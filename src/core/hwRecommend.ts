// Local model recommender: rank catalog models for the scanned hardware.

import type { HardwareInfo, ModelCatalogEntry, ModelRecommendation } from '@shared/types'

export function bestVram(hw: HardwareInfo): number {
  return Math.max(0, ...hw.gpus.map((g) => g.vramGB))
}

export function recommendModels(hw: HardwareInfo, catalog: ModelCatalogEntry[], opts: { freedom?: boolean; limit?: number } = {}): ModelRecommendation[] {
  const vram = bestVram(hw)
  const recs: ModelRecommendation[] = []
  for (const m of catalog) {
    if (m.uncensored && !opts.freedom) continue
    const reasons: string[] = []
    let fitsAt: ModelRecommendation['fitsAt']
    let fitMul: number
    if (m.vram16kGB <= vram) {
      fitsAt = '16k'
      fitMul = 1
      reasons.push(`Fits in your ${vram} GB graphics memory with room for long job descriptions (16k context).`)
    } else if (m.vram8kGB <= vram) {
      fitsAt = '8k'
      fitMul = 0.78
      reasons.push(`Fits in ${vram} GB with a medium context (8k) — long postings may get trimmed.`)
    } else if (m.paramsB <= 32 && hw.ramGB >= m.vram8kGB + 6) {
      fitsAt = 'cpu'
      // Mixture-of-experts models stay usable when partly on CPU.
      fitMul = /moe|a3b|gpt-oss/i.test(m.name + m.id) ? 0.6 : 0.3
      reasons.push(`Too big for your graphics memory; it would run partly on the CPU (${hw.ramGB} GB RAM) and be slower.`)
    } else continue
    if (m.quality >= 8) reasons.push('High writing quality for tailoring and cover letters.')
    if (m.speed >= 8) reasons.push('Fast responses.')
    if (m.vision) reasons.push('Can read screenshots (useful for Site Learning).')
    if (m.uncensored) reasons.push('Uncensored: fewer refusals, but follows formatting instructions less reliably.')
    const score = m.quality * 10 * fitMul + m.speed * 2.5 + (m.vision ? 3 : 0)
    recs.push({ model: m, score: Math.round(score), fitsAt, reasons })
  }
  return recs.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5)
}

/** A prompt the user can paste into any chatbot for step-by-step local AI setup help. */
export function setupPrompt(hw: HardwareInfo, recs: ModelRecommendation[]): string {
  const gpu = hw.gpus.map((g) => `${g.model} (${g.vramGB} GB VRAM)`).join(', ') || 'no dedicated GPU detected'
  return `I want to run a local AI model on my Windows PC for a job-application helper app called JobSweep, which talks to Ollama at http://localhost:11434.

My computer:
- OS: ${hw.os}
- CPU: ${hw.cpu} (${hw.cores} cores)
- RAM: ${hw.ramGB} GB
- GPU: ${gpu}
- Free disk space: ${hw.freeDiskGB} GB
- Ollama installed: ${hw.ollamaInstalled ? 'yes' : 'no'}${hw.installedModels.length ? `\n- Models already installed: ${hw.installedModels.join(', ')}` : ''}

The app recommended these models (best first):
${recs.map((r, i) => `${i + 1}. ${r.model.name} — Ollama tag "${r.model.ollamaTag}" (fits at ${r.fitsAt})`).join('\n')}

Please walk me through, one step at a time and waiting for me to confirm each step:
1. Installing Ollama on Windows (if needed) and checking it runs.
2. Downloading the first recommended model with "ollama pull".
3. Testing it with a short prompt.
4. Setting the context length to 16k if my GPU memory allows it.
5. Also pulling the embedding model "nomic-embed-text".
6. What to do if it is slow or runs out of memory.
Keep instructions simple; I am comfortable copying commands into PowerShell.`
}
