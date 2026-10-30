// Job pipeline: fetch from sources -> dedupe -> score -> scam check -> blocklist, plus the board view.

import type { Job, NormalizedJob, Profile } from '@shared/types'
import { SOURCE_LABELS } from '@shared/defaults'
import { applyPriority, fingerprint, isSameJob } from '@core/dedupe'
import { scoreJob, interviewScore } from '@core/match'
import { scamCheck } from '@core/scam'
import { buildBlocklist, isBlocked } from '@core/blocklist'
import { detectPlatform } from '@core/platform'
import { orderSources, sourceAffinity } from '@core/learning'
import { companyKey } from '@core/text'
import type { Db } from './db'
import { CONNECTORS, type ConnectorContext, type SearchQuery } from './sources/connectors'

export interface RefreshReport {
  bySource: Record<string, { found: number; added: number; error?: string }>
  added: number
  merged: number
}

const BUDGETS: Record<string, { per: 'day' | 'month'; limit: number }> = {
  adzuna: { per: 'day', limit: 200 },
  jsearch: { per: 'month', limit: 180 }
}

// Bump when scoreJob changes so saved jobs are re-scored on the next launch.
const SCORE_VERSION = 2

// Boards that list every kind of remote job; off-field jobs from them are hidden.
const WIDE_BOARDS = new Set(['remotive', 'remoteok', 'arbeitnow', 'themuse'])

export class JobService {
  constructor(
    private db: Db,
    private log: (m: string) => void = () => {}
  ) {}

  buildQuery(profile: Profile): SearchQuery {
    const s = this.db.getSettings()
    const keywords = [...new Set([...profile.roles, ...s.searchKeywords].map((k) => k.trim()).filter(Boolean))].slice(0, 6)
    const loc = profile.locations[0]?.place || [profile.city, profile.state].filter(Boolean).join(', ')
    return { keywords, location: loc, remoteOnly: profile.remoteMode === 'remote_only', radiusMiles: profile.locations[0]?.radiusMiles ?? 50 }
  }

