import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { emptyResume, parseResumeText, resumeToText } from '@core/resume/parse'
import { lintResume, atsScore } from '@core/resume/atsLint'
import { applyAtsFixes, describeFixes } from '@core/resume/fixes'
import { extractSkills, suggestRoles, rolesFromResume } from '@core/keywords'
import { scoreJob, annualize, interviewScore } from '@core/match'
import { fingerprint, isSameJob } from '@core/dedupe'
import { scamCheck } from '@core/scam'
import { buildBlocklist, isBlocked } from '@core/blocklist'
import { scrubPII, restorePII } from '@core/pii'
import { capTier } from '@core/risk'
import { wordDiff, changeRatio, lineChanges } from '@core/diff'
import { detectPlatform, parseWorkdayUrl } from '@core/platform'
import { truthCheck, yearsFromDates } from '@core/truthGuard'
import { applyTailorOps, tailorDeterministic } from '@core/tailor'
import { fillTemplate, checkTweak } from '@core/coverLetter'
import { matchKey, chooseOption, resolveField, SEED_QUESTIONS } from '@core/fields'
import { recommendModels, setupPrompt } from '@core/hwRecommend'
import { classifyEmail, linkEmail, pickVerificationLink, extractCode } from '@core/emailClassify'
import { sourceAffinity, orderSources } from '@core/learning'
import { funnel, byGroup } from '@core/analytics'
import { stripInvisible } from '@core/text'
import catalog from '../catalog/models.json'
import type { NormalizedJob, Profile, ModelCatalogEntry, AnswerBankEntry } from '@shared/types'

const raw = readFileSync('tests/fixtures/sample-resume.txt', 'utf8')
const resume = parseResumeText(raw)

const profile: Profile = {
  fullName: 'Jordan Sample',
  email: 'jobs.jordan@example.com',
  phone: '(919) 555-0142',
  city: 'Raleigh',
  state: 'NC',
  country: 'United States',
  workAuthorized: true,
  needsSponsorship: false,
  educationLevel: 'bachelor',
  degrees: [{ level: 'bachelor', field: 'Supply Chain Management', school: 'NC State', year: '2019' }],
  fields: ['Operations'],
  roles: ['Operations Analyst', 'Data Analyst'],
  pay: { min: 25, target: 30, unit: 'hourly' },
  locations: [{ place: 'Raleigh, NC', radiusMiles: 30 }],
  remoteMode: 'any',
  federal: { jobs: {} }
}

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'greenhouse',
  externalId: '1',
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  company: 'Acme Corp',
  title: 'Operations Analyst',
  location: 'Raleigh, NC',
  remoteType: 'hybrid',
  description:
    'We are hiring an Operations Analyst. Requirements: SQL, Excel, Power BI, process improvement, stakeholder management. Preferred: Tableau. Bachelor degree required. ' +
    'You will build dashboards and partner with finance to improve forecasting accuracy across our supply chain.',
  payMin: 60000,
  payMax: 75000,
  payUnit: 'salary',
  postedAt: new Date().toISOString(),
  ...over
})

