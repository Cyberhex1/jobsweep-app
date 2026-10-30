// Rules-based resume parser: plain text -> ResumeStructured.
// Works on text from DOCX (paragraph per line) or PDF (visual lines). The user can edit everything afterwards.

import type { ResumeEducation, ResumeExperience, ResumeStructured } from '@shared/types'
import { stripInvisible } from '../text'

type Section = 'header' | 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'other'

const HEADINGS: [Section, RegExp][] = [
  ['summary', /^(professional\s+)?(summary|profile|objective|about\s+me|career\s+summary|professional\s+profile)\b/i],
  ['skills', /^(key\s+)?(strengths|skills|core\s+competencies|competencies|technical\s+skills|key\s+strengths\s+and\s+skills|skills\s+(and|&)\s+\w+|technical\s+toolkit)\b/i],
  ['experience', /^(professional\s+|work\s+|relevant\s+)?(experience|employment(\s+history)?|work\s+history|career\s+history)\b/i],
  ['education', /^(education|academic\s+background|education\s+(and|&)\s+training)\b/i],
  ['certifications', /^(certifications?|licenses?(\s+(and|&)\s+certifications?)?|certificates)\b/i],
  ['other', /^(projects|volunteer(ing)?(\s+experience)?|awards|honors|publications|activities|languages|interests|references)\b/i]
]

export const BULLET_RE = /^\s*([●•▪◦‣∙·\-*–—►➢✓✔o]|\d+[.)])\s+/
const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE = `(${MONTHS}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`
export const DATE_RANGE_RE = new RegExp(`${DATE}\\s*(–|-|—|to)\\s*(${DATE}|present|current|now)`, 'i')
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const URL_RE = /\b((https?:\/\/)?(www\.)?(linkedin\.com|github\.com|[\w-]+\.(com|io|dev|me|net|org))\/[\w\-./%?=&#]*)/gi
const STATES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia'
export const LOCATION_RE = new RegExp(`\\b(remote|[A-Z][a-zA-Z.]+(\\s[A-Z][a-zA-Z.]+)*,\\s*([A-Z]{2}|${STATES}))\\b`)

export function detectHeading(line: string): { section: Section; heading: string; rest: string } | null {
  const clean = stripInvisible(line).trim().replace(/[:\s]+$/, '')
  if (!clean || clean.length > 60) {
    // A heading might be followed by content on the same line, e.g. "Skills: Excel, SQL"
    const m = /^([A-Za-z &]{3,40}):\s*(.+)$/.exec(stripInvisible(line).trim())
    if (m) {
      for (const [section, re] of HEADINGS) if (re.test(m[1])) return { section, heading: m[1], rest: m[2] }
    }
    return null
  }
  for (const [section, re] of HEADINGS) {
    if (re.test(clean)) {
      // Avoid treating sentences that start with "Experience ..." as headings.
      const words = clean.split(/\s+/).length
      if (words <= 6) return { section, heading: clean, rest: '' }
      const m = /^([A-Za-z &]{3,40}):\s*(.+)$/.exec(clean)
      if (m) return { section, heading: m[1], rest: m[2] }
    }
  }
  return null
}

function splitList(s: string): string[] {
  // Split on , ; | • but not inside parentheses: "ERP Systems (SAP, Core, Syteline)" stays whole.
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && /[,;|•●·]/.test(ch)) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim().replace(/\.$/, '')).filter((x) => x.length > 1)
}

