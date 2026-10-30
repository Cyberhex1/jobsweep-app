// Job source connectors. Each returns NormalizedJob[]; failures are reported, never thrown past the source.

import type { JobRemoteType, NormalizedJob, PayUnit } from '@shared/types'
import { stripHtml } from '@core/text'
import { detectPlatform, parseWorkdayUrl } from '@core/platform'

export interface SearchQuery {
  keywords: string[] // empty = generic/newest
  location: string // "Raleigh, NC"
  remoteOnly: boolean
  radiusMiles: number
}

export interface ConnectorContext {
  fetchJson: (url: string, init?: RequestInit) => Promise<any>
  fetchText: (url: string, init?: RequestInit) => Promise<string>
  secret: (key: string) => string | null
  budget: (source: string, cost: number) => boolean // false when the free quota would be exceeded
  settings: { workdayTenants: string[]; companyBoards: { platform: string; slug: string; company: string }[]; email: string }
  log: (msg: string) => void
}

export interface Connector {
  id: string
  needsKey?: string
  search(q: SearchQuery, ctx: ConnectorContext): Promise<NormalizedJob[]>
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export function remoteTypeOf(...texts: (string | undefined | boolean)[]): JobRemoteType {
  const t = texts
    .filter((x) => typeof x === 'string')
    .join(' ')
    .toLowerCase()
  if (texts.includes(true)) return 'remote'
  if (/\bhybrid\b/.test(t)) return 'hybrid'
  if (/\b(remote|work from home|wfh|telework|anywhere)\b/.test(t)) return 'remote'
  if (/\b(on-?site|in-?office|in person)\b/.test(t)) return 'onsite'
  return 'unknown'
}

/** "$42,683.24 - $46,615.00 Annually", "$20 - $25 an hour", "$65K–$80K". */
export function parsePay(s: string | undefined): { payMin?: number; payMax?: number; payUnit?: PayUnit } {
  if (!s) return {}
  const nums = [...s.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)].map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
  if (!nums.length) return {}
  let [min, max] = [nums[0], nums[1] ?? nums[0]]
  if (min > max) [min, max] = max / min > 0.2 ? [max, min] : [max, max]
  const hourly = /hour|hr\b|hourly/i.test(s) || max < 300
  return { payMin: min, payMax: max, payUnit: hourly ? 'hourly' : 'salary' }
}

const kwQuery = (q: SearchQuery) => (q.keywords.length ? q.keywords : [''])

function matchesKeywords(title: string, desc: string, q: SearchQuery): boolean {
  if (!q.keywords.length) return true
  const t = `${title} ${desc.slice(0, 2000)}`.toLowerCase()
  return q.keywords.some((k) =>
    k
      .toLowerCase()
      .split(/\s+/)
      .every((w) => t.includes(w))
  )
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    })
  )
  return out
}

// ---------------- Government ----------------

export const usajobs: Connector = {
  id: 'usajobs',
  needsKey: 'key.usajobs',
  async search(q, ctx) {
    const key = ctx.secret('key.usajobs')
    if (!key || !ctx.settings.email) return []
    const out: NormalizedJob[] = []
    for (const kw of kwQuery(q).slice(0, 5)) {
      const params = new URLSearchParams({ ResultsPerPage: '50', SortField: 'opendate', SortDirection: 'Desc' })
      if (kw) params.set('Keyword', kw)
      if (q.remoteOnly) params.set('RemoteIndicator', 'True')
      else if (q.location) {
        params.set('LocationName', q.location)
        params.set('Radius', String(q.radiusMiles || 50))
      }
      const data = await ctx.fetchJson(`https://data.usajobs.gov/api/search?${params}`, {
        headers: { Host: 'data.usajobs.gov', 'User-Agent': ctx.settings.email, 'Authorization-Key': key }
      })
      for (const item of data?.SearchResult?.SearchResultItems ?? []) {
        const d = item.MatchedObjectDescriptor
        const pay = d.PositionRemuneration?.[0]
        const details = d.UserArea?.Details ?? {}
        out.push({
          source: 'usajobs',
          externalId: String(d.PositionID ?? item.MatchedObjectId),
          url: d.PositionURI,
          applyUrl: d.ApplyURI?.[0] ?? d.PositionURI,
          company: d.OrganizationName ?? d.DepartmentName ?? 'U.S. Government',
          title: d.PositionTitle,
          location: d.PositionLocationDisplay ?? '',
          remoteType: details.RemoteIndicator ? 'remote' : details.TeleworkEligible ? 'hybrid' : 'onsite',
          payMin: pay ? Number(pay.MinimumRange) : undefined,
          payMax: pay ? Number(pay.MaximumRange) : undefined,
          payUnit: pay?.RateIntervalCode === 'PH' ? 'hourly' : 'salary',
          description: [details.JobSummary, d.QualificationSummary, (details.MajorDuties ?? []).join('\n')].filter(Boolean).join('\n\n'),
          postedAt: d.PublicationStartDate,
          platform: 'usajobs'
        })
      }
    }
    return out
  }
}