describe('resume parsing', () => {
  it('extracts contact, headline, skills, experience, education', () => {
    expect(resume.contact.name).toBe('Jordan Sample')
    expect(resume.contact.email).toBe('jordan.sample@example.com')
    expect(resume.contact.location).toBe('Raleigh, North Carolina')
    expect(resume.headline).toBe('Operations Coordinator / Data Analyst')
    expect(resume.skills).toContain('Stakeholder Communication')
    expect(resume.toolkit).toContain('ERP Systems (SAP, Oracle)')
    expect(resume.toolkit).toContain('Jira')
    expect(resume.experience).toHaveLength(2)
    expect(resume.experience[0]).toMatchObject({ company: 'Acme Logistics', title: 'Operations Coordinator', start: 'Jan 2022', end: 'Present', location: 'Remote | Raleigh, NC' })
    expect(resume.experience[0].bullets).toHaveLength(4)
    expect(resume.experience[0].bullets[3]).toContain('SQL queries')
    expect(resume.experience[1].bullets).toHaveLength(2)
    expect(resume.education[0].school).toBe('North Carolina State University')
    expect(resume.education[0].field).toBe('Supply Chain Management')
    expect(resume.certifications).toEqual(['Microsoft Excel Expert'])
  })

  it('lints the known issues', () => {
    const ids = lintResume({ rawText: raw, data: resume }).map((f) => f.id)
    for (const id of ['invisible-chars', 'double-punctuation', 'headline-merged', 'soft-skill-padding', 'duplicate-bullets', 'missing-linkedin', 'implausible-metric', 'weak-verb'])
      expect(ids).toContain(id)
  })

  it('fixes produce a cleaner resume', () => {
    const fixed = applyAtsFixes(resume)
    expect(fixed.skills).not.toContain('Team Player')
    const text = resumeToText(fixed)
    expect(stripInvisible(text)).toBe(text)
    const before = atsScore(lintResume({ rawText: raw, data: resume }))
    const after = atsScore(lintResume({ rawText: text, data: { ...fixed, headlineFused: false } }))
    expect(after).toBeGreaterThan(before)
  })
})

describe('keywords and roles', () => {
  it('extracts canonical skills', () => {
    const s = extractSkills('Strong MS Excel and PowerBI, SQL Server, scrum.')
    expect(s).toEqual(expect.arrayContaining(['excel', 'power bi', 'sql', 'agile']))
  })
  it('suggests roles while typing', () => {
    expect(suggestRoles('proj')[0]).toMatch(/^Project/)
    expect(suggestRoles('supply')).toContain('Supply Chain Analyst')
  })
  it('suggests roles from a resume', () => {
    const r = rolesFromResume([...resume.skills, ...resume.toolkit], resume.experience.map((e) => e.title))
    expect(r.fields.length).toBeGreaterThan(0)
  })
})

describe('matching', () => {
  it('scores a good job higher than a poor one', () => {
    const good = scoreJob(job(), profile, resume)
    const poor = scoreJob(job({ title: 'Registered Nurse', description: 'Provide patient care. RN license required. Epic EHR.', payMax: 40000 }), profile, resume)
    expect(good.score).toBeGreaterThan(poor.score + 20)
    expect(good.missingKeywords).toContain('tableau')
  })
  it('respects remote-only', () => {
    const r = scoreJob(job({ remoteType: 'onsite' }), { ...profile, remoteMode: 'remote_only' }, resume)
    expect(r.hardFail).toBeTruthy()
    expect(r.score).toBeLessThanOrEqual(20)
  })
  it('shows a strong match as 85 or more', () => {
    expect(scoreJob(job(), profile, resume).score).toBeGreaterThanOrEqual(85)
  })
  it('reads coursework and certifications as skills', () => {
    const r = { ...resume, education: [{ school: 'UNCG', degree: 'B.S.', details: ['Coursework: Project Management, Operations Management'] }], certifications: ['Lean Six Sigma Yellow Belt'] }
    const j = job({ description: 'Requirements: project management and operations management.' })
    expect(scoreJob(j, profile, resume).missingKeywords).toContain('project management')
    expect(scoreJob(j, profile, r).missingKeywords).not.toContain('project management')
  })
  it('ignores "contact Human Resources" as a skill', () => {
    const j = job({ description: 'Requirements: SQL. For questions, contact Human Resources at 555-0100.' })
    expect(scoreJob(j, profile, resume).missingKeywords).not.toContain('hr')
    expect(scoreJob(job({ description: 'Requirements: human resources experience.' }), profile, resume).missingKeywords).toContain('hr')
  })
  it('flags titles outside your roles and fields', () => {
    expect(scoreJob(job({ title: 'Freelance Writer' }), profile, resume).offField).toBe(true)
    expect(scoreJob(job({ title: 'Senior Operations Analyst' }), profile, resume).offField).toBe(false)
    expect(scoreJob(job({ title: 'Process Improvement Analyst' }), profile, resume).offField).toBe(false)
  })
  it('annualizes pay', () => {
    expect(annualize(25, 'hourly')).toBe(52000)
    expect(annualize(60000, 'salary')).toBe(60000)
  })
  it('interview score shrinks small samples', () => {
    expect(interviewScore(70, [{ responses: 1, applied: 1 }], 0.1)).toBeLessThan(100)
    expect(interviewScore(70, [], 0.1)).toBe(70)
  })
})

