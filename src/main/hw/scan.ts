// Hardware scan (only after the user grants permission) and Ollama management.

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import si from 'systeminformation'
import type { HardwareInfo, ModelTest } from '@shared/types'
import { OLLAMA_URL } from '../ai/providers'

const exec = promisify(execFile)

async function nvidiaSmi(): Promise<{ model: string; vramGB: number }[]> {
  try {
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true })
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, mem] = l.split(',').map((s) => s.trim())
        return { model: name, vramGB: Math.round((Number(mem) / 1024) * 10) / 10 }
      })
  } catch {
    return []
  }
}

/** Windows stores the true VRAM size in the display driver registry key (WMI caps at 4 GB). */
async function registryVram(): Promise<number[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await exec(
      'reg',
      ['query', 'HKLM\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'HardwareInformation.qwMemorySize'],
      { timeout: 8000, windowsHide: true }
    )
    return [...stdout.matchAll(/REG_QWORD\s+0x([0-9a-f]+)/gi)].map((m) => Math.round((parseInt(m[1], 16) / 1024 ** 3) * 10) / 10)
  } catch {
    return []
  }
}

/** Where the Windows installer puts Ollama. Checking the file avoids starting a console process. */
function ollamaExe(): { cli: string; app: string } | null {
  if (process.platform !== 'win32') return null
  const dir = join(process.env.LOCALAPPDATA ?? join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama')
  const cli = join(dir, 'ollama.exe')
  return existsSync(cli) ? { cli, app: join(dir, 'ollama app.exe') } : null
}

async function ollamaRunning(): Promise<string[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (r.ok) return (((await r.json()) as { models?: { name: string }[] }).models ?? []).map((m) => m.name)
  } catch {
    /* not running */
  }
  return null
}

export async function ollamaState(): Promise<{ installed: boolean; running: boolean; models: string[] }> {
  const models = await ollamaRunning()
  if (models) return { installed: true, running: true, models }
  let installed = false
  if (process.platform === 'win32') installed = !!ollamaExe()
  else {
    try {
      await exec('ollama', ['--version'], { timeout: 4000 })
      installed = true
    } catch {
      installed = false
    }
  }
  return { installed, running: false, models: [] }
}

export async function scanHardware(): Promise<HardwareInfo> {
  // One hidden PowerShell session serves every query instead of a new window per query.
  if (process.platform === 'win32') si.powerShellStart()
  let cpu, mem, graphics, disks, osInfo, smi, reg, ol
  try {
    ;[cpu, mem, graphics, disks, osInfo, smi, reg, ol] = await Promise.all([si.cpu(), si.mem(), si.graphics(), si.fsSize(), si.osInfo(), nvidiaSmi(), registryVram(), ollamaState()])
  } finally {
    if (process.platform === 'win32') si.powerShellRelease()
  }
  const gpus = graphics.controllers
    .filter((c) => !/basic display|microsoft remote|virtual/i.test(c.model))
    .map((c, i) => {
      const smiMatch = smi.find((s) => c.model && s.model.toLowerCase().includes(c.model.toLowerCase().replace(/nvidia\s*/i, '').trim().slice(0, 10)))
      const regVal = reg[i]
      const vram = Math.max(smiMatch?.vramGB ?? 0, regVal ?? 0, Math.round(((c.vram ?? 0) / 1024) * 10) / 10)
      return { model: c.model, vendor: c.vendor, vramGB: vram }
    })
  for (const s of smi) if (!gpus.some((g) => g.model.includes(s.model) || s.model.includes(g.model))) gpus.push({ model: s.model, vendor: 'NVIDIA', vramGB: s.vramGB })
  const home = os.homedir().slice(0, 2).toUpperCase()
  const disk = disks.find((d) => d.mount.toUpperCase().startsWith(home)) ?? disks.sort((a, b) => b.available - a.available)[0]
  return {
    os: `${osInfo.distro} ${osInfo.release}`.trim(),
    cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cores: cpu.physicalCores || cpu.cores,
    ramGB: Math.round(mem.total / 1024 ** 3),
    gpus,
    freeDiskGB: disk ? Math.round(disk.available / 1024 ** 3) : 0,
    ollamaInstalled: ol.installed,
    ollamaRunning: ol.running,
    installedModels: ol.models
  }
}

/** Install Ollama with winget (user approves in the app first). */
export async function installOllama(onLine: (l: string) => void): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'win32') return { ok: false, message: 'Automatic install is only available on Windows. Get Ollama from https://ollama.com/download' }
  return new Promise((resolve) => {
    const p = spawn('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--silent', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements'], { windowsHide: true })
    p.stdout.on('data', (d) => onLine(String(d)))
    p.stderr.on('data', (d) => onLine(String(d)))
    p.on('error', (e) => resolve({ ok: false, message: `winget not available (${e.message}). Download Ollama from https://ollama.com/download` }))
    p.on('close', (code) => resolve(code === 0 ? { ok: true, message: 'Ollama installed. It starts automatically; if not, open "Ollama" from the Start menu.' } : { ok: false, message: `winget exited with code ${code}` }))
  })
}

