import { describe, it, expect } from 'vitest'
import { tempDb } from './helpers'
import { JobService } from '../src/main/jobs'
import type { NormalizedJob } from '@shared/types'

const nj = (o: Partial<NormalizedJob>): NormalizedJob => ({ source: 'greenhouse', externalId: '1', url: 'https://boards.greenhouse.io/acme/jobs/1', company: 'Acme', title: 'Operations Analyst', location: 'Greensboro, NC', remoteType: 'hybrid', description: 'SQL Excel Power BI process improvement. '.repeat(10), ...o })

describe('db + job pipeline', () => {
  it('stores settings, profile, secrets and seeds the answer bank', () => {
    const db = tempDb()
    expect(db.getSettings().mode).toBe('review')
    db.saveSettings({ dailyCap: 20 })
    expect(db.getSettings().dailyCap).toBe(20)
    db.setSecret('key.gemini', 'abc')
    expect(db.getSecret('key.gemini')).toBe('abc')
    db.saveSettings({ aiOrder: ['ollama', 'gemini', 'openrouter', 'openai', 'anthropic'] })
    expect(db.getSettings().aiOrder).toEqual(['ollama', 'gemini', 'openrouter', 'openai', 'anthropic', 'deepseek'])
    expect(db.listAnswers().length).toBeGreaterThan(10)
    db.saveAnswer({ key: 'gender', question: 'Gender', variants: [], answer: 'Female', sensitivity: 'sensitive', approved: true }, false)
    expect(db.listAnswers().find((a) => a.question === 'Gender')?.answer).toBe('')
  })

  it('dedupes across sources and prefers the company apply site', () => {
    const db = tempDb()
    db.saveProfile({ ...db.getProfile(), city: 'Greensboro', state: 'NC', roles: ['Operations Analyst'], currentEmployer: 'Initech' })
    const svc = new JobService(db)
    expect(svc.upsert(nj({ source: 'adzuna', externalId: 'a1', url: 'https://adzuna.com/x' }))).toBe('added')
    expect(svc.upsert(nj({ source: 'greenhouse', externalId: 'g1' }))).toBe('merged')
    expect(svc.upsert(nj({ source: 'greenhouse', externalId: 'g2', company: 'Initech', title: 'Clerk' }))).toBe('added')
    const jobs = db.allJobs({ includeHidden: true })
    expect(jobs).toHaveLength(2)
    const acme = jobs.find((j) => j.company === 'Acme')!
    expect(acme.applyUrl).toContain('greenhouse')
    expect(acme.sightings.map((s) => s.source).sort()).toEqual(['adzuna', 'greenhouse'])
    expect(jobs.find((j) => j.company === 'Initech')!.blocked).toBe(true)
    expect(svc.board().find((c) => c.source === 'adzuna')?.jobs[0].company).toBe('Acme')
  })

  it('tracks applications and caps', () => {
    const db = tempDb()
    const svc = new JobService(db)
    svc.upsert(nj({}))
    const job = db.allJobs()[0]
    const app = db.createApplication({ jobId: job.id, mode: 'review', status: 'ready_for_review' })
    db.updateApplication(app.id, { status: 'submitted', submittedAt: new Date().toISOString() })
    expect(db.submittedToday()).toBe(1)
    expect(db.companyAppsLast30('Acme')).toBe(1)
    expect(db.events(app.id).length).toBe(2)
  })
})

describe.skipIf(!process.env.LIVE)('live sources', () => {
  it('pulls real jobs', async () => {
    const db = tempDb()
    db.saveProfile({ ...db.getProfile(), city: 'Raleigh', state: 'NC', roles: ['Analyst', 'Coordinator'], locations: [{ place: 'Raleigh, NC', radiusMiles: 50 }], email: 'test@example.com' })
    db.saveSettings({ sources: { governmentjobs: true, ncstate: true, remotive: true, themuse: true, remoteok: true, usajobs: false, adzuna: false, jsearch: false, workday: false, greenhouse: false, lever: false, ashby: false, smartrecruiters: false, arbeitnow: false, imported: true } })
    const svc = new JobService(db)
    const rep = await svc.refresh((s, st) => console.log(s, st))
    console.log(JSON.stringify(rep.bySource))
    const board = svc.board()
    for (const c of board) console.log(c.label, c.total, c.jobs.map((j) => `${j.title} @ ${j.company} [${j.matchScore}]`).slice(0, 3))
    expect(rep.added).toBeGreaterThan(5)
  }, 300000)
})
