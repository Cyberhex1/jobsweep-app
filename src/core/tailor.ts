// Resume tailoring. Deterministic reordering works with no AI; AI edits are applied only if they pass the truth guard.

import type { ResumeStructured } from '@shared/types'
import { resumeToText } from './resume/parse'
import { extractSkills, jobKeywords } from './keywords'
import { truthCheck, yearsFromDates, type Violation } from './truthGuard'
import { normalize } from './text'

export type TailorOp =
  | { op: 'rephrase_bullet'; job: number; bullet: number; text: string }
  | { op: 'reorder_bullets'; job: number; order: number[] }
  | { op: 'summary'; text: string }
  | { op: 'headline'; text: string }
  | { op: 'skills_order'; skills: string[] }

export interface TailorResult {
  resume: ResumeStructured
  applied: TailorOp[]
  rejected: { op: TailorOp; violations: Violation[] }[]
}

function relevance(text: string, kw: Map<string, number>): number {
  return extractSkills(text).reduce((s, k) => s + (kw.get(k) ?? 0), 0)
}

/** Reorder bullets and skills so the most job-relevant come first. Never changes wording. */
export function tailorDeterministic(r: ResumeStructured, jobDescription: string): ResumeStructured {
  const kw = new Map(jobKeywords(jobDescription).map((k) => [k.skill, k.weight]))
  const sortStable = <T,>(xs: T[], score: (x: T) => number) =>
    xs.map((x, i) => ({ x, i, s: score(x) })).sort((a, b) => b.s - a.s || a.i - b.i).map((y) => y.x)
  return {
    ...r,
    skills: sortStable(r.skills, (s) => relevance(s, kw)),
    toolkit: sortStable(r.toolkit, (s) => relevance(s, kw)),
    experience: r.experience.map((e) => ({ ...e, bullets: sortStable(e.bullets, (b) => relevance(b, kw)) }))
  }
}

export function applyTailorOps(r: ResumeStructured, ops: TailorOp[], knownEmployers: string[] = []): TailorResult {
  const source = resumeToText(r)
  const years = yearsFromDates(r.experience)
  const allowed = [String(years), `${years}+`]
  const out: ResumeStructured = structuredClone(r)
  const applied: TailorOp[] = []
  const rejected: TailorResult['rejected'] = []
  for (const op of ops) {
    const check = (text: string) => truthCheck(text, source, { allowedNumbers: allowed, knownEmployers })
    let violations: Violation[] = []
    switch (op.op) {
      case 'rephrase_bullet': {
        const job = out.experience[op.job]
        if (!job || job.bullets[op.bullet] == null) continue
        // Numbers in a rephrased bullet must come from that same bullet.
        violations = truthCheck(op.text, job.bullets[op.bullet] + '\n' + source, { allowedNumbers: allowed, knownEmployers })
        if (!violations.length) job.bullets[op.bullet] = op.text
        break
      }
      case 'reorder_bullets': {
        const job = out.experience[op.job]
        if (!job) continue
        const valid = op.order.length === job.bullets.length && new Set(op.order).size === op.order.length && op.order.every((i) => i >= 0 && i < job.bullets.length)
        if (valid) job.bullets = op.order.map((i) => job.bullets[i])
        else continue
        break
      }
      case 'summary':
        violations = check(op.text)
        if (!violations.length) out.summary = op.text
        break
      case 'headline':
        violations = check(op.text)
        if (!violations.length) out.headline = op.text
        break
      case 'skills_order': {
        const have = new Map(out.skills.map((s) => [normalize(s), s]))
        const ordered = op.skills.map((s) => have.get(normalize(s))).filter((s): s is string => !!s)
        const rest = out.skills.filter((s) => !ordered.includes(s))
        out.skills = [...new Set([...ordered, ...rest])]
        break
      }
    }
    if (violations.length) rejected.push({ op, violations })
    else applied.push(op)
  }
  return { resume: out, applied, rejected }
}
