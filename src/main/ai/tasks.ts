// AI tasks with versioned prompts. Every output is validated before use.

import { z } from 'zod'
import type { EmailClass, FormField, ResumeStructured } from '@shared/types'
import { resumeToText } from '@core/resume/parse'
import { KEY_RULES } from '@core/fields'
import type { TailorOp } from '@core/tailor'
import type { AiRouter } from './router'

const HONESTY =
  'Never invent facts. Only use employers, titles, dates, numbers, tools, skills, and credentials that appear in the source material. Rewording and reordering is fine; adding new claims is not.'

const TailorSchema = z.object({
  headline: z.string().optional(),
  summary: z.string().optional(),
  skills_order: z.array(z.string()).optional(),
  bullets: z.array(z.object({ job: z.number().int(), bullet: z.number().int(), text: z.string() })).optional(),
  reorder: z.array(z.object({ job: z.number().int(), order: z.array(z.number().int()) })).optional()
})

export async function aiTailor(ai: AiRouter, resume: ResumeStructured, job: { title: string; company: string; description: string }): Promise<TailorOp[]> {
  const jobs = resume.experience.map((e, i) => `JOB ${i}: ${e.title} at ${e.company}\n${e.bullets.map((b, k) => `  [${k}] ${b}`).join('\n')}`).join('\n\n')
  const raw = await ai.json<unknown>({
    task: 'write',
    system: `You tailor resumes to job postings. ${HONESTY} Output JSON only.`,
    prompt: `JOB POSTING: ${job.title} at ${job.company}
${job.description.slice(0, 6000)}

RESUME HEADLINE: ${resume.headline ?? ''}
SUMMARY: ${resume.summary ?? ''}
SKILLS: ${resume.skills.join(', ')}

${jobs}

Return JSON:
{
 "headline": "target title line using only titles/skills from the resume",
 "summary": "2-3 sentence summary emphasizing what matches the posting (no new facts)",
 "skills_order": ["skills from the SKILLS list, most relevant first"],
 "bullets": [{"job": 0, "bullet": 1, "text": "rephrased bullet using posting keywords where truthful"}],
 "reorder": [{"job": 0, "order": [2,0,1]}]
}
Rephrase at most 6 bullets total. Keep every number exactly as written.`
  })
  const p = TailorSchema.parse(raw)
  const ops: TailorOp[] = []
  if (p.headline) ops.push({ op: 'headline', text: p.headline })
  if (p.summary) ops.push({ op: 'summary', text: p.summary })
  if (p.skills_order) ops.push({ op: 'skills_order', skills: p.skills_order })
  for (const b of p.bullets ?? []) ops.push({ op: 'rephrase_bullet', job: b.job, bullet: b.bullet, text: b.text })
  for (const r of p.reorder ?? []) ops.push({ op: 'reorder_bullets', job: r.job, order: r.order })
  return ops
}

export async function aiTweakCoverLetter(ai: AiRouter, base: string, resume: ResumeStructured, job: { title: string; company: string; description: string }): Promise<string> {
  const r = await ai.run({
    task: 'write',
    system: `You lightly adapt a cover letter the candidate wrote themselves. Keep their voice, structure, and most sentences unchanged. Change at most 25% of the words. ${HONESTY} Output only the final letter text.`,
    prompt: `CANDIDATE'S LETTER:
${base}

RESUME FACTS:
${resumeToText(resume).slice(0, 5000)}

JOB: ${job.title} at ${job.company}
${job.description.slice(0, 4000)}

Adjust only what's needed so the letter fits this job (company/role references, which true accomplishment is highlighted, one sentence connecting to the posting).`,
    temperature: 0.4
  })
  return r.text.trim().replace(/^```\w*|```$/g, '').trim()
}

export async function aiDraftAnswer(ai: AiRouter, question: string, resume: ResumeStructured | null, job?: { title: string; company: string; description: string }): Promise<string> {
  const r = await ai.run({
    task: 'write',
    system: `You draft short, natural answers to job application questions for the candidate. ${HONESTY} If the question needs personal information you don't have (e.g. salary history, demographic data, legal history), reply exactly: NEEDS_USER`,
    prompt: `QUESTION: ${question}
${job ? `JOB: ${job.title} at ${job.company}\n${job.description.slice(0, 2500)}` : ''}
RESUME:
${resume ? resumeToText(resume).slice(0, 4000) : '(none)'}

Answer in the candidate's voice in 1-4 sentences (or a single word/number if the question calls for it).`
  })
  return r.text.trim()
}

const MapSchema = z.record(z.string(), z.string())

/** Map unknown field labels to known keys (or "unknown"). */
export async function aiMapFields(ai: AiRouter, fields: FormField[]): Promise<Record<string, string>> {
  if (!fields.length) return {}
  const keys = KEY_RULES.map((k) => k.key).join(', ')
  const raw = await ai.json<unknown>({
    task: 'classify',
    system: 'You label job-application form fields. Output JSON only.',
    prompt: `Known keys: ${keys}
For each field label below, return the best key, or "question" if it's a free-text/custom question, or "unknown".
Fields:
${fields.map((f, i) => `${i}: "${f.label}" (type ${f.type}${f.options.length ? `, options: ${f.options.slice(0, 8).join(' / ')}` : ''})`).join('\n')}
Return JSON object mapping index (as string) to key, e.g. {"0":"first_name","1":"question"}.`,
    privacy: 'normal'
  })
  return MapSchema.parse(raw)
}

