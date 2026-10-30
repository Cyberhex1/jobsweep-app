// Skill/keyword extraction against the curated skills dictionary, plus role suggestions.

import skillsCatalog from '../../catalog/skills.json'
import rolesCatalog from '../../catalog/roles.json'
import { normalize, stringSimilarity, uniq } from './text'

const SKILLS: Record<string, string[]> = (skillsCatalog as { skills: Record<string, string[]> }).skills
export const ROLE_FIELDS: Record<string, string[]> = (rolesCatalog as { fields: Record<string, string[]> }).fields

// Pre-compile alias regexes once.
const ALIAS_RES: { canonical: string; re: RegExp }[] = Object.entries(SKILLS).flatMap(([canonical, aliases]) =>
  aliases.map((a) => ({
    canonical,
    re: new RegExp(`(^|[^a-z0-9+#])${escapeRe(normalize(a))}($|[^a-z0-9+#])`)
  }))
)

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Canonical skills mentioned in the text. */
export function extractSkills(text: string): string[] {
  const n = ' ' + normalize(text) + ' '
  const found = new Set<string>()
  for (const { canonical, re } of ALIAS_RES) if (re.test(n)) found.add(canonical)
  return [...found]
}

// "Contact Human Resources", "the Human Resources office": how to apply, not a skill the job needs.
const BOILERPLATE_RES = [
  /\b(contact|agency|agency's|office of|department of|division of|dept\.? of)\s+human resources\b/gi,
  /\bhuman resources\s+(office|department|division|staff|representative|team|will|at|for)\b/gi
]
function stripBoilerplate(s: string): string {
  return BOILERPLATE_RES.reduce((t, re) => t.replace(re, ' '), s)
}

/** Weighted skills for a job description: required/qualification sections count more. */
export function jobKeywords(text: string): { skill: string; weight: number }[] {
  const description = stripBoilerplate(text)
  const lower = description.toLowerCase()
  const reqIdx = lower.search(/(requirements|qualifications|what you('| wi)ll need|must have|required skills|minimum qualifications)/)
  const prefIdx = lower.search(/(preferred|nice to have|bonus|desired qualifications)/)
  const all = extractSkills(description)
  return all.map((skill) => {
    let weight = 1
    if (reqIdx >= 0) {
      const req = description.slice(reqIdx, prefIdx > reqIdx ? prefIdx : undefined)
      if (extractSkills(req).includes(skill)) weight = 2
    }
    return { skill, weight }
  })
}

export function allRoles(): { title: string; field: string }[] {
  return Object.entries(ROLE_FIELDS).flatMap(([field, titles]) => titles.map((title) => ({ title, field })))
}

/** Typeahead suggestions; resume titles and skills bias the ranking. */
export function suggestRoles(query: string, context: { resumeTitles?: string[]; skills?: string[]; fields?: string[] } = {}, limit = 8): string[] {
  const q = normalize(query)
  const pool = uniq([...allRoles().map((r) => r.title), ...(context.resumeTitles ?? [])])
  const fieldBoost = new Set(context.fields ?? [])
  const scored = pool.map((title) => {
    const t = normalize(title)
    let s = 0
    if (!q) s = 0.1
    else if (t.startsWith(q)) s = 1
    else if (t.includes(q)) s = 0.8
    else if (t.split(' ').some((w) => w.startsWith(q))) s = 0.7
    else s = stringSimilarity(q, t) * 0.6
    const field = allRoles().find((r) => r.title === title)?.field
    if (field && fieldBoost.has(field)) s += 0.15
    if (context.resumeTitles?.includes(title)) s += 0.1
    return { title, s }
  })
  return scored
    .filter((x) => x.s > 0.3 || !q)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.title)
}

/** Suggest target roles and fields from a resume's skills and past titles. */
export function rolesFromResume(skills: string[], titles: string[]): { roles: string[]; fields: string[] } {
  const canon = new Set(extractSkills(skills.join(', ') + ', ' + titles.join(', ')))
  const signals: Record<string, string[]> = {
    'Project Management': ['project management', 'agile', 'stakeholder management', 'requirements gathering', 'risk management', 'budget tracking', 'microsoft project'],
    Operations: ['process improvement', 'operations management', 'reporting', 'erp systems', 'cross-functional leadership'],
    'Business & Data Analysis': ['data analysis', 'data visualization', 'sql', 'power bi', 'excel', 'statistical analysis', 'python', 'forecasting'],
    'Supply Chain': ['supply chain management', 'erp systems', 'sap', 'forecasting', 'syteline'],
    'IT & Support': ['technical support', 'itil', 'networking', 'windows', 'macos', 'documentation'],
    'Customer Experience': ['customer service'],
    Marketing: ['marketing', 'graphic design']
  }
  const fieldScores = Object.entries(signals)
    .map(([field, sk]) => ({ field, score: sk.filter((s) => canon.has(s)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
  const fields = fieldScores.slice(0, 4).map((x) => x.field)
  const roles = uniq(fields.flatMap((f) => ROLE_FIELDS[f].slice(0, 3)))
  return { roles, fields }
}
