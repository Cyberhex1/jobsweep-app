// Error log: %APPDATA%\JobSweep\logs\jobsweep.log. Kept small so it can be attached to a bug report.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1_000_000
let file = ''

export function initLog(dataDir: string) {
  const dir = join(dataDir, 'logs')
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'jobsweep.log')
  process.on('uncaughtException', (e) => logError('main', e))
  process.on('unhandledRejection', (e) => logError('main', e))
  return dir
}

export function logError(where: string, e: unknown) {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e)
  console.error(`[${where}]`, text)
  if (!file) return
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, file + '.old')
    appendFileSync(file, `${new Date().toISOString()} [${where}] ${text}\n`)
  } catch {
    // Logging must never crash the app.
  }
}