export async function aiClassifyEmail(ai: AiRouter, e: { from: string; subject: string; text: string }): Promise<EmailClass> {
  const r = await ai.json<{ class: EmailClass }>({
    task: 'classify',
    system: 'Classify job-search emails. Output JSON only.',
    prompt: `Classes: verification, confirmation, rejection, interview, assessment, recruiter, offer, other.
FROM: ${e.from}
SUBJECT: ${e.subject}
BODY: ${e.text.slice(0, 2500)}
Return {"class": "..."}.`,
    privacy: 'private'
  })
  return r.class
}

const FeedbackSchema = z.object({ mappings: z.record(z.string(), z.string()), notes: z.array(z.string()).default([]) })

/** Turn plain-language feedback from a site test into mapping overrides. */
export async function aiFeedbackToMappings(ai: AiRouter, feedback: string, fields: { label: string; key: string | null; value: string }[]) {
  const keys = KEY_RULES.map((k) => k.key).join(', ')
  return FeedbackSchema.parse(
    await ai.json<unknown>({
      task: 'extract',
      system: 'You fix form-filling rules from user feedback. Output JSON only.',
      prompt: `Known keys: ${keys}
Fields from the last test (label -> key used -> value filled):
${fields.map((f) => `"${f.label}" -> ${f.key ?? 'none'} -> "${f.value}"`).join('\n')}

USER FEEDBACK: ${feedback}

Return {"mappings": {"<exact field label>": "<key>" or "=<literal value>" or "skip"}, "notes": ["short note of what changed"]}`
    })
  )
}

/** Read a screenshot of an application form: list the visible fields. */
export async function aiReadScreenshot(ai: AiRouter, png: Buffer): Promise<{ label: string; type: string; required: boolean }[]> {
  const raw = await ai.json<{ fields?: { label: string; type: string; required?: boolean }[] }>({
    task: 'vision',
    system: 'You read screenshots of job application forms. Output JSON only.',
    prompt: 'List every form field visible: {"fields":[{"label":"First Name","type":"text|email|select|radio|checkbox|file|textarea|date","required":true}]}',
    images: [{ mime: 'image/png', base64: png.toString('base64') }]
  })
  return (raw.fields ?? []).map((f) => ({ label: f.label, type: f.type, required: !!f.required }))
}

const ImproveSchema = z.object({
  suggestions: z.array(z.object({ job: z.number().int(), bullet: z.number().int(), text: z.string(), why: z.string(), remove: z.array(z.number().int()).optional() }))
})

/** Bullet rewrites. `issues` are ATS check findings to address first (e.g. two similar bullets to merge). */
export async function aiImproveBullets(ai: AiRouter, resume: ResumeStructured, issues: string[] = []) {
  const jobs = resume.experience.map((e, i) => `JOB ${i}: ${e.title} at ${e.company}\n${e.bullets.map((b, k) => `  [${k}] ${b}`).join('\n')}`).join('\n\n')
  const fix = issues.length
    ? `\n\nThe ATS check found these problems. Suggest a fix for each one first:\n${issues.map((i) => `- ${i}`).join('\n')}\nTo merge two similar bullets, rewrite the first one as the merged bullet and list the other's index in "remove".`
    : ''
  return ImproveSchema.parse(
    await ai.json<unknown>({
      task: 'write',
      system: `You are a resume coach. Suggest stronger wording for weak bullets: lead with an action verb, make impact clear, keep it to one line. ${HONESTY} Output JSON only.`,
      prompt: `${jobs}${fix}\n\nReturn {"suggestions":[{"job":0,"bullet":2,"text":"improved bullet","why":"short reason","remove":[]}]} for up to 8 bullets, the ATS problems first, then the weakest bullets.`
    })
  ).suggestions
}

/** Structure a resume with AI when the rule-based parser struggles (unusual layouts). */
export async function aiStructureResume(ai: AiRouter, raw: string): Promise<ResumeStructured> {
  const r = await ai.json<ResumeStructured>({
    task: 'extract',
    system: 'You convert resume text into structured JSON exactly as written. Do not rewrite or add anything. Output JSON only.',
    prompt: `Return JSON with keys: contact{name,email,phone,location,links[]}, headline, summary, skills[], toolkit[], experience[{company,title,location,start,end,bullets[]}], education[{school,degree,field,location,date,details[]}], certifications[], other[{heading,lines[]}].

RESUME:
${raw.slice(0, 12000)}`,
    privacy: 'private'
  })
  return {
    ...r,
    skills: r.skills ?? [],
    toolkit: r.toolkit ?? [],
    experience: r.experience ?? [],
    education: r.education ?? [],
    certifications: r.certifications ?? [],
    other: r.other ?? [],
    contact: { ...r.contact, links: r.contact?.links ?? [] }
  }
}
