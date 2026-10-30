// Deterministic ATS checks. Each rule returns findings; fixable ones have an automatic fix in fixes.ts.

import type { LintFinding, ResumeStructured } from '@shared/types'
import { INVISIBLE_RE, normalize } from '../text'

export const SOFT_SKILLS = [
  'team player',
  'positive attitude',
  'hard working',
  'hardworking',
  'hard worker',
  'self starter',
  'self-starter',
  'detail oriented',
  'detail-oriented',
  'go getter',
  'people person',
  'fast learner',
  'quick learner',
  'solution oriented',
  'results driven',
  'motivated',
  'dependable',
  'reliable',
  'punctual',
  'friendly',
  'passionate',
  'team-player'
]

export const STANDARD_HEADINGS = ['summary', 'skills', 'experience', 'education', 'certifications', 'projects']

const WEAK_STARTS = /^(responsible for|duties included|helped|worked on|assisted with|in charge of|tasked with)\b/i
const METRIC_RE = /(\d+(\.\d+)?\s*%|\$\s?\d|\b\d{2,}\b|\b\d+x\b)/i

export interface LintInput {
  rawText: string
  data: ResumeStructured
  docx?: { hasTables: boolean; hasTextBoxes: boolean; hasImages: boolean; headerFooterHasContact: boolean; columns: number }
}

