import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { it, expect } from 'vitest'
import { parseResumeText } from '@core/resume/parse'
import { applyAtsFixes } from '@core/resume/fixes'
import { lintResume } from '@core/resume/atsLint'
import { resumeDocx, coverLetterDocx, federalDocx } from '../src/main/docs/render'
import { importDocx } from '../src/main/docs/import'
import { docxToPdf } from '../src/main/docs/convert'
import { EMPTY_PROFILE } from '@shared/defaults'

it('round-trips an ATS docx and converts to PDF', async () => {
  const r = applyAtsFixes(parseResumeText(readFileSync('tests/fixtures/sample-resume.txt', 'utf8')))
  const buf = await resumeDocx(r)
  const dir = mkdtempSync(join(tmpdir(), 'js-'))
  const path = join(dir, 'ats.docx')
  writeFileSync(path, buf)
  const back = await importDocx(buf)
  expect(back.docx?.hasTables).toBe(false)
  const parsed = parseResumeText(back.text)
  expect(parsed.contact.name).toBe('Jordan Sample')
  expect(parsed.experience.map((e) => e.company)).toEqual(['Acme Logistics', 'Blue Ridge Supply'])
  expect(parsed.experience[0].bullets.length).toBe(4)
  const ids = lintResume({ rawText: back.text, data: parsed, docx: back.docx }).map((f) => f.id)
  expect(ids).not.toContain('invisible-chars')
  expect(ids).not.toContain('soft-skill-padding')
  writeFileSync(join(dir, 'cl.docx'), await coverLetterDocx('Dear Hiring Manager,\n\nHello there.\n\nSincerely,\nJordan', r))
  writeFileSync(join(dir, 'fed.docx'), await federalDocx(r, { ...EMPTY_PROFILE, city: 'Raleigh', state: 'NC' }))
  const pdf = await docxToPdf(path)
  // Word on Windows, LibreOffice elsewhere. Either is a real conversion.
  expect(['word', 'libreoffice']).toContain(pdf.via)
  expect(readFileSync(pdf.path).subarray(0, 5).toString()).toBe('%PDF-')
}, 120000)
