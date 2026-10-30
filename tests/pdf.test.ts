import { existsSync, readFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { pdfText } from '../src/main/docs/import'
import { parseResumeText } from '@core/resume/parse'

const pdf = '/root/.claude/uploads/a8d28b7b-e882-5c5b-bc36-3eb277ebf0fe/3a01915a-Resume_2025-12-15.pdf.pdf'
it.skipIf(!existsSync(pdf))('reads the owner PDF', async () => {
  const text = await pdfText(readFileSync(pdf))
  const r = parseResumeText(text)
  console.log(text.split('\n').slice(0, 30).join('\n'))
  console.log(r.experience.map((e) => `${e.company} | ${e.title} | ${e.location} | ${e.start}-${e.end} | ${e.bullets.length}`).join('\n'))
  expect(r.experience.length).toBe(4)
})