export const governmentjobs: Connector = {
  id: 'governmentjobs',
  async search(q, ctx) {
    if (!q.location && !q.remoteOnly) return []
    const out: NormalizedJob[] = []
    const seen = new Set<string>()
    for (const kw of kwQuery(q).slice(0, 4)) {
      const params = new URLSearchParams({ location: q.location || 'United States', distance: String(Math.max(25, q.radiusMiles || 50)), sort: 'date', isDescendingSort: 'True' })
      if (kw) params.set('keyword', kw)
      const html = await ctx.fetchText(`https://www.governmentjobs.com/jobs?${params}`, { headers: { 'User-Agent': UA } })
      for (const m of html.matchAll(/<li class="job-item" data-job-id="([^"]+)"[\s\S]*?<\/li>/g)) {
        const block = m[0]
        const id = m[1]
        if (seen.has(id)) continue
        seen.add(id)
        const href = /class="job-details-link" href="([^"]+)">([^<]+)</.exec(block)
        if (!href) continue
        const org = /job-organization">([^<]+)</.exec(block)?.[1]?.trim() ?? 'Government'
        const loc = /job-location">([^<]+)</.exec(block)?.[1]?.trim() ?? ''
        const info = [...block.matchAll(/<div class="primaryInfo">\s*([^<]+?)\s*<\/div>/g)].map((x) => x[1]).join(' ')
        const title = stripHtml(href[2])
        out.push({
          source: 'governmentjobs',
          externalId: id,
          url: `https://www.governmentjobs.com${href[1]}`,
          applyUrl: `https://www.governmentjobs.com${href[1]}`,
          company: stripHtml(org),
          title,
          location: stripHtml(loc),
          remoteType: remoteTypeOf(title, loc),
          ...parsePay(info),
          description: '',
          platform: 'neogov'
        })
      }
    }
    // Descriptions live on detail pages; fetch for the newest few.
    await pool(out.slice(0, 40), 4, async (j) => {
      try {
        const page = await ctx.fetchText(j.url, { headers: { 'User-Agent': UA } })
        const start = page.indexOf('id="details-info"')
        const end = page.indexOf('id="details-benefits"')
        if (start > 0) j.description = stripHtml(page.slice(start, end > start ? end : start + 60000)).slice(0, 12000)
        const posted = /Posted\s*<\/span>\s*<span[^>]*>\s*([^<]+)</i.exec(page) ?? /"datePosted"\s*:\s*"([^"]+)"/.exec(page)
        if (posted) {
          const d = new Date(posted[1])
          if (!isNaN(d.getTime())) j.postedAt = d.toISOString()
        }
        j.remoteType = j.remoteType === 'unknown' ? remoteTypeOf(j.description.slice(0, 3000)) : j.remoteType
      } catch {
        /* keep listing data */
      }
    })
    return out.filter((j) => matchesKeywords(j.title, j.description, q))
  }
}

