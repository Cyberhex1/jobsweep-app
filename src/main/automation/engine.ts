// Application engine: opens the application, handles accounts, fills each page, and stops or submits per mode.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import type { Page } from 'playwright-core'
import type { FilledField, FormField, Job } from '@shared/types'
import { chooseOption, resolveField, sensitivityOf, type ValueContext } from '@core/fields'
import { detectPlatform, ASSIST_ONLY } from '@core/platform'
import { normalize } from '@core/text'
import type { Db } from '../db'
import type { AiRouter } from '../ai/router'
import { aiDraftAnswer, aiMapFields } from '../ai/tasks'
import type { BrowserManager } from './browser'
import { EXTRACT_FIELDS, FIND_BUTTONS, FIND_ERRORS, PAGE_TEXT } from './pageScript'

export type FillMode = 'dry' | 'review' | 'auto' | 'assist'

export interface JobDocuments {
  resumeDocx: string
  resumePdf: () => Promise<string>
  /** Generated only when a site has a cover letter field. */
  coverLetter: () => Promise<{ path: string; text: string } | null>
  resumeVersionId?: number
  coverLetterId?: () => number | null
}

export interface ExtractedField extends FormField {
  group?: string[]
  current?: string
  accept?: string
}

export interface FillOutcome {
  status: 'ready_for_review' | 'submitted' | 'needs_you' | 'failed' | 'tested'
  fields: FilledField[]
  screenshots: string[]
  pages: { title: string; screenshot: string; fields: (FormField & { value: string; key: string | null; confidence: number })[] }[]
  reason?: string
  finalUrl?: string
}

export interface EngineDeps {
  db: Db
  browser: BrowserManager
  ai: AiRouter | null
  screenshotsDir: string
  documents: (job: Job) => Promise<JobDocuments>
  waitForVerification?: (hosts: string[], since: Date, timeoutMs: number) => Promise<{ link?: string; code?: string } | null>
  onStatus?: (msg: string) => void
}

type Btn = { selector: string; text: string; auto: string; type: string; tag: string }

