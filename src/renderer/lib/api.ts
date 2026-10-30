// Typed bridge to the main process. Types come from main/api.ts (type-only import, erased at build).
import type { Api } from '../../main/api'

type Promisified<T> = {
  [K in keyof T]: { [F in keyof T[K]]: T[K][F] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }
}

declare global {
  interface Window {
    jobsweep: { call: (path: string, ...args: unknown[]) => Promise<unknown>; on: (cb: (event: string, payload: unknown) => void) => () => void }
  }
}

export const api = new Proxy({} as Promisified<Api>, {
  get: (_t, ns: string) => new Proxy({}, { get: (_t2, fn: string) => (...args: unknown[]) => window.jobsweep.call(`${ns}.${fn}`, ...args) })
})

export type ApiResult<N extends keyof Api, F extends keyof Api[N]> = Api[N][F] extends (...a: never[]) => infer R ? Awaited<R> : never

export function onEvent(cb: (event: string, payload: any) => void) {
  return window.jobsweep.on(cb)
}
