// Browser manager: a persistent Microsoft Edge profile driven by Playwright.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

export interface BrowserOptions {
  profileDir: string
  headless?: boolean
}

function findExecutable(): { channel?: string; executablePath?: string } {
  if (process.env.JOBSWEEP_BROWSER && existsSync(process.env.JOBSWEEP_BROWSER)) return { executablePath: process.env.JOBSWEEP_BROWSER }
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe')
    ]
    const found = candidates.find((c) => existsSync(c))
    return found ? { executablePath: found } : { channel: 'msedge' }
  }
  const linux = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/google-chrome']
  const found = linux.find((c) => existsSync(c))
  return found ? { executablePath: found } : { channel: 'msedge' }
}

export class BrowserManager {
  private ctx: BrowserContext | null = null
  private launching: Promise<BrowserContext> | null = null

  constructor(private opts: BrowserOptions) {}

  async context(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx
    if (this.launching) return this.launching
    this.launching = chromium
      .launchPersistentContext(this.opts.profileDir, {
        ...findExecutable(),
        headless: this.opts.headless ?? false,
        viewport: null,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
        acceptDownloads: true
      })
      .then((c) => {
        this.ctx = c
        c.on('close', () => {
          this.ctx = null
        })
        return c
      })
      .finally(() => {
        this.launching = null
      })
    return this.launching
  }

  async newPage(): Promise<Page> {
    const c = await this.context()
    return c.newPage()
  }

  async close() {
    await this.ctx?.close().catch(() => {})
    this.ctx = null
  }

  get isOpen() {
    return !!this.ctx
  }
}
