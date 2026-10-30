// Email watcher for the dedicated job-search Gmail (IMAP + app password).

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { classifyEmail, extractCode, extractLinks, linkEmail, pickVerificationLink, STATUS_FOR, type AppLite } from '@core/emailClassify'
import { detectPlatform } from '@core/platform'
import type { Db } from '../db'
import type { AiRouter } from '../ai/router'
import { aiClassifyEmail } from '../ai/tasks'

interface Parsed {
  messageId: string
  from: string
  subject: string
  text: string
  html: string
  date: Date
}

export class EmailWatcher {
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private db: Db,
    private ai: AiRouter | null,
    private onUpdate: (msg: string) => void = () => {}
  ) {}

  private creds() {
    const s = this.db.getSettings()
    const pass = this.db.getSecret('email.password')
    if (!s.emailUser || !pass) return null
    return { host: s.emailHost || 'imap.gmail.com', user: s.emailUser, pass }
  }

  configured() {
    return !!this.creds()
  }

  private async withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = this.creds()
    if (!c) throw new Error('Email is not set up')
    const client = new ImapFlow({ host: c.host, port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const n = await this.withClient(async (c) => {
        const box = await c.mailboxOpen('INBOX', { readOnly: true })
        return box.exists
      })
      return { ok: true, message: `Connected. ${n} messages in the inbox.` }
    } catch (e) {
      const m = (e as Error).message
      return { ok: false, message: /auth|credentials|invalid/i.test(m) ? 'Sign-in failed. Use a Gmail app password (16 letters), not your normal password.' : m }
    }
  }

  private async fetchSince(since: Date, limit = 200): Promise<Parsed[]> {
    return this.withClient(async (c) => {
      await c.mailboxOpen('INBOX', { readOnly: true })
      const uids = (await c.search({ since }, { uid: true })) || []
      const out: Parsed[] = []
      for (const uid of uids.slice(-limit)) {
        const msg = await c.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        const p = await simpleParser(msg.source)
        out.push({
          messageId: p.messageId ?? `uid-${uid}`,
          from: p.from?.text ?? '',
          subject: p.subject ?? '',
          text: p.text ?? '',
          html: typeof p.html === 'string' ? p.html : '',
          date: p.date ?? new Date()
        })
      }
      return out
    })
  }

  /** Check the inbox, classify new mail, and update application statuses. */
  async check(): Promise<{ processed: number; updates: string[] }> {
    if (this.busy || !this.configured()) return { processed: 0, updates: [] }
    this.busy = true
    const updates: string[] = []
    try {
      const last = this.db.getKv<string | null>('email.lastCheck', null)
      const since = last ? new Date(new Date(last).getTime() - 86400000) : new Date(Date.now() - 30 * 86400000)
      const msgs = await this.fetchSince(since)
      const apps: AppLite[] = this.db
        .listApplications()
        .filter((a) => a.job && a.submittedAt)
        .map((a) => ({ id: a.id, company: a.job!.company, title: a.job!.title, platformHost: hostOf(a.job!.applyUrl ?? a.job!.url), submittedAt: a.submittedAt }))
      let processed = 0
      for (const m of msgs) {
        if (this.db.hasEmail(m.messageId)) continue
        processed++
        let { cls, confidence } = classifyEmail(m)
        if (cls === 'other' && this.ai) {
          try {
            cls = await aiClassifyEmail(this.ai, m)
            confidence = 0.6
          } catch {
            /* keep rules result */
          }
        }
        const link = cls === 'verification' ? null : linkEmail(m, apps)
        this.db.addEmail({ messageId: m.messageId, from: m.from, subject: m.subject, receivedAt: m.date.toISOString(), classification: cls, applicationId: link?.appId ?? null, snippet: m.text.slice(0, 280) })
        const status = STATUS_FOR[cls]
        if (link && status && confidence >= 0.6) {
          const app = this.db.getApplication(link.appId)
          if (app) {
            const rank = ['submitted', 'confirmed', 'rejected', 'assessment', 'interview', 'offer']
            // Don't downgrade (e.g., a late confirmation after an interview invite).
            if (rank.indexOf(status) >= rank.indexOf(app.status) || status === 'rejected') {
              this.db.updateApplication(app.id, { status, ...(status !== 'confirmed' && !this.firstResponse(app.id) ? { firstResponseAt: m.date.toISOString() } : {}) })
              this.db.addEvent(app.id, 'email', `${cls}: ${m.subject}`)
              if (app.jobId) {
                const job = this.db.getJob(app.jobId)
                if (job && status !== 'confirmed') this.db.addSignal({ jobId: job.id, source: job.source, kind: 'response' })
              }
              updates.push(`${cls === 'interview' ? '🎉 ' : ''}${status}: ${m.subject}`)
            }
          }
        }
      }
      this.db.setKv('email.lastCheck', new Date().toISOString())
      if (updates.length) this.onUpdate(updates.join('\n'))
      return { processed, updates }
    } finally {
      this.busy = false
    }
  }

  private firstResponse(appId: number): boolean {
    return !!this.db.listApplications().find((a) => a.id === appId)?.firstResponseAt
  }

  /** Wait for a verification email from one of the allowed hosts; returns the link or code. */
  async waitForVerification(hosts: string[], since: Date, timeoutMs: number): Promise<{ link?: string; code?: string } | null> {
    if (!this.configured()) return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const msgs = await this.fetchSince(new Date(since.getTime() - 60000), 30)
        for (const m of msgs.filter((x) => x.date >= new Date(since.getTime() - 60000)).reverse()) {
          if (classifyEmail(m).cls !== 'verification' && !/verif|confirm|activat/i.test(m.subject)) continue
          const link = pickVerificationLink(extractLinks(m.html || m.text), hosts)
          if (link) return { link }
          const code = extractCode(m.text)
          if (code) return { code }
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 15000))
    }
    return null
  }

  start() {
    this.stop()
    const minutes = Math.max(3, this.db.getSettings().emailPollMinutes || 10)
    this.timer = setInterval(() => void this.check().catch(() => {}), minutes * 60000)
    setTimeout(() => void this.check().catch(() => {}), 20000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

function hostOf(url: string): string | undefined {
  try {
    const h = new URL(url).hostname
    return detectPlatform(url) === 'generic' ? h : h
  } catch {
    return undefined
  }
}
