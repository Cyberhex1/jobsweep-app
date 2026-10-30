// Board learning: per-source affinity from user signals with time decay.

import type { Signal } from '@shared/types'

export const SIGNAL_WEIGHT: Record<Signal['kind'], number> = {
  view: 0.2,
  expand: 0.5,
  open: 1,
  save: 2,
  apply: 3,
  response: 5,
  dismiss: -1
}

const HALF_LIFE_DAYS = 21

export function sourceAffinity(signals: Signal[], now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of signals) {
    const ageDays = (now - new Date(s.at).getTime()) / 86400000
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
    out[s.source] = (out[s.source] ?? 0) + SIGNAL_WEIGHT[s.kind] * decay
  }
  return out
}

export function orderSources(sources: string[], affinity: Record<string, number>, defaults: Record<string, number> = {}): string[] {
  return [...sources].sort((a, b) => (affinity[b] ?? 0) + (defaults[b] ?? 0) - ((affinity[a] ?? 0) + (defaults[a] ?? 0)))
}
