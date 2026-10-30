import { afterEach, describe, expect, it, vi } from 'vitest'
import { deepseekProvider } from '../src/main/ai/providers'

describe('deepseek provider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls the OpenAI-compatible endpoint with the key and asks for json', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const p = deepseekProvider(() => 'sk-test')
    expect(await p.available()).toBe(true)
    const out = await p.chat({ system: 's', prompt: 'p', json: true, images: [{ mime: 'image/png', base64: 'x' }] }, 'deepseek-flash')
    expect(out).toBe('{"ok":true}')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('deepseek-flash')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[1].content).toContain('json')
    expect(typeof body.messages[1].content).toBe('string')
  })

  it('is unavailable without a key', async () => {
    expect(await deepseekProvider(() => null).available()).toBe(false)
  })
})
