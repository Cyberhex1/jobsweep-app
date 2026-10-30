// Match scoring: how well a job fits the profile + default resume. Pure and explainable.

import type { NormalizedJob, Profile, ResumeStructured } from '@shared/types'
import { extractSkills, jobKeywords, ROLE_FIELDS } from './keywords'
import { clamp, cosineBow, normalize, stringSimilarity, tokens } from './text'

export interface MatchResult {
  score: number // 0-100
  reasons: string[]
  missingKeywords: string[]
  hardFail: string | null // e.g. remote-only profile vs onsite job
  offField: boolean // title is nowhere near your roles or fields
}

// Share of a job's listed skills that counts as a full skills match: postings list far more than any one resume covers.
const FULL_SKILL_COVERAGE = 0.6

/** Title similarity; a target whose words all appear in the job title ("Project Manager" in "Senior Project Manager") is a near match. */
export function titleSimilarity(target: string, title: string): number {
  const t = target.replace(/\([^)]*\)/g, ' ')
  const s = Math.max(stringSimilarity(t, title), cosineBow(t, title))
  const tt = tokens(t)
  const jt = new Set(tokens(title))
  return tt.length && tt.every((w) => jt.has(w)) ? Math.max(s, 0.9) : s
}

/** All resume text that can show a skill, including coursework and certifications. */
function resumeSkillText(r: ResumeStructured): string {
  return [
    ...r.skills,
    ...r.toolkit,
    r.summary ?? '',
    ...r.experience.flatMap((e) => [e.title, ...e.bullets]),
    ...r.education.flatMap((e) => [e.degree ?? '', e.field ?? '', ...e.details]),
    ...r.certifications
  ].join(' \n ')
}

const HOURS_PER_YEAR = 2080

export function annualize(amount: number | undefined, unit: 'hourly' | 'salary' | undefined): number | undefined {
  if (amount == null) return undefined
  if (unit === 'hourly' || (unit == null && amount < 300)) return amount * HOURS_PER_YEAR
  return amount
}

const EDU_RANK: Record<string, number> = { none: 0, high_school: 1, some_college: 2, associate: 3, bachelor: 4, master: 5, doctorate: 6 }