export async function startOllama(): Promise<boolean> {
  if (await ollamaRunning()) return true
  try {
    const exe = ollamaExe()
    // Ollama starts a console program for every model it loads. If the server itself has no console (which is what
    // windowsHide or detached give it), each of those opens its own visible window. The tray app avoids this; failing
    // that, Start-Process -WindowStyle Hidden gives the server a hidden console that its children share.
    const p =
      exe && existsSync(exe.app)
        ? spawn(exe.app, [], { detached: true, stdio: 'ignore' })
        : process.platform === 'win32'
          ? spawn(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -WindowStyle Hidden -FilePath '${(exe?.cli ?? 'ollama').replace(/'/g, "''")}' -ArgumentList 'serve'`],
              { stdio: 'ignore', windowsHide: true }
            )
          : spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' })
    p.on('error', () => {})
    p.unref()
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await ollamaRunning()) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/** Pull a model with streaming progress. */
export async function pullModel(tag: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void): Promise<void> {
  const r = await fetch(`${OLLAMA_URL}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag, stream: true }) })
  if (!r.ok || !r.body) throw new Error(`Pull failed: ${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { status: string; completed?: number; total?: number; error?: string }
      if (msg.error) throw new Error(msg.error)
      onProgress(msg)
    }
  }
}

export async function deleteModel(tag: string): Promise<void> {
  await fetch(`${OLLAMA_URL}/api/delete`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag }) })
}

/**
 * Benchmark: a realistic extraction task. Returns whether the output was valid JSON, plus how long loading the model
 * from disk took versus answering, since the first run after an install or restart is mostly loading.
 */
export async function benchmark(tag: string, numCtx = 16384): Promise<Omit<ModelTest, 'at'>> {
  // Unload any copy already in memory first. One loaded with a different context size (another app, or Ollama's own
  // default) would otherwise stay on the graphics card next to the test copy and run it out of memory.
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag, keep_alive: 0 }), signal: AbortSignal.timeout(15000) })
  } catch {
    /* not loaded, or Ollama will report the real problem below */
  }
  const t0 = Date.now()
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: tag,
        stream: false,
        format: 'json',
        options: { num_ctx: numCtx, temperature: 0 },
        messages: [
          { role: 'system', content: 'Extract job details as JSON with keys title, company, location, pay_min, pay_max, skills (array).' },
          {
            role: 'user',
            content:
              'Operations Analyst — Acme Logistics, Greensboro NC (hybrid). $58,000–$66,000/yr. You will build Power BI dashboards, write SQL, improve warehouse processes, and present findings to stakeholders. Requirements: 2+ years analytics, Excel, SQL, Power BI. Preferred: SAP.'
          }
        ]
      })
    })
    const data = (await r.json()) as { message?: { content: string }; error?: string; eval_count?: number; eval_duration?: number; load_duration?: number }
    if (data.error) throw new Error(data.error)
    const seconds = (Date.now() - t0) / 1000
    const loadSeconds = data.load_duration ? Math.round(data.load_duration / 1e8) / 10 : 0
    const answerSeconds = Math.max(0, Math.round((seconds - loadSeconds) * 10) / 10)
    const tps = data.eval_count && data.eval_duration ? Math.round((data.eval_count / data.eval_duration) * 1e9) : null
    const parsed = JSON.parse(data.message?.content ?? '{}') as { title?: string; skills?: string[] }
    const ok = !!parsed.title && Array.isArray(parsed.skills)
    return { ok, seconds, loadSeconds, answerSeconds, tokensPerSec: tps, message: ok ? `Extracted "${parsed.title}" with ${parsed.skills!.length} skills.` : 'Model answered but the JSON was incomplete.' }
  } catch (e) {
    const raw = (e as Error).message
    const message = /out of memory|out-of-memory|unable to allocate|CUDA\w* buffer/i.test(raw)
      ? 'Not enough free graphics memory to load this model. Close games or other AI apps using the graphics card and try again, or pick a smaller model.'
      : raw
    return { ok: false, seconds: (Date.now() - t0) / 1000, loadSeconds: 0, answerSeconds: 0, tokensPerSec: null, message }
  }
}

/** Freedom mode: search Hugging Face for uncensored GGUF models that fit in VRAM. */
export async function hfUncensoredSearch(maxGB: number): Promise<{ id: string; tag: string; downloads: number; likes: number; sizeHint: string }[]> {
  const out: { id: string; tag: string; downloads: number; likes: number; sizeHint: string }[] = []
  for (const q of ['abliterated gguf', 'uncensored gguf']) {
    try {
      const r = await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=40`, { signal: AbortSignal.timeout(10000) })
      const list = (await r.json()) as { id: string; downloads: number; likes: number }[]
      for (const m of list) {
        const size = /(\d+(\.\d+)?)\s*b\b/i.exec(m.id.replace(/[-_]/g, ' '))
        const params = size ? Number(size[1]) : null
        // Q4_K_M needs ~0.62 GB per billion params plus context.
        if (params && params * 0.62 + 1.5 > maxGB) continue
        if (out.some((o) => o.id === m.id)) continue
        out.push({ id: m.id, tag: `hf.co/${m.id}`, downloads: m.downloads, likes: m.likes, sizeHint: params ? `${params}B` : 'size unknown' })
      }
    } catch {
      /* offline */
    }
  }
  return out.sort((a, b) => b.downloads - a.downloads).slice(0, 15)
}
