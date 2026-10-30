// Automatic fixes for fixable lint findings, producing a clean ATS-friendly structure.

import type { ResumeStructured } from '@shared/types'
import { normalize, stripInvisible, uniqBy } from '../text'
import { SOFT_SKILLS } from './atsLint'

const clean = (s: string) =>
  stripInvisible(s)
    .replace(/,\s*,+/g, ',')
    .replace(/;\s*;+/g, ';')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()

export function applyAtsFixes(r: ResumeStructured, opts: { removeSoftSkills?: boolean } = {}): ResumeStructured {
  const removeSoft = opts.removeSoftSkills ?? true
  const skills = uniqBy(
    r.skills.map(clean).filter((s) => s && (!removeSoft || !SOFT_SKILLS.includes(normalize(s)))),
    (s) => normalize(s)
  )
  return {
    contact: {
      name: clean(r.contact.name),
      email: r.contact.email && clean(r.contact.email),
      phone: r.contact.phone && clean(r.contact.phone),
      location: r.contact.location && clean(r.contact.location),
      links: r.contact.links.map(clean)
    },
    headline: r.headline && clean(r.headline),
    summary: r.summary && clean(r.summary),
    skills,
    toolkit: uniqBy(r.toolkit.map(clean).filter(Boolean), (s) => normalize(s)),
    experience: r.experience.map((e) => ({
      ...e,
      company: clean(e.company),
      title: clean(e.title),
      location: e.location && clean(e.location),
      bullets: e.bullets.map(clean).filter(Boolean)
    })),
    education: r.education.map((e) => ({
      ...e,
      school: clean(e.school),
      degree: e.degree && clean(e.degree),
      field: e.field && clean(e.field),
      details: e.details.map(clean).filter(Boolean)
    })),
    certifications: r.certifications.map(clean).filter(Boolean),
    other: r.other.map((o) => ({ heading: clean(o.heading), lines: o.lines.map(clean).filter(Boolean) }))
  }
}

/** Suggestions for the user's original resume (things we don't auto-change). */
export function suggestionsFor(r: ResumeStructured): string[] {
  const s: string[] = []
  if (!r.headline) s.push('Add a one-line headline with your target title (e.g., "Project Coordinator | Operations Analyst").')
  if (r.summary && r.summary.length > 600) s.push('Trim the summary to 2–3 sentences; recruiters skim the top third of the page.')
  if (r.skills.length > 25) s.push('Your skills list is long — keep the 12–18 most relevant hard skills.')
  if (r.experience.some((e) => e.bullets.length > 7)) s.push('Keep 3–6 bullets per role, strongest first.')
  if (r.certifications.length === 0) s.push('If you have certifications, list them — many ATS filters look for them.')
  return s
}

/** Plain-language list of what applyAtsFixes changed between two versions. Empty when nothing changed. */
export function describeFixes(before: ResumeStructured, after: ResumeStructured): string[] {
  const out: string[] = []
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`
  if (before.headlineFused && !after.headlineFused) out.push('Moved your headline onto its own line')
  const skills = before.skills.length - after.skills.length
  if (skills > 0) out.push(`Removed ${n(skills, 'soft-skill, duplicate or empty item')} from Skills`)
  const tools = before.toolkit.length - after.toolkit.length
  if (tools > 0) out.push(`Removed ${n(tools, 'duplicate or empty item')} from your toolkit`)
  const bullets = (r: ResumeStructured) => r.experience.reduce((s, e) => s + e.bullets.length, 0)
  const emptyBullets = bullets(before) - bullets(after)
  if (emptyBullets > 0) out.push(`Removed ${n(emptyBullets, 'empty bullet')}`)
  const prev = new Set(textsOf(before))
  const cleaned = textsOf(after).filter((s) => !prev.has(s)).length
  if (cleaned > 0) out.push(`Cleaned up ${n(cleaned, 'line')} (hidden characters, repeated punctuation, stray spaces or curly quotes)`)
  return out
}

function textsOf(r: ResumeStructured): string[] {
  const c = r.contact
  return [
    c.name,
    c.email,
    c.phone,
    c.location,
    ...c.links,
    r.headline,
    r.summary,
    ...r.skills,
    ...r.toolkit,
    ...r.experience.flatMap((e) => [e.company, e.title, e.location, ...e.bullets]),
    ...r.education.flatMap((e) => [e.school, e.degree, e.field, ...e.details]),
    ...r.certifications,
    ...r.other.flatMap((o) => [o.heading, ...o.lines])
  ].filter((s): s is string => !!s)
}
