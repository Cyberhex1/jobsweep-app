// Site Learning: test-fill an application without submitting, show results, learn from feedback.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Job, SiteRecipe, SiteTestResult } from '@shared/types'
import { detectPlatform } from '@core/platform'
import { normalize } from '@core/text'
import type { Db } from './db'
import type { AiRouter } from './ai/router'
import { aiFeedbackToMappings, aiReadScreenshot } from './ai/tasks'
import { ApplyEngine } from './automation/engine'
import type { BrowserManager } from './automation/browser'
import { resumeDocx } from './docs/render'

export function scopeFor(url: string): string {
  const p = detectPlatform(url)
  return p === 'generic' ? new URL(url).hostname : p
}

export class SiteLearning {
  private engine: ApplyEngine

  constructor(
    private db: Db,
    private ai: AiRouter,
    browser: BrowserManager,
    private dataDir: string,
    onStatus: (m: string) => void
  ) {
    this.engine = new ApplyEngine({
      db,
      browser,
      ai,
      screenshotsDir: join(dataDir, 'screenshots', 'learning'),
      onStatus,
      documents: async () => {
        const v = db.defaultVersion()
        const dir = join(dataDir, 'documents', 'learning')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, 'Resume.docx')
        if (v) writeFileSync(path, await resumeDocx(v.data))
        else writeFileSync(path, '')
        return { resumeDocx: path, resumePdf: async () => path, coverLetter: async () => null }
      }
    })
  }

  async test(url: string, screenshots: string[] = []): Promise<{ scope: string; recipe: SiteRecipe; expectedMissing: string[] }> {
    const scope = scopeFor(url)
    const fakeJob: Job = {
      id: 0,
      source: 'learning',
      externalId: url,
      url,
      applyUrl: url,
      company: new URL(url).hostname,
      title: 'Test application',
      location: '',
      remoteType: 'unknown',
      description: '',
      firstSeen: new Date().toISOString(),
      fingerprint: '',
      matchScore: 0,
      interviewScore: 0,
      scamScore: 0,
      scamReasons: [],
      blocked: false,
      dismissed: false,
      saved: false,
      sightings: [],
      matchReasons: [],
      missingKeywords: [],
      offField: false
    }
    const out = await this.engine.run(fakeJob, 'dry')
    const result: SiteTestResult = {
      url,
      at: new Date().toISOString(),
      pages: out.pages,
      errors: out.reason && out.status !== 'tested' ? [out.reason] : [],
      submitBlocked: true
    }
    // Compare against fields seen in user-provided screenshots.
    const expectedMissing: string[] = []
    if (screenshots.length && (await this.ai.hasAny())) {
      const seen = new Set(out.pages.flatMap((p) => p.fields.map((f) => normalize(f.label))))
      for (const s of screenshots) {
        try {
          const fields = await aiReadScreenshot(this.ai, readFileSync(s))
          for (const f of fields) if (![...seen].some((x) => x.includes(normalize(f.label)) || normalize(f.label).includes(x))) expectedMissing.push(f.label)
        } catch {
          /* vision unavailable */
        }
      }
    }
    const recipe = this.db.saveRecipe(scope, { lastTest: result, approved: false })
    return { scope, recipe, expectedMissing }
  }

  /** Apply plain-language feedback ("salary got my hourly rate") and re-test. */
  async feedback(scope: string, text: string, manual?: Record<string, string>) {
    const recipe = this.db.getRecipe(scope)
    if (!recipe?.lastTest) throw new Error('Run a test first.')
    const mappings = { ...recipe.mappings }
    const notes = [...recipe.notes]
    if (manual) for (const [label, key] of Object.entries(manual)) mappings[normalize(label)] = key
    if (text.trim()) {
      const fields = recipe.lastTest.pages.flatMap((p) => p.fields.map((f) => ({ label: f.label, key: f.key, value: f.value })))
      const fix = await aiFeedbackToMappings(this.ai, text, fields)
      for (const [label, key] of Object.entries(fix.mappings)) mappings[normalize(label)] = key
      notes.push(...fix.notes)
    }
    this.db.saveRecipe(scope, { mappings, notes })
    return this.test(recipe.lastTest.url)
  }

  approve(scope: string) {
    return this.db.saveRecipe(scope, { approved: true })
  }
}
