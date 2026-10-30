// Domain types shared by the main process, renderer, and pure core logic.

export type RemoteMode = 'remote_only' | 'onsite_only' | 'hybrid_ok' | 'any'
export type PayUnit = 'hourly' | 'salary'
export type EducationLevel =
  | 'none'
  | 'high_school'
  | 'some_college'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctorate'

export interface PreferredLocation {
  place: string // "Raleigh, NC"
  radiusMiles: number
}

export interface Degree {
  level: EducationLevel
  field: string
  school: string
  year?: string
}

export interface FederalInfo {
  // Extra details USAJOBS-style resumes expect, per job (keyed by "company|title").
  jobs: Record<string, { hoursPerWeek?: number; salary?: string; supervisor?: string; supervisorPhone?: string; mayContact?: boolean; address?: string }>
  citizenship?: string
  veteranPreference?: string
}

export interface Profile {
  fullName: string
  email: string // the dedicated application email
  phone: string
  city: string
  state: string
  zip?: string
  country: string
  linkedin?: string
  website?: string
  currentEmployer?: string
  workAuthorized: boolean | null
  needsSponsorship: boolean | null
  educationLevel: EducationLevel
  degrees: Degree[]
  fields: string[]
  roles: string[]
  pay: { min?: number; target?: number; unit: PayUnit }
  locations: PreferredLocation[]
  remoteMode: RemoteMode
  federal: FederalInfo
}

export interface ResumeExperience {
  company: string
  title: string
  location?: string
  start?: string
  end?: string
  bullets: string[]
}

export interface ResumeEducation {
  school: string
  degree?: string
  field?: string
  location?: string
  date?: string
  details: string[]
}

export interface ResumeStructured {
  contact: { name: string; email?: string; phone?: string; location?: string; links: string[] }
  headline?: string
  headlineFused?: boolean // headline was on the same line as the summary in the source
  summary?: string
  skills: string[]
  toolkit: string[]
  experience: ResumeExperience[]
  education: ResumeEducation[]
  certifications: string[]
  other: { heading: string; lines: string[] }[]
}

export type ResumeKind = 'original' | 'ats' | 'tailored' | 'federal' | 'created'

export interface ResumeVersion {
  id: number
  resumeId: number
  kind: ResumeKind
  label: string
  parentId: number | null
  data: ResumeStructured
  rawText: string
  docxPath: string | null
  jobId: number | null
  createdAt: string
}

export interface Resume {
  id: number
  name: string
  isDefault: boolean
  defaultVersionId: number | null
  createdAt: string
}

export type LintSeverity = 'high' | 'medium' | 'low'

export interface LintFinding {
  id: string // rule id
  severity: LintSeverity
  title: string
  detail: string
  fixable: boolean
  where?: string
}

export type JobRemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export interface NormalizedJob {
  source: string
  externalId: string
  url: string
  applyUrl?: string
  company: string
  companyDomain?: string
  title: string
  location: string
  remoteType: JobRemoteType
  payMin?: number
  payMax?: number
  payUnit?: PayUnit
  description: string
  postedAt?: string
  platform?: string
}

export interface Job extends NormalizedJob {
  id: number
  firstSeen: string
  fingerprint: string
  matchScore: number
  interviewScore: number
  scamScore: number
  scamReasons: string[]
  blocked: boolean
  dismissed: boolean
  saved: boolean
  sightings: { source: string; url: string }[]
  matchReasons: string[]
  missingKeywords: string[]
  offField: boolean
}

export type ApplicationMode = 'assist' | 'review' | 'auto'
export type ApplicationStatus =
  | 'queued'
  | 'filling'
  | 'ready_for_review'
  | 'needs_you'
  | 'submitted'
  | 'failed'
  | 'confirmed'
  | 'rejected'
  | 'interview'
  | 'assessment'
  | 'offer'
  | 'withdrawn'

export interface Application {
  id: number
  jobId: number
  resumeVersionId: number | null
  coverLetterId: number | null
  mode: ApplicationMode
  status: ApplicationStatus
  failureReason: string | null
  needsReason: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
  fieldValues: FilledField[]
  screenshots: string[]
}

export interface FilledField {
  label: string
  key: string | null
  value: string
  confidence: number
  source: 'profile' | 'answer_bank' | 'ai' | 'recipe' | 'default' | 'user'
}

