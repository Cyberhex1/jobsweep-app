// AI router: picks a provider per task, scrubs personal info before cloud calls, logs every call.

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AiProviderId, AiTask, Profile, Settings } from '@shared/types'
import { restorePII, scrubPII } from '@core/pii'
import type { Db } from '../db'
import {
  anthropicProvider,
  deepseekProvider,
  geminiModels,
  geminiProvider,
  ollamaModels,
  ollamaProvider,
  sameOllamaModel,
  openaiProvider,
  openrouterProvider,
  parseJsonLoose,
  pickGeminiModel,
  type ChatRequest,
  type Provider
} from './providers'

export interface AiRequest extends ChatRequest {
  task: AiTask
  /** 'private' content only ever goes to local AI. */
  privacy?: 'normal' | 'private'
}

export class NoAiError extends Error {
  constructor() {
    super('No AI is set up yet. Open Maintenance → AI Setup to connect local AI or a cloud AI key.')
  }
}

export class AiRouter {
  private providers: Record<AiProviderId, Provider>

  constructor(private db: Db) {
    this.providers = {
      ollama: ollamaProvider(() => 16384),
      gemini: geminiProvider(() => db.getSecret('key.gemini')),
      openrouter: openrouterProvider(() => db.getSecret('key.openrouter')),
      deepseek: deepseekProvider(() => db.getSecret('key.deepseek')),
      openai: openaiProvider(() => db.getSecret('key.openai')),
      anthropic: anthropicProvider(() => db.getSecret('key.anthropic'))
    }
  }

  private settings(): Settings {
    return this.db.getSettings()
  }

  modelFor(id: AiProviderId, s = this.settings()): string {
    return { ollama: s.ollamaModel, gemini: s.geminiModel, openrouter: s.openrouterModel, deepseek: s.deepseekModel, openai: s.openaiModel, anthropic: s.anthropicModel }[id]
  }

  /** Why local AI can't be used right now, or null when it can. */
  private async ollamaProblem(model: string): Promise<string | null> {
    const models = await ollamaModels()
    if (!models) return 'Ollama isn’t running.'
    if (!models.some((m) => sameOllamaModel(m, model))) return `${model} isn’t installed. Pick an installed model in Maintenance → Local AI.`
    return null
  }

  async status(): Promise<{ id: AiProviderId; configured: boolean; model: string; local: boolean; problem?: string }[]> {
    const s = this.settings()
    const out = []
    for (const id of s.aiOrder) {
      const p = this.providers[id]
      const model = this.modelFor(id, s)
      if (id === 'ollama') {
        const problem = model ? await this.ollamaProblem(model) : null
        out.push({ id, configured: !!model && !problem, model, local: p.local, ...(problem ? { problem } : {}) })
      } else out.push({ id, configured: await p.available(), model, local: p.local })
    }
    return out
  }

  async hasAny(): Promise<boolean> {
    return (await this.status()).some((x) => x.configured)
  }

  async run(req: AiRequest): Promise<{ text: string; provider: AiProviderId; model: string }> {
    const s = this.settings()
    const profile = this.db.getProfile()
    const errors: string[] = []
    for (const id of s.aiOrder) {
      const p = this.providers[id]
      if (req.privacy === 'private' && !p.local) continue
      if (req.images?.length && id === 'ollama' && !/gemma3|llava|vl|vision|mistral-small/i.test(s.ollamaModel)) continue
      if (req.images?.length && id === 'deepseek') continue
      const model = this.modelFor(id, s)
      if (!model) continue
      if (id === 'ollama') {
        const problem = await this.ollamaProblem(model)
        if (problem) {
          if (problem.includes('installed')) errors.push(`ollama: ${problem}`)
          continue
        }
      } else if (!(await p.available())) continue
      const scrub = !p.local
      const { system, prompt, map } = scrub ? this.scrub(req, profile) : { system: req.system, prompt: req.prompt, map: {} }
      const t0 = Date.now()
      try {
        const text = await p.chat({ ...req, system, prompt }, model)
        this.db.logAi({ provider: id, model, task: req.task, ms: Date.now() - t0, ok: true, scrubbed: scrub })
        return { text: restorePII(text, map), provider: id, model }
      } catch (e) {
        const msg = (e as Error).message
        errors.push(`${id}: ${msg}`)
        this.db.logAi({ provider: id, model, task: req.task, ms: Date.now() - t0, ok: false, scrubbed: scrub, error: msg.slice(0, 300) })
      }
    }
    if (errors.length) throw new Error('All AI providers failed:\n' + errors.join('\n'))
    throw new NoAiError()
  }

