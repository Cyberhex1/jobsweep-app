// Apply service: documents per job, single applications, batch runs, approvals, and run summaries.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Application, Job, RunSummary } from '@shared/types'
import { applyTailorOps, tailorDeterministic } from '@core/tailor'
import { fillTemplate, checkTweak } from '@core/coverLetter'
import { resumeToText } from '@core/resume/parse'
import type { Db } from './db'
import type { AiRouter } from './ai/router'
import { aiTailor, aiTweakCoverLetter } from './ai/tasks'
import { resumeDocx, coverLetterDocx } from './docs/render'
import { docxToPdf } from './docs/convert'
import { ApplyEngine, type FillMode, type FillOutcome, type JobDocuments } from './automation/engine'
import type { BrowserManager } from './automation/browser'
import type { JobService } from './jobs'

export interface ApplyDeps {
  db: Db
  ai: AiRouter
  browser: BrowserManager
  jobs: JobService
  dataDir: string
  pdfFallback?: (html: string, out: string) => Promise<boolean>
  waitForVerification?: (hosts: string[], since: Date, timeoutMs: number) => Promise<{ link?: string; code?: string } | null>
  emit: (event: string, payload: unknown) => void
  notify: (title: string, body: string) => void
}

const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40)

export class ApplyService {
  readonly engine: ApplyEngine
  private running = false
  private stopRequested = false

  constructor(private d: ApplyDeps) {
    this.engine = new ApplyEngine({
      db: d.db,
      browser: d.browser,
      ai: d.ai,
      screenshotsDir: join(d.dataDir, 'screenshots'),
      documents: (job) => this.documents(job),
      waitForVerification: d.waitForVerification,
      onStatus: (m) => d.emit('apply:status', m)
    })
  }

  get isRunning() {
    return this.running
  }

  /** Tailored resume (and lazily a cover letter) for a job. */
  async documents(job: Job): Promise<JobDocuments> {
    const db = this.d.db
    const base = db.defaultVersion()
    if (!base) throw new Error('Choose a default resume in Resume Studio first.')
    const profile = db.getProfile()
    const dir = join(this.d.dataDir, 'documents', `job-${job.id}`)
    mkdirSync(dir, { recursive: true })
    let data = tailorDeterministic(base.data, job.description)
    let note = 'reordered for this job'
    if (await this.d.ai.hasAny()) {
      try {
        const ops = await aiTailor(this.d.ai, data, job)
        const res = applyTailorOps(data, ops, [job.company])
        data = res.resume
        note = `tailored (${res.applied.length} edits, ${res.rejected.length} rejected by truth guard)`
      } catch (e) {
        note = `reordered only (AI tailoring failed: ${(e as Error).message.slice(0, 80)})`
      }
    }
    const name = safe(profile.fullName || base.data.contact.name || 'Resume')
    const docxPath = join(dir, `${name}-Resume.docx`)
    writeFileSync(docxPath, await resumeDocx(data))
    const version = db.addVersion({ resumeId: base.resumeId, kind: 'tailored', label: `${job.company} – ${job.title} (${note})`, parentId: base.id, data, rawText: resumeToText(data), docxPath, jobId: job.id })
    let clId: number | null = null
    let clCache: { path: string; text: string } | null | undefined
    return {
      resumeDocx: docxPath,
      resumeVersionId: version.id,
      resumePdf: async () => {
        const pdf = docxPath.replace(/\.docx$/, '.pdf')
        if (existsSync(pdf)) return pdf
        const { resumeHtml } = await import('./docs/render')
        return (await docxToPdf(docxPath, this.d.pdfFallback ? (out) => this.d.pdfFallback!(resumeHtml(data), out) : undefined)).path
      },
      coverLetter: async () => {
        if (clCache !== undefined) return clCache
        const tpl = db.getTemplates().find((t) => t.isDefault) ?? db.getTemplates()[0]
        if (!tpl) return (clCache = null)
        const filled = fillTemplate(tpl.body, { company: job.company, role: job.title, name: profile.fullName })
        let text = filled
        if (await this.d.ai.hasAny()) {
          try {
            const tweaked = await aiTweakCoverLetter(this.d.ai, filled, data, job)
            if (checkTweak(filled, tweaked, resumeToText(data)).ok) text = tweaked
          } catch {
            /* keep the user's letter */
          }
        }
        const path = join(dir, `${name}-Cover-Letter.docx`)
        writeFileSync(path, await coverLetterDocx(text, data))
        clId = db.addCoverLetter(job.id, text, filled, path)
        return (clCache = { path, text })
      },
      coverLetterId: () => clId
    }
  }

  private record(app: Application, out: FillOutcome, docsVersion?: number) {
    const status = out.status === 'tested' ? 'ready_for_review' : out.status
    this.d.db.updateApplication(app.id, {
      status,
      fieldValues: out.fields,
      screenshots: out.screenshots,
      failureReason: out.status === 'failed' ? (out.reason ?? 'Unknown error') : null,
      needsReason: out.status === 'needs_you' ? (out.reason ?? null) : null,
      submittedAt: out.status === 'submitted' ? new Date().toISOString() : undefined,
      resumeVersionId: docsVersion
    })
    const job = this.d.db.getJob(app.jobId)
    if (out.status === 'submitted' && job) this.d.db.addSignal({ jobId: job.id, source: job.source, kind: 'apply' })
  }