describe('dedupe, scam, blocklist', () => {
  it('detects duplicates across sources', () => {
    const a = job()
    const b = job({ source: 'adzuna', title: 'Operations Analyst (Hybrid)', company: 'Acme Corp, Inc.' })
    expect(fingerprint(a)).toBe(fingerprint(b))
    expect(isSameJob(a, b)).toBe(true)
    expect(isSameJob(a, job({ company: 'Other Co' }))).toBe(false)
  })
  it('flags scams', () => {
    const s = scamCheck(job({ description: 'Data entry clerk. Interview on Telegram. We will send a check to deposit for equipment. Contact hr.acme@gmail.com', company: 'Confidential' }))
    expect(s.score).toBeGreaterThan(60)
    expect(scamCheck(job()).score).toBeLessThan(20)
  })
  it('blocks the current employer', () => {
    const list = buildBlocklist([], 'Initech')
    expect(isBlocked('Initech Inc.', undefined, list)).toBeTruthy()
    expect(isBlocked('Acme', undefined, list)).toBeNull()
  })
})

describe('privacy and safety helpers', () => {
  it('scrubs and restores PII', () => {
    const t = 'Jordan Sample, jordan.sample@example.com, (919) 555-0142, 12 Oak Street'
    const s = scrubPII(t, { name: 'Jordan Sample' })
    expect(s.text).not.toMatch(/Jordan|example\.com|555/)
    expect(restorePII(s.text, s.map)).toBe(t)
  })
  it('cap tiers escalate', () => {
    expect(capTier(5).tier).toBe('green')
    expect(capTier(20).tier).toBe('yellow')
    expect(capTier(40).tier).toBe('orange')
    expect(capTier(80).confirmations).toBe(2)
  })
})

describe('diff, platform, truth guard, tailoring, cover letters', () => {
  it('diffs words', () => {
    const d = wordDiff('I like apples', 'I like green apples')
    expect(d.some((p) => p.type === 'add' && p.text.includes('green'))).toBe(true)
    expect(changeRatio('a b c d', 'a b c d')).toBe(0)
  })
  it('detects platforms', () => {
    expect(detectPlatform('https://ncgov.wd5.myworkdayjobs.com/en-US/NCGov/job/x')).toBe('workday')
    expect(parseWorkdayUrl('https://ncgov.wd5.myworkdayjobs.com/en-US/NCGov/job/x')).toEqual({ host: 'ncgov.wd5.myworkdayjobs.com', tenant: 'ncgov', site: 'NCGov' })
    expect(detectPlatform('https://jobs.lever.co/acme/123')).toBe('lever')
  })
  it('truth guard rejects invented facts', () => {
    const src = resumeToText(resume)
    expect(truthCheck('Cut reporting time by 40% with Power BI dashboards', src)).toHaveLength(0)
    const v = truthCheck('Cut reporting time by 65% using Tableau; PMP certified', src)
    expect(v.map((x) => x.kind)).toEqual(expect.arrayContaining(['number', 'skill', 'credential']))
    expect(yearsFromDates([{ start: 'Jan 2020', end: 'Jan 2023' }])).toBe(3)
  })
  it('applies safe tailoring ops and rejects unsafe ones', () => {
    const r = applyTailorOps(resume, [
      { op: 'rephrase_bullet', job: 0, bullet: 0, text: 'Cut reporting time 40% by building weekly Power BI KPI dashboards' },
      { op: 'rephrase_bullet', job: 0, bullet: 1, text: 'Managed $2M budget in Tableau' },
      { op: 'reorder_bullets', job: 1, order: [1, 0] }
    ])
    expect(r.applied).toHaveLength(2)
    expect(r.rejected).toHaveLength(1)
    expect(r.resume.experience[1].bullets[0]).toContain('97%')
    const d = tailorDeterministic(resume, 'Need SQL and Jira')
    expect(d.experience[0].bullets[0]).toContain('SQL')
  })
  it('fills cover letter templates and limits tweaks', () => {
    const base = fillTemplate('Dear {{hiring_manager}}, I want the {{role}} job at {{company}}.', { company: 'Acme', role: 'Analyst' })
    expect(base).toBe('Dear Hiring Manager, I want the Analyst job at Acme.')
    expect(checkTweak(base, base.replace('want', 'would love'), '').ok).toBe(true)
    expect(checkTweak(base, 'Totally different text about being PMP certified with 20 years', '').ok).toBe(false)
  })
})

