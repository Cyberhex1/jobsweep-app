import { useCallback, useEffect, useRef, useState } from 'react'
import { onEvent } from './api'

/** Load async data with reload support. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; loading: boolean; error: string | null; reload: () => Promise<void>; set: (v: T) => void } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fnRef.current())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps)
  return { data, loading, error, reload, set: setData }
}

export function useEvent(name: string | string[], cb: (payload: any) => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    const names = Array.isArray(name) ? name : [name]
    return onEvent((e, p) => names.includes(e) && ref.current(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(name) ? name.join() : name])
}

export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method 'api': (Error: )?/, '')
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

export function money(min?: number, max?: number, unit?: string): string {
  if (min == null && max == null) return ''
  const f = (n: number) => (unit === 'hourly' ? `$${n.toFixed(n % 1 ? 2 : 0)}` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)
  const r = min != null && max != null && min !== max ? `${f(min)}–${f(max)}` : f((min ?? max)!)
  return unit === 'hourly' ? `${r}/hr` : `${r}/yr`
}