function splitColumns(line: string): string[] {
  return line
    .split(/\t+|\s{3,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseResumeText(input: string): ResumeStructured {
  const lines = input
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => stripInvisible(l).replace(/\s+$/, ''))

  const out: ResumeStructured = {
    contact: { name: '', links: [] },
    skills: [],
    toolkit: [],
    experience: [],
    education: [],
    certifications: [],
    other: []
  }

  const buckets: Record<Section, string[]> = {
    header: [],
    summary: [],
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    other: []
  }
  let current: Section = 'header'
  let otherHeading = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      buckets[current].push('')
      continue
    }
    const h = detectHeading(line)
    if (h) {
      current = h.section
      if (current === 'other') {
        otherHeading = h.heading
        out.other.push({ heading: h.heading, lines: [] })
      }
      if (h.rest) buckets[current].push(`${h.heading}: ${h.rest}`)
      continue
    }
    if (current === 'other') out.other[out.other.length - 1].lines.push(line)
    else buckets[current].push(raw)
  }
  void otherHeading

  // Header: name, contact, headline. A long header paragraph usually means the summary has no heading.
  const header = buckets.header.map((l) => l.trim()).filter(Boolean)
  if (header.length) out.contact.name = header[0].split(/\s{2,}|\|/)[0].trim()
  const rest: string[] = []
  for (const l of header.slice(1)) {
    const email = EMAIL_RE.exec(l)
    const phone = PHONE_RE.exec(l)
    const links = l.match(URL_RE)
    if (email || phone || links) {
      if (email) out.contact.email = email[0]
      if (phone) out.contact.phone = phone[0].trim()
      if (links) out.contact.links.push(...links)
      const loc = l
        .split(/\s*[|•·]\s*/)
        .map((s) => s.trim())
        .find((s) => !EMAIL_RE.test(s) && !PHONE_RE.test(s) && !/^phone|^email/i.test(s) && LOCATION_RE.test(s))
      if (loc) out.contact.location = loc
      continue
    }
    rest.push(l)
  }
  if (rest.length) {
    // A short first line is a headline; otherwise the block is a (possibly wrapped) summary paragraph,
    // which may start with a fused headline: "Project Manager / Operations Analyst Analytical project professional ..."
    if (rest[0].length <= 80 && rest.length > 1 && !/[.!?]$/.test(rest[0]) && rest[1].length > 80) {
      out.headline = rest[0]
      out.summary = rest.slice(1).join(' ')
    } else if (rest.length === 1 && rest[0].length <= 80) {
      out.headline = rest[0]
    } else {
      const joined = rest.join(' ')
      const fused = /^((?:[A-Z][\w&-]*(?:\s*[/|]\s*|\s+)){1,7}?[A-Z][\w&-]*)\s+([A-Z][a-z]+(?:-[a-z]+)?\s+[a-z][\s\S]*)$/.exec(joined)
      if (fused && fused[1].length < 70 && fused[1].split(/\s+/).length >= 2) {
        out.headline = fused[1].trim()
        out.summary = fused[2].trim()
        out.headlineFused = true
      } else out.summary = joined
    }
  }
  const summaryText = buckets.summary.map((l) => l.trim()).filter(Boolean).join(' ')
  if (summaryText) out.summary = out.summary ? `${out.summary} ${summaryText}` : summaryText

  // Skills: "Skills: a, b" / "Technical Toolkit: x | y" or bulleted lists. Wrapped lines are joined first.
  const skillLines: string[] = []
  for (const l of buckets.skills.map((x) => x.trim())) {
    if (!l) {
      skillLines.push('')
      continue
    }
    const startsNew = /^[A-Za-z &]{3,40}:/.test(l) || BULLET_RE.test(l)
    const prev = skillLines.length ? skillLines[skillLines.length - 1] : ''
    // "SQL" + "Python | Jira": a '|'-separated list wrapped between items needs its separator back.
    const sep = /\|/.test(prev) && /\|/.test(l) && !/[|,;]\s*$/.test(prev) ? ' | ' : ' '
    if (!startsNew && prev) skillLines[skillLines.length - 1] = prev + sep + l
    else skillLines.push(l)
  }
  for (const l of skillLines.filter(Boolean)) {
    const m = /^([A-Za-z &]{3,40}):\s*(.*)$/.exec(l)
    const target = m && /tool|technical|software|systems|technolog/i.test(m[1]) ? out.toolkit : out.skills
    const body = m ? m[2] : l.replace(BULLET_RE, '')
    target.push(...splitList(body))
  }
  out.skills = out.skills.filter((s) => s.length < 60)
  out.toolkit = out.toolkit.filter((s) => s.length < 60)

  out.experience = parseExperience(buckets.experience)
  out.education = parseEducation(buckets.education)
  out.certifications = buckets.certifications
    .map((l) => l.trim().replace(BULLET_RE, ''))
    .filter(Boolean)
  return out
}