describe('form fields', () => {
  const bank = SEED_QUESTIONS.map((q, i) => ({ ...q, id: i + 1, approved: true, answer: q.answer || 'Yes' })) as AnswerBankEntry[]
  const ctx = { profile, resume, bank, settings: { storeSensitive: false, storeSsnDob: false } }
  it('maps labels to keys', () => {
    expect(matchKey('First Name*')?.key).toBe('first_name')
    expect(matchKey('Will you now or in the future require sponsorship?')?.key).toBe('needs_sponsorship')
    expect(matchKey('LinkedIn Profile')?.key).toBe('linkedin')
    expect(matchKey('Confirm Password')?.key).toBe('confirm_password')
  })
  it('chooses options', () => {
    expect(chooseOption(['Select...', 'Yes', 'No'], 'No')).toBe('No')
    expect(chooseOption(['Male', 'Female', 'I decline to self-identify'], 'Decline to self-identify')).toBe('I decline to self-identify')
    expect(chooseOption(["Bachelor's Degree", "Master's Degree"], "Bachelor's Degree")).toBe("Bachelor's Degree")
  })
  it('resolves values and pauses on sensitive data', () => {
    const f = (label: string, extra: object = {}) => ({ selector: '#x', label, name: '', type: 'text' as const, required: true, options: [], ...extra })
    expect(resolveField(f('First name'), ctx).value).toBe('Jordan')
    expect(resolveField(f('Are you legally authorized to work in the US?'), ctx).value).toBe('Yes')
    expect(resolveField(f('Social Security Number'), ctx).needsUser).toBeTruthy()
    expect(resolveField(f('Gender', { type: 'select', options: ['Male', 'Female', 'Decline to self-identify'] }), ctx).value).toBe('Decline to self-identify')
    expect(resolveField(f('What is your favorite color?'), ctx).needsUser).toMatch(/New question/)
  })
})

describe('local AI recommender', () => {
  const models = (catalog as { models: ModelCatalogEntry[] }).models
  const hw = { os: 'Windows 11', cpu: 'Ryzen 7', cores: 8, ramGB: 32, gpus: [{ model: 'RTX 3060', vendor: 'NVIDIA', vramGB: 12 }], freeDiskGB: 200, ollamaInstalled: false, ollamaRunning: false, installedModels: [] }
  it('recommends 5 models that fit 12GB', () => {
    const r = recommendModels(hw, models)
    expect(r).toHaveLength(5)
    expect(r[0].fitsAt).toBe('16k')
    expect(r.some((x) => x.model.uncensored)).toBe(false)
    expect(recommendModels(hw, models, { freedom: true, limit: 20 }).some((x) => x.model.uncensored)).toBe(true)
    expect(setupPrompt(hw, r)).toContain('RTX 3060')
  })
})

