// Local SQLite database (Node's built-in node:sqlite — no native modules to compile).

import { DatabaseSync } from 'node:sqlite'
import type {
  AnswerBankEntry,
  Application,
  ApplicationMode,
  ApplicationStatus,
  Job,
  NormalizedJob,
  Profile,
  Resume,
  ResumeKind,
  ResumeStructured,
  ResumeVersion,
  RunSummary,
  Settings,
  Signal,
  SiteRecipe,
  SiteTestResult
} from '@shared/types'
import { DEFAULT_SETTINGS, EMPTY_PROFILE } from '@shared/defaults'
import { SEED_QUESTIONS } from '@core/fields'
import type { BlockEntry } from '@core/blocklist'

const MIGRATIONS: string[] = [
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE resumes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, default_version_id INTEGER, created_at TEXT NOT NULL);
   CREATE TABLE resume_versions (id INTEGER PRIMARY KEY, resume_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, parent_id INTEGER, data TEXT NOT NULL, raw_text TEXT NOT NULL DEFAULT '', docx_path TEXT, job_id INTEGER, created_at TEXT NOT NULL);
   CREATE TABLE cover_letters (id INTEGER PRIMARY KEY, job_id INTEGER, body TEXT NOT NULL, base TEXT NOT NULL, docx_path TEXT, created_at TEXT NOT NULL);
   CREATE TABLE answer_bank (id INTEGER PRIMARY KEY, key TEXT NOT NULL, question TEXT NOT NULL, variants TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '', answer_enc TEXT, sensitivity TEXT NOT NULL DEFAULT 'normal', approved INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE jobs (id INTEGER PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT NOT NULL, apply_url TEXT, company TEXT NOT NULL, company_domain TEXT, title TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
     remote_type TEXT NOT NULL DEFAULT 'unknown', pay_min REAL, pay_max REAL, pay_unit TEXT, description TEXT NOT NULL DEFAULT '', posted_at TEXT, platform TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, times_seen INTEGER NOT NULL DEFAULT 1,
     fingerprint TEXT NOT NULL, match_score REAL NOT NULL DEFAULT 0, interview_score REAL NOT NULL DEFAULT 0, scam_score REAL NOT NULL DEFAULT 0, scam_reasons TEXT NOT NULL DEFAULT '[]', match_reasons TEXT NOT NULL DEFAULT '[]', missing_keywords TEXT NOT NULL DEFAULT '[]',
     blocked INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, UNIQUE(source, external_id));
   CREATE INDEX jobs_fp ON jobs(fingerprint);
   CREATE TABLE job_sightings (job_id INTEGER NOT NULL, source TEXT NOT NULL, url TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(job_id, source, url));
   CREATE TABLE signals (id INTEGER PRIMARY KEY, job_id INTEGER, source TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL);
   CREATE TABLE blocklist (id INTEGER PRIMARY KEY, company TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', domains TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '');
   CREATE TABLE site_accounts (id INTEGER PRIMARY KEY, scope TEXT NOT NULL UNIQUE, username TEXT NOT NULL, password_enc TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created', created_at TEXT NOT NULL);
   CREATE TABLE site_recipes (id INTEGER PRIMARY KEY, scope TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, mappings TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '[]', approved INTEGER NOT NULL DEFAULT 0, last_test TEXT);
   CREATE TABLE applications (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, resume_version_id INTEGER, cover_letter_id INTEGER, mode TEXT NOT NULL, status TEXT NOT NULL, failure_reason TEXT, needs_reason TEXT,
     submitted_at TEXT, first_response_at TEXT, field_values TEXT NOT NULL DEFAULT '[]', screenshots TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE application_events (id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL, kind TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
   CREATE TABLE emails (id INTEGER PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, from_addr TEXT NOT NULL, subject TEXT NOT NULL, received_at TEXT NOT NULL, classification TEXT NOT NULL, application_id INTEGER, snippet TEXT NOT NULL DEFAULT '');
   CREATE TABLE runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, mode TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0, submitted INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0,
     needs_you INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '[]');
   CREATE TABLE ai_calls (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, scrubbed INTEGER NOT NULL, error TEXT, at TEXT NOT NULL);
   CREATE TABLE secrets (key TEXT PRIMARY KEY, value_enc TEXT NOT NULL);
   CREATE TABLE cover_letter_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);`,
  `ALTER TABLE jobs ADD COLUMN off_field INTEGER NOT NULL DEFAULT 0;`
]

export interface Cipher {
  encrypt(plain: string): string
  decrypt(enc: string): string
}

const now = () => new Date().toISOString()
const j = <T,>(s: string | null | undefined, fallback: T): T => {
  if (s == null) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

type Row = Record<string, unknown>

export class Db {
  readonly sql: DatabaseSync

  constructor(path: string, private cipher: Cipher) {
    this.sql = new DatabaseSync(path)
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL)')
    const row = this.sql.prepare('SELECT version FROM meta').get() as { version: number } | undefined
    let v = row?.version ?? 0
    if (!row) this.sql.prepare('INSERT INTO meta (version) VALUES (0)').run()
    for (; v < MIGRATIONS.length; v++) {
      this.sql.exec('BEGIN')
      try {
        this.sql.exec(MIGRATIONS[v])
        this.sql.prepare('UPDATE meta SET version = ?').run(v + 1)
        this.sql.exec('COMMIT')
      } catch (e) {
        this.sql.exec('ROLLBACK')
        throw e
      }
    }
    if (v === MIGRATIONS.length && (this.sql.prepare('SELECT COUNT(*) AS n FROM answer_bank').get() as { n: number }).n === 0) {
      const ins = this.sql.prepare('INSERT INTO answer_bank (key, question, variants, answer, sensitivity, approved) VALUES (?, ?, ?, ?, ?, 0)')
      for (const q of SEED_QUESTIONS) ins.run(q.key, q.question, JSON.stringify(q.variants), q.answer, q.sensitivity)
    }
  }

  close() {
    this.sql.close()
  }

  // ---------- key/value: settings, profile ----------
  private kvGet<T>(key: string, fallback: T): T {
    const r = this.sql.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return r ? { ...fallback, ...j<T>(r.value, fallback) } : fallback
  }
  private kvSet(key: string, value: unknown) {
    this.sql.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }
  getSettings(): Settings {
    const s = this.kvGet<Settings>('settings', DEFAULT_SETTINGS)
    // Providers added after the user saved their order go at the end, so local AI stays first.
    const aiOrder = [...s.aiOrder, ...DEFAULT_SETTINGS.aiOrder.filter((id) => !s.aiOrder.includes(id))]
    // Defaults first, so settings added in a newer version get their default value.
    return { ...DEFAULT_SETTINGS, ...s, aiOrder, sources: { ...DEFAULT_SETTINGS.sources, ...s.sources } }
  }
  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch }
    this.kvSet('settings', next)
    return next
  }
  getProfile(): Profile {
    return this.kvGet<Profile>('profile', EMPTY_PROFILE)
  }
  saveProfile(p: Profile): Profile {
    this.kvSet('profile', p)
    return p
  }
  getKv<T>(key: string, fallback: T): T {
    const r = this.sql.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return r ? j<T>(r.value, fallback) : fallback
  }
  setKv(key: string, value: unknown) {
    this.kvSet(key, value)
  }

  // ---------- secrets (encrypted) ----------
  setSecret(key: string, value: string | null) {
    if (value == null || value === '') this.sql.prepare('DELETE FROM secrets WHERE key = ?').run(key)
    else this.sql.prepare('INSERT INTO secrets (key, value_enc) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc').run(key, this.cipher.encrypt(value))
  }
  getSecret(key: string): string | null {
    const r = this.sql.prepare('SELECT value_enc FROM secrets WHERE key = ?').get(key) as { value_enc: string } | undefined
    return r ? this.cipher.decrypt(r.value_enc) : null
  }
  hasSecret(key: string): boolean {
    return !!this.sql.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key)
  }
  clearSecretsLike(prefix: string) {
    this.sql.prepare('DELETE FROM secrets WHERE key LIKE ?').run(prefix + '%')
  }

  // ---------- resumes ----------
  listResumes(): (Resume & { versions: ResumeVersion[] })[] {
    const rs = this.sql.prepare('SELECT * FROM resumes ORDER BY id').all() as Row[]
    return rs.map((r) => ({ ...this.mapResume(r), versions: this.listVersions(Number(r.id)) }))
  }
  private mapResume(r: Row): Resume {
    return { id: Number(r.id), name: String(r.name), isDefault: !!r.is_default, defaultVersionId: r.default_version_id == null ? null : Number(r.default_version_id), createdAt: String(r.created_at) }
  }
  createResume(name: string): Resume {
    const isFirst = (this.sql.prepare('SELECT COUNT(*) AS n FROM resumes').get() as { n: number }).n === 0
    const r = this.sql.prepare('INSERT INTO resumes (name, is_default, created_at) VALUES (?, ?, ?)').run(name, isFirst ? 1 : 0, now())
    return this.mapResume(this.sql.prepare('SELECT * FROM resumes WHERE id = ?').get(r.lastInsertRowid) as Row)
  }
  deleteResume(id: number) {
    this.sql.prepare('DELETE FROM resume_versions WHERE resume_id = ?').run(id)
    this.sql.prepare('DELETE FROM resumes WHERE id = ?').run(id)
  }
  addVersion(v: { resumeId: number; kind: ResumeKind; label: string; parentId?: number | null; data: ResumeStructured; rawText?: string; docxPath?: string | null; jobId?: number | null }): ResumeVersion {
    const r = this.sql
      .prepare('INSERT INTO resume_versions (resume_id, kind, label, parent_id, data, raw_text, docx_path, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.resumeId, v.kind, v.label, v.parentId ?? null, JSON.stringify(v.data), v.rawText ?? '', v.docxPath ?? null, v.jobId ?? null, now())
    return this.getVersion(Number(r.lastInsertRowid))!
  }
  updateVersion(id: number, patch: { data?: ResumeStructured; label?: string; docxPath?: string | null }) {
    const cur = this.getVersion(id)
    if (!cur) return null
    this.sql
      .prepare('UPDATE resume_versions SET data = ?, label = ?, docx_path = ? WHERE id = ?')
      .run(JSON.stringify(patch.data ?? cur.data), patch.label ?? cur.label, patch.docxPath === undefined ? cur.docxPath : patch.docxPath, id)
    return this.getVersion(id)
  }
  getVersion(id: number): ResumeVersion | null {
    const r = this.sql.prepare('SELECT * FROM resume_versions WHERE id = ?').get(id) as Row | undefined
    return r ? this.mapVersion(r) : null
  }
  listVersions(resumeId: number): ResumeVersion[] {
    return (this.sql.prepare("SELECT * FROM resume_versions WHERE resume_id = ? AND kind != 'tailored' ORDER BY id").all(resumeId) as Row[]).map((r) => this.mapVersion(r))
  }
  private mapVersion(r: Row): ResumeVersion {
    return {
      id: Number(r.id),
      resumeId: Number(r.resume_id),
      kind: r.kind as ResumeKind,
      label: String(r.label),
      parentId: r.parent_id == null ? null : Number(r.parent_id),
      data: j(String(r.data), {} as ResumeStructured),
      rawText: String(r.raw_text ?? ''),
      docxPath: (r.docx_path as string) ?? null,
      jobId: r.job_id == null ? null : Number(r.job_id),
      createdAt: String(r.created_at)
    }
  }
  setDefaultVersion(resumeId: number, versionId: number) {
    this.sql.exec('UPDATE resumes SET is_default = 0')
    this.sql.prepare('UPDATE resumes SET is_default = 1, default_version_id = ? WHERE id = ?').run(versionId, resumeId)
  }
  defaultVersion(): ResumeVersion | null {
    const r = this.sql.prepare('SELECT * FROM resumes WHERE is_default = 1').get() as Row | undefined
    if (!r) return null
    if (r.default_version_id != null) return this.getVersion(Number(r.default_version_id))
    const v = this.sql.prepare('SELECT * FROM resume_versions WHERE resume_id = ? ORDER BY id LIMIT 1').get(Number(r.id)) as Row | undefined
    return v ? this.mapVersion(v) : null
  }

  // ---------- cover letters ----------
  getTemplates(): { id: number; name: string; body: string; isDefault: boolean }[] {
    return (this.sql.prepare('SELECT * FROM cover_letter_templates ORDER BY id').all() as Row[]).map((r) => ({ id: Number(r.id), name: String(r.name), body: String(r.body), isDefault: !!r.is_default }))
  }
  saveTemplate(t: { id?: number; name: string; body: string; isDefault?: boolean }) {
    if (t.isDefault) this.sql.exec('UPDATE cover_letter_templates SET is_default = 0')
    if (t.id) this.sql.prepare('UPDATE cover_letter_templates SET name = ?, body = ?, is_default = ? WHERE id = ?').run(t.name, t.body, t.isDefault ? 1 : 0, t.id)
    else {
      const first = this.getTemplates().length === 0
      this.sql.prepare('INSERT INTO cover_letter_templates (name, body, is_default) VALUES (?, ?, ?)').run(t.name, t.body, t.isDefault || first ? 1 : 0)
    }
    return this.getTemplates()
  }
  deleteTemplate(id: number) {
    this.sql.prepare('DELETE FROM cover_letter_templates WHERE id = ?').run(id)
  }
  addCoverLetter(jobId: number | null, body: string, base: string, docxPath: string | null): number {
    return Number(this.sql.prepare('INSERT INTO cover_letters (job_id, body, base, docx_path, created_at) VALUES (?, ?, ?, ?, ?)').run(jobId, body, base, docxPath, now()).lastInsertRowid)
  }
  getCoverLetter(id: number): { id: number; jobId: number | null; body: string; base: string; docxPath: string | null } | null {
    const r = this.sql.prepare('SELECT * FROM cover_letters WHERE id = ?').get(id) as Row | undefined
    return r ? { id: Number(r.id), jobId: r.job_id == null ? null : Number(r.job_id), body: String(r.body), base: String(r.base), docxPath: (r.docx_path as string) ?? null } : null
  }

  // ---------- answer bank ----------
  listAnswers(): AnswerBankEntry[] {
    return (this.sql.prepare('SELECT * FROM answer_bank ORDER BY id').all() as Row[]).map((r) => {
      const enc = r.answer_enc as string | null
      return {
        id: Number(r.id),
        key: String(r.key),
        question: String(r.question),
        variants: j<string[]>(String(r.variants), []),
        answer: enc ? this.cipher.decrypt(enc) : String(r.answer),
        sensitivity: r.sensitivity as AnswerBankEntry['sensitivity'],
        approved: !!r.approved
      }
    })
  }
  saveAnswer(a: Omit<AnswerBankEntry, 'id'> & { id?: number }, storeSensitive: boolean): AnswerBankEntry[] {
    const sensitive = a.sensitivity !== 'normal'
    // Sensitive answers are encrypted; if storing is off, they're not kept at all.
    const plain = sensitive ? '' : a.answer
    const enc = sensitive && storeSensitive && a.answer ? this.cipher.encrypt(a.answer) : null
    if (a.id)
      this.sql
        .prepare('UPDATE answer_bank SET key = ?, question = ?, variants = ?, answer = ?, answer_enc = ?, sensitivity = ?, approved = ? WHERE id = ?')
        .run(a.key, a.question, JSON.stringify(a.variants), plain, enc, a.sensitivity, a.approved ? 1 : 0, a.id)
    else
      this.sql
        .prepare('INSERT INTO answer_bank (key, question, variants, answer, answer_enc, sensitivity, approved) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(a.key, a.question, JSON.stringify(a.variants), plain, enc, a.sensitivity, a.approved ? 1 : 0)
    return this.listAnswers()
  }
  deleteAnswer(id: number) {
    this.sql.prepare('DELETE FROM answer_bank WHERE id = ?').run(id)
  }
  purgeSensitiveAnswers() {
    this.sql.exec("UPDATE answer_bank SET answer_enc = NULL, answer = '' WHERE sensitivity != 'normal'")
  }

  // ---------- jobs ----------
  findJobByFingerprint(fp: string): Job | null {
    const r = this.sql.prepare('SELECT * FROM jobs WHERE fingerprint = ? ORDER BY id LIMIT 1').get(fp) as Row | undefined
    return r ? this.mapJob(r) : null
  }
  findJobBySource(source: string, externalId: string): Job | null {
    const r = this.sql.prepare('SELECT * FROM jobs WHERE source = ? AND external_id = ?').get(source, externalId) as Row | undefined
    return r ? this.mapJob(r) : null
  }
  candidatesForDedupe(companyLike: string): Job[] {
    return (this.sql.prepare('SELECT * FROM jobs WHERE lower(company) LIKE ? LIMIT 200').all(`%${companyLike.toLowerCase().slice(0, 12)}%`) as Row[]).map((r) => this.mapJob(r))
  }
  insertJob(n: NormalizedJob, extra: { fingerprint: string; platform?: string }): Job {
    const t = now()
    const r = this.sql
      .prepare(
        `INSERT INTO jobs (source, external_id, url, apply_url, company, company_domain, title, location, remote_type, pay_min, pay_max, pay_unit, description, posted_at, platform, first_seen, last_seen, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        n.source,
        n.externalId,
        n.url,
        n.applyUrl ?? null,
        n.company,
        n.companyDomain ?? null,
        n.title,
        n.location,
        n.remoteType,
        n.payMin ?? null,
        n.payMax ?? null,
        n.payUnit ?? null,
        n.description,
        n.postedAt ?? null,
        extra.platform ?? n.platform ?? null,
        t,
        t,
        extra.fingerprint
      )
    const id = Number(r.lastInsertRowid)
    this.addSighting(id, n.source, n.url)
    return this.getJob(id)!
  }
  addSighting(jobId: number, source: string, url: string) {
    this.sql.prepare('INSERT OR IGNORE INTO job_sightings (job_id, source, url, seen_at) VALUES (?, ?, ?, ?)').run(jobId, source, url, now())
    this.sql.prepare('UPDATE jobs SET last_seen = ?, times_seen = (SELECT COUNT(*) FROM job_sightings WHERE job_id = ?) WHERE id = ?').run(now(), jobId, jobId)
  }
  updateJob(id: number, patch: Partial<{ applyUrl: string; platform: string; description: string; matchScore: number; interviewScore: number; scamScore: number; scamReasons: string[]; matchReasons: string[]; missingKeywords: string[]; offField: boolean; blocked: boolean; dismissed: boolean; saved: boolean; payMin: number; payMax: number; payUnit: string }>) {
    const cols: Record<string, string> = {
      applyUrl: 'apply_url',
      platform: 'platform',
      description: 'description',
      matchScore: 'match_score',
      interviewScore: 'interview_score',
      scamScore: 'scam_score',
      scamReasons: 'scam_reasons',
      matchReasons: 'match_reasons',
      missingKeywords: 'missing_keywords',
      offField: 'off_field',
      blocked: 'blocked',
      dismissed: 'dismissed',
      saved: 'saved',
      payMin: 'pay_min',
      payMax: 'pay_max',
      payUnit: 'pay_unit'
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      const val = Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v
      this.sql.prepare(`UPDATE jobs SET ${cols[k]} = ? WHERE id = ?`).run(val as string | number, id)
    }
  }
  getJob(id: number): Job | null {
    const r = this.sql.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return r ? this.mapJob(r) : null
  }
  allJobs(opts: { includeHidden?: boolean } = {}): Job[] {
    const where = opts.includeHidden ? '' : 'WHERE dismissed = 0 AND blocked = 0'
    return (this.sql.prepare(`SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT 5000`).all() as Row[]).map((r) => this.mapJob(r))
  }
  private mapJob(r: Row): Job {
    const id = Number(r.id)
    const sightings = (this.sql.prepare('SELECT source, url FROM job_sightings WHERE job_id = ?').all(id) as { source: string; url: string }[]).map((s) => ({ source: s.source, url: s.url }))
    return {
      id,
      source: String(r.source),
      externalId: String(r.external_id),
      url: String(r.url),
      applyUrl: (r.apply_url as string) ?? undefined,
      company: String(r.company),
      companyDomain: (r.company_domain as string) ?? undefined,
      title: String(r.title),
      location: String(r.location),
      remoteType: r.remote_type as Job['remoteType'],
      payMin: r.pay_min == null ? undefined : Number(r.pay_min),
      payMax: r.pay_max == null ? undefined : Number(r.pay_max),
      payUnit: (r.pay_unit as Job['payUnit']) ?? undefined,
      description: String(r.description),
      postedAt: (r.posted_at as string) ?? undefined,
      platform: (r.platform as string) ?? undefined,
      firstSeen: String(r.first_seen),
      fingerprint: String(r.fingerprint),
      matchScore: Number(r.match_score),
      interviewScore: Number(r.interview_score),
      scamScore: Number(r.scam_score),
      scamReasons: j(String(r.scam_reasons), []),
      matchReasons: j(String(r.match_reasons), []),
      missingKeywords: j(String(r.missing_keywords), []),
      offField: !!r.off_field,
      blocked: !!r.blocked,
      dismissed: !!r.dismissed,
      saved: !!r.saved,
      sightings
    }
  }
  timesSeen(id: number): number {
    return (this.sql.prepare('SELECT times_seen FROM jobs WHERE id = ?').get(id) as { times_seen: number } | undefined)?.times_seen ?? 1
  }

  // ---------- signals ----------
  addSignal(s: Omit<Signal, 'at'>) {
    this.sql.prepare('INSERT INTO signals (job_id, source, kind, at) VALUES (?, ?, ?, ?)').run(s.jobId, s.source, s.kind, now())
  }
  signals(sinceDays = 180): Signal[] {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString()
    return (this.sql.prepare('SELECT * FROM signals WHERE at >= ?').all(since) as Row[]).map((r) => ({ jobId: r.job_id == null ? null : Number(r.job_id), source: String(r.source), kind: r.kind as Signal['kind'], at: String(r.at) }))
  }

  // ---------- blocklist ----------
  listBlocklist(): (BlockEntry & { id: number })[] {
    return (this.sql.prepare('SELECT * FROM blocklist ORDER BY id').all() as Row[]).map((r) => ({ id: Number(r.id), company: String(r.company), aliases: j(String(r.aliases), []), domains: j(String(r.domains), []), reason: String(r.reason) }))
  }
  addBlock(b: BlockEntry) {
    this.sql.prepare('INSERT INTO blocklist (company, aliases, domains, reason) VALUES (?, ?, ?, ?)').run(b.company, JSON.stringify(b.aliases), JSON.stringify(b.domains), b.reason)
  }
  removeBlock(id: number) {
    this.sql.prepare('DELETE FROM blocklist WHERE id = ?').run(id)
  }

  // ---------- site accounts & recipes ----------
  getAccount(scope: string): { scope: string; username: string; password: string; email: string; status: string } | null {
    const r = this.sql.prepare('SELECT * FROM site_accounts WHERE scope = ?').get(scope) as Row | undefined
    return r ? { scope: String(r.scope), username: String(r.username), password: this.cipher.decrypt(String(r.password_enc)), email: String(r.email), status: String(r.status) } : null
  }
  saveAccount(a: { scope: string; username: string; password: string; email: string; status: string }) {
    this.sql
      .prepare(
        'INSERT INTO site_accounts (scope, username, password_enc, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET username = excluded.username, password_enc = excluded.password_enc, email = excluded.email, status = excluded.status'
      )
      .run(a.scope, a.username, this.cipher.encrypt(a.password), a.email, a.status, now())
  }
  listAccounts(): { scope: string; username: string; email: string; status: string; createdAt: string }[] {
    return (this.sql.prepare('SELECT scope, username, email, status, created_at FROM site_accounts ORDER BY scope').all() as Row[]).map((r) => ({ scope: String(r.scope), username: String(r.username), email: String(r.email), status: String(r.status), createdAt: String(r.created_at) }))
  }
  deleteAccount(scope: string) {
    this.sql.prepare('DELETE FROM site_accounts WHERE scope = ?').run(scope)
  }
  getRecipe(scope: string): SiteRecipe | null {
    const r = this.sql.prepare('SELECT * FROM site_recipes WHERE scope = ?').get(scope) as Row | undefined
    return r ? this.mapRecipe(r) : null
  }
  listRecipes(): SiteRecipe[] {
    return (this.sql.prepare('SELECT * FROM site_recipes ORDER BY scope').all() as Row[]).map((r) => this.mapRecipe(r))
  }
  private mapRecipe(r: Row): SiteRecipe {
    return { id: Number(r.id), scope: String(r.scope), version: Number(r.version), mappings: j(String(r.mappings), {}), notes: j(String(r.notes), []), approved: !!r.approved, lastTest: j<SiteTestResult | null>(r.last_test as string, null) }
  }
  saveRecipe(scope: string, patch: Partial<Pick<SiteRecipe, 'mappings' | 'notes' | 'approved' | 'lastTest'>>): SiteRecipe {
    const cur = this.getRecipe(scope)
    if (!cur) this.sql.prepare('INSERT INTO site_recipes (scope) VALUES (?)').run(scope)
    const base = this.getRecipe(scope)!
    const next = { ...base, ...patch }
    this.sql
      .prepare('UPDATE site_recipes SET mappings = ?, notes = ?, approved = ?, last_test = ?, version = ? WHERE scope = ?')
      .run(JSON.stringify(next.mappings), JSON.stringify(next.notes), next.approved ? 1 : 0, next.lastTest ? JSON.stringify(next.lastTest) : null, base.version + (patch.mappings ? 1 : 0), scope)
    return this.getRecipe(scope)!
  }
  deleteRecipe(scope: string) {
    this.sql.prepare('DELETE FROM site_recipes WHERE scope = ?').run(scope)
  }

  // ---------- applications ----------
  createApplication(a: { jobId: number; mode: ApplicationMode; status: ApplicationStatus; resumeVersionId?: number | null; coverLetterId?: number | null }): Application {
    const t = now()
    const r = this.sql
      .prepare('INSERT INTO applications (job_id, resume_version_id, cover_letter_id, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(a.jobId, a.resumeVersionId ?? null, a.coverLetterId ?? null, a.mode, a.status, t, t)
    const id = Number(r.lastInsertRowid)
    this.addEvent(id, 'created', a.status)
    return this.getApplication(id)!
  }
  updateApplication(id: number, patch: Partial<Pick<Application, 'status' | 'failureReason' | 'needsReason' | 'submittedAt' | 'fieldValues' | 'screenshots' | 'resumeVersionId' | 'coverLetterId' | 'mode'>> & { firstResponseAt?: string }) {
    const cols: Record<string, string> = {
      status: 'status',
      failureReason: 'failure_reason',
      needsReason: 'needs_reason',
      submittedAt: 'submitted_at',
      fieldValues: 'field_values',
      screenshots: 'screenshots',
      resumeVersionId: 'resume_version_id',
      coverLetterId: 'cover_letter_id',
      mode: 'mode',
      firstResponseAt: 'first_response_at'
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      this.sql.prepare(`UPDATE applications SET ${cols[k]} = ?, updated_at = ? WHERE id = ?`).run(Array.isArray(v) ? JSON.stringify(v) : (v as string | number | null), now(), id)
    }
    if (patch.status) this.addEvent(id, 'status', patch.status + (patch.failureReason ? `: ${patch.failureReason}` : patch.needsReason ? `: ${patch.needsReason}` : ''))
  }
  getApplication(id: number): Application | null {
    const r = this.sql.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined
    return r ? this.mapApp(r) : null
  }
  listApplications(status?: ApplicationStatus[]): (Application & { job: Job | null; firstResponseAt: string | null })[] {
    const rows = status?.length
      ? (this.sql.prepare(`SELECT * FROM applications WHERE status IN (${status.map(() => '?').join(',')}) ORDER BY id DESC`).all(...status) as Row[])
      : (this.sql.prepare('SELECT * FROM applications ORDER BY id DESC').all() as Row[])
    return rows.map((r) => ({ ...this.mapApp(r), job: this.getJob(Number(r.job_id)), firstResponseAt: (r.first_response_at as string) ?? null }))
  }
  applicationForJob(jobId: number): Application | null {
    const r = this.sql.prepare("SELECT * FROM applications WHERE job_id = ? AND status != 'failed' ORDER BY id DESC LIMIT 1").get(jobId) as Row | undefined
    return r ? this.mapApp(r) : null
  }
  private mapApp(r: Row): Application {
    return {
      id: Number(r.id),
      jobId: Number(r.job_id),
      resumeVersionId: r.resume_version_id == null ? null : Number(r.resume_version_id),
      coverLetterId: r.cover_letter_id == null ? null : Number(r.cover_letter_id),
      mode: r.mode as ApplicationMode,
      status: r.status as ApplicationStatus,
      failureReason: (r.failure_reason as string) ?? null,
      needsReason: (r.needs_reason as string) ?? null,
      submittedAt: (r.submitted_at as string) ?? null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      fieldValues: j(String(r.field_values), []),
      screenshots: j(String(r.screenshots), [])
    }
  }
  addEvent(appId: number, kind: string, details: string) {
    this.sql.prepare('INSERT INTO application_events (application_id, kind, details, at) VALUES (?, ?, ?, ?)').run(appId, kind, details, now())
  }
  events(appId: number): { kind: string; details: string; at: string }[] {
    return this.sql.prepare('SELECT kind, details, at FROM application_events WHERE application_id = ? ORDER BY id').all(appId) as { kind: string; details: string; at: string }[]
  }
  submittedToday(): number {
    const d = new Date().toISOString().slice(0, 10)
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM applications WHERE substr(submitted_at, 1, 10) = ?').get(d) as { n: number }).n
  }
  companyAppsLast30(company: string): number {
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE lower(j.company) = lower(?) AND a.created_at >= ? AND a.status != \'failed\'').get(company, since) as { n: number }).n
  }

  // ---------- emails ----------
  hasEmail(messageId: string): boolean {
    return !!this.sql.prepare('SELECT 1 FROM emails WHERE message_id = ?').get(messageId)
  }
  addEmail(e: { messageId: string; from: string; subject: string; receivedAt: string; classification: string; applicationId: number | null; snippet: string }) {
    this.sql
      .prepare('INSERT OR IGNORE INTO emails (message_id, from_addr, subject, received_at, classification, application_id, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.messageId, e.from, e.subject, e.receivedAt, e.classification, e.applicationId, e.snippet)
  }
  listEmails(limit = 200) {
    return (this.sql.prepare('SELECT * FROM emails ORDER BY received_at DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      from: String(r.from_addr),
      subject: String(r.subject),
      receivedAt: String(r.received_at),
      classification: String(r.classification),
      applicationId: r.application_id == null ? null : Number(r.application_id),
      snippet: String(r.snippet)
    }))
  }

  // ---------- runs ----------
  startRun(mode: 'review' | 'auto'): number {
    return Number(this.sql.prepare('INSERT INTO runs (started_at, mode) VALUES (?, ?)').run(now(), mode).lastInsertRowid)
  }
  finishRun(id: number, s: Omit<RunSummary, 'id' | 'startedAt' | 'finishedAt' | 'mode'>) {
    this.sql
      .prepare('UPDATE runs SET finished_at = ?, attempted = ?, submitted = ?, ready = ?, needs_you = ?, failed = ?, skipped = ?, notes = ? WHERE id = ?')
      .run(now(), s.attempted, s.submitted, s.readyForReview, s.needsYou, s.failed, s.skipped, JSON.stringify(s.notes), id)
  }
  listRuns(limit = 30): RunSummary[] {
    return (this.sql.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      startedAt: String(r.started_at),
      finishedAt: (r.finished_at as string) ?? null,
      mode: r.mode as 'review' | 'auto',
      attempted: Number(r.attempted),
      submitted: Number(r.submitted),
      readyForReview: Number(r.ready),
      needsYou: Number(r.needs_you),
      failed: Number(r.failed),
      skipped: Number(r.skipped),
      notes: j(String(r.notes), [])
    }))
  }

  // ---------- ai log ----------
  logAi(c: { provider: string; model: string; task: string; ms: number; ok: boolean; scrubbed: boolean; error?: string }) {
    this.sql.prepare('INSERT INTO ai_calls (provider, model, task, ms, ok, scrubbed, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.provider, c.model, c.task, c.ms, c.ok ? 1 : 0, c.scrubbed ? 1 : 0, c.error ?? null, now())
  }
  aiStats() {
    return this.sql.prepare('SELECT provider, model, COUNT(*) AS calls, SUM(ok) AS ok, AVG(ms) AS avg_ms FROM ai_calls GROUP BY provider, model').all()
  }
}