export type QuestionSensitivity = 'normal' | 'sensitive' | 'ssn_dob'

export interface AnswerBankEntry {
  id: number
  key: string
  question: string
  variants: string[]
  answer: string
  sensitivity: QuestionSensitivity
  approved: boolean
}

export interface FormField {
  selector: string
  label: string
  name: string
  type: 'text' | 'email' | 'tel' | 'password' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'date' | 'number' | 'url' | 'combobox' | 'other'
  required: boolean
  options: string[]
  placeholder?: string
}

export interface SiteRecipe {
  id: number
  scope: string // platform name or domain
  version: number
  mappings: Record<string, string> // field label (normalized) -> profile/answer key or literal "=value"
  notes: string[]
  approved: boolean
  lastTest: SiteTestResult | null
}

export interface SiteTestResult {
  url: string
  at: string
  pages: { title: string; screenshot: string; fields: (FormField & { value: string; key: string | null; confidence: number })[] }[]
  errors: string[]
  submitBlocked: boolean
}

export type EmailClass = 'verification' | 'confirmation' | 'rejection' | 'interview' | 'assessment' | 'recruiter' | 'offer' | 'other'

export type AiProviderId = 'ollama' | 'gemini' | 'openrouter' | 'deepseek' | 'openai' | 'anthropic'
export type AiTask = 'extract' | 'classify' | 'write' | 'embed' | 'vision'

export interface Settings {
  mode: 'review' | 'auto'
  dailyCap: number
  perCompanyMonthlyCap: number
  minMatchScore: number
  maxScamScore: number
  storeSensitive: boolean
  storeSsnDob: boolean
  aiOrder: AiProviderId[]
  ollamaModel: string
  ollamaEmbedModel: string
  geminiModel: string
  openrouterModel: string
  deepseekModel: string
  openaiModel: string
  anthropicModel: string
  scheduleEnabled: boolean
  scheduleTime: string // "09:00"
  startAtLogin: boolean
  musicOn: boolean
  musicVolume: number
  sfxOn: boolean
  reduceMotion: boolean // skip the door animation and other movement
  emailHost: string
  emailUser: string
  emailPollMinutes: number
  sources: Record<string, boolean>
  workdayTenants: string[] // careers URLs to watch
  companyBoards: { platform: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'; slug: string; company: string }[]
  searchKeywords: string[] // extra keywords for searches beyond profile roles
  onboarded: boolean
  freedomMode: boolean
  modelTests: Record<string, ModelTest> // last test result per installed model
}

export interface ModelTest {
  ok: boolean
  message: string
  seconds: number
  loadSeconds: number // reading the model from disk into memory
  answerSeconds: number
  tokensPerSec: number | null
  at: string
}

/** A model install or test running in the background, kept in the main process so it survives floor changes. */
export interface ModelJob {
  tag: string
  phase: 'starting' | 'downloading' | 'testing' | 'done' | 'failed'
  status: string
  pct: number
  error?: string
}

export interface HardwareInfo {
  os: string
  cpu: string
  cores: number
  ramGB: number
  gpus: { model: string; vendor: string; vramGB: number }[]
  freeDiskGB: number
  ollamaInstalled: boolean
  ollamaRunning: boolean
  installedModels: string[]
}

export interface ModelCatalogEntry {
  id: string
  name: string
  ollamaTag: string
  paramsB: number
  quant: string
  vram8kGB: number
  vram16kGB: number
  quality: number // 1-10
  speed: number // 1-10
  license: string
  uncensored: boolean
  vision: boolean
  notes: string
}

export interface ModelRecommendation {
  model: ModelCatalogEntry
  score: number
  fitsAt: '16k' | '8k' | 'cpu'
  reasons: string[]
}

export interface RunSummary {
  id: number
  startedAt: string
  finishedAt: string | null
  mode: 'review' | 'auto'
  attempted: number
  submitted: number
  readyForReview: number
  needsYou: number
  failed: number
  skipped: number
  notes: string[]
}

export interface Signal {
  jobId: number | null
  source: string
  kind: 'view' | 'expand' | 'save' | 'dismiss' | 'apply' | 'response' | 'open'
  at: string
}