  async json<T>(req: AiRequest): Promise<T> {
    const r = await this.run({ ...req, json: true })
    return parseJsonLoose<T>(r.text)
  }

  async embed(texts: string[]): Promise<number[][] | null> {
    const s = this.settings()
    const p = this.providers.ollama
    if (!s.ollamaEmbedModel || !(await p.available())) return null
    try {
      return await p.embed!(texts, s.ollamaEmbedModel)
    } catch {
      return null
    }
  }

  private scrub(req: AiRequest, profile: Profile) {
    const known = { name: profile.fullName, email: profile.email, phone: profile.phone }
    const a = scrubPII(req.system, known)
    const b = scrubPII(req.prompt, known)
    return { system: a.text, prompt: b.text, map: { ...a.map, ...b.map } }
  }

  // ---------- key management ----------
  async setKey(id: Exclude<AiProviderId, 'ollama'>, key: string): Promise<{ ok: boolean; message: string }> {
    const k = key.trim()
    if (!k) {
      this.db.setSecret(`key.${id}`, null)
      return { ok: true, message: 'Key removed.' }
    }
    if (id === 'gemini') {
      try {
        const models = await geminiModels(k)
        const pick = pickGeminiModel(models)
        this.db.setSecret('key.gemini', k)
        if (pick) this.db.saveSettings({ geminiModel: pick })
        return { ok: true, message: `Gemini connected. Using ${pick ?? this.settings().geminiModel}.` }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    }
    this.db.setSecret(`key.${id}`, k)
    try {
      await this.providers[id].chat({ system: 'Reply with OK.', prompt: 'Say OK', maxTokens: 5 }, this.modelFor(id))
      return { ok: true, message: 'Connected.' }
    } catch (e) {
      return { ok: false, message: `Saved, but a test call failed: ${(e as Error).message.slice(0, 200)}` }
    }
  }

  async test(id: AiProviderId): Promise<{ ok: boolean; message: string; ms: number }> {
    const t0 = Date.now()
    const model = this.modelFor(id)
    try {
      // Thinking models (Gemini 2.5+, many OpenRouter picks) spend tokens reasoning first, so a tiny cap returns nothing.
      // Any answer at all proves the key, model and connection work.
      const text = (await this.providers[id].chat({ system: 'You are terse.', prompt: 'Reply with the single word: ready', maxTokens: 1024 }, model)).trim()
      const ms = Date.now() - t0
      this.db.logAi({ provider: id, model, task: 'test', ms, ok: !!text, scrubbed: false, error: text ? undefined : 'empty reply' })
      return { ok: !!text, message: text ? `Answered: ${text.slice(0, 60)}` : 'Connected, but the model sent an empty reply. Try another model.', ms }
    } catch (e) {
      const msg = (e as Error).message
      this.db.logAi({ provider: id, model, task: 'test', ms: Date.now() - t0, ok: false, scrubbed: false, error: msg.slice(0, 300) })
      return { ok: false, message: msg.slice(0, 300), ms: Date.now() - t0 }
    }
  }

  /** OpenRouter sign-in with OAuth PKCE and a one-shot localhost callback. */
  async openrouterLogin(openUrl: (url: string) => void): Promise<{ ok: boolean; message: string }> {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    return new Promise((resolve) => {
      const server = createServer(async (req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1')
        const code = u.searchParams.get('code')
        if (!code) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body style="font-family:sans-serif;background:#0b0d12;color:#e8e6df;padding:40px"><h2>JobSweep is connected to OpenRouter.</h2><p>You can close this tab.</p></body></html>')
        server.close()
        try {
          const r = await fetch('https://openrouter.ai/api/v1/auth/keys', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
          })
          const data = (await r.json()) as { key?: string }
          if (!data.key) throw new Error('No key returned')
          this.db.setSecret('key.openrouter', data.key)
          resolve({ ok: true, message: 'OpenRouter connected.' })
        } catch (e) {
          resolve({ ok: false, message: (e as Error).message })
        }
      })
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port
        const cb = `http://localhost:${port}/callback`
        openUrl(`https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256`)
      })
      setTimeout(() => {
        server.close()
        resolve({ ok: false, message: 'Timed out waiting for OpenRouter sign-in.' })
      }, 5 * 60000)
    })
  }
}