function requiredEducation(desc: string): number | null {
  const d = desc.toLowerCase()
  if (/\b(phd|doctorate|doctoral)\b.*\brequired\b/.test(d)) return 6
  if (/\bmaster'?s\b[^.]{0,40}\brequired\b/.test(d)) return 5
  if (/\bbachelor'?s\b|\bb\.?s\.?\b degree|\bba\/bs\b|\bfour-year degree\b/.test(d)) return 4
  if (/\bassociate'?s\b/.test(d)) return 3
  if (/\bhigh school\b|\bged\b/.test(d)) return 1
  return null
}

export function locationFit(job: NormalizedJob, profile: Profile): { fit: number; hardFail: string | null; reason: string } {
  const jobRemote = job.remoteType
  const mode = profile.remoteMode
  if (mode === 'remote_only' && jobRemote !== 'remote' && jobRemote !== 'unknown')
    return { fit: 0, hardFail: 'Not remote', reason: 'Not remote (you chose remote only)' }
  if (mode === 'onsite_only' && jobRemote === 'remote') return { fit: 0, hardFail: 'Remote job', reason: 'Remote (you chose onsite only)' }
  if (jobRemote === 'remote') return { fit: 1, hardFail: null, reason: 'Remote' }
  const loc = normalize(job.location)
  const places = [...profile.locations.map((l) => l.place), `${profile.city}, ${profile.state}`].filter((p) => p.trim().length > 2)
  if (!places.length) return { fit: 0.6, hardFail: null, reason: '' }
  for (const p of places) {
    const city = normalize(p.split(',')[0])
    if (city && loc.includes(city)) return { fit: 1, hardFail: null, reason: `In ${p}` }
  }
  const state = normalize(profile.state)
  if (state && (loc.includes(` ${state}`) || loc.endsWith(state) || loc.includes(stateName(profile.state))))
    return { fit: 0.65, hardFail: null, reason: `Same state (${profile.state})` }
  if (jobRemote === 'unknown') return { fit: 0.4, hardFail: null, reason: '' }
  return { fit: 0.15, hardFail: null, reason: 'Outside your preferred locations' }
}

const STATE_NAMES: Record<string, string> = { NC: 'north carolina', SC: 'south carolina', VA: 'virginia', GA: 'georgia', TN: 'tennessee', NY: 'new york', CA: 'california', TX: 'texas', FL: 'florida' }
function stateName(abbr: string): string {
  return STATE_NAMES[abbr.toUpperCase()] ?? '___'
}

export function scoreJob(job: NormalizedJob, profile: Profile, resume: ResumeStructured | null): MatchResult {
  const reasons: string[] = []
  const resumeSkills = new Set(resume ? extractSkills(resumeSkillText(resume)) : [])
  const kws = jobKeywords(job.description + ' ' + job.title)
  const totalW = kws.reduce((s, k) => s + k.weight, 0)
  const haveW = kws.filter((k) => resumeSkills.has(k.skill)).reduce((s, k) => s + k.weight, 0)
  const coverage = totalW ? haveW / totalW : 0
  const skillFit = totalW ? Math.min(1, coverage / FULL_SKILL_COVERAGE) : 0.5
  const missing = kws.filter((k) => !resumeSkills.has(k.skill)).sort((a, b) => b.weight - a.weight).map((k) => k.skill)
  if (totalW) reasons.push(`${Math.round(coverage * 100)}% of the job's skills are on your resume`)

  // Title fit: best similarity between the job title and any target role / past title.
  const targets = [...profile.roles, ...(resume?.experience.map((e) => e.title) ?? []), resume?.headline ?? ''].filter(Boolean)
  let titleFit = 0
  let bestTitle = ''
  for (const t of targets) {
    const s = titleSimilarity(t, job.title)
    if (s > titleFit) {
      titleFit = s
      bestTitle = t
    }
  }
  if (!targets.length) titleFit = 0.5
  if (titleFit > 0.55) reasons.push(`Title is close to "${bestTitle}"`)
  // Off-field: the title is far from your roles, past titles and every role in your fields.
  const fieldTitles = profile.fields.flatMap((f) => ROLE_FIELDS[f] ?? [])
  const offField = targets.length > 0 && titleFit < 0.4 && !fieldTitles.some((t) => titleSimilarity(t, job.title) >= 0.4)

  const loc = locationFit(job, profile)
  if (loc.reason) reasons.push(loc.reason)

  // Pay, education and recency count only when known, so missing data neither helps nor hurts.
  let payFit: number | null = null
  const want = annualize(profile.pay.min ?? profile.pay.target, profile.pay.unit)
  const offerMax = annualize(job.payMax ?? job.payMin, job.payUnit)
  if (want && offerMax) {
    payFit = offerMax >= want ? 1 : clamp(offerMax / want, 0, 1) ** 2
    reasons.push(offerMax >= want ? 'Pay meets your minimum' : 'Pay is below your minimum')
  }

  let eduFit: number | null = null
  const req = requiredEducation(job.description)
  if (req != null) {
    const have = EDU_RANK[profile.educationLevel] ?? 0
    eduFit = have >= req ? 1 : have === req - 1 ? 0.5 : 0.2
    if (have < req) reasons.push('Asks for more education than listed in your profile')
  }

  let recency: number | null = null
  if (job.postedAt) {
    const days = (Date.now() - new Date(job.postedAt).getTime()) / 86400000
    recency = days <= 3 ? 1 : days <= 14 ? 0.85 : days <= 30 ? 0.6 : 0.3
  }

  const parts: [number, number | null][] = [
    [0.38, skillFit],
    [0.27, titleFit],
    [0.15, loc.fit],
    [0.1, payFit],
    [0.05, eduFit],
    [0.05, recency]
  ]
  const known = parts.filter((p): p is [number, number] => p[1] != null)
  const score = (100 * known.reduce((s, [w, v]) => s + w * v, 0)) / known.reduce((s, [w]) => s + w, 0)
  return { score: Math.round(loc.hardFail ? Math.min(score, 20) : score), reasons, missingKeywords: missing.slice(0, 10), hardFail: loc.hardFail, offField }
}

/**
 * "Likely to get an interview": match score adjusted by learned response rates.
 * rates are shrunk toward the global rate so small samples don't dominate.
 */
export function interviewScore(match: number, groupStats: { responses: number; applied: number }[], globalRate: number): number {
  if (!groupStats.length) return match
  const prior = 20
  let adj = 0
  for (const g of groupStats) {
    const rate = (g.responses + prior * globalRate) / (g.applied + prior)
    adj += globalRate > 0 ? Math.log(rate / globalRate) : 0
  }
  const factor = clamp(Math.exp(0.5 * (adj / groupStats.length)), 0.5, 1.5)
  return Math.round(clamp(match * factor, 0, 100))
}