/** Workday career sites (NC state government + any company tenants the user adds). */
function workdayConnector(id: 'ncstate' | 'workday'): Connector {
  return {
    id,
    async search(q, ctx) {
      const out: NormalizedJob[] = []
      for (const careersUrl of ctx.settings.workdayTenants) {
        const w = parseWorkdayUrl(careersUrl)
        if (!w || (w.tenant === 'nc') !== (id === 'ncstate')) continue
        const isNc = w.tenant === 'nc'
        const base = `https://${w.host}/wday/cxs/${w.tenant}/${w.site}`
        const found: { title: string; externalPath: string; locationsText: string; postedOn: string }[] = []
        for (const kw of kwQuery(q).slice(0, 5)) {
          for (let offset = 0; offset < 100; offset += 20) {
            const data = await ctx.fetchJson(`${base}/jobs`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json', 'User-Agent': UA },
              body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: kw })
            })
            const posts = data?.jobPostings ?? []
            for (const p of posts) if (!found.some((f) => f.externalPath === p.externalPath)) found.push(p)
            if (posts.length < 20) break
          }
        }
        const companyName = isNc ? 'State of North Carolina' : w.tenant.replace(/^\w/, (c) => c.toUpperCase())
        const jobs = await pool(found.slice(0, 60), 4, async (p): Promise<NormalizedJob | null> => {
          try {
            const d = await ctx.fetchJson(`${base}${p.externalPath}`, { headers: { accept: 'application/json', 'User-Agent': UA } })
            const info = d?.jobPostingInfo ?? {}
            const hiring = d?.hiringOrganization?.name
            const desc = stripHtml(info.jobDescription ?? '')
            const url = info.externalUrl ?? `https://${w.host}/${w.site}${p.externalPath}`
            return {
              source: isNc ? 'ncstate' : 'workday',
              externalId: info.jobReqId ?? p.externalPath,
              url,
              applyUrl: url,
              company: isNc && hiring ? `NC ${hiring}` : (hiring ?? companyName),
              title: p.title,
              location: info.location ?? p.locationsText ?? '',
              remoteType: remoteTypeOf(info.remoteType, p.locationsText, info.location, desc.slice(0, 1500)),
              ...parsePay(/\$[\d,]+(\.\d+)?\s*(-|–|to)\s*\$[\d,]+(\.\d+)?[^.\n]{0,30}/.exec(desc)?.[0]),
              description: desc,
              postedAt: info.startDate ? new Date(info.startDate).toISOString() : undefined,
              platform: 'workday'
            }
          } catch {
            return null
          }
        })
        out.push(...jobs.filter((j): j is NormalizedJob => !!j))
      }
      return out
    }
  }
}

export const ncstate = workdayConnector('ncstate')
export const workday = workdayConnector('workday')

// ---------------- Company job boards ----------------