describe('email', () => {
  it('classifies and links', () => {
    expect(classifyEmail({ from: 'no-reply@acme.com', subject: 'Thank you for applying', text: '' }).cls).toBe('confirmation')
    expect(classifyEmail({ from: 'x', subject: 'Update on your application', text: 'Unfortunately we decided to move forward with other candidates' }).cls).toBe('rejection')
    expect(classifyEmail({ from: 'x', subject: 'Interview invitation', text: '' }).cls).toBe('interview')
    expect(classifyEmail({ from: 'x', subject: 'Verify your email', text: '' }).cls).toBe('verification')
    expect(linkEmail({ from: 'talent@acme.com', subject: 'Your application for Operations Analyst', text: 'Acme Corp' }, [{ id: 7, company: 'Acme Corp', title: 'Operations Analyst', submittedAt: '' }, { id: 8, company: 'Beta', title: 'Clerk', submittedAt: '' }])?.appId).toBe(7)
    expect(pickVerificationLink(['https://evil.com/verify', 'https://acme.wd5.myworkdayjobs.com/verify?token=1'], ['myworkdayjobs.com'])).toContain('myworkdayjobs')
    expect(extractCode('Your verification code is 482913.')).toBe('482913')
  })
})

describe('learning and analytics', () => {
  it('orders sources by affinity', () => {
    const now = Date.now()
    const at = new Date(now).toISOString()
    const aff = sourceAffinity([{ jobId: 1, source: 'usajobs', kind: 'apply', at }, { jobId: 2, source: 'adzuna', kind: 'dismiss', at }], now)
    expect(orderSources(['adzuna', 'usajobs', 'lever'], aff)).toEqual(['usajobs', 'lever', 'adzuna'])
  })
  it('computes funnel and groups', () => {
    const rows = [
      { id: 1, status: 'interview' as const, mode: 'auto', source: 'a', platform: 'workday', resumeLabel: 'ATS v1', submittedAt: '2026-10-01', firstResponseAt: '2026-10-05' },
      { id: 2, status: 'submitted' as const, mode: 'auto', source: 'a', platform: 'workday', resumeLabel: 'ATS v1', submittedAt: '2026-10-02', firstResponseAt: null },
      { id: 3, status: 'ready_for_review' as const, mode: 'review', source: 'b', platform: 'lever', resumeLabel: 'Original', submittedAt: null, firstResponseAt: null }
    ]
    expect(funnel(rows)).toMatchObject({ total: 3, submitted: 2, interviews: 1, pending: 1 })
    const g = byGroup(rows, (r) => r.resumeLabel)
    expect(g[0]).toMatchObject({ group: 'ATS v1', applied: 2, responses: 1, enoughData: false })
  })
})

describe('resume studio fixes', () => {
  const raw = readFileSync('tests/fixtures/sample-resume.txt', 'utf8')
  const resume = parseResumeText(raw)

  it('describes what the automatic fixes changed, and nothing on a second run', () => {
    const fixed = { ...applyAtsFixes(resume), headlineFused: false }
    const changes = describeFixes(resume, fixed)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.join(' ')).toMatch(/Skills/)
    expect(describeFixes(fixed, { ...applyAtsFixes(fixed), headlineFused: false })).toEqual([])
  })

  it('lists only changed lines, with a word diff for edits', () => {
    const c = lineChanges('Name\na | b\nSKILLS', 'Name\na | b | linkedin.com/in/x\nSKILLS')
    expect(c.map((l) => l.type)).toEqual(['del', 'add'])
    expect(c[1].words?.some((w) => w.type === 'add' && w.text.includes('linkedin'))).toBe(true)
    expect(lineChanges('same\ntext', 'same\ntext')).toEqual([])
  })

  it('flags two bullets about the same system as similar', () => {
    const bullets = [
      'Ran SAP workflows and standardized documentation for repeatable processes, reducing order cycle time by 12%.',
      'Handled B2B order processing in SAP, ensuring accuracy and timely fulfillment',
      'Generated reports and processed invoices'
    ]
    const data = { ...emptyResume(), experience: [{ company: 'Acme', title: 'Coordinator', start: 'Jan 2020', bullets }] }
    const dup = lintResume({ rawText: '', data }).filter((f) => f.id === 'duplicate-bullets')
    expect(dup).toHaveLength(1)
  })
})