  /** Prepare (review), submit (auto), or fill-for-you (assist) one job. */
  async applyOne(jobId: number, mode: FillMode): Promise<Application> {
    const job = this.d.db.getJob(jobId)
    if (!job) throw new Error('Job not found')
    const existing = this.d.db.applicationForJob(jobId)
    if (existing && ['submitted', 'confirmed', 'interview', 'offer', 'assessment', 'rejected'].includes(existing.status)) throw new Error('You already applied to this job.')
    const app = existing ?? this.d.db.createApplication({ jobId, mode: mode === 'dry' ? 'review' : mode, status: 'filling' })
    this.d.db.updateApplication(app.id, { status: 'filling', mode: mode === 'dry' ? 'review' : mode })
    this.d.emit('apply:changed', { id: app.id })
    let versionId: number | undefined
    const out = await this.engine.run(job, mode).catch((e) => ({ status: 'failed', fields: [], screenshots: [], pages: [], reason: (e as Error).message }) as FillOutcome)
    // documents() was called inside the engine; find the tailored version it created.
    versionId = this.d.db.sql.prepare("SELECT id FROM resume_versions WHERE job_id = ? AND kind = 'tailored' ORDER BY id DESC LIMIT 1").get(jobId)?.id as number | undefined
    this.record(app, out, versionId)
    this.d.emit('apply:changed', { id: app.id })
    if (out.status === 'needs_you') this.d.notify('JobSweep needs you', `${job.title} at ${job.company}: ${out.reason ?? 'please take a look'}`)
    return this.d.db.getApplication(app.id)!
  }

  /** Approve a reviewed application: replay the fill and submit. */
  async approve(appId: number): Promise<Application> {
    const app = this.d.db.getApplication(appId)
    if (!app) throw new Error('Application not found')
    return this.applyOne(app.jobId, 'auto')
  }

  markSubmittedManually(appId: number) {
    this.d.db.updateApplication(appId, { status: 'submitted', submittedAt: new Date().toISOString(), needsReason: null })
    const app = this.d.db.getApplication(appId)
    const job = app && this.d.db.getJob(app.jobId)
    if (job) this.d.db.addSignal({ jobId: job.id, source: job.source, kind: 'apply' })
  }

  discard(appId: number) {
    this.d.db.updateApplication(appId, { status: 'withdrawn' })
  }

  stop() {
    this.stopRequested = true
  }

  /** "Apply for me": run through the best candidates within the caps. */
  async runBatch(modeOverride?: 'review' | 'auto'): Promise<RunSummary> {
    if (this.running) throw new Error('A run is already in progress.')
    const s = this.d.db.getSettings()
    const mode = modeOverride ?? s.mode
    this.running = true
    this.stopRequested = false
    const runId = this.d.db.startRun(mode)
    const summary = { attempted: 0, submitted: 0, readyForReview: 0, needsYou: 0, failed: 0, skipped: 0, notes: [] as string[] }
    try {
      if (!this.d.db.defaultVersion()) throw new Error('Choose a default resume in Resume Studio first.')
      const pendingReview = this.d.db.listApplications(['ready_for_review']).length
      const remaining = mode === 'auto' ? s.dailyCap - this.d.db.submittedToday() : Math.max(0, s.dailyCap - pendingReview)
      if (remaining <= 0) summary.notes.push(mode === 'auto' ? `Daily cap of ${s.dailyCap} reached.` : `You already have ${pendingReview} applications waiting for review.`)
      const candidates = this.d.jobs.candidatesForApply(Math.max(0, remaining))
      if (!candidates.length && remaining > 0) summary.notes.push(`No jobs above your minimum match score (${s.minMatchScore}). Refresh the board or lower the threshold.`)
      for (const job of candidates) {
        if (this.stopRequested) {
          summary.notes.push('Stopped by you.')
          break
        }
        summary.attempted++
        this.d.emit('run:progress', { runId, current: `${job.title} at ${job.company}`, ...summary })
        const app = await this.applyOne(job.id, mode).catch((e) => {
          summary.notes.push(`${job.company}: ${(e as Error).message}`)
          return null
        })
        if (!app) {
          summary.failed++
          continue
        }
        if (app.status === 'submitted') summary.submitted++
        else if (app.status === 'ready_for_review') summary.readyForReview++
        else if (app.status === 'needs_you') {
          summary.needsYou++
          summary.notes.push(`${job.company} – ${job.title}: ${app.needsReason ?? 'needs you'}`)
        } else if (app.status === 'failed') {
          summary.failed++
          summary.notes.push(`${job.company} – ${job.title} failed: ${app.failureReason}`)
        }
      }
    } catch (e) {
      summary.notes.push((e as Error).message)
    } finally {
      this.d.db.finishRun(runId, summary)
      this.running = false
      this.d.emit('run:done', { runId })
      this.d.notify(
        'JobSweep run finished',
        mode === 'auto' ? `${summary.submitted} submitted, ${summary.needsYou} need you, ${summary.failed} failed.` : `${summary.readyForReview} ready for your review, ${summary.needsYou} need you.`
      )
    }
    return this.d.db.listRuns(1)[0]
  }
}