const SUBMIT_RE = /^(submit|submit application|submit my application|send application|send|finish|complete application|complete|apply|apply now|review and submit)$/i
const NEXT_RE = /^(next|continue|save and continue|save & continue|proceed|next step|next page)$/i
const START_RE = /^(apply|apply now|apply for this (job|position|role)|i'?m interested|apply manually|start application|apply on company site|apply to job)$/i
const SIGNIN_RE = /^(sign in|log in|login|sign-in)$/i
const CREATE_RE = /^(create account|create an account|sign up|register|create my account)$/i
const SKIP_RE = /(linkedin|google|facebook|indeed|apple|microsoft|autofill|seek|dice|use my last application)/i
const CONFIRM_RE = /(thank you for (applying|your application|your interest)|application (has been |was )?(received|submitted|complete)|we('ve| have) received your application|successfully (applied|submitted)|your application is complete)/i

export function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?']
  const all = sets.join('')
  const chars = sets.map((s) => s[randomInt(s.length)])
  while (chars.length < 16) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const k = randomInt(i + 1)
    ;[chars[i], chars[k]] = [chars[k], chars[i]]
  }
  return chars.join('')
}

export function accountScope(url: string): string {
  const u = new URL(url)
  const platform = detectPlatform(url)
  // NEOGOV / governmentjobs.com uses one account for every agency.
  if (platform === 'neogov') return 'neogov'
  if (platform === 'usajobs') return 'usajobs'
  return `${platform}:${u.hostname}`
}

export class ApplyEngine {
  constructor(private d: EngineDeps) {}

  private status(m: string) {
    this.d.onStatus?.(m)
  }

  /** Fill (and per mode, submit) the application for a job. */
  async run(job: Job, mode: FillMode, opts: { keepOpen?: boolean; startUrl?: string } = {}): Promise<FillOutcome> {
    const url = opts.startUrl ?? job.applyUrl ?? job.url
    const platform = detectPlatform(url)
    if (mode === 'auto' && ASSIST_ONLY.includes(platform as never)) mode = 'assist'
    mkdirSync(this.d.screenshotsDir, { recursive: true })
    const page = await this.d.browser.newPage()
    page.setDefaultTimeout(15000)
    const outcome: FillOutcome = { status: 'failed', fields: [], screenshots: [], pages: [] }
    try {
      this.status(`Opening ${new URL(url).hostname}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await this.settle(page)
      const docs = await this.d.documents(job)
      const ctx = this.valueContext(job)
      const recipe = this.d.db.getRecipe(platform) ?? this.d.db.getRecipe(new URL(url).hostname)
      let lastSig = ''
      for (let step = 0; step < 15; step++) {
        if (CONFIRM_RE.test(await this.text(page)) && step > 0) {
          outcome.status = mode === 'auto' ? 'submitted' : outcome.status
          break
        }
        let fields = await this.extract(page)
        const buttons = await this.buttons(page)
        // Landing page with no form yet: click "Apply".
        if (this.fillable(fields).length < 2 && !fields.some((f) => f.type === 'password')) {
          const start = buttons.find((b) => START_RE.test(b.text) && !SKIP_RE.test(b.text)) ?? buttons.find((b) => b.auto === 'adventureButton')
          const manual = buttons.find((b) => /apply manually/i.test(b.text) || b.auto === 'applyManually')
          const target = manual ?? start
          if (target && step < 4) {
            this.status(`Clicking "${target.text}"`)
            await this.click(page, target.selector)
            continue
          }
        }
        // Accounts: sign in or create one.
        if (fields.some((f) => f.type === 'password')) {
          const acct = await this.handleAccount(page, url, fields, buttons, ctx.profile.email, mode)
          if (acct === 'needs_you') {
            outcome.status = 'needs_you'
            outcome.reason = 'Account sign-in or verification needs you (CAPTCHA, 2FA, or email verification).'
            break
          }
          if (acct === 'done') {
            await this.settle(page)
            continue
          }
        }
        fields = await this.extract(page)
        const sig = fields.map((f) => f.label).join('|')
        const filled = await this.fillPage(page, fields, ctx, recipe?.mappings ?? {}, docs, mode, job)
        outcome.fields.push(...filled.values)
        const shot = join(this.d.screenshotsDir, `job${job.id}-${Date.now()}-p${step}.png`)
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
        outcome.screenshots.push(shot)
        outcome.pages.push({ title: await page.title(), screenshot: shot, fields: filled.pageFields })
        if (filled.needs.length && mode === 'auto') {
          outcome.status = 'needs_you'
          outcome.reason = filled.needs.join('; ')
          break
        }
        if (mode === 'assist') {
          outcome.status = 'needs_you'
          outcome.reason = filled.needs.length ? `Fill in: ${filled.needs.join('; ')} — then review and submit yourself.` : 'Filled. Review the page and submit it yourself.'
          opts.keepOpen = true
          break
        }
        const btns = await this.buttons(page)
        const next = btns.find((b) => NEXT_RE.test(b.text) || b.auto === 'bottom-navigation-next-button' && !/submit/i.test(b.text))
        const submit = btns.find((b) => SUBMIT_RE.test(b.text) && !SKIP_RE.test(b.text)) ?? btns.find((b) => b.type === 'submit' && /submit|apply/i.test(b.text))
        const finalSubmit = !!submit && (/submit|send|finish|complete/i.test(submit.text) || !next)
        if (next && !finalSubmit) {
          if (sig === lastSig) {
            const errors = await page.evaluate(FIND_ERRORS).catch(() => [] as string[])
            outcome.status = 'needs_you'
            outcome.reason = `Stuck on a page${(errors as string[]).length ? ': ' + (errors as string[]).join('; ') : ''}`
            break
          }
          lastSig = sig
          this.status(`Next page`)
          await this.click(page, next.selector)
          continue
        }
        if (submit) {
          if (mode !== 'auto') {
            outcome.status = mode === 'dry' ? 'tested' : filled.needs.length ? 'needs_you' : 'ready_for_review'
            if (filled.needs.length) outcome.reason = filled.needs.join('; ')
            break
          }
          if (filled.needs.length) {
            outcome.status = 'needs_you'
            outcome.reason = filled.needs.join('; ')
            break
          }
          this.status('Submitting')
          await this.click(page, submit.selector)
          await this.settle(page, 4000)
          const text = await this.text(page)
          if (CONFIRM_RE.test(text)) {
            outcome.status = 'submitted'
            const s2 = join(this.d.screenshotsDir, `job${job.id}-${Date.now()}-confirm.png`)
            await page.screenshot({ path: s2, fullPage: true }).catch(() => {})
            outcome.screenshots.push(s2)
            break
          }
          const errors = (await page.evaluate(FIND_ERRORS).catch(() => [])) as string[]
          if (errors.length) {
            outcome.status = 'needs_you'
            outcome.reason = `The site reported: ${errors.join('; ')}`
            break
          }
          // Some sites go to another step after "Submit"; loop again.
          continue
        }
        outcome.status = mode === 'dry' ? 'tested' : 'needs_you'
        outcome.reason = 'Could not find a Next or Submit button.'
        break
      }
      outcome.finalUrl = page.url()
      if (outcome.status === 'failed' && !outcome.reason) outcome.reason = 'Too many steps'
    } catch (e) {
      outcome.status = 'failed'
      outcome.reason = (e as Error).message.split('\n')[0].slice(0, 300)
      const shot = join(this.d.screenshotsDir, `job${job.id}-${Date.now()}-error.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      outcome.screenshots.push(shot)
    } finally {
      const keep = opts.keepOpen || outcome.status === 'needs_you'
      if (!keep) await page.close().catch(() => {})
      else await page.bringToFront().catch(() => {})
    }
    return outcome
  }

  private valueContext(job: Job): ValueContext {
    const db = this.d.db
    const s = db.getSettings()
    const sensitiveValues: Record<string, string> = {}
    if (s.storeSsnDob) {
      const ssn = db.getSecret('sensitive.ssn')
      const dob = db.getSecret('sensitive.dob')
      if (ssn) sensitiveValues.ssn = ssn
      if (dob) sensitiveValues.dob = dob
    }
    return { profile: db.getProfile(), resume: db.defaultVersion()?.data ?? null, bank: db.listAnswers(), settings: s, job: { company: job.company, title: job.title }, sensitiveValues }
  }

  private async settle(page: Page, extra = 1200) {
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(extra)
  }

  private async text(page: Page): Promise<string> {
    return (await page.evaluate(PAGE_TEXT).catch(() => '')) as string
  }

  private async extract(page: Page): Promise<ExtractedField[]> {
    return ((await page.evaluate(EXTRACT_FIELDS).catch(() => [])) as ExtractedField[]).filter((f) => f.label || f.name || f.type === 'file')
  }

  private async buttons(page: Page): Promise<Btn[]> {
    return (await page.evaluate(FIND_BUTTONS).catch(() => [])) as Btn[]
  }

  private fillable(fields: ExtractedField[]) {
    return fields.filter((f) => f.type !== 'file' && f.type !== 'checkbox')
  }

  private async click(page: Page, selector: string) {
    const el = page.locator(selector).first()
    await el.scrollIntoViewIfNeeded().catch(() => {})
    // Small human-paced pause between actions.
    await page.waitForTimeout(300 + randomInt(500))
    await el.click()
    await this.settle(page)
  }

  /** Sign in with a saved account or create one. */
  private async handleAccount(page: Page, url: string, fields: ExtractedField[], buttons: Btn[], email: string, mode: FillMode): Promise<'done' | 'needs_you' | 'skip'> {
    const scope = accountScope(url)
    const db = this.d.db
    let acct = db.getAccount(scope)
    const pwFields = fields.filter((f) => f.type === 'password')
    const emailField = fields.find((f) => f.type === 'email' || /e-?mail|user ?name/i.test(f.label))
    const isSignup = pwFields.length >= 2 || buttons.some((b) => CREATE_RE.test(b.text) && /submit|button/i.test(b.type + b.tag) && pwFields.length >= 2)
    if (!isSignup && !acct) {
      const create = buttons.find((b) => CREATE_RE.test(b.text) || b.auto === 'createAccountLink')
      if (create) {
        await this.click(page, create.selector)
        return 'done'
      }
      return 'needs_you'
    }
    if (isSignup && !acct) {
      if (!email) return 'needs_you'
      const password = generatePassword()
      this.status(`Creating an account on ${new URL(url).hostname}`)
      if (emailField) await page.locator(emailField.selector).fill(email)
      for (const p of pwFields) await page.locator(p.selector).fill(password)
      for (const c of fields.filter((f) => f.type === 'checkbox' && (f.required || /agree|terms|privacy|consent/i.test(f.label)))) await page.locator(c.selector).check({ force: true }).catch(() => {})
      db.saveAccount({ scope, username: email, password, email, status: 'pending_verification' })
      const since = new Date()
      const btn = (await this.buttons(page)).find((b) => CREATE_RE.test(b.text) || b.auto === 'createAccountSubmitButton' || /^(submit|continue)$/i.test(b.text))
      if (!btn) return 'needs_you'
      await this.click(page, btn.selector)
      const text = await this.text(page)
      if (/captcha|i'?m not a robot/i.test(text)) return 'needs_you'
      if (/verif|confirm your email|check your (e-?mail|inbox)|activation/i.test(text) && this.d.waitForVerification) {
        this.status('Waiting for the verification email')
        const host = new URL(url).hostname
        const root = host.split('.').slice(-2).join('.')
        const v = await this.d.waitForVerification([host, root, 'myworkday.com', 'myworkdayjobs.com', 'governmentjobs.com', 'neogov.com', 'icims.com', 'taleo.net', 'successfactors.com'], since, 5 * 60000)
        if (!v) return 'needs_you'
        if (v.link) {
          await page.goto(v.link, { waitUntil: 'domcontentloaded' })
          await this.settle(page)
          await page.goto(url, { waitUntil: 'domcontentloaded' })
        } else if (v.code) {
          const codeField = (await this.extract(page)).find((f) => /code|otp|verification/i.test(f.label))
          if (!codeField) return 'needs_you'
          await page.locator(codeField.selector).fill(v.code)
          const b2 = (await this.buttons(page)).find((b) => /verify|submit|continue|confirm/i.test(b.text))
          if (b2) await this.click(page, b2.selector)
        }
      }
      db.saveAccount({ scope, username: email, password, email, status: 'active' })
      return 'done'
    }
    if (!acct) acct = db.getAccount(scope)
    if (!acct) return 'needs_you'
    this.status(`Signing in to ${new URL(url).hostname}`)
    if (emailField) await page.locator(emailField.selector).fill(acct.username)
    await page.locator(pwFields[0].selector).fill(acct.password)
    const signIn = (await this.buttons(page)).find((b) => SIGNIN_RE.test(b.text) || b.auto === 'signInSubmitButton' || (b.type === 'submit' && !CREATE_RE.test(b.text)))
    if (!signIn) return 'needs_you'
    await this.click(page, signIn.selector)
    const after = await this.extract(page)
    // Still on a password page: wrong password, CAPTCHA, or two-step verification.
    if (after.some((f) => f.type === 'password')) return 'needs_you'
    return 'done'
  }

  private async fillPage(
    page: Page,
    fields: ExtractedField[],
    ctx: ValueContext,
    mappings: Record<string, string>,
    docs: JobDocuments,
    mode: FillMode,
    job: Job
  ): Promise<{ values: FilledField[]; needs: string[]; pageFields: FillOutcome['pages'][number]['fields'] }> {
    const values: FilledField[] = []
    const needs: string[] = []
    const pageFields: FillOutcome['pages'][number]['fields'] = []
    const resolved = new Map<ExtractedField, { value: string | null; key: string | null; confidence: number; source: FilledField['source']; needsUser?: string }>()

    for (const f of fields) {
      if (f.type === 'password') continue
      const override = mappings[normalize(f.label)]
      if (override === 'skip') continue
      if (override?.startsWith('=')) {
        resolved.set(f, { value: override.slice(1), key: null, confidence: 1, source: 'recipe' })
        continue
      }
      if (f.type === 'file') {
        const isCover = /cover|letter/i.test(f.label + f.name)
        const cl = isCover ? await docs.coverLetter() : null
        resolved.set(f, { value: isCover ? (cl?.path ?? null) : '__resume__', key: isCover ? 'cover_letter' : 'resume_upload', confidence: 0.9, source: 'profile' })
        continue
      }
      const r = resolveField(f, ctx, override || undefined)
      // Cover letter text boxes.
      if (r.key === 'cover_letter') {
        const cl = await docs.coverLetter()
        if (cl) resolved.set(f, { value: cl.text, key: 'cover_letter', confidence: 0.9, source: 'profile' })
        continue
      }
      resolved.set(f, r)
    }

    // Ask AI about required fields we couldn't place.
    const unknown = fields.filter((f) => {
      const r = resolved.get(f)
      return r && !r.value && !r.key && f.required
    })
    if (unknown.length && this.d.ai) {
      try {
        const keys = await aiMapFields(this.d.ai, unknown)
        for (const [i, key] of Object.entries(keys)) {
          const f = unknown[Number(i)]
          if (!f || key === 'unknown') continue
          if (key === 'question') {
            const draft = await aiDraftAnswer(this.d.ai, f.label, ctx.resume, { title: job.title, company: job.company, description: job.description })
            if (draft && draft !== 'NEEDS_USER') {
              const exists = ctx.bank.some((b) => normalize(b.question) === normalize(f.label))
              if (!exists) this.d.db.saveAnswer({ key: `custom_${Date.now()}`, question: f.label, variants: [], answer: draft, sensitivity: 'normal', approved: false }, false)
              resolved.set(f, { value: draft, key: null, confidence: 0.5, source: 'ai', needsUser: mode === 'auto' ? `Approve the drafted answer for "${f.label}" in the Answer Bank` : undefined })
            }
          } else {
            const r = resolveField(f, ctx, key)
            if (r.value || r.needsUser) resolved.set(f, { ...r, confidence: Math.min(r.confidence, 0.75) })
          }
        }
      } catch {
        /* AI unavailable: fall through to needs */
      }
    }

    for (const f of fields) {
      const r = resolved.get(f)
      if (!r) continue
      if (r.needsUser && (f.required || sensitivityOf(r.key ?? '') !== 'normal')) needs.push(r.needsUser)
      if (r.value == null || r.value === '') {
        pageFields.push({ ...f, value: '', key: r.key, confidence: 0 })
        continue
      }
      try {
        const used = await this.setValue(page, f, r.value, docs)
        if (used != null) {
          values.push({ label: f.label, key: r.key, value: f.type === 'file' ? used.split(/[\\/]/).pop()! : used, confidence: r.confidence, source: r.source })
          pageFields.push({ ...f, value: used, key: r.key, confidence: r.confidence })
        } else if (f.required) {
          needs.push(`No matching option for "${f.label}" (wanted "${r.value}")`)
          pageFields.push({ ...f, value: '', key: r.key, confidence: 0 })
        }
      } catch (e) {
        if (f.required) needs.push(`Couldn't fill "${f.label}": ${(e as Error).message.split('\n')[0].slice(0, 120)}`)
      }
    }
    return { values, needs: [...new Set(needs)], pageFields }
  }

  /** Put a value into a field. Returns the value actually used, or null if no option matched. */
  private async setValue(page: Page, f: ExtractedField, value: string, docs: JobDocuments): Promise<string | null> {
    const loc = page.locator(f.selector).first()
    switch (f.type) {
      case 'file': {
        let path = value
        if (value === '__resume__') path = /pdf/i.test(f.accept ?? '') && !/doc/i.test(f.accept ?? '') ? await docs.resumePdf() : docs.resumeDocx
        await loc.setInputFiles(path)
        return path
      }
      case 'select': {
        const opt = chooseOption(f.options, value)
        if (!opt) return null
        await loc.selectOption({ label: opt })
        return opt
      }
      case 'radio': {
        const opt = chooseOption(f.options, value)
        if (!opt) return null
        const idx = f.options.indexOf(opt)
        const target = page.locator(f.group?.[idx] ?? f.selector).first()
        await target.check({ force: true }).catch(async () => target.click({ force: true }))
        return opt
      }
      case 'checkbox': {
        if (/^(yes|true|i agree|agree|checked|1)$/i.test(value) || /^yes/i.test(value)) {
          if (f.group?.length && f.options.length) {
            const opt = chooseOption(f.options, value)
            if (opt) await page.locator(f.group[f.options.indexOf(opt)]).check({ force: true })
          } else await loc.check({ force: true })
          return 'checked'
        }
        return 'unchecked'
      }
      case 'combobox': {
        await loc.click()
        await page.waitForTimeout(400)
        const options = await page.locator('[role="option"]').allInnerTexts().catch(() => [] as string[])
        let opt = chooseOption(options, value)
        if (!opt) {
          await page.keyboard.type(value.slice(0, 40), { delay: 30 })
          await page.waitForTimeout(800)
          const opts2 = await page.locator('[role="option"]').allInnerTexts().catch(() => [] as string[])
          opt = chooseOption(opts2, value)
        }
        if (!opt) {
          await page.keyboard.press('Escape').catch(() => {})
          return null
        }
        await page.locator('[role="option"]', { hasText: opt }).first().click()
        return opt
      }
      case 'date': {
        const d = new Date(value)
        await loc.fill(isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10))
        return value
      }
      default: {
        if ((f.current ?? '') === value) return value
        await loc.fill(value)
        return value
      }
    }
  }
}
