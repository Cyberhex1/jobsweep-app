// Cover letter templating: the user's own template, lightly adapted. AI tweaks are limited and fact-checked.

import { changeRatio, wordDiff, type DiffPart } from './diff'
import { truthCheck, type Violation } from './truthGuard'

export interface CoverLetterVars {
  company: string
  role: string
  hiringManager?: string
  date?: string
  name?: string
}

/** Fill {{company}}, {{role}}, {{hiring_manager}}, {{date}}, {{name}} placeholders. */
export function fillTemplate(template: string, v: CoverLetterVars): string {
  const date = v.date ?? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return template
    .replace(/\{\{\s*company\s*\}\}/gi, v.company)
    .replace(/\{\{\s*(role|position|title)\s*\}\}/gi, v.role)
    .replace(/\{\{\s*hiring_manager\s*\}\}/gi, v.hiringManager ?? 'Hiring Manager')
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .replace(/\{\{\s*name\s*\}\}/gi, v.name ?? '')
}

export const MAX_CHANGE = 0.3

export function checkTweak(base: string, tweaked: string, sourceFacts: string): { ok: boolean; ratio: number; violations: Violation[]; diff: DiffPart[] } {
  const ratio = changeRatio(base, tweaked)
  const violations = truthCheck(tweaked, sourceFacts + '\n' + base)
  return { ok: ratio <= MAX_CHANGE && violations.length === 0, ratio, violations, diff: wordDiff(base, tweaked) }
}

export const DEFAULT_TEMPLATE = `{{date}}

Dear {{hiring_manager}},

I'm excited to apply for the {{role}} position at {{company}}. [Write 2–3 sentences about who you are and the kind of work you do best.]

[Write a paragraph with one or two real accomplishments you're proud of. JobSweep will adjust this paragraph to fit each job, using only facts from your resume.]

[Write a closing sentence about why you'd like to work there and how to reach you.]

Sincerely,
{{name}}`
