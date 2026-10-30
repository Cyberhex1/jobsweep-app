// Everything the UI can ask the backend to do. Electron-specific bits come in through `Platform`.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import JSZip from 'jszip'
import type { AiProviderId, AnswerBankEntry, Job, Profile, ResumeStructured, Settings } from '@shared/types'
import { parseResumeText, resumeToText, emptyResume } from '@core/resume/parse'
import { atsScore, lintResume } from '@core/resume/atsLint'
import { applyAtsFixes, describeFixes, suggestionsFor } from '@core/resume/fixes'
import { rolesFromResume, suggestRoles } from '@core/keywords'
import { recommendModels, setupPrompt } from '@core/hwRecommend'
import { capTier } from '@core/risk'
import { funnel, byGroup, perDay, type AppRow } from '@core/analytics'
import { DEFAULT_TEMPLATE, fillTemplate } from '@core/coverLetter'
import { lineChanges, wordDiff } from '@core/diff'
import { detectPlatform } from '@core/platform'
import { matchAnswer, matchKey, sensitivityOf } from '@core/fields'
import type { BlockEntry } from '@core/blocklist'
import catalog from '../../catalog/models.json'
import type { Db } from './db'
import type { AiRouter } from './ai/router'
import { aiImproveBullets, aiStructureResume, aiDraftAnswer } from './ai/tasks'
import type { JobService } from './jobs'
import type { ApplyService } from './apply'
import type { SiteLearning } from './siteLearning'
import type { EmailWatcher } from './email/watcher'
import type { BrowserManager } from './automation/browser'
import { importResumeFile } from './docs/import'
import { federalDocx, resumeDocx, resumeHtml } from './docs/render'
import { docxToPdf } from './docs/convert'
import { benchmark, deleteModel, hfUncensoredSearch, installOllama, ollamaState, pullModel, scanHardware, startOllama } from './hw/scan'
import type { ModelCatalogEntry, HardwareInfo, ModelJob } from '@shared/types'