  private ctx(): ConnectorContext {
    const s = this.db.getSettings()
    const profile = this.db.getProfile()
    const fetchRaw = async (url: string, init?: RequestInit) => {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`)
      return r
    }
    return {
      fetchJson: async (url, init) => (await fetchRaw(url, init)).json(),
      fetchText: async (url, init) => (await fetchRaw(url, init)).text(),
      secret: (k) => this.db.getSecret(k),
      budget: (source, cost) => {
        const b = BUDGETS[source]
        if (!b) return true
        const period = b.per === 'day' ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7)
        const key = `budget.${source}.${period}`
        const used = this.db.getKv<number>(key, 0)
        if (used + cost > b.limit) return false
        this.db.setKv(key, used + cost)
        return true
      },
      settings: { workdayTenants: s.workdayTenants, companyBoards: s.companyBoards, email: profile.email },
      log: this.log
    }
  }

  async refresh(onProgress: (source: string, status: string) => void = () => {}): Promise<RefreshReport> {
    const s = this.db.getSettings()
    const profile = this.db.getProfile()
    const q = this.buildQuery(profile)
    const ctx = this.ctx()
    const report: RefreshReport = { bySource: {}, added: 0, merged: 0 }
    const enabled = CONNECTORS.filter((c) => s.sources[c.id] !== false)
    await Promise.all(
      enabled.map(async (c) => {
        onProgress(c.id, 'searching')
        try {
          const jobs = await c.search(q, ctx)
          let added = 0
          for (const j of jobs) {
            const r = this.upsert(j)
            if (r === 'added') added++
            if (r === 'merged') report.merged++
          }
          report.bySource[c.id] = { found: jobs.length, added }
          report.added += added
          onProgress(c.id, `found ${jobs.length}`)
        } catch (e) {
          report.bySource[c.id] = { found: 0, added: 0, error: (e as Error).message }
          onProgress(c.id, `error: ${(e as Error).message}`)
        }
      })
    )
    this.rescoreAll()
    this.db.setKv('jobs.lastRefresh', new Date().toISOString())
    return report
  }

  /** Insert a job, or merge it into an existing duplicate. */
  upsert(n: NormalizedJob): 'added' | 'merged' | 'existing' {
    if (!n.title || !n.url) return 'existing'
    const existing = this.db.findJobBySource(n.source, n.externalId)
    if (existing) {
      this.db.addSighting(existing.id, n.source, n.url)
      if (!existing.description && n.description) this.db.updateJob(existing.id, { description: n.description })
      return 'existing'
    }
    const fp = fingerprint(n)
    const dup = this.db.findJobByFingerprint(fp) ?? this.db.candidatesForDedupe(n.company).find((c) => isSameJob(c, n)) ?? null
    if (dup) {
      this.db.addSighting(dup.id, n.source, n.url)
      // Prefer the company's own application site as the place to apply.
      const candidate = n.applyUrl ?? n.url
      if (applyPriority(n.source, candidate) > applyPriority(dup.source, dup.applyUrl ?? dup.url)) this.db.updateJob(dup.id, { applyUrl: candidate, platform: detectPlatform(candidate) })
      if (n.description.length > dup.description.length) this.db.updateJob(dup.id, { description: n.description })
      if (dup.payMin == null && n.payMin != null) this.db.updateJob(dup.id, { payMin: n.payMin, payMax: n.payMax, payUnit: n.payUnit })
      return 'merged'
    }
    const platform = n.platform ?? detectPlatform(n.applyUrl ?? n.url)
    const job = this.db.insertJob(n, { fingerprint: fp, platform })
    this.score(job)
    return 'added'
  }

  score(job: Job) {
    const profile = this.db.getProfile()
    const resume = this.db.defaultVersion()?.data ?? null
    const block = buildBlocklist(this.db.listBlocklist(), profile.currentEmployer)
    const m = scoreJob(job, profile, resume)
    const scam = scamCheck(job, { timesSeen: this.db.timesSeen(job.id), firstSeen: job.firstSeen })
    const stats = this.responseStats()
    const groups = [stats.bySource[job.source], stats.byPlatform[job.platform ?? 'generic']].filter((g): g is { responses: number; applied: number } => !!g)
    this.db.updateJob(job.id, {
      matchScore: m.score,
      interviewScore: interviewScore(m.score, groups, stats.globalRate),
      matchReasons: m.reasons,
      missingKeywords: m.missingKeywords,
      offField: m.offField,
      scamScore: scam.score,
      scamReasons: scam.reasons,
      blocked: !!isBlocked(job.company, job.applyUrl ?? job.url, block)
    })
  }

  private statsCache: { at: number; v: ReturnType<JobService['computeStats']> } | null = null
  private responseStats() {
    if (!this.statsCache || Date.now() - this.statsCache.at > 60000) this.statsCache = { at: Date.now(), v: this.computeStats() }
    return this.statsCache.v
  }
  private computeStats() {
    const apps = this.db.listApplications().filter((a) => a.submittedAt && a.job)
    const responded = (st: string) => ['interview', 'assessment', 'offer'].includes(st)
    const bySource: Record<string, { responses: number; applied: number }> = {}
    const byPlatform: Record<string, { responses: number; applied: number }> = {}
    for (const a of apps) {
      const s = (bySource[a.job!.source] ??= { responses: 0, applied: 0 })
      const p = (byPlatform[a.job!.platform ?? 'generic'] ??= { responses: 0, applied: 0 })
      s.applied++
      p.applied++
      if (responded(a.status)) {
        s.responses++
        p.responses++
      }
    }
    const total = apps.length
    const globalRate = total ? apps.filter((a) => responded(a.status)).length / total : 0
    return { bySource, byPlatform, globalRate }
  }

  /** Re-score saved jobs once after the scoring rules change. */
  rescoreIfStale() {
    if (this.db.getKv<number>('jobs.scoreVersion', 0) >= SCORE_VERSION) return
    this.rescoreAll()
    this.db.setKv('jobs.scoreVersion', SCORE_VERSION)
  }

  rescoreAll() {
    this.statsCache = null
    for (const j of this.db.allJobs({ includeHidden: true })) this.score(j)
  }

  /** Board: one card per source with its top 5 matches, ordered by learned affinity. */
  board(): { source: string; label: string; total: number; jobs: Job[] }[] {
    const s = this.db.getSettings()
    const jobs = this.visibleJobs()
    const sources = Object.keys(SOURCE_LABELS).filter((k) => s.sources[k] !== false)
    const aff = sourceAffinity(this.db.signals())
    const defaults: Record<string, number> = { imported: 3, ncstate: 2, governmentjobs: 2, usajobs: 1.5, workday: 1, greenhouse: 1, lever: 1, ashby: 1 }
    const hasProfile = this.db.getProfile().roles.length > 0 || !!this.db.defaultVersion()
    const sortKey = (j: Job) => (hasProfile ? j.interviewScore : new Date(j.postedAt ?? j.firstSeen).getTime() / 1e10)
    return orderSources(sources, aff, defaults)
      .map((src) => {
        const list = jobs.filter((j) => j.source === src || j.sightings.some((x) => x.source === src))
        return { source: src, label: SOURCE_LABELS[src] ?? src, total: list.length, jobs: [...list].sort((a, b) => sortKey(b) - sortKey(a)).slice(0, 5) }
      })
      .filter((c) => c.total > 0 || c.source === 'imported')
  }

  visibleJobs(): Job[] {
    const s = this.db.getSettings()
    return this.db.allJobs().filter((j) => j.scamScore < Math.max(s.maxScamScore + 30, 70) && !(j.offField && WIDE_BOARDS.has(j.source)))
  }

  list(f: { source?: string; sort?: 'newest' | 'match' | 'interview' | 'pay'; remote?: string; minPay?: number; q?: string; saved?: boolean; limit?: number; offset?: number }): { total: number; jobs: Job[] } {
    let jobs = this.visibleJobs()
    if (f.source) jobs = jobs.filter((j) => j.source === f.source || j.sightings.some((x) => x.source === f.source))
    if (f.remote && f.remote !== 'any') jobs = jobs.filter((j) => j.remoteType === f.remote)
    if (f.saved) jobs = jobs.filter((j) => j.saved)
    if (f.q) {
      const q = f.q.toLowerCase()
      jobs = jobs.filter((j) => `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q))
    }
    const annual = (j: Job) => (j.payMax ?? j.payMin ?? 0) * (j.payUnit === 'hourly' ? 2080 : 1)
    if (f.minPay) jobs = jobs.filter((j) => annual(j) >= f.minPay!)
    const date = (j: Job) => new Date(j.postedAt ?? j.firstSeen).getTime()
    const sorters: Record<string, (a: Job, b: Job) => number> = {
      newest: (a, b) => date(b) - date(a),
      match: (a, b) => b.matchScore - a.matchScore,
      interview: (a, b) => b.interviewScore - a.interviewScore,
      pay: (a, b) => annual(b) - annual(a)
    }
    jobs.sort(sorters[f.sort ?? 'interview'])
    const off = f.offset ?? 0
    return { total: jobs.length, jobs: jobs.slice(off, off + (f.limit ?? 50)) }
  }

  /** Jobs eligible for automatic applying, best first. */
  candidatesForApply(limit: number): Job[] {
    const s = this.db.getSettings()
    return this.visibleJobs()
      .filter((j) => !j.blocked && !j.dismissed && j.scamScore <= s.maxScamScore && j.matchScore >= s.minMatchScore && !this.db.applicationForJob(j.id))
      .filter((j) => this.db.companyAppsLast30(j.company) < s.perCompanyMonthlyCap)
      .sort((a, b) => b.interviewScore - a.interviewScore)
      .slice(0, limit)
  }

  /** Discover company boards from imported/aggregated jobs so future refreshes can query them directly. */
  learnBoardsFromJobs() {
    const s = this.db.getSettings()
    const boards = [...s.companyBoards]
    const tenants = [...s.workdayTenants]
    for (const j of this.db.allJobs({ includeHidden: true })) {
      const url = j.applyUrl ?? j.url
      let m: RegExpExecArray | null
      if ((m = /boards\.greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)/.exec(url)) || (m = /job-boards\.greenhouse\.io\/([\w-]+)/.exec(url))) add('greenhouse', m[1], j.company)
      else if ((m = /jobs\.lever\.co\/([\w-]+)/.exec(url))) add('lever', m[1], j.company)
      else if ((m = /jobs\.ashbyhq\.com\/([\w-]+)/.exec(url))) add('ashby', m[1], j.company)
      else if ((m = /(https:\/\/[\w-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[\w-]+)/.exec(url))) {
        const base = m[1].replace(/\/[a-z]{2}-[A-Z]{2}\//, '/')
        if (!tenants.includes(base)) tenants.push(base)
      }
    }
    function add(platform: 'greenhouse' | 'lever' | 'ashby', slug: string, company: string) {
      if (!boards.some((b) => b.platform === platform && b.slug === slug)) boards.push({ platform, slug, company })
    }
    this.db.saveSettings({ companyBoards: boards, workdayTenants: tenants })
    return { boards: boards.length, tenants: tenants.length }
  }

  companyKey = companyKey
}
