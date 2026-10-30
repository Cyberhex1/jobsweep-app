import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tempDb } from './helpers'
import { startSite } from './fixtures/site/server'
import { BrowserManager } from '../src/main/automation/browser'
import { ApplyEngine, accountScope, generatePassword } from '../src/main/automation/engine'
import { JobService } from '../src/main/jobs'
import type { Job } from '@shared/types'

let site: Awaited<ReturnType<typeof startSite>>
const dir = mkdtempSync(join(tmpdir(), 'eng-'))
const browser = new BrowserManager({ profileDir: join(dir, 'profile'), headless: true })
const resume = join(dir, 'resume.docx')
writeFileSync(resume, 'fake docx')

function setup() {
  const db = tempDb()
  db.saveProfile({ ...db.getProfile(), fullName: 'Jordan Q Sample', email: 'jobs.jordan@example.com', phone: '919-555-0142', city: 'Raleigh', state: 'NC', workAuthorized: true, needsSponsorship: false, linkedin: 'https://linkedin.com/in/jordansample', pay: { target: 65000, unit: 'salary' } })
  const why = db.listAnswers().find((a) => a.key === 'why_company')!
  db.saveAnswer({ ...why, answer: 'I admire Acme’s focus on operations excellence.', approved: true }, false)
  const engine = new ApplyEngine({ db, browser, ai: null, screenshotsDir: join(dir, 'shots'), documents: async () => ({ resumeDocx: resume, resumePdf: async () => resume, coverLetter: async () => null }) })
  const svc = new JobService(db)
  return { db, engine, svc }
}

function jobFor(db: ReturnType<typeof tempDb>, svc: JobService, path: string): Job {
  svc.upsert({ source: 'greenhouse', externalId: path, url: site.url + path, applyUrl: site.url + path, company: 'Acme', title: 'Operations Analyst', location: 'Raleigh, NC', remoteType: 'onsite', description: 'x' })
  return db.allJobs({ includeHidden: true }).find((j) => j.externalId === path)!
}

beforeAll(async () => {
  site = await startSite()
})
afterAll(async () => {
  await browser.close()
  site.server.close()
})

describe('apply engine', () => {
  it('dry run fills every page and never submits', async () => {
    const { db, engine, svc } = setup()
    const out = await engine.run(jobFor(db, svc, '/job'), 'dry')
    expect(out.status).toBe('tested')
    expect(site.submissions).toHaveLength(0)
    const byLabel = Object.fromEntries(out.fields.map((f) => [f.label, f.value]))
    expect(byLabel['First Name']).toBe('Jordan')
    expect(byLabel['Last Name']).toBe('Sample')
    expect(byLabel['Email']).toBe('jobs.jordan@example.com')
    expect(byLabel['Resume/CV']).toBe('resume.docx')
    expect(byLabel['Are you legally authorized to work in the United States?']).toBe('Yes')
    expect(byLabel['Will you now or in the future require sponsorship?']).toBe('No')
    expect(byLabel['Gender']).toBe('Decline to self-identify')
    expect(out.pages).toHaveLength(2)
  }, 60000)

  it('review mode stops before submit', async () => {
    const { db, engine, svc } = setup()
    const out = await engine.run(jobFor(db, svc, '/job'), 'review')
    expect(out.status).toBe('ready_for_review')
    expect(site.submissions).toHaveLength(0)
  }, 60000)

  it('auto mode submits and detects the confirmation', async () => {
    const { db, engine, svc } = setup()
    const out = await engine.run(jobFor(db, svc, '/job'), 'auto')
    expect(out.status).toBe('submitted')
    expect(site.submissions).toHaveLength(1)
    expect(site.submissions[0]).toMatchObject({ first: 'Jordan', last: 'Sample', auth: 'yes', sponsor: 'No', gender: 'Decline to self-identify', salary: '$65,000' })
  }, 60000)

  it('pauses on an unanswered required question in auto mode', async () => {
    const { db, engine, svc } = setup()
    const why = db.listAnswers().find((a) => a.key === 'why_company')!
    db.saveAnswer({ ...why, approved: false }, false)
    const out = await engine.run(jobFor(db, svc, '/job'), 'auto')
    expect(out.status).toBe('needs_you')
    expect(out.reason).toMatch(/Why do you want to work here/)
    expect(site.submissions).toHaveLength(1)
  }, 60000)

  it('creates an account when the site requires one', async () => {
    const { db, engine, svc } = setup()
    const job = jobFor(db, svc, '/secure-job')
    const out = await engine.run(job, 'review')
    expect(site.accounts).toHaveLength(1)
    expect(site.accounts[0].email).toBe('jobs.jordan@example.com')
    const acct = db.getAccount(accountScope(job.url))!
    expect(acct.password).toBe(site.accounts[0].password)
    expect(out.status).toBe('ready_for_review')
  }, 60000)

  it('generates strong passwords', () => {
    const p = generatePassword()
    expect(p).toHaveLength(16)
    expect(p).toMatch(/[A-Z]/)
    expect(p).toMatch(/[a-z]/)
    expect(p).toMatch(/\d/)
    expect(p).toMatch(/[!@#$%&*?]/)
  })
})
