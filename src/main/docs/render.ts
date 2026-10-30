// Word (.docx) output: ATS-friendly single-column resume, federal resume, and cover letters.

import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from 'docx'
import type { Profile, ResumeStructured } from '@shared/types'

const FONT = 'Calibri'
const RIGHT_TAB = 10080 // twips at the right margin for 8.5in page with 0.75in margins

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '444444', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, font: FONT })]
  })
}

function para(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; after?: number } = {}): Paragraph {
  return new Paragraph({ spacing: { after: opts.after ?? 60 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: opts.size ?? 21, font: FONT })] })
}

function bullet(text: string): Paragraph {
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, size: 21, font: FONT })] })
}

function leftRight(left: string, right: string, bold = false): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
    spacing: { after: 20 },
    children: [new TextRun({ text: left, bold, size: 21, font: FONT }), new TextRun({ text: right ? `\t${right}` : '', size: 21, font: FONT })]
  })
}

function doc(children: Paragraph[]): Document {
  return new Document({
    creator: 'JobSweep',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }]
    },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1080, right: 1080 } } }, children }]
  })
}

function contactLine(r: ResumeStructured): string {
  return [r.contact.location, r.contact.phone, r.contact.email, ...r.contact.links].filter(Boolean).join('  |  ')
}

export function resumeParagraphs(r: ResumeStructured): Paragraph[] {
  const out: Paragraph[] = []
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: r.contact.name, bold: true, size: 36, font: FONT })] }))
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: contactLine(r), size: 20, font: FONT })] }))
  if (r.headline) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: r.headline, bold: true, size: 24, font: FONT })] }))
  if (r.summary) {
    out.push(heading('Summary'))
    out.push(para(r.summary))
  }
  if (r.skills.length || r.toolkit.length) {
    out.push(heading('Skills'))
    if (r.skills.length) out.push(para(r.skills.join(', ')))
    if (r.toolkit.length) out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Technical: ', bold: true, size: 21, font: FONT }), new TextRun({ text: r.toolkit.join(', '), size: 21, font: FONT })] }))
  }
  if (r.experience.length) {
    out.push(heading('Professional Experience'))
    for (const e of r.experience) {
      out.push(leftRight(e.title || e.company, [e.start, e.end].filter(Boolean).join(' – '), true))
      out.push(leftRight(e.title ? e.company : '', e.location ?? ''))
      for (const b of e.bullets) out.push(bullet(b))
      out.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
    }
  }
  if (r.education.length) {
    out.push(heading('Education'))
    for (const e of r.education) {
      out.push(leftRight(e.school, e.date ?? '', true))
      const deg = [e.degree, e.field].filter(Boolean).join(', ')
      if (deg) out.push(leftRight(deg, e.location ?? ''))
      for (const d of e.details) out.push(bullet(d))
    }
  }
  if (r.certifications.length) {
    out.push(heading('Certifications'))
    for (const c of r.certifications) out.push(bullet(c))
  }
  for (const o of r.other) {
    out.push(heading(o.heading))
    for (const l of o.lines) out.push(bullet(l))
  }
  return out
}

export async function resumeDocx(r: ResumeStructured): Promise<Buffer> {
  return Packer.toBuffer(doc(resumeParagraphs(r)))
}

