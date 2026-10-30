// AI provider clients. All plain fetch calls — no SDKs — so they behave the same everywhere.

import type { AiProviderId } from '@shared/types'

export interface ChatRequest {
  system: string
  prompt: string
  json?: boolean
  images?: { mime: string; base64: string }[]
  maxTokens?: number
  temperature?: number
}

export interface Provider {
  id: AiProviderId
  local: boolean
  available(): Promise<boolean>
  chat(req: ChatRequest, model: string): Promise<string>
  embed?(texts: string[], model: string): Promise<number[][]>
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 120000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal })
    const text = await r.text()
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(t)
  }
}

export const OLLAMA_URL = 'http://127.0.0.1:11434'

/** Installed Ollama model names, or null when Ollama isn't running. */
export async function ollamaModels(): Promise<string[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    return (((await r.json()) as { models?: { name: string }[] }).models ?? []).map((m) => m.name)
  } catch {
    return null
  }
}

/** Ollama reports untagged models as "name:latest". */
export function sameOllamaModel(a: string, b: string): boolean {
  const norm = (x: string) => (x.includes(':') ? x : `${x}:latest`)
  return !!a && !!b && norm(a) === norm(b)
}

export function ollamaProvider(numCtx: () => number): Provider {
  return {
    id: 'ollama',
    local: true,
    async available() {
      try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })
        return r.ok
      } catch {
        return false
      }
    },
    async chat(req, model) {
      const res = await post(
        `${OLLAMA_URL}/api/chat`,
        {
          model,
          stream: false,
          format: req.json ? 'json' : undefined,
          options: { num_ctx: numCtx(), temperature: req.temperature ?? 0.3 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt, images: req.images?.map((i) => i.base64) }
          ]
        },
        {},
        300000
      )
      return String(res.message?.content ?? '')
    },
    async embed(texts, model) {
      const res = await post(`${OLLAMA_URL}/api/embed`, { model, input: texts }, {}, 120000)
      return res.embeddings as number[][]
    }
  }
}

export function geminiProvider(key: () => string | null): Provider {
  return {
    id: 'gemini',
    local: false,
    async available() {
      return !!key()
    },
    async chat(req, model) {
      const parts: any[] = [{ text: req.prompt }]
      for (const img of req.images ?? []) parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } })
      const res = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: req.temperature ?? 0.3, maxOutputTokens: req.maxTokens ?? 4096, ...(req.json ? { responseMimeType: 'application/json' } : {}) }
        },
        { 'x-goog-api-key': key() ?? '' }
      )
      return (res.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
    }
  }
}

export async function geminiModels(key: string): Promise<string[]> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })
  if (!r.ok) throw new Error(`Gemini key check failed (${r.status})`)
  const data = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  return (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
}

/** Prefer the newest "flash" model (free tier) that isn't an experimental/preview/image/tts variant. */
export function pickGeminiModel(models: string[]): string | null {
  const flash = models.filter((m) => /flash/.test(m) && !/(preview|exp|image|tts|live|audio|thinking|lite)/.test(m))
  const ver = (m: string) => Number(/gemini-(\d+(\.\d+)?)/.exec(m)?.[1] ?? 0)
  return flash.sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0] ?? models.find((m) => /flash/.test(m)) ?? null
}

function openAiCompatible(id: AiProviderId, baseUrl: string, key: () => string | null, extraHeaders: Record<string, string> = {}): Provider {
  return {
    id,
    local: false,
    async available() {
      return !!key()
    },
    async chat(req, model) {
      const content: any[] = [{ type: 'text', text: req.prompt }]
      for (const img of req.images ?? []) content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })
      const res = await post(
        `${baseUrl}/chat/completions`,
        {
          model,
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxTokens ?? 4096,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.images?.length ? content : req.prompt }
          ]
        },
        { authorization: `Bearer ${key() ?? ''}`, ...extraHeaders }
      )
      return String(res.choices?.[0]?.message?.content ?? '')
    }
  }
}

export const openrouterProvider = (key: () => string | null) => openAiCompatible('openrouter', 'https://openrouter.ai/api/v1', key, { 'HTTP-Referer': 'https://github.com/Cyberhex1/jobsweep-app', 'X-Title': 'JobSweep' })
export const openaiProvider = (key: () => string | null) => openAiCompatible('openai', 'https://api.openai.com/v1', key)

/** DeepSeek's API is OpenAI-compatible. Its JSON mode needs the word "json" in the prompt, and it takes no images. */
export function deepseekProvider(key: () => string | null): Provider {
  const base = openAiCompatible('deepseek', 'https://api.deepseek.com', key)
  return {
    ...base,
    chat: (req, model) => base.chat({ ...req, images: undefined, prompt: req.json ? req.prompt + '\n\nRespond with json only.' : req.prompt }, model)
  }
}

export function anthropicProvider(key: () => string | null): Provider {
  return {
    id: 'anthropic',
    local: false,
    async available() {
      return !!key()
    },
    async chat(req, model) {
      const content: any[] = []
      for (const img of req.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })
      content.push({ type: 'text', text: req.prompt + (req.json ? '\n\nRespond with JSON only.' : '') })
      const res = await post(
        'https://api.anthropic.com/v1/messages',
        { model, max_tokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.3, system: req.system, messages: [{ role: 'user', content }] },
        { 'x-api-key': key() ?? '', 'anthropic-version': '2023-06-01' }
      )
      return (res.content ?? []).map((c: any) => c.text ?? '').join('')
    }
  }
}

/** Pull the first JSON object/array out of a model response. */
export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.search(/[[{]/)
    if (start < 0) throw new Error('No JSON in model response')
    const open = cleaned[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inStr) {
        if (ch === '\\') i++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T
    }
    throw new Error('Unterminated JSON in model response')
  }
}
