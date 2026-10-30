// Truth guard: AI may reword and reorder, never invent. Checks a candidate text against the source facts.

import { extractSkills } from './keywords'

export interface Violation {
  kind: 'number' | 'skill' | 'credential' | 'employer'
  value: string
}

const CREDENTIALS = /\b(PMP|CAPM|MBA|CPA|CFA|PhD|Ph\.D|Master'?s|Bachelor'?s|Associate'?s degree|Six Sigma (Green|Black) Belt|Lean Six Sigma|CSM|Scrum Master certified|ITIL( v4)? certified|CompTIA [A-Z+]+|Security\+|A\+|CCNA|AWS Certified|Azure Certified|certified [A-Z][\w ]+)\b/gi

function numbersIn(s: string): string[] {
  return (s.match(/\$?\d[\d,]*(\.\d+)?\s*(%|k|m|x|\+)?/gi) ?? []).map((n) => n.replace(/[\s,$]/g, '').toLowerCase())
}

export function truthCheck(candidate: string, sourceText: string, opts: { allowedNumbers?: string[]; knownEmployers?: string[] } = {}): Violation[] {
  const v: Violation[] = []
  const srcNums = new Set([...numbersIn(sourceText), ...(opts.allowedNumbers ?? []).map((n) => n.toLowerCase())])
  const bare = (n: string) => n.replace(/[%kmx+]$/, '')
  const srcBare = new Set([...srcNums].map(bare))
  for (const n of numbersIn(candidate)) {
    if (!srcNums.has(n) && !srcBare.has(bare(n))) v.push({ kind: 'number', value: n })
  }
  const srcSkills = new Set(extractSkills(sourceText))
  for (const s of extractSkills(candidate)) if (!srcSkills.has(s)) v.push({ kind: 'skill', value: s })
  const srcLower = sourceText.toLowerCase()
  for (const c of candidate.match(CREDENTIALS) ?? []) if (!srcLower.includes(c.toLowerCase())) v.push({ kind: 'credential', value: c })
  for (const e of opts.knownEmployers ?? []) {
    if (e && candidate.toLowerCase().includes(e.toLowerCase()) && !srcLower.includes(e.toLowerCase())) v.push({ kind: 'employer', value: e })
  }
  return v
}

/** Years of experience that can be honestly claimed, from resume dates. */
export function yearsFromDates(ranges: { start?: string; end?: string }[]): number {
  let months = 0
  for (const r of ranges) {
    const s = parseMonth(r.start)
    const e = /present|current|now/i.test(r.end ?? '') ? new Date() : parseMonth(r.end)
    if (s && e && e > s) months += (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  }
  return Math.floor(months / 12)
}

function parseMonth(s?: string): Date | null {
  if (!s) return null
  const d = new Date(/^\d{4}$/.test(s.trim()) ? `Jan 1 ${s}` : `1 ${s}`)
  return isNaN(d.getTime()) ? null : d
}