function parseExperience(lines: string[]): ResumeExperience[] {
  // Split into header blocks (company/title/location/dates lines) and bullet groups.
  const L = lines.map((l) => l.trim()).filter(Boolean)
  const items: ResumeExperience[] = []
  let cur: ResumeExperience | null = null
  let i = 0
  while (i < L.length) {
    if (BULLET_RE.test(L[i])) {
      if (!cur) items.push((cur = { company: '', title: '', bullets: [] }))
      cur.bullets.push(L[i].replace(BULLET_RE, '').trim())
      i++
      continue
    }
    // Gather the run of non-bullet lines.
    let j = i
    while (j < L.length && !BULLET_RE.test(L[j])) j++
    const run = L.slice(i, j)
    // Leading continuation lines belong to the previous bullet (wrapped text).
    let k = 0
    if (cur && cur.bullets.length) {
      const hasHeader = run.some((r) => DATE_RANGE_RE.test(r)) || j >= L.length
      const continues = (idx: number) => {
        const prev = idx === 0 ? cur!.bullets[cur!.bullets.length - 1] : run[idx - 1]
        return /^[a-z0-9(&%$]/.test(run[idx]) || /(\b(and|or|of|the|to|with|for|in|on|by|a|an|as|at|from|into|across)|[,&/-])$/i.test(prev.trim())
      }
      while (k < run.length && !DATE_RANGE_RE.test(run[k]) && (!hasHeader || continues(k))) {
        cur.bullets[cur.bullets.length - 1] += ' ' + run[k]
        k++
        if (!hasHeader) break
      }
      if (!hasHeader) {
        // No dates anywhere: everything left in this run is continuation text.
        while (k < run.length) cur.bullets[cur.bullets.length - 1] += ' ' + run[k++]
      }
    }
    const header = run.slice(k)
    if (header.length) items.push((cur = parseHeaderBlock(header)))
    i = j
  }
  return items.filter((x) => x.company || x.title || x.bullets.length)
}

function parseHeaderBlock(lines: string[]): ResumeExperience {
  const it: ResumeExperience = { company: '', title: '', bullets: [] }
  const pieces: { text: string; withDate: boolean }[] = []
  for (const raw of lines) {
    let line = raw
    const d = DATE_RANGE_RE.exec(line)
    if (d) {
      const [start, end] = d[0].split(/\s*(?:–|-|—|\bto\b)\s*/i)
      it.start = start.trim()
      it.end = end?.trim()
      line = (line.slice(0, d.index) + ' ' + line.slice(d.index + d[0].length)).trim()
    }
    for (const col of splitColumns(line)) {
      const c = col.replace(/^[|,–-]\s*|\s*[|,–-]$/g, '').trim()
      if (!c) continue
      if (!it.location && LOCATION_RE.test(c) && LOCATION_RE.exec(c)![0].length >= c.length - 12) it.location = c
      else if (it.location && /^remote$/i.test(c)) it.location = `Remote | ${it.location}`
      else pieces.push({ text: c, withDate: !!d })
    }
  }
  // Text sharing a line with the dates is the job title ("Title<TAB>Jan 2022 – Present").
  const titled = pieces.find((p) => p.withDate)
  const others = pieces.filter((p) => p !== titled)
  if (titled && others.length) {
    it.title = titled.text
    it.company = others.map((p) => p.text).join(' ')
  } else if (pieces.length >= 2) {
    it.company = pieces[0].text
    it.title = pieces.slice(1).map((p) => p.text).join(' ')
  } else if (pieces.length === 1) {
    const sp = /^(.+?)\s+(?:\||—|–|at|@)\s+(.+)$/.exec(pieces[0].text)
    if (sp) {
      it.title = sp[1].trim()
      it.company = sp[2].trim()
    } else it.company = pieces[0].text
  }
  return it
}

function parseEducation(lines: string[]): ResumeEducation[] {
  const items: ResumeEducation[] = []
  let cur: ResumeEducation | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const isDegree = /\b(bachelor|master|associate|doctor|ph\.?d|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?b\.?a|diploma|ged|certificate)\b/i.test(line)
    const isSchool = /\b(university|college|institute|school|academy)\b/i.test(line) && !/school of/i.test(line)
    if (isSchool && (!cur || cur.degree || cur.details.length)) {
      const cols = splitColumns(line)
      cur = { school: cols[0], location: cols.length > 1 ? cols[cols.length - 1] : undefined, details: [] }
      items.push(cur)
      continue
    }
    if (!cur) {
      cur = { school: '', details: [] }
      items.push(cur)
    }
    if (isDegree && !cur.degree) {
      const date = /\b(19|20)\d{2}\b/.exec(line)?.[0]
      cur.degree = line.replace(BULLET_RE, '').replace(date ?? '', '').trim()
      if (date) cur.date = date
      continue
    }
    const major = /^(major|majors|concentration)\s+(in\s+)?(.+)$/i.exec(line)
    if (major) {
      cur.field = major[3].trim()
      continue
    }
    cur.details.push(line.replace(BULLET_RE, ''))
  }
  return items
}

/** Plain-text rendering of a structured resume (used for keyword matching and AI prompts). */
export function resumeToText(r: ResumeStructured): string {
  const parts: string[] = []
  parts.push(r.contact.name)
  parts.push([r.contact.location, r.contact.phone, r.contact.email, ...r.contact.links].filter(Boolean).join(' | '))
  if (r.headline) parts.push(r.headline)
  if (r.summary) parts.push('\nSUMMARY\n' + r.summary)
  if (r.skills.length) parts.push('\nSKILLS\n' + r.skills.join(', '))
  if (r.toolkit.length) parts.push('Technical: ' + r.toolkit.join(', '))
  if (r.experience.length) {
    parts.push('\nEXPERIENCE')
    for (const e of r.experience) {
      parts.push(`${e.title} | ${e.company}${e.location ? ' | ' + e.location : ''}${e.start ? ' | ' + e.start + ' – ' + (e.end ?? '') : ''}`)
      for (const b of e.bullets) parts.push('• ' + b)
    }
  }
  if (r.education.length) {
    parts.push('\nEDUCATION')
    for (const e of r.education) parts.push([e.degree, e.field, e.school, e.date].filter(Boolean).join(', '))
  }
  if (r.certifications.length) parts.push('\nCERTIFICATIONS\n' + r.certifications.join('\n'))
  for (const o of r.other) parts.push(`\n${o.heading.toUpperCase()}\n${o.lines.join('\n')}`)
  return parts.filter(Boolean).join('\n')
}

export function emptyResume(): ResumeStructured {
  return { contact: { name: '', links: [] }, skills: [], toolkit: [], experience: [], education: [], certifications: [], other: [] }
}