export const greenhouse: Connector = {
  id: 'greenhouse',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    for (const b of ctx.settings.companyBoards.filter((x) => x.platform === 'greenhouse')) {
      const data = await ctx.fetchJson(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`)
      for (const j of data?.jobs ?? []) {
        const desc = stripHtml(stripHtml(j.content ?? ''))
        if (!matchesKeywords(j.title, desc, q)) continue
        out.push({
          source: 'greenhouse',
          externalId: `${b.slug}:${j.id}`,
          url: j.absolute_url,
          applyUrl: j.absolute_url,
          company: b.company,
          title: j.title,
          location: j.location?.name ?? '',
          remoteType: remoteTypeOf(j.location?.name, j.title),
          description: desc,
          postedAt: j.updated_at,
          platform: 'greenhouse',
          ...parsePay(/\$[\d,]+[^\n]{0,40}/.exec(desc)?.[0])
        })
      }
    }
    return out
  }
}

export const lever: Connector = {
  id: 'lever',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    for (const b of ctx.settings.companyBoards.filter((x) => x.platform === 'lever')) {
      const data = await ctx.fetchJson(`https://api.lever.co/v0/postings/${b.slug}?mode=json`)
      for (const j of Array.isArray(data) ? data : []) {
        const desc = [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${stripHtml(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n')
        if (!matchesKeywords(j.text, desc, q)) continue
        const sr = j.salaryRange
        out.push({
          source: 'lever',
          externalId: j.id,
          url: j.hostedUrl,
          applyUrl: j.applyUrl ?? j.hostedUrl,
          company: b.company,
          title: j.text,
          location: j.categories?.location ?? '',
          remoteType: j.workplaceType === 'remote' ? 'remote' : j.workplaceType === 'hybrid' ? 'hybrid' : remoteTypeOf(j.categories?.location),
          description: desc,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
          platform: 'lever',
          ...(sr ? { payMin: sr.min, payMax: sr.max, payUnit: /hour/i.test(sr.interval ?? '') ? 'hourly' : 'salary' } : {})
        })
      }
    }
    return out
  }
}

export const ashby: Connector = {
  id: 'ashby',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    for (const b of ctx.settings.companyBoards.filter((x) => x.platform === 'ashby')) {
      const data = await ctx.fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${b.slug}?includeCompensation=true`)
      for (const j of data?.jobs ?? []) {
        const desc = j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? '')
        if (!matchesKeywords(j.title, desc, q)) continue
        out.push({
          source: 'ashby',
          externalId: j.id ?? j.jobUrl,
          url: j.jobUrl,
          applyUrl: j.applyUrl ?? j.jobUrl,
          company: b.company,
          title: j.title,
          location: j.location ?? '',
          remoteType: j.isRemote ? 'remote' : remoteTypeOf(j.location, j.workplaceType),
          description: desc,
          postedAt: j.publishedAt,
          platform: 'ashby',
          ...parsePay(j.compensation?.compensationTierSummary)
        })
      }
    }
    return out
  }
}

export const smartrecruiters: Connector = {
  id: 'smartrecruiters',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    for (const b of ctx.settings.companyBoards.filter((x) => x.platform === 'smartrecruiters')) {
      const data = await ctx.fetchJson(`https://api.smartrecruiters.com/v1/companies/${b.slug}/postings?limit=100${q.keywords[0] ? `&q=${encodeURIComponent(q.keywords[0])}` : ''}`)
      const list = (data?.content ?? []).slice(0, 40)
      const jobs = await pool(list, 4, async (p: any): Promise<NormalizedJob | null> => {
        try {
          const d = await ctx.fetchJson(`https://api.smartrecruiters.com/v1/companies/${b.slug}/postings/${p.id}`)
          const sections = d?.jobAd?.sections ?? {}
          const desc = stripHtml(
            Object.values(sections)
              .map((s: any) => `${s.title ?? ''}\n${s.text ?? ''}`)
              .join('\n\n')
          )
          const loc = [p.location?.city, p.location?.region].filter(Boolean).join(', ')
          return {
            source: 'smartrecruiters',
            externalId: p.id,
            url: d.postingUrl ?? `https://jobs.smartrecruiters.com/${b.slug}/${p.id}`,
            applyUrl: d.applyUrl ?? d.postingUrl,
            company: b.company,
            title: p.name,
            location: loc,
            remoteType: p.location?.remote ? 'remote' : remoteTypeOf(loc),
            description: desc,
            postedAt: p.releasedDate,
            platform: 'smartrecruiters'
          }
        } catch {
          return null
        }
      })
      out.push(...jobs.filter((j): j is NormalizedJob => !!j && matchesKeywords(j.title, j.description, q)))
    }
    return out
  }
}

// ---------------- Aggregators & remote feeds ----------------

export const adzuna: Connector = {
  id: 'adzuna',
  needsKey: 'key.adzuna',
  async search(q, ctx) {
    const raw = ctx.secret('key.adzuna')
    if (!raw) return []
    const [appId, appKey] = raw.split(':')
    const out: NormalizedJob[] = []
    for (const kw of kwQuery(q).slice(0, 4)) {
      if (!ctx.budget('adzuna', 1)) break
      const params = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: '50', sort_by: 'date', 'content-type': 'application/json' })
      if (kw) params.set('what', kw)
      if (q.remoteOnly) params.set('what_or', 'remote')
      else if (q.location) {
        params.set('where', q.location)
        params.set('distance', String(Math.round((q.radiusMiles || 30) * 1.6)))
      }
      const data = await ctx.fetchJson(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`)
      for (const j of data?.results ?? [])
        out.push({
          source: 'adzuna',
          externalId: String(j.id),
          url: j.redirect_url,
          company: j.company?.display_name ?? 'Unknown',
          title: stripHtml(j.title),
          location: j.location?.display_name ?? '',
          remoteType: remoteTypeOf(j.title, j.description),
          ...(j.salary_is_predicted === '1' ? {} : { payMin: j.salary_min, payMax: j.salary_max, payUnit: 'salary' as const }),
          description: stripHtml(j.description ?? ''),
          postedAt: j.created
        })
    }
    return out
  }
}

export const jsearch: Connector = {
  id: 'jsearch',
  needsKey: 'key.jsearch',
  async search(q, ctx) {
    const key = ctx.secret('key.jsearch')
    if (!key) return []
    const out: NormalizedJob[] = []
    for (const kw of kwQuery(q).slice(0, 2)) {
      if (!ctx.budget('jsearch', 1)) break
      const query = `${kw || 'jobs'} ${q.remoteOnly ? 'remote' : `in ${q.location}`}`.trim()
      const data = await ctx.fetchJson(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=1&num_pages=1&date_posted=week`, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
      })
      for (const j of data?.data ?? []) {
        // Prefer a direct company apply link over job boards.
        const direct = (j.apply_options ?? []).find((o: any) => o.is_direct)?.apply_link
        out.push({
          source: 'jsearch',
          externalId: j.job_id,
          url: j.job_apply_link,
          applyUrl: direct ?? j.job_apply_link,
          company: j.employer_name,
          companyDomain: j.employer_website ? new URL(j.employer_website).hostname.replace(/^www\./, '') : undefined,
          title: j.job_title,
          location: [j.job_city, j.job_state].filter(Boolean).join(', '),
          remoteType: j.job_is_remote ? 'remote' : 'unknown',
          payMin: j.job_min_salary ?? undefined,
          payMax: j.job_max_salary ?? undefined,
          payUnit: j.job_salary_period === 'HOUR' ? 'hourly' : 'salary',
          description: j.job_description ?? '',
          postedAt: j.job_posted_at_datetime_utc,
          platform: direct ? detectPlatform(direct) : undefined
        })
      }
    }
    return out
  }
}

