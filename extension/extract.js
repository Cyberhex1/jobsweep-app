// Reads the job currently on screen. Runs only when the user clicks Import.
// eslint-disable-next-line no-unused-vars
function jobsweepExtract() {
  const txt = (sel) => {
    for (const s of [].concat(sel)) {
      const el = document.querySelector(s)
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim()
    }
    return ''
  }
  const host = location.hostname
  const out = { url: location.href, title: '', company: '', location: '', description: '', externalApplyUrl: '', companyUrl: '' }

  // 1) schema.org JobPosting (many sites include it)
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent)
      const list = [].concat(data, data['@graph'] || [])
      const jp = list.find((x) => x && x['@type'] === 'JobPosting')
      if (jp) {
        out.title = jp.title || ''
        out.company = (jp.hiringOrganization && jp.hiringOrganization.name) || ''
        out.companyUrl = (jp.hiringOrganization && (jp.hiringOrganization.sameAs || jp.hiringOrganization.url)) || ''
        const loc = [].concat(jp.jobLocation || [])[0]
        if (loc && loc.address) out.location = [loc.address.addressLocality, loc.address.addressRegion].filter(Boolean).join(', ')
        if (jp.jobLocationType === 'TELECOMMUTE') out.location = (out.location ? out.location + ' · ' : '') + 'Remote'
        const div = document.createElement('div')
        div.innerHTML = jp.description || ''
        out.description = div.innerText
        out.postedAt = jp.datePosted
        break
      }
    } catch (e) {}
  }

  // 2) Site-specific selectors
  if (host.includes('linkedin.com')) {
    const id = new URLSearchParams(location.search).get('currentJobId') || (location.pathname.match(/jobs\/view\/(\d+)/) || [])[1]
    if (id) out.url = `https://www.linkedin.com/jobs/view/${id}/`
    out.title = out.title || txt(['.job-details-jobs-unified-top-card__job-title h1', '.jobs-unified-top-card__job-title', '.t-24.t-bold', 'h1'])
    out.company = out.company || txt(['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name'])
    out.location = out.location || txt(['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet'])
    out.description = out.description || txt(['#job-details', '.jobs-description__content', '.jobs-box__html-content'])
    const easy = document.querySelector('.jobs-apply-button')
    out.easyApply = !!easy && /easy apply/i.test(easy.innerText)
  } else if (host.includes('indeed.com')) {
    out.title = out.title || txt(['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1.jobsearch-JobInfoHeader-title', 'h1'])
    out.company = out.company || txt(['[data-testid="inlineHeader-companyName"]', '[data-company-name]', '.jobsearch-CompanyInfoContainer a'])
    out.location = out.location || txt(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'])
    out.description = out.description || txt(['#jobDescriptionText'])
    const ext = document.querySelector('#applyButtonLinkContainer a, a[href*="applystart"], button[href]')
    if (ext && ext.getAttribute('href')) out.externalApplyUrl = new URL(ext.getAttribute('href'), location.href).href
  } else if (host.includes('glassdoor.com')) {
    out.title = out.title || txt(['[data-test="job-title"]', 'h1'])
    out.company = out.company || txt(['[data-test="employer-name"]', '[data-test="employerName"]'])
    out.location = out.location || txt(['[data-test="location"]'])
    out.description = out.description || txt(['[class*="JobDetails_jobDescription"]', '.jobDescriptionContent'])
  } else if (host.includes('ziprecruiter.com')) {
    out.title = out.title || txt(['h1'])
    out.company = out.company || txt(['[class*="company_name"]', '.hiring_company'])
    out.description = out.description || txt(['.job_description', '[class*="job_description"]'])
  }

  // 3) Generic fallbacks
  out.title = out.title || txt(['h1']) || document.title
  if (!out.description) {
    const main = document.querySelector('main, article, [role="main"]') || document.body
    out.description = main.innerText.slice(0, 15000)
  }
  // An "Apply" link that leaves this site is usually the company's own application.
  if (!out.externalApplyUrl) {
    for (const a of document.querySelectorAll('a[href]')) {
      if (!/apply/i.test(a.innerText || a.getAttribute('aria-label') || '')) continue
      try {
        const u = new URL(a.getAttribute('href'), location.href)
        if (u.hostname && !u.hostname.endsWith(host.replace(/^www\./, ''))) {
          out.externalApplyUrl = u.href
          break
        }
      } catch (e) {}
    }
  }
  out.description = out.description.slice(0, 20000)
  return out
}
