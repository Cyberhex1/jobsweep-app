// Rule-based email classification and linking to applications. Local AI handles what rules can't.

import type { EmailClass } from '@shared/types'
import { companyKey, normalize, stringSimilarity } from './text'

export interface EmailLite {
  from: string
  subject: string
  text: string
}

const RULES: [EmailClass, RegExp][] = [
  ['verification', /(verify|confirm|activate) (your )?(email|account)|verification code|one-time (pass)?code|security code|confirm your registration|activate your account/i],
  ['offer', /\b(offer letter|pleased to offer|extend (you )?an offer|job offer)\b/i],
  ['interview', /\b(schedule (an|a|your) (interview|call|chat|conversation)|interview (invitation|request)|invite you to (an )?interview|like to (speak|talk|chat|meet) with you|next step(s)? in (the|our) (process|interview)|phone screen)\b/i],
  ['assessment', /\b(assessment|skills test|coding challenge|hirevue|take-home|online test|codility|hackerrank|criteria corp)\b/i],
  ['rejection', /\b(unfortunately|not (to )?(move|moving) forward|decided to (pursue|proceed with) other|no longer (being )?considered|position has been filled|not selected|regret to inform|other candidates (whose|that)|will not be moving)\b/i],
  ['confirmation', /\b(thank you for (applying|your application|your interest)|application (has been )?(received|submitted)|we('ve| have) received your application|successfully (applied|submitted))\b/i],
  ['recruiter', /\b(recruiter|talent acquisition|came across your (profile|resume)|opportunity (that|which) (might|may) interest)\b/i]
]

export function classifyEmail(e: EmailLite): { cls: EmailClass; confidence: number } {
  const hay = `${e.subject}\n${e.text.slice(0, 5000)}`
  for (const [cls, re] of RULES) if (re.test(hay)) return { cls, confidence: re.test(e.subject) ? 0.95 : 0.8 }
  return { cls: 'other', confidence: 0.3 }
}

export function extractCode(text: string): string | null {
  const m = /\b(code|passcode|pin)\b[^0-9]{0,30}?\b([0-9]{4,8})\b/i.exec(text)
  if (m) return m[2]
  const alnum = /\b(?:code|passcode)\b[^A-Z0-9]{0,30}?\b((?=[A-Z0-9]*\d)[A-Z0-9]{6,8})\b/.exec(text)
  return alnum ? alnum[1] : null
}

export function extractLinks(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) out.add(m[1].replace(/&amp;/g, '&'))
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/g)) out.add(m[0])
  return [...out]
}

/** Only follow verification links on domains we expect for this account. */
export function pickVerificationLink(links: string[], allowedHosts: string[]): string | null {
  const ok = links.filter((l) => {
    try {
      const h = new URL(l).hostname.toLowerCase()
      return allowedHosts.some((a) => h === a || h.endsWith('.' + a))
    } catch {
      return false
    }
  })
  return ok.find((l) => /verif|confirm|activat|validate|token/i.test(l)) ?? null
}

export interface AppLite {
  id: number
  company: string
  title: string
  platformHost?: string
  submittedAt: string | null
}

/** Link an email to the most likely application. */
export function linkEmail(e: EmailLite, apps: AppLite[]): { appId: number; confidence: number } | null {
  const hay = normalize(`${e.from} ${e.subject} ${e.text.slice(0, 4000)}`)
  const hayKey = hay.replace(/[^a-z0-9]/g, '')
  let best: { appId: number; confidence: number } | null = null
  for (const a of apps) {
    let s = 0
    const ck = companyKey(a.company)
    if (ck.length >= 3 && hayKey.includes(ck)) s += 0.55
    const tn = normalize(a.title)
    if (tn && hay.includes(tn)) s += 0.35
    else if (tn) s += 0.2 * stringSimilarity(tn, normalize(e.subject))
    if (a.platformHost && e.from.toLowerCase().includes(a.platformHost.split('.')[0])) s += 0.1
    if (!best || s > best.confidence) best = { appId: a.id, confidence: s }
  }
  return best && best.confidence >= 0.5 ? best : null
}

export const STATUS_FOR: Partial<Record<EmailClass, 'confirmed' | 'rejected' | 'interview' | 'assessment' | 'offer'>> = {
  confirmation: 'confirmed',
  rejection: 'rejected',
  interview: 'interview',
  assessment: 'assessment',
  offer: 'offer'
}