export interface Platform {
  openExternal(url: string): void
  openPath(path: string): void
  pickFiles(opts: { title: string; filters: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<string[]>
  saveFile(opts: { title: string; defaultName: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>
  notify(title: string, body: string): void
  htmlToPdf(html: string, out: string): Promise<boolean>
  setStartAtLogin(on: boolean): void
  appVersion: string
  extensionDir: string
  logDir: string
  logError(where: string, e: unknown): void
}

export interface Services {
  db: Db
  ai: AiRouter
  jobs: JobService
  apply: ApplyService
  learning: SiteLearning
  email: EmailWatcher
  browser: BrowserManager
  dataDir: string
  platform: Platform
  emit: (event: string, payload: unknown) => void
  pairing: () => { port: number; token: string }
  rescheduleRuns: () => void
}

const MODELS = (catalog as { models: ModelCatalogEntry[] }).models

export function createApi(s: Services) {
  const { db, ai, jobs, apply, learning, email, platform } = s
  const docsDir = join(s.dataDir, 'documents')
  mkdirSync(docsDir, { recursive: true })
  let lastHw: HardwareInfo | null = null
  // Model installs/tests and the Ollama install log live here so leaving the floor doesn't lose them.
  const modelJobs: Record<string, ModelJob> = {}
  let ollamaLog = ''
  let ollamaInstalling = false
  const setJob = (tag: string, patch: Partial<ModelJob>) => {
    modelJobs[tag] = { ...(modelJobs[tag] ?? { tag, phase: 'starting', status: '', pct: 0 }), ...patch, tag }
    s.emit('hw:job', modelJobs[tag])
  }
  const runTest = async (tag: string) => {
    setJob(tag, { phase: 'testing', status: 'Loading the model and running a test…', pct: 100, error: undefined })
    const r = await benchmark(tag)
    db.saveSettings({ modelTests: { ...db.getSettings().modelTests, [tag]: { ...r, at: new Date().toISOString() } } })
    setJob(tag, { phase: r.ok ? 'done' : 'failed', status: r.message, error: r.ok ? undefined : r.message })
    return r
  }
  const useModel = async (tag: string) => {
    db.saveSettings({ ollamaModel: tag })
    const st = await ollamaState()
    if (!st.models.some((m) => m.startsWith('nomic-embed-text'))) void pullModel('nomic-embed-text', () => {}).catch(() => {})
    return true
  }
  const ensureOllama = async () => {
    if (!(await startOllama())) throw new Error('Ollama isn’t running. Install it first (button above) or open it from the Start menu.')
  }

  const BULLET_FINDINGS = new Set(['duplicate-bullets', 'weak-verb', 'long-bullet', 'implausible-metric', 'few-metrics'])
  const suggestionCache = new Map<number, { key: string; items: Awaited<ReturnType<typeof aiImproveBullets>> }>()

  const lintVersion = (versionId: number) => {
    const v = db.getVersion(versionId)
    if (!v) throw new Error('Version not found')
    const meta = db.getKv<Record<string, unknown>>(`resume.docxmeta.${v.resumeId}`, {})
    const findings = lintResume({ rawText: v.rawText || resumeToText(v.data), data: v.data, docx: v.kind === 'original' ? (meta as never) : undefined })
    // Without Word metadata the resume came from a PDF (or text): explain where missing contact details usually hide.
    if (!Object.keys(meta).length)
      for (const f of findings)
        if (f.id === 'missing-phone' || f.id === 'missing-location')
          f.detail += ` It isn't in the text JobSweep could read from your file. In PDFs this usually means it sits in the page header or next to an icon, which readers skip. Type it into the ATS version, or import the Word version.`
    if (v.kind === 'original' && !v.docxPath)
      findings.push({
        id: 'pdf-import',
        severity: 'low',
        title: 'Checked from a PDF',
        detail: 'PDFs hide some problems (invisible characters, tables, text boxes). Import the Word or Google Docs version too for the most complete check.',
        fixable: false
      })
    return { findings, score: atsScore(findings), suggestions: suggestionsFor(v.data) }
  }

  const exportDocx = async (versionId: number, kind: 'standard' | 'federal' = 'standard') => {
    const v = db.getVersion(versionId)!
    const name = (db.getProfile().fullName || v.data.contact.name || 'Resume').replace(/[^\w ]+/g, '').replace(/\s+/g, '-')
    const path = join(docsDir, `${name}-${kind === 'federal' ? 'Federal-' : ''}Resume-v${v.id}.docx`)
    writeFileSync(path, kind === 'federal' ? await federalDocx(v.data, db.getProfile()) : await resumeDocx(v.data))
    if (kind === 'standard') db.updateVersion(v.id, { docxPath: path })
    return path
  }

  return {
    app: {
      info: () => ({ version: platform.appVersion, dataDir: s.dataDir, platform: process.platform }),
      openExternal: (url: string) => platform.openExternal(url),
      openPath: (p: string) => platform.openPath(p),
      pairing: () => s.pairing(),
      openExtensionFolder: () => platform.openPath(platform.extensionDir),
      openLogs: () => platform.openPath(platform.logDir),
      logError: (where: string, message: string) => platform.logError(where, message),
      readImage: (path: string) => (existsSync(path) ? `data:image/png;base64,${readFileSync(path).toString('base64')}` : null),
      exportBackup: async () => {
        const out = await platform.saveFile({ title: 'Save backup', defaultName: `JobSweep-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] })
        if (!out) return null
        db.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        const zip = new JSZip()
        zip.file('jobsweep.db', readFileSync(join(s.dataDir, 'jobsweep.db')))
        zip.file('README.txt', 'JobSweep backup. Passwords and keys inside are encrypted with your Windows login and only work on this Windows account.')
        writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }))
        return out
      }
    },

    settings: {
      get: () => db.getSettings(),
      save: (patch: Partial<Settings>) => {
        const before = db.getSettings()
        const next = db.saveSettings(patch)
        if (patch.storeSensitive === false && before.storeSensitive) db.purgeSensitiveAnswers()
        if (patch.storeSsnDob === false) {
          db.setSecret('sensitive.ssn', null)
          db.setSecret('sensitive.dob', null)
        }
        if (patch.startAtLogin !== undefined) platform.setStartAtLogin(patch.startAtLogin)
        if (patch.scheduleEnabled !== undefined || patch.scheduleTime !== undefined) s.rescheduleRuns()
        if (patch.emailPollMinutes !== undefined) email.start()
        return next
      },
      capTier: (cap: number) => capTier(cap),
      setSensitive: (key: 'ssn' | 'dob', value: string) => {
        if (!db.getSettings().storeSsnDob) throw new Error('Turn on "Store SSN and date of birth" first.')
        db.setSecret(`sensitive.${key}`, value || null)
        return true
      },
      hasSensitive: () => ({ ssn: db.hasSecret('sensitive.ssn'), dob: db.hasSecret('sensitive.dob') })
    },

    profile: {
      get: () => db.getProfile(),
      save: (p: Profile) => {
        const saved = db.saveProfile(p)
        jobs.rescoreAll()
        return saved
      },
      suggestRoles: (q: string) => {
        const v = db.defaultVersion()
        return suggestRoles(q, { resumeTitles: v?.data.experience.map((e) => e.title) ?? [], fields: db.getProfile().fields })
      },
      prefillFromResume: () => {
        const v = db.defaultVersion()
        if (!v) return db.getProfile()
        const p = db.getProfile()
        const r = v.data
        const sug = rolesFromResume([...r.skills, ...r.toolkit], r.experience.map((e) => e.title))
        const [city, state] = (r.contact.location ?? '').split(',').map((x) => x.trim())
        const stateAbbr = state && state.length > 2 ? (STATE_ABBR[state.toLowerCase()] ?? state) : state
        const edu = r.education[0]
        const level = /master/i.test(edu?.degree ?? '') ? 'master' : /bachelor|b\.?s|b\.?a/i.test(edu?.degree ?? '') ? 'bachelor' : /associate/i.test(edu?.degree ?? '') ? 'associate' : p.educationLevel
        const next: Profile = {
          ...p,
          fullName: p.fullName || r.contact.name,
          phone: p.phone || r.contact.phone || '',
          city: p.city || city || '',
          state: p.state || stateAbbr || '',
          linkedin: p.linkedin || r.contact.links.find((l) => /linkedin/i.test(l)),
          currentEmployer: p.currentEmployer || (r.experience[0] && /present|current/i.test(r.experience[0].end ?? '') ? r.experience[0].company : undefined),
          educationLevel: level,
          degrees: p.degrees.length ? p.degrees : edu ? [{ level, field: edu.field ?? '', school: edu.school, year: edu.date }] : [],
          fields: p.fields.length ? p.fields : sug.fields,
          roles: p.roles.length ? p.roles : sug.roles,
          locations: p.locations.length ? p.locations : city ? [{ place: `${city}, ${stateAbbr}`, radiusMiles: 30 }] : []
        }
        return next
      }
    },

    resume: {
      list: () => db.listResumes(),
      import: async (path?: string) => {
        const file = path ?? (await platform.pickFiles({ title: 'Choose your resume', filters: [{ name: 'Resume', extensions: ['docx', 'pdf', 'txt'] }] }))[0]
        if (!file) return null
        const imported = await importResumeFile(file)
        let data = parseResumeText(imported.text)
        // Unusual layouts: let local AI structure it when the rules find little.
        if (data.experience.length === 0 && (await ai.hasAny())) {
          try {
            data = await aiStructureResume(ai, imported.text)
          } catch {
            /* keep rule-based result */
          }
        }
        const r = db.createResume(basename(file).replace(/\.\w+$/, ''))
        const stored = join(docsDir, `original-${r.id}-${basename(file)}`)
        copyFileSync(file, stored)
        if (imported.docx) db.setKv(`resume.docxmeta.${r.id}`, imported.docx)
        const original = db.addVersion({ resumeId: r.id, kind: 'original', label: 'Original', data, rawText: imported.text, docxPath: stored.endsWith('.docx') ? stored : null })
        const fixed = applyAtsFixes(data)
        const ats = db.addVersion({ resumeId: r.id, kind: 'ats', label: 'ATS version', parentId: original.id, data: { ...fixed, headlineFused: false }, rawText: resumeToText(fixed) })
        if (r.isDefault) db.setDefaultVersion(r.id, ats.id)
        return { resumeId: r.id, originalId: original.id, atsId: ats.id }
      },
      createBlank: (name: string) => {
        const r = db.createResume(name || 'New resume')
        const p = db.getProfile()
        const data: ResumeStructured = { ...emptyResume(), contact: { name: p.fullName, email: p.email, phone: p.phone, location: [p.city, p.state].filter(Boolean).join(', '), links: p.linkedin ? [p.linkedin] : [] } }
        const v = db.addVersion({ resumeId: r.id, kind: 'created', label: 'Created in JobSweep', data, rawText: resumeToText(data) })
        if (r.isDefault) db.setDefaultVersion(r.id, v.id)
        return { resumeId: r.id, versionId: v.id }
      },
      update: (versionId: number, data: ResumeStructured) => {
        const v = db.updateVersion(versionId, { data })
        db.sql.prepare('UPDATE resume_versions SET raw_text = ? WHERE id = ?').run(resumeToText(data), versionId)
        return v
      },
      lint: (versionId: number) => lintVersion(versionId),
      fixAll: (versionId: number) => {
        const v = db.getVersion(versionId)!
        const fixed = { ...applyAtsFixes(v.data), headlineFused: false }
        const changes = describeFixes(v.data, fixed)
        if (changes.length) {
          db.updateVersion(versionId, { data: fixed })
          db.sql.prepare('UPDATE resume_versions SET raw_text = ? WHERE id = ?').run(resumeToText(fixed), versionId)
        }
        return { version: db.getVersion(versionId)!, changes }
      },
      /** What this version changed compared with the version it came from (for ATS versions: the original). */
      changes: (versionId: number) => {
        const v = db.getVersion(versionId)
        const parent = v?.parentId ? db.getVersion(v.parentId) : null
        if (!v || !parent) return null
        return {
          parentLabel: parent.label,
          fixes: v.kind === 'ats' && parent.kind === 'original' ? describeFixes(parent.data, applyAtsFixes(parent.data)) : [],
          lines: lineChanges(resumeToText(parent.data), resumeToText(v.data))
        }
      },
      setDefault: (resumeId: number, versionId: number) => {
        db.setDefaultVersion(resumeId, versionId)
        jobs.rescoreAll()
        return true
      },
      rename: (versionId: number, label: string) => db.updateVersion(versionId, { label }),
      duplicate: (versionId: number) => {
        const v = db.getVersion(versionId)!
        return db.addVersion({ resumeId: v.resumeId, kind: v.kind === 'original' ? 'ats' : v.kind, label: `${v.label} (copy)`, parentId: v.id, data: v.data, rawText: v.rawText })
      },
      /** Opens the file exactly as it was uploaded (import keeps a copy named original-<resumeId>-<name>). */
      openOriginalFile: (resumeId: number) => {
        const name = existsSync(docsDir) ? readdirSync(docsDir).find((f) => f.startsWith(`original-${resumeId}-`)) : undefined
        if (!name) return false
        platform.openPath(join(docsDir, name))
        return true
      },
      delete: (resumeId: number) => db.deleteResume(resumeId),
      exportDocx: async (versionId: number, kind: 'standard' | 'federal' = 'standard') => {
        const path = await exportDocx(versionId, kind)
        platform.openPath(path)
        return path
      },
      exportPdf: async (versionId: number) => {
        const path = await exportDocx(versionId)
        const v = db.getVersion(versionId)!
        const pdf = await docxToPdf(path, (out) => platform.htmlToPdf(resumeHtml(v.data), out))
        platform.openPath(pdf.path)
        return pdf
      },
      html: (versionId: number) => resumeHtml(db.getVersion(versionId)!.data),
      /** AI rewrites for the bullets, aimed at the ATS check's bullet findings. Cached until the resume text changes. */
      suggestions: async (versionId: number, refresh = false) => {
        const v = db.getVersion(versionId)!
        const key = `${versionId}:${resumeToText(v.data)}`
        const hit = suggestionCache.get(versionId)
        if (!refresh && hit?.key === key) return { ai: true, items: hit.items }
        if (!(await ai.hasAny())) return { ai: false, items: [] }
        const issues = lintVersion(versionId)
          .findings.filter((f) => BULLET_FINDINGS.has(f.id))
          .map((f) => `${f.title}: ${f.detail}`)
        const items = await aiImproveBullets(ai, v.data, issues)
        suggestionCache.set(versionId, { key, items })
        return { ai: true, items }
      },
      tailoredFor: (jobId: number) => db.sql.prepare("SELECT id, label, docx_path FROM resume_versions WHERE job_id = ? AND kind = 'tailored' ORDER BY id DESC").all(jobId)
    },

    coverLetter: {
      templates: () => db.getTemplates(),
      defaultTemplate: () => DEFAULT_TEMPLATE,
      save: (t: { id?: number; name: string; body: string; isDefault?: boolean }) => db.saveTemplate(t),
      delete: (id: number) => db.deleteTemplate(id),
      preview: (templateBody: string, company: string, role: string) => fillTemplate(templateBody, { company, role, name: db.getProfile().fullName }),
      diff: (a: string, b: string) => wordDiff(a, b),
      forApplication: (coverLetterId: number) => db.getCoverLetter(coverLetterId)
    },

    answers: {
      list: () => db.listAnswers(),
      save: (a: Omit<AnswerBankEntry, 'id'> & { id?: number }) => db.saveAnswer(a, db.getSettings().storeSensitive),
      delete: (id: number) => db.deleteAnswer(id),
      draft: async (question: string) => aiDraftAnswer(ai, question, db.defaultVersion()?.data ?? null),
      /** Answer a question met on an application: update the matching entry, or add a new one. */
      answerQuestion: (question: string, answer: string) => {
        const all = db.listAnswers()
        const key = matchKey(question)?.key
        const existing = all.find((a) => key && a.key === key) ?? matchAnswer(question, all)?.entry ?? all.find((a) => a.question === question)
        const sensitivity = key ? sensitivityOf(key) : 'normal'
        if (existing) return db.saveAnswer({ ...existing, answer, approved: true, variants: existing.question === question ? existing.variants : [...new Set([...existing.variants, question])] }, db.getSettings().storeSensitive)
        return db.saveAnswer({ key: key ?? `custom_${Date.now()}`, question, variants: [], answer, sensitivity, approved: true }, db.getSettings().storeSensitive)
      }
    },

    blocklist: {
      list: () => db.listBlocklist(),
      add: (b: BlockEntry) => {
        db.addBlock(b)
        jobs.rescoreAll()
        return db.listBlocklist()
      },
      remove: (id: number) => {
        db.removeBlock(id)
        jobs.rescoreAll()
        return db.listBlocklist()
      }
    },

    jobs: {
      board: () => jobs.board(),
      list: (f: Parameters<JobService['list']>[0]) => jobs.list(f),
      get: (id: number) => ({ job: db.getJob(id), application: db.applicationForJob(id) }),
      refresh: async () => {
        const rep = await jobs.refresh((source, status) => s.emit('jobs:progress', { source, status }))
        jobs.learnBoardsFromJobs()
        s.emit('jobs:changed', {})
        return rep
      },
      lastRefresh: () => db.getKv<string | null>('jobs.lastRefresh', null),
      signal: (jobId: number, kind: 'view' | 'expand' | 'open' | 'save' | 'dismiss') => {
        const j = db.getJob(jobId)
        if (!j) return
        db.addSignal({ jobId, source: j.source, kind })
        if (kind === 'dismiss') db.updateJob(jobId, { dismissed: true })
        if (kind === 'save') db.updateJob(jobId, { saved: !j.saved })
        if (kind === 'open') platform.openExternal(j.url)
      },
      sourceSignal: (source: string) => db.addSignal({ jobId: null, source, kind: 'expand' }),
      importUrl: async (url: string, extra?: Partial<Job>) => importJob(s, { url, ...extra }),
      addCompanyBoard: async (url: string) => {
        const st = db.getSettings()
        const platformName = detectPlatform(url)
        if (platformName === 'workday') {
          db.saveSettings({ workdayTenants: [...new Set([...st.workdayTenants, url.replace(/\/job\/.*$/, '')])] })
          return 'Workday site added.'
        }
        const m = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com)\/(?:embed\/job_app\?for=)?([\w-]+)/.exec(url)
        if (!m || !['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(platformName)) throw new Error('Paste a careers page link from Workday, Greenhouse, Lever, Ashby, or SmartRecruiters.')
        db.saveSettings({ companyBoards: [...st.companyBoards, { platform: platformName as 'greenhouse', slug: m[1], company: m[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }] })
        return `${platformName} board for ${m[1]} added.`
      }
    },

    applications: {
      list: (status?: Parameters<Db['listApplications']>[0]) => db.listApplications(status),
      events: (id: number) => db.events(id),
      prepare: (jobId: number) => apply.applyOne(jobId, 'review'),
      assist: (jobId: number) => apply.applyOne(jobId, 'assist'),
      submitNow: (jobId: number) => apply.applyOne(jobId, 'auto'),
      approve: (appId: number) => apply.approve(appId),
      markSubmitted: (appId: number) => apply.markSubmittedManually(appId),
      discard: (appId: number) => apply.discard(appId),
      setStatus: (appId: number, status: Parameters<Db['updateApplication']>[1]['status']) => db.updateApplication(appId, { status }),
      runBatch: (mode?: 'review' | 'auto') => {
        void apply.runBatch(mode).catch((e) => s.emit('toast', { kind: 'error', text: (e as Error).message }))
        return true
      },
      stop: () => apply.stop(),
      isRunning: () => apply.isRunning,
      runs: () => db.listRuns(),
      accounts: () => db.listAccounts(),
      revealPassword: (scope: string) => db.getAccount(scope)?.password ?? null,
      deleteAccount: (scope: string) => db.deleteAccount(scope)
    },

    sites: {
      test: async (url: string, screenshots?: string[]) => learning.test(url, screenshots),
      pickScreenshots: () => platform.pickFiles({ title: 'Screenshots of the application', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }], multi: true }),
      feedback: async (scope: string, text: string, manual?: Record<string, string>) => learning.feedback(scope, text, manual),
      approve: (scope: string) => learning.approve(scope),
      recipes: () => db.listRecipes(),
      delete: (scope: string) => db.deleteRecipe(scope)
    },

    email: {
      save: async (user: string, appPassword: string) => {
        db.saveSettings({ emailUser: user.trim() })
        if (appPassword) db.setSecret('email.password', appPassword.replace(/\s+/g, ''))
        const t = await email.test()
        if (t.ok) email.start()
        return t
      },
      test: () => email.test(),
      checkNow: () => email.check(),
      list: () => db.listEmails(),
      configured: () => email.configured()
    },

    analytics: {
      summary: () => {
        const apps = db.listApplications()
        const rows: AppRow[] = apps.map((a) => ({
          id: a.id,
          status: a.status,
          mode: a.mode,
          source: a.job?.source ?? 'unknown',
          platform: a.job?.platform ?? 'generic',
          resumeLabel: resumeFamily(db, a.resumeVersionId),
          submittedAt: a.submittedAt,
          firstResponseAt: a.firstResponseAt
        }))
        return {
          funnel: funnel(rows),
          byResume: byGroup(rows, (r) => r.resumeLabel),
          bySource: byGroup(rows, (r) => r.source),
          byPlatform: byGroup(rows, (r) => r.platform),
          byMode: byGroup(rows, (r) => r.mode),
          perDay: perDay(rows, 30),
          ai: db.aiStats()
        }
      }
    },

    ai: {
      status: () => ai.status(),
      setKey: (id: Exclude<AiProviderId, 'ollama'>, key: string) => ai.setKey(id, key),
      hasKey: (id: AiProviderId) => db.hasSecret(`key.${id}`),
      test: (id: AiProviderId) => ai.test(id),
      openrouterLogin: () => ai.openrouterLogin((u) => platform.openExternal(u)),
      setSourceKey: (id: 'usajobs' | 'adzuna' | 'jsearch', key: string) => {
        db.setSecret(`key.${id}`, key.trim() || null)
        return true
      },
      hasSourceKey: (id: string) => db.hasSecret(`key.${id}`)
    },

    hw: {
      scan: async () => (lastHw = await scanHardware()),
      /** Everything the Local AI screen needs to pick up where it left off. */
      state: () => ({ hw: lastHw, jobs: Object.values(modelJobs), ollamaLog, ollamaInstalling }),
      recommend: (freedom: boolean) => (lastHw ? recommendModels(lastHw, MODELS, { freedom }) : []),
      hfSearch: async () => hfUncensoredSearch(lastHw ? Math.max(4, ...lastHw.gpus.map((g) => g.vramGB)) : 8),
      setupPrompt: (freedom: boolean) => (lastHw ? setupPrompt(lastHw, recommendModels(lastHw, MODELS, { freedom })) : ''),
      ollama: () => ollamaState(),
      installOllama: async () => {
        ollamaInstalling = true
        ollamaLog = ''
        try {
          return await installOllama((l) => {
            ollamaLog = (ollamaLog + l).slice(-2000)
            s.emit('hw:log', l)
          })
        } finally {
          ollamaInstalling = false
        }
      },
      startOllama: () => startOllama(),
      /** Download, test, and (if nothing is in use yet) select a model. Runs in the background; progress arrives as hw:job events. */
      install: async (tag: string) => {
        const job = modelJobs[tag]
        if (job && (job.phase === 'starting' || job.phase === 'downloading' || job.phase === 'testing')) return true
        setJob(tag, { phase: 'starting', status: 'Starting Ollama…', pct: 0, error: undefined })
        void (async () => {
          try {
            await ensureOllama()
            setJob(tag, { phase: 'downloading', status: 'Downloading…' })
            await pullModel(tag, (p) =>
              setJob(tag, { status: p.status, pct: p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : (modelJobs[tag]?.pct ?? 0) })
            )
            const r = await runTest(tag)
            if (r.ok && !db.getSettings().ollamaModel) await useModel(tag)
          } catch (e) {
            setJob(tag, { phase: 'failed', status: (e as Error).message, error: (e as Error).message })
          }
        })()
        return true
      },
      /** Re-run the test on an installed model. */
      test: async (tag: string) => {
        const job = modelJobs[tag]
        if (job && (job.phase === 'starting' || job.phase === 'downloading' || job.phase === 'testing')) return true
        void (async () => {
          try {
            await ensureOllama()
            await runTest(tag)
          } catch (e) {
            setJob(tag, { phase: 'failed', status: (e as Error).message, error: (e as Error).message })
          }
        })()
        return true
      },
      remove: async (tag: string) => {
        await ensureOllama()
        await deleteModel(tag)
        const st = db.getSettings()
        const tests = { ...st.modelTests }
        delete tests[tag]
        db.saveSettings({ modelTests: tests, ...(sameModel(st.ollamaModel, tag) ? { ollamaModel: '' } : {}) })
        delete modelJobs[tag]
        return true
      },
      benchmark: (tag: string) => benchmark(tag),
      use: (tag: string) => useModel(tag),
      catalog: () => MODELS
    }
  }
}

/** Ollama reports untagged models as "name:latest". */
function sameModel(a: string, b: string): boolean {
  const norm = (x: string) => (x.includes(':') ? x : `${x}:latest`)
  return !!a && !!b && norm(a) === norm(b)
}

export type Api = ReturnType<typeof createApi>

const STATE_ABBR: Record<string, string> = {
  'north carolina': 'NC',
  'south carolina': 'SC',
  virginia: 'VA',
  georgia: 'GA',
  tennessee: 'TN',
  florida: 'FL',
  texas: 'TX',
  california: 'CA',
  'new york': 'NY',
  ohio: 'OH',
  pennsylvania: 'PA',
  maryland: 'MD'
}

function resumeFamily(db: Db, versionId: number | null): string {
  if (!versionId) return 'Unknown'
  let v = db.getVersion(versionId)
  // Tailored versions roll up to the base version they came from.
  for (let i = 0; v && v.kind === 'tailored' && v.parentId && i < 5; i++) v = db.getVersion(v.parentId)
  return v ? `${v.label} #${v.id}` : 'Unknown'
}

/** Import a job from a URL or from extension data, then resolve the original posting. */
export async function importJob(s: Services, data: Partial<Job> & { url: string; externalApplyUrl?: string; companyUrl?: string }) {
  const { db, jobs } = s
  const url = data.url
  const platformName = detectPlatform(url)
  let description = data.description ?? ''
  let title = data.title ?? ''
  let company = data.company ?? ''
  let location = data.location ?? ''
  if (!title || !description) {
    // Fetch the page and read schema.org JobPosting data if present.
    try {
      const html = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0' }, signal: AbortSignal.timeout(20000) })).text()
      const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
        try {
          return JSON.parse(m[1])
        } catch {
          return null
        }
      })
      const posting = ld.flat().find((x) => x && (x['@type'] === 'JobPosting' || x['@graph']?.some?.((g: any) => g['@type'] === 'JobPosting')))
      const jp = posting?.['@type'] === 'JobPosting' ? posting : posting?.['@graph']?.find((g: any) => g['@type'] === 'JobPosting')
      if (jp) {
        title ||= jp.title
        company ||= jp.hiringOrganization?.name ?? ''
        description ||= (await import('@core/text')).stripHtml(jp.description ?? '')
        const addr = Array.isArray(jp.jobLocation) ? jp.jobLocation[0]?.address : jp.jobLocation?.address
        location ||= [addr?.addressLocality, addr?.addressRegion].filter(Boolean).join(', ')
      } else {
        title ||= /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? 'Imported job'
        description ||= (await import('@core/text')).stripHtml(html).slice(0, 8000)
      }
    } catch {
      /* keep what we have */
    }
  }
  const applyUrl = data.externalApplyUrl && detectPlatform(data.externalApplyUrl) !== 'linkedin' ? data.externalApplyUrl : platformName === 'linkedin' || platformName === 'indeed' ? undefined : url
  const n = {
    source: 'imported',
    externalId: url.replace(/[?#].*$/, ''),
    url,
    applyUrl,
    company: company || 'Unknown company',
    companyDomain: data.companyUrl ? safeHost(data.companyUrl) : undefined,
    title: title || 'Imported job',
    location,
    remoteType: (data.remoteType ?? (/remote/i.test(location + title) ? 'remote' : /hybrid/i.test(location + title) ? 'hybrid' : 'unknown')) as Job['remoteType'],
    payMin: data.payMin,
    payMax: data.payMax,
    payUnit: data.payUnit,
    description,
    postedAt: data.postedAt,
    platform: applyUrl ? detectPlatform(applyUrl) : platformName
  }
  const res = jobs.upsert(n)
  const job = db.findJobBySource('imported', n.externalId) ?? db.findJobByFingerprint((await import('@core/dedupe')).fingerprint(n))
  // Original-posting resolver: no company link yet -> look on known company boards.
  if (job && !job.applyUrl) {
    const resolved = await resolveOriginal(s, job)
    if (resolved) db.updateJob(job.id, { applyUrl: resolved, platform: detectPlatform(resolved) })
  }
  jobs.learnBoardsFromJobs()
  s.emit('jobs:changed', {})
  const final = job ? db.getJob(job.id) : null
  return { result: res, job: final, assistOnly: !!final && !final.applyUrl }
}

function safeHost(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** Find the same job on the company's own application site. */
async function resolveOriginal(s: Services, job: Job): Promise<string | null> {
  const { db } = s
  const st = db.getSettings()
  const key = job.company.toLowerCase().replace(/[^a-z0-9]/g, '')
  const titleWords = job.title.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  const close = (t: string) => titleWords.filter((w) => t.toLowerCase().includes(w)).length >= Math.max(1, Math.ceil(titleWords.length * 0.7))
  const guesses = [...new Set([key, job.company.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...st.companyBoards.filter((b) => b.company.toLowerCase().replace(/[^a-z0-9]/g, '') === key).map((b) => b.slug)])]
  for (const slug of guesses) {
    try {
      const gh = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { signal: AbortSignal.timeout(8000) })
      if (gh.ok) {
        const hit = ((await gh.json()) as { jobs: { title: string; absolute_url: string }[] }).jobs.find((j) => close(j.title))
        if (hit) return hit.absolute_url
      }
      const lv = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, { signal: AbortSignal.timeout(8000) })
      if (lv.ok) {
        const hit = ((await lv.json()) as { text: string; hostedUrl: string }[]).find((j) => close(j.text))
        if (hit) return hit.hostedUrl
      }
      const ab = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(8000) })
      if (ab.ok) {
        const hit = ((await ab.json()) as { jobs: { title: string; jobUrl: string }[] }).jobs.find((j) => close(j.title))
        if (hit) return hit.jobUrl
      }
    } catch {
      /* try next */
    }
  }
  // Company careers page: look for a known platform link.
  if (job.companyDomain) {
    for (const path of ['/careers', '/jobs', '/careers/']) {
      try {
        const html = await (await fetch(`https://${job.companyDomain}${path}`, { signal: AbortSignal.timeout(8000) })).text()
        const link = /https:\/\/[\w.-]*(myworkdayjobs\.com|greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|smartrecruiters\.com)[^"'\s<]*/.exec(html)?.[0]
        if (link) return link
      } catch {
        /* next */
      }
    }
  }
  return null
}
