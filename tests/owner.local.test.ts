// Runs only on a machine with the owner's resume text in local/ (git-ignored). Skipped elsewhere.
import { existsSync, readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseResumeText } from '@core/resume/parse'
import { lintResume } from '@core/resume/atsLint'

const path = 'local/owner-resume-pdftotext.txt'
describe.skipIf(!existsSync(path))('owner resume', () => {
  it('parses and lints', () => {
    const raw = readFileSync(path, 'utf8')
    const data = parseResumeText(raw)
    const findings = lintResume({ rawText: raw, data })
    
    console.log(findings.map((f) => f.id + ': ' + f.detail).join('\n'))
    expect(data.experience.length).toBeGreaterThanOrEqual(4)
  })
})
