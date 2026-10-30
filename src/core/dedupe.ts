// Duplicate guard: the same job seen on several sources becomes one entry.

import type { NormalizedJob } from '@shared/types'
import { companyKey, jaccard, normalize, shingles } from './text'

const TITLE_NOISE = /\b(remote|hybrid|onsite|on site|full time|full-time|part time|part-time|contract|temporary|temp|i{1,3}|iv|level \d|sr|jr|senior|junior)\b/g

export function normalizeTitle(t: string): string {
  return normalize(t).replace(/\(.*?\)/g, ' ').replace(TITLE_NOISE, ' ').replace(/\s+/g, ' ').trim()
}

function locBucket(loc: string, remote: string): string {
  if (remote === 'remote') return 'remote'
  return normalize(loc).split(/[ ,]/)[0] ?? ''
}

export function fingerprint(j: Pick<NormalizedJob, 'company' | 'title' | 'location' | 'remoteType'>): string {
  return `${companyKey(j.company)}|${normalizeTitle(j.title)}|${locBucket(j.location, j.remoteType)}`
}

/** True when two jobs are probably the same posting (reposts, cross-posts with slightly different titles). */
export function isSameJob(a: NormalizedJob, b: NormalizedJob): boolean {
  if (companyKey(a.company) !== companyKey(b.company)) return false
  if (fingerprint(a) === fingerprint(b)) return true
  const ta = new Set(normalizeTitle(a.title).split(' '))
  const tb = new Set(normalizeTitle(b.title).split(' '))
  if (jaccard(ta, tb) < 0.5) return false
  if (!a.description || !b.description) return false
  return jaccard(shingles(a.description.slice(0, 4000)), shingles(b.description.slice(0, 4000))) >= 0.6
}

const AGGREGATORS = ['adzuna', 'jsearch', 'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'hiringcafe', 'remotive', 'remoteok', 'themuse', 'arbeitnow']

/** Prefer the company's own application site over aggregators when picking where to apply. */
export function applyPriority(source: string, url: string): number {
  if (/myworkdayjobs|greenhouse|lever\.co|ashbyhq|smartrecruiters|icims|taleo|successfactors|governmentjobs|usajobs|oraclecloud/i.test(url)) return 3
  if (AGGREGATORS.includes(source)) return 1
  return 2
}