export const remotive: Connector = {
  id: 'remotive',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    for (const kw of kwQuery(q).slice(0, 4)) {
      const data = await ctx.fetchJson(`https://remotive.com/api/remote-jobs?limit=60${kw ? `&search=${encodeURIComponent(kw)}` : ''}`)
      for (const j of data?.jobs ?? []) {
        if (j.candidate_required_location && !/usa|united states|worldwide|anywhere|americas|north america/i.test(j.candidate_required_location)) continue
        out.push({
          source: 'remotive',
          externalId: String(j.id),
          url: j.url,
          company: j.company_name,
          title: j.title,
          location: `Remote (${j.candidate_required_location || 'Anywhere'})`,
          remoteType: 'remote',
          ...parsePay(j.salary),
          description: stripHtml(j.description ?? ''),
          postedAt: j.publication_date
        })
      }
    }
    return out
  }
}

export const remoteok: Connector = {
  id: 'remoteok',
  async search(q, ctx) {
    const data = await ctx.fetchJson('https://remoteok.com/api', { headers: { 'User-Agent': UA } })
    const out: NormalizedJob[] = []
    for (const j of (Array.isArray(data) ? data : []).slice(1)) {
      const desc = stripHtml(j.description ?? '')
      if (!matchesKeywords(j.position ?? '', desc, q)) continue
      out.push({
        source: 'remoteok',
        externalId: String(j.id),
        url: j.url,
        applyUrl: j.apply_url,
        company: j.company,
        title: j.position,
        location: j.location || 'Remote',
        remoteType: 'remote',
        payMin: j.salary_min || undefined,
        payMax: j.salary_max || undefined,
        payUnit: 'salary',
        description: desc,
        postedAt: j.date
      })
    }
    return out
  }
}

export const themuse: Connector = {
  id: 'themuse',
  async search(q, ctx) {
    const out: NormalizedJob[] = []
    const locs = q.remoteOnly ? ['Flexible / Remote'] : [q.location, 'Flexible / Remote'].filter(Boolean)
    for (let page = 0; page < 3; page++) {
      const params = new URLSearchParams({ page: String(page), descending: 'true' })
      for (const l of locs) params.append('location', l)
      const data = await ctx.fetchJson(`https://www.themuse.com/api/public/jobs?${params}`)
      for (const j of data?.results ?? []) {
        const desc = stripHtml(j.contents ?? '')
        if (!matchesKeywords(j.name, desc, q)) continue
        const loc = (j.locations ?? []).map((l: any) => l.name).join('; ')
        out.push({
          source: 'themuse',
          externalId: String(j.id),
          url: j.refs?.landing_page,
          company: j.company?.name ?? 'Unknown',
          title: j.name,
          location: loc,
          remoteType: remoteTypeOf(loc),
          description: desc,
          postedAt: j.publication_date
        })
      }
    }
    return out
  }
}

export const arbeitnow: Connector = {
  id: 'arbeitnow',
  async search(q, ctx) {
    const data = await ctx.fetchJson('https://www.arbeitnow.com/api/job-board-api')
    return (data?.data ?? [])
      .filter((j: any) => j.remote && matchesKeywords(j.title, j.description ?? '', q))
      .map((j: any) => ({
        source: 'arbeitnow',
        externalId: j.slug,
        url: j.url,
        company: j.company_name,
        title: j.title,
        location: j.location || 'Remote',
        remoteType: 'remote' as const,
        description: stripHtml(j.description ?? ''),
        postedAt: new Date(j.created_at * 1000).toISOString()
      }))
  }
}

export const CONNECTORS: Connector[] = [governmentjobs, ncstate, workday, usajobs, greenhouse, lever, ashby, smartrecruiters, adzuna, jsearch, remotive, remoteok, themuse, arbeitnow]