/** USAJOBS-style federal resume: longer, with hours, salary, supervisor, and full addresses per job. */
export async function federalDocx(r: ResumeStructured, profile: Profile): Promise<Buffer> {
  const out: Paragraph[] = []
  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: r.contact.name, bold: true, size: 32, font: FONT })] }))
  out.push(para([profile.city && `${profile.city}, ${profile.state} ${profile.zip ?? ''}`.trim(), r.contact.phone, r.contact.email].filter(Boolean).join('  |  ')))
  if (profile.federal.citizenship) out.push(para(`Citizenship: ${profile.federal.citizenship}`))
  if (profile.federal.veteranPreference) out.push(para(`Veterans' Preference: ${profile.federal.veteranPreference}`))
  if (r.summary) {
    out.push(heading('Professional Summary'))
    out.push(para(r.summary))
  }
  out.push(heading('Work Experience'))
  for (const e of r.experience) {
    const f = profile.federal.jobs[`${e.company}|${e.title}`] ?? {}
    out.push(para(e.title, { bold: true, after: 20 }))
    out.push(para(`${e.company}${f.address ? ', ' + f.address : e.location ? ', ' + e.location : ''}`, { after: 20 }))
    out.push(para(`${e.start ?? ''} – ${e.end ?? ''}  |  ${f.hoursPerWeek ?? 40} hours per week${f.salary ? `  |  Salary: ${f.salary}` : ''}`, { after: 20 }))
    if (f.supervisor) out.push(para(`Supervisor: ${f.supervisor}${f.supervisorPhone ? ` (${f.supervisorPhone})` : ''}  |  May contact: ${f.mayContact === false ? 'No' : 'Yes'}`, { after: 40 }))
    out.push(para('Duties, Accomplishments and Related Skills:', { italic: true, after: 20 }))
    for (const b of e.bullets) out.push(bullet(b))
    out.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
  }
  out.push(heading('Education'))
  for (const e of r.education) {
    out.push(para(e.school, { bold: true, after: 20 }))
    out.push(para([e.degree, e.field, e.date].filter(Boolean).join(' — ') || '', { after: 20 }))
    for (const d of e.details) out.push(bullet(d))
  }
  if (r.skills.length || r.toolkit.length) {
    out.push(heading('Skills'))
    out.push(para([...r.skills, ...r.toolkit].join(', ')))
  }
  if (r.certifications.length) {
    out.push(heading('Certifications'))
    for (const c of r.certifications) out.push(bullet(c))
  }
  return Packer.toBuffer(doc(out))
}

export async function coverLetterDocx(body: string, r: ResumeStructured): Promise<Buffer> {
  const out: Paragraph[] = []
  out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: r.contact.name, bold: true, size: 28, font: FONT })] }))
  out.push(para(contactLine(r), { after: 240 }))
  for (const block of body.split(/\n\s*\n/)) out.push(new Paragraph({ spacing: { after: 200 }, children: block.split('\n').flatMap((l, i) => [...(i ? [new TextRun({ text: '', break: 1 })] : []), new TextRun({ text: l, size: 22, font: FONT })]) }))
  return Packer.toBuffer(doc(out))
}

/** Simple HTML rendering, used for PDF fallback and previews. */
export function resumeHtml(r: ResumeStructured): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const sec = (t: string) => `<h2>${esc(t)}</h2>`
  let h = `<h1>${esc(r.contact.name)}</h1><p class="c">${esc(contactLine(r))}</p>`
  if (r.headline) h += `<p class="hl">${esc(r.headline)}</p>`
  if (r.summary) h += sec('Summary') + `<p>${esc(r.summary)}</p>`
  if (r.skills.length || r.toolkit.length) h += sec('Skills') + `<p>${esc(r.skills.join(', '))}</p>` + (r.toolkit.length ? `<p><b>Technical:</b> ${esc(r.toolkit.join(', '))}</p>` : '')
  if (r.experience.length) {
    h += sec('Professional Experience')
    for (const e of r.experience)
      h += `<div class="row"><b>${esc(e.title || e.company)}</b><span>${esc([e.start, e.end].filter(Boolean).join(' – '))}</span></div><div class="row"><span>${esc(e.title ? e.company : '')}</span><span>${esc(e.location ?? '')}</span></div><ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
  }
  if (r.education.length) {
    h += sec('Education')
    for (const e of r.education) h += `<div class="row"><b>${esc(e.school)}</b><span>${esc(e.date ?? '')}</span></div><div>${esc([e.degree, e.field].filter(Boolean).join(', '))}</div><ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
  }
  if (r.certifications.length) h += sec('Certifications') + `<ul>${r.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
  for (const o of r.other) h += sec(o.heading) + `<ul>${o.lines.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;margin:0.6in 0.75in;color:#111}
  h1{text-align:center;font-size:18pt;margin:0 0 2pt} .c{text-align:center;margin:0 0 6pt} .hl{text-align:center;font-weight:bold;font-size:12pt;margin:0 0 6pt}
  h2{font-size:11pt;text-transform:uppercase;border-bottom:1px solid #444;margin:10pt 0 4pt;padding-bottom:1pt}
  .row{display:flex;justify-content:space-between} ul{margin:2pt 0 6pt 16pt;padding:0} li{margin:0 0 1pt} p{margin:0 0 4pt}
  </style></head><body>${h}</body></html>`
}
