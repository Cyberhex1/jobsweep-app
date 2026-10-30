// Form field understanding: map a form field label to a profile/answer-bank key, and pick option values.

import type { AnswerBankEntry, FormField, Profile, QuestionSensitivity, ResumeStructured, Settings } from '@shared/types'
import { normalize, stringSimilarity, tokens } from './text'
import { yearsFromDates } from './truthGuard'

export interface KeyRule {
  key: string
  patterns: RegExp[]
  sensitivity: QuestionSensitivity
}

// Order matters: more specific rules first.
export const KEY_RULES: KeyRule[] = [
  { key: 'confirm_password', patterns: [/confirm.*password|re-?enter.*password|verify.*password|password.*again/], sensitivity: 'normal' },
  { key: 'password', patterns: [/^password$|\bpassword\b/], sensitivity: 'normal' },
  { key: 'confirm_email', patterns: [/confirm.*e-?mail|re-?enter.*e-?mail|verify.*e-?mail/], sensitivity: 'normal' },
  { key: 'first_name', patterns: [/first name|given name|^first$|fname|legal first/], sensitivity: 'normal' },
  { key: 'last_name', patterns: [/last name|family name|surname|^last$|lname|legal last/], sensitivity: 'normal' },
  { key: 'middle_name', patterns: [/middle (name|initial)/], sensitivity: 'normal' },
  { key: 'preferred_name', patterns: [/preferred (first )?name|nickname/], sensitivity: 'normal' },
  { key: 'full_name', patterns: [/^(full |your )?name$|full name|legal name|^name\b/], sensitivity: 'normal' },
  { key: 'email', patterns: [/e-?mail/], sensitivity: 'normal' },
  { key: 'phone', patterns: [/phone|mobile|cell|telephone/], sensitivity: 'normal' },
  { key: 'address_line1', patterns: [/address( line)? ?1|street address|^address$|mailing address/], sensitivity: 'sensitive' },
  { key: 'address_line2', patterns: [/address( line)? ?2|\bapt\b|\bsuite\b|\bunit\b/], sensitivity: 'sensitive' },
  { key: 'city', patterns: [/^city|\bcity\b|\btown\b/], sensitivity: 'normal' },
  { key: 'state', patterns: [/^state|province|region/], sensitivity: 'normal' },
  { key: 'zip', patterns: [/zip|postal/], sensitivity: 'normal' },
  { key: 'country', patterns: [/country/], sensitivity: 'normal' },
  { key: 'location', patterns: [/^location|current location|where are you (located|based)/], sensitivity: 'normal' },
  { key: 'linkedin', patterns: [/linked ?in/], sensitivity: 'normal' },
  { key: 'website', patterns: [/website|portfolio|personal (site|url)|github/], sensitivity: 'normal' },
  { key: 'current_employer', patterns: [/current (company|employer)|present employer|most recent (company|employer)/], sensitivity: 'normal' },
  { key: 'current_title', patterns: [/current (job )?title|current position|most recent (title|position)/], sensitivity: 'normal' },
  { key: 'resume_upload', patterns: [/resume|cv\b|curriculum vitae/], sensitivity: 'normal' },
  { key: 'cover_letter', patterns: [/cover letter|letter of interest|motivation letter/], sensitivity: 'normal' },
  { key: 'needs_sponsorship', patterns: [/sponsor|visa|h-?1b/], sensitivity: 'normal' },
  { key: 'work_authorized', patterns: [/authori[sz]ed to work|legally (eligible|authorized|able) to work|right to work|work authori[sz]ation|eligible to work/], sensitivity: 'normal' },
  { key: 'age_18', patterns: [/18 years|at least 18|over (the age of )?18|legal age/], sensitivity: 'normal' },
  { key: 'salary_expectation', patterns: [/salary|compensation|pay (expectation|requirement)|desired (pay|wage|rate)|expected (pay|wage)/], sensitivity: 'normal' },
  { key: 'start_date', patterns: [/start date|when can you start|available to start|availability|notice period/], sensitivity: 'normal' },
  { key: 'relocate', patterns: [/relocat/], sensitivity: 'normal' },
  { key: 'commute', patterns: [/commut|on-?site|in (the )?office|hybrid schedule|reliable transportation/], sensitivity: 'normal' },
  { key: 'how_heard', patterns: [/how did you (hear|find|learn)|\bsource\b|referr(al|ed)/], sensitivity: 'normal' },
  { key: 'years_experience', patterns: [/years of (relevant |professional )?experience|how many years/], sensitivity: 'normal' },
  { key: 'education_level', patterns: [/highest (level of )?education|education level|degree (level|obtained)|highest degree/], sensitivity: 'normal' },
  { key: 'school', patterns: [/school|university|college|institution/], sensitivity: 'normal' },
  { key: 'degree', patterns: [/^degree|degree type/], sensitivity: 'normal' },
  { key: 'field_of_study', patterns: [/field of study|major|discipline|area of study/], sensitivity: 'normal' },
  { key: 'graduation_year', patterns: [/graduat|completion (date|year)/], sensitivity: 'normal' },
  { key: 'gender', patterns: [/gender|sex\b/], sensitivity: 'sensitive' },
  { key: 'hispanic', patterns: [/hispanic|latin[oax]/], sensitivity: 'sensitive' },
  { key: 'race', patterns: [/\brace\b|ethnicity/], sensitivity: 'sensitive' },
  { key: 'veteran', patterns: [/veteran|military|protected veteran/], sensitivity: 'sensitive' },
  { key: 'disability', patterns: [/disabilit/], sensitivity: 'sensitive' },
  { key: 'pronouns', patterns: [/pronoun/], sensitivity: 'sensitive' },
  { key: 'criminal', patterns: [/convicted|felony|criminal/], sensitivity: 'sensitive' },
  { key: 'drivers_license', patterns: [/driver'?s? licen[sc]e/], sensitivity: 'normal' },
  { key: 'ssn', patterns: [/social security|\bssn\b/], sensitivity: 'ssn_dob' },
  { key: 'dob', patterns: [/date of birth|birth ?date|\bdob\b/], sensitivity: 'ssn_dob' },
  { key: 'previously_employed', patterns: [/previously (been )?employed|worked (for|at) .* before|former employee/], sensitivity: 'normal' },
  { key: 'non_compete', patterns: [/non-?compete|non-?solicit/], sensitivity: 'normal' },
  { key: 'background_check', patterns: [/background check|drug (test|screen)/], sensitivity: 'normal' },
  { key: 'terms_agree', patterns: [/i (agree|acknowledge|certify|consent)|terms (and|&) conditions|privacy (policy|notice)/], sensitivity: 'normal' },
  { key: 'why_company', patterns: [/why (do you want|are you interested|this company|us\b)|what interests you/], sensitivity: 'normal' },
  { key: 'username', patterns: [/user ?name|login id/], sensitivity: 'normal' }
]

export function matchKey(label: string): { key: string; confidence: number; sensitivity: QuestionSensitivity } | null {
  const n = normalize(label)
  if (!n) return null
  for (const r of KEY_RULES) if (r.patterns.some((p) => p.test(n))) return { key: r.key, confidence: 0.9, sensitivity: r.sensitivity }
  return null
}

export function sensitivityOf(key: string): QuestionSensitivity {
  return KEY_RULES.find((r) => r.key === key)?.sensitivity ?? 'normal'
}

/** Match a free-text question to an answer bank entry (question + variants). */
export function matchAnswer(label: string, bank: AnswerBankEntry[]): { entry: AnswerBankEntry; confidence: number } | null {
  const n = normalize(label)
  let best: { entry: AnswerBankEntry; confidence: number } | null = null
  const lt = new Set(tokens(label))
  for (const e of bank) {
    for (const q of [e.question, ...e.variants]) {
      const qt = new Set(tokens(q))
      let inter = 0
      for (const t of lt) if (qt.has(t)) inter++
      const overlap = inter / Math.max(1, Math.min(lt.size, qt.size))
      const sim = 0.35 * stringSimilarity(n, normalize(q)) + 0.65 * overlap
      if (!best || sim > best.confidence) best = { entry: e, confidence: sim }
    }
  }
  return best && best.confidence >= 0.62 ? best : null
}

const YES = /^(yes|y|true|i am|i do|i have|i will|i agree|i acknowledge|agree)/i
const NO = /^(no|n|false|i am not|i do not|i don't|i have not|i will not)/i
const DECLINE = /(decline|prefer not|do not wish|don't wish|choose not|not to (say|answer|disclose|self-identify))/i

/** Choose the best option text for a select/radio given a desired answer. */
export function chooseOption(options: string[], answer: string): string | null {
  const opts = options.filter((o) => o.trim() && !/^(select|choose|--|please select)/i.test(o.trim()))
  if (!opts.length) return null
  const a = answer.trim()
  const exact = opts.find((o) => normalize(o) === normalize(a))
  if (exact) return exact
  if (DECLINE.test(a)) return opts.find((o) => DECLINE.test(o)) ?? null
  if (YES.test(a)) return opts.find((o) => YES.test(o.trim())) ?? null
  if (NO.test(a)) return opts.find((o) => NO.test(o.trim())) ?? null
  let best: string | null = null
  let bestS = 0
  for (const o of opts) {
    const s = Math.max(stringSimilarity(a, o), normalize(o).includes(normalize(a)) || normalize(a).includes(normalize(o)) ? 0.8 : 0)
    if (s > bestS) {
      bestS = s
      best = o
    }
  }
  return bestS >= 0.5 ? best : null
}

const EDU_LABEL: Record<string, string> = {
  none: 'None',
  high_school: 'High School Diploma or GED',
  some_college: 'Some College',
  associate: "Associate's Degree",
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  doctorate: 'Doctorate'
}

export interface ValueContext {
  profile: Profile
  resume: ResumeStructured | null
  bank: AnswerBankEntry[]
  settings: Pick<Settings, 'storeSensitive' | 'storeSsnDob'>
  job?: { company: string; title: string }
  sensitiveValues?: Record<string, string> // decrypted on demand
  password?: string
}

export interface ResolvedValue {
  value: string | null
  key: string | null
  confidence: number
  source: 'profile' | 'answer_bank' | 'default'
  needsUser?: string // reason to pause
}

/** Resolve the value for a form field from the profile/answer bank. Returns needsUser when we must pause. */
export function resolveField(field: FormField, ctx: ValueContext, forcedKey?: string): ResolvedValue {
  const m = forcedKey ? { key: forcedKey, confidence: 0.95, sensitivity: sensitivityOf(forcedKey) } : matchKey(field.label || field.name || field.placeholder || '')
  const p = ctx.profile
  const [first, ...restName] = p.fullName.trim().split(/\s+/)
  const last = restName.length ? restName[restName.length - 1] : ''
  const latest = ctx.resume?.experience[0]
  const deg = p.degrees[0]
  const fromProfile: Record<string, string | undefined> = {
    first_name: first,
    last_name: last,
    middle_name: restName.length > 1 ? restName.slice(0, -1).join(' ') : '',
    preferred_name: first,
    full_name: p.fullName,
    email: p.email,
    confirm_email: p.email,
    phone: p.phone,
    city: p.city,
    state: p.state,
    zip: p.zip,
    country: p.country || 'United States',
    location: [p.city, p.state].filter(Boolean).join(', '),
    linkedin: p.linkedin,
    website: p.website,
    current_employer: p.currentEmployer ?? latest?.company,
    current_title: latest?.title,
    work_authorized: p.workAuthorized == null ? undefined : p.workAuthorized ? 'Yes' : 'No',
    needs_sponsorship: p.needsSponsorship == null ? undefined : p.needsSponsorship ? 'Yes' : 'No',
    age_18: 'Yes',
    salary_expectation: p.pay.target ? (p.pay.unit === 'hourly' ? `$${p.pay.target}/hour` : `$${p.pay.target.toLocaleString('en-US')}`) : undefined,
    education_level: EDU_LABEL[p.educationLevel],
    school: deg?.school,
    degree: deg ? EDU_LABEL[deg.level] : undefined,
    field_of_study: deg?.field,
    graduation_year: deg?.year,
    years_experience: ctx.resume ? String(yearsFromDates(ctx.resume.experience)) : undefined,
    password: ctx.password,
    confirm_password: ctx.password,
    username: p.email
  }
  if (m) {
    if (m.sensitivity === 'ssn_dob') {
      const v = ctx.settings.storeSsnDob ? ctx.sensitiveValues?.[m.key] : undefined
      return v ? { value: v, key: m.key, confidence: 1, source: 'profile' } : { value: null, key: m.key, confidence: 0, source: 'default', needsUser: `"${field.label}" (SSN/date of birth is never filled without you)` }
    }
    const direct = fromProfile[m.key]
    if (direct) return { value: direct, key: m.key, confidence: m.confidence, source: 'profile' }
    const bankHit = ctx.bank.find((b) => b.key === m.key && b.approved)
    const eeo = ['gender', 'hispanic', 'race', 'veteran', 'disability', 'pronouns'].includes(m.key)
    const declineOpt = field.options.find((o) => DECLINE.test(o))
    if (eeo && declineOpt && (!bankHit || !ctx.settings.storeSensitive)) return { value: declineOpt, key: m.key, confidence: 0.85, source: 'default' }
    if (bankHit) {
      if (m.sensitivity === 'sensitive' && !ctx.settings.storeSensitive) return { value: null, key: m.key, confidence: 0, source: 'default', needsUser: `"${field.label}" is sensitive and storing sensitive answers is off` }
      return { value: bankHit.answer, key: m.key, confidence: 0.9, source: 'answer_bank' }
    }
    if (m.sensitivity === 'sensitive') {
      // EEO questions are voluntary: decline when no stored answer.
      if (['gender', 'hispanic', 'race', 'veteran', 'disability', 'pronouns'].includes(m.key) && field.options.some((o) => DECLINE.test(o)))
        return { value: field.options.find((o) => DECLINE.test(o))!, key: m.key, confidence: 0.8, source: 'default' }
      return { value: null, key: m.key, confidence: 0, source: 'default', needsUser: `"${field.label}" needs your answer` }
    }
    if (m.key === 'terms_agree') return { value: 'Yes', key: m.key, confidence: 0.7, source: 'default' }
  }
  const bank = matchAnswer(field.label, ctx.bank.filter((b) => b.approved))
  if (bank) {
    if (bank.entry.sensitivity !== 'normal' && !ctx.settings.storeSensitive) return { value: null, key: bank.entry.key, confidence: 0, source: 'default', needsUser: `"${field.label}" is sensitive` }
    return { value: bank.entry.answer, key: bank.entry.key, confidence: bank.confidence, source: 'answer_bank' }
  }
  return { value: null, key: m?.key ?? null, confidence: 0, source: 'default', needsUser: field.required ? `New question: "${field.label}"` : undefined }
}

/** Starter answer bank. Answers left blank are filled in by the user once. */
export const SEED_QUESTIONS: Omit<AnswerBankEntry, 'id'>[] = [
  { key: 'work_authorized', question: 'Are you legally authorized to work in the United States?', variants: ['Are you eligible to work in the US?'], answer: '', sensitivity: 'normal', approved: false },
  { key: 'needs_sponsorship', question: 'Will you now or in the future require visa sponsorship?', variants: ['Do you require sponsorship?'], answer: '', sensitivity: 'normal', approved: false },
  { key: 'age_18', question: 'Are you at least 18 years old?', variants: [], answer: 'Yes', sensitivity: 'normal', approved: false },
  { key: 'salary_expectation', question: 'What are your salary expectations?', variants: ['Desired salary', 'Expected compensation'], answer: '', sensitivity: 'normal', approved: false },
  { key: 'start_date', question: 'When can you start?', variants: ['Available start date', 'What is your notice period?'], answer: 'Two weeks after an offer', sensitivity: 'normal', approved: false },
  { key: 'relocate', question: 'Are you willing to relocate?', variants: [], answer: '', sensitivity: 'normal', approved: false },
  { key: 'commute', question: 'Are you able to commute to the office / work on-site?', variants: ['Can you reliably commute to this location?'], answer: '', sensitivity: 'normal', approved: false },
  { key: 'how_heard', question: 'How did you hear about this position?', variants: ['Source'], answer: 'Company website', sensitivity: 'normal', approved: false },
  { key: 'previously_employed', question: 'Have you previously worked for this company?', variants: [], answer: 'No', sensitivity: 'normal', approved: false },
  { key: 'non_compete', question: 'Are you bound by a non-compete agreement?', variants: [], answer: 'No', sensitivity: 'normal', approved: false },
  { key: 'background_check', question: 'Are you willing to undergo a background check?', variants: ['Are you willing to take a drug test?'], answer: 'Yes', sensitivity: 'normal', approved: false },
  { key: 'drivers_license', question: "Do you have a valid driver's license?", variants: [], answer: '', sensitivity: 'normal', approved: false },
  { key: 'why_company', question: 'Why do you want to work here?', variants: ['What interests you about this role?'], answer: '', sensitivity: 'normal', approved: false },
  { key: 'gender', question: 'Gender (voluntary self-identification)', variants: [], answer: 'Decline to self-identify', sensitivity: 'sensitive', approved: false },
  { key: 'hispanic', question: 'Are you Hispanic or Latino? (voluntary)', variants: [], answer: 'Decline to self-identify', sensitivity: 'sensitive', approved: false },
  { key: 'race', question: 'Race / ethnicity (voluntary self-identification)', variants: [], answer: 'Decline to self-identify', sensitivity: 'sensitive', approved: false },
  { key: 'veteran', question: 'Veteran status (voluntary)', variants: ['Are you a protected veteran?'], answer: 'I prefer not to answer', sensitivity: 'sensitive', approved: false },
  { key: 'disability', question: 'Disability status (voluntary)', variants: [], answer: "I don't wish to answer", sensitivity: 'sensitive', approved: false },
  { key: 'criminal', question: 'Have you ever been convicted of a felony?', variants: [], answer: '', sensitivity: 'sensitive', approved: false }
]