export function lintResume({ rawText, data, docx }: LintInput): LintFinding[] {
  const f: LintFinding[] = []

  const invisible = rawText.match(INVISIBLE_RE)?.length ?? 0
  if (invisible > 0)
    f.push({
      id: 'invisible-chars',
      severity: 'high',
      title: 'Invisible characters found',
      detail: `${invisible} hidden zero-width/formatting characters (often from Google Docs exports). Some ATS parsers garble the words around them.`,
      fixable: true
    })

  const dupPunct = rawText.match(/([,;])\s*\1|,\s*,/g)?.length ?? 0
  if (dupPunct)
    f.push({ id: 'double-punctuation', severity: 'medium', title: 'Repeated punctuation', detail: `Found ${dupPunct} spot(s) like ", ," — looks like a typo to recruiters.`, fixable: true })

  if (data.headlineFused)
    f.push({
      id: 'headline-merged',
      severity: 'medium',
      title: 'Headline runs into the summary',
      detail: `"${data.headline}" is on the same line as your summary. Put it on its own line so parsers read it as your target title.`,
      fixable: true
    })

  const soft = data.skills.filter((s) => SOFT_SKILLS.includes(normalize(s)))
  if (soft.length)
    f.push({
      id: 'soft-skill-padding',
      severity: 'medium',
      title: 'Soft skills taking keyword space',
      detail: `${soft.join(', ')} — ATS keyword matching looks for hard skills. Show soft skills through bullets instead.`,
      fixable: true
    })

  const blankSkills = data.skills.filter((s) => !s.trim()).length
  if (blankSkills) f.push({ id: 'empty-skill', severity: 'low', title: 'Empty skill entry', detail: 'An empty item sits in your skills list.', fixable: true })

  // Near-duplicate bullets within the same job (rough stemming + overlap coefficient).
  // Short acronyms (ERP, SQL, B2B) are kept: two bullets about the same system are a strong duplicate signal.
  const acronyms = (b: string) => new Set((b.match(/\b[A-Z][A-Z0-9]{1,4}\b/g) ?? []).map((w) => w.toLowerCase()))
  const stems = (b: string) => {
    const keep = acronyms(b)
    return new Set(
      normalize(b)
        .split(' ')
        .filter((w) => (w.length > 3 || keep.has(w)) && !['that', 'with', 'from', 'into', 'and', 'the', 'using', 'ensuring'].includes(w))
        .map((w) => w.slice(0, 5))
    )
  }
  for (const job of data.experience) {
    const st = job.bullets.map(stems)
    const ac = job.bullets.map(acronyms)
    for (let i = 0; i < job.bullets.length; i++)
      for (let j = i + 1; j < job.bullets.length; j++) {
        let inter = 0
        for (const w of st[i]) if (st[j].has(w)) inter++
        const overlap = inter / Math.max(1, Math.min(st[i].size, st[j].size))
        const sameSystem = [...ac[i]].some((w) => ac[j].has(w))
        if ((inter >= 4 && overlap >= 0.38) || (sameSystem && inter >= 3 && overlap >= 0.25))
          f.push({
            id: 'duplicate-bullets',
            severity: 'medium',
            title: `Similar bullets at ${job.company || job.title}`,
            detail: `"${trunc(job.bullets[i])}" and "${trunc(job.bullets[j])}" say nearly the same thing. Merge them to make room for something new.`,
            fixable: false,
            where: job.company
          })
      }
  }

  const hasLinkedIn = data.contact.links.some((l) => /linkedin\.com/i.test(l)) || /linkedin\.com\/in\//i.test(rawText)
  if (!hasLinkedIn) f.push({ id: 'missing-linkedin', severity: 'low', title: 'No LinkedIn URL', detail: 'Recruiters almost always check LinkedIn; add your profile URL to the contact line.', fixable: false })
  if (!data.contact.email) f.push({ id: 'missing-email', severity: 'high', title: 'No email found', detail: 'Parsers could not find an email address in your contact info.', fixable: false })
  if (!data.contact.phone) f.push({ id: 'missing-phone', severity: 'medium', title: 'No phone number found', detail: 'Add a phone number to the contact line.', fixable: false })
  if (!data.contact.location) f.push({ id: 'missing-location', severity: 'low', title: 'No location found', detail: 'Add "City, ST" — many ATS filters use location.', fixable: false })

  for (const job of data.experience) {
    if (!job.start) f.push({ id: 'missing-dates', severity: 'medium', title: `No dates for ${job.company || job.title}`, detail: 'Every job needs start and end dates (Mon YYYY – Mon YYYY).', fixable: false, where: job.company })
    if (!job.title) f.push({ id: 'missing-title', severity: 'medium', title: `No job title for ${job.company}`, detail: 'Each role needs a clear title line.', fixable: false, where: job.company })
  }

  for (const job of data.experience)
    for (const b of job.bullets) {
      if (WEAK_STARTS.test(b))
        f.push({ id: 'weak-verb', severity: 'low', title: 'Weak bullet opening', detail: `"${trunc(b)}" — start with an action verb (Led, Built, Reduced…).`, fixable: false, where: job.company })
      if (b.length > 260) f.push({ id: 'long-bullet', severity: 'low', title: 'Very long bullet', detail: `"${trunc(b)}" — keep bullets to one or two lines.`, fixable: false, where: job.company })
      const pct = /(\d{2,3})\s*%/.exec(b)
      if (pct && Number(pct[1]) >= 90 && /reduc|cut|decreas|lower|improv/i.test(b))
        f.push({
          id: 'implausible-metric',
          severity: 'low',
          title: 'Metric recruiters may question',
          detail: `"${trunc(b)}" — a ${pct[1]}% change invites skepticism. Double-check it, or add context (from what, to what, over how long).`,
          fixable: false,
          where: job.company
        })
    }

  const allBullets = data.experience.flatMap((e) => e.bullets)
  const withMetrics = allBullets.filter((b) => METRIC_RE.test(b)).length
  if (allBullets.length >= 6 && withMetrics / allBullets.length < 0.25)
    f.push({ id: 'few-metrics', severity: 'low', title: 'Few measurable results', detail: `Only ${withMetrics} of ${allBullets.length} bullets include a number. Quantified results stand out.`, fixable: false })

  if (docx) {
    if (docx.hasTables) f.push({ id: 'tables', severity: 'high', title: 'Tables in the document', detail: 'Many ATS parsers read tables out of order. Use plain paragraphs.', fixable: true })
    if (docx.hasTextBoxes) f.push({ id: 'text-boxes', severity: 'high', title: 'Text boxes', detail: 'Text inside text boxes is often skipped entirely by ATS parsers.', fixable: true })
    if (docx.hasImages) f.push({ id: 'images', severity: 'medium', title: 'Images or icons', detail: 'ATS parsers ignore images; icons used as labels (phone/email) are lost.', fixable: true })
    if (docx.headerFooterHasContact) f.push({ id: 'header-contact', severity: 'high', title: 'Contact info in the page header/footer', detail: 'Some parsers skip headers and footers. Move contact info into the body.', fixable: true })
    if (docx.columns > 1) f.push({ id: 'columns', severity: 'high', title: 'Multi-column layout', detail: 'Columns are often read left-to-right across both, mixing sections.', fixable: true })
  }

  const order = { high: 0, medium: 1, low: 2 }
  return dedupeFindings(f).sort((a, b) => order[a.severity] - order[b.severity])
}

function dedupeFindings(f: LintFinding[]): LintFinding[] {
  const seen = new Set<string>()
  return f.filter((x) => {
    const k = x.id + '|' + x.detail
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function trunc(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** 0-100 score: start at 100, subtract per finding by severity. */
export function atsScore(findings: LintFinding[]): number {
  const cost = { high: 15, medium: 7, low: 3 }
  const total = findings.reduce((s, f) => s + cost[f.severity], 0)
  return Math.max(0, 100 - total)
}
