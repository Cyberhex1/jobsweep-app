// Electron main process: window, services, IPC, extension bridge, scheduler.

import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from 'electron'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cron } from 'croner'
import { Db, type Cipher } from './db'
import { AiRouter } from './ai/router'
import { JobService } from './jobs'
import { ApplyService } from './apply'
import { SiteLearning } from './siteLearning'
import { EmailWatcher } from './email/watcher'
import { BrowserManager } from './automation/browser'
import { createApi, importJob, type Api, type Services } from './api'
import { initLog, logError } from './log'

app.setName('JobSweep')
const dataDir = app.getPath('userData')
mkdirSync(dataDir, { recursive: true })
const logDir = initLog(dataDir)
// Packaged: resources\extension. From source: the repo's extension folder.
const extensionDir = app.isPackaged ? join(process.resourcesPath, 'extension') : join(app.getAppPath(), 'extension')

let win: BrowserWindow | null = null
const EXT_PORT = 47821

function cipher(): Cipher {
  if (safeStorage.isEncryptionAvailable())
    return { encrypt: (s) => 'd:' + safeStorage.encryptString(s).toString('base64'), decrypt: (s) => (s.startsWith('d:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : Buffer.from(s.slice(2), 'base64').toString()) }
  // Fallback (rare on Windows): obfuscated only.
  return { encrypt: (s) => 'b:' + Buffer.from(s).toString('base64'), decrypt: (s) => (s.startsWith('d:') ? '' : Buffer.from(s.slice(2), 'base64').toString()) }
}

function emit(event: string, payload: unknown) {
  win?.webContents.send('event', event, payload)
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) new Notification({ title, body }).show()
  emit('toast', { kind: 'info', text: `${title}: ${body}` })
}

async function htmlToPdf(html: string, out: string): Promise<boolean> {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
    writeFileSync(out, pdf)
    return true
  } catch {
    return false
  } finally {
    w.destroy()
  }
}

async function boot() {
  const db = new Db(join(dataDir, 'jobsweep.db'), cipher())
  const ai = new AiRouter(db)
  const browser = new BrowserManager({ profileDir: join(dataDir, 'browser-profile') })
  const jobs = new JobService(db, (m) => emit('log', m))
  jobs.rescoreIfStale()
  const email = new EmailWatcher(db, ai, (m) => notify('Job email update', m))
  const apply = new ApplyService({ db, ai, browser, jobs, dataDir, pdfFallback: htmlToPdf, waitForVerification: (h, s, t) => email.waitForVerification(h, s, t), emit, notify })
  const learning = new SiteLearning(db, ai, browser, dataDir, (m) => emit('apply:status', m))

  let token = db.getKv<string>('extension.token', '')
  if (!token) {
    token = randomBytes(12).toString('hex')
    db.setKv('extension.token', token)
  }
  let port = EXT_PORT

  let cron: Cron | null = null
  const rescheduleRuns = () => {
    cron?.stop()
    const s = db.getSettings()
    if (!s.scheduleEnabled) return
    const [h, m] = s.scheduleTime.split(':').map(Number)
    cron = new Cron(`${m || 0} ${h || 9} * * *`, async () => {
      emit('toast', { kind: 'info', text: 'Scheduled run starting: refreshing jobs…' })
      await jobs.refresh().catch(() => {})
      await apply.runBatch().catch((e) => notify('Scheduled run failed', (e as Error).message))
    })
  }

  const services: Services = {
    db,
    ai,
    jobs,
    apply,
    learning,
    email,
    browser,
    dataDir,
    emit,
    pairing: () => ({ port, token }),
    rescheduleRuns,
    platform: {
      openExternal: (u) => void shell.openExternal(u),
      openPath: (p) => void shell.openPath(p),
      pickFiles: async (o) => (await dialog.showOpenDialog(win!, { title: o.title, filters: o.filters, properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'] })).filePaths,
      saveFile: async (o) => (await dialog.showSaveDialog(win!, { title: o.title, defaultPath: o.defaultName, filters: o.filters })).filePath ?? null,
      notify,
      htmlToPdf,
      setStartAtLogin: (on) => app.setLoginItemSettings({ openAtLogin: on }),
      appVersion: app.getVersion(),
      extensionDir,
      logDir,
      logError
    }
  }
  const api: Api = createApi(services)

  ipcMain.handle('api', async (_e, path: string, args: unknown[]) => {
    const [ns, fn] = path.split('.') as [keyof Api, string]
    const target = (api[ns] as Record<string, (...a: unknown[]) => unknown>)?.[fn]
    if (!target) throw new Error(`Unknown API ${path}`)
    try {
      return await target(...args)
    } catch (e) {
      logError(`api ${path}`, e)
      throw e
    }
  })

  // Extension bridge: 127.0.0.1 only, pairing token required.
  const server = createServer((req, res) => {
    const origin = req.headers.origin ?? ''
    res.setHeader('Access-Control-Allow-Origin', origin.startsWith('chrome-extension://') || origin.startsWith('extension://') ? origin : 'null')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-jobsweep-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    if (req.headers['x-jobsweep-token'] !== token) return void res.writeHead(401).end(JSON.stringify({ error: 'Not paired' }))
    if (req.method === 'GET' && req.url === '/ping') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, app: 'JobSweep' }))
    if (req.method === 'POST' && req.url === '/import') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        try {
          const data = JSON.parse(body)
          const r = await importJob(services, data)
          emit('toast', { kind: 'success', text: `Imported: ${r.job?.title ?? 'job'}${r.assistOnly ? ' (assist mode — no company site found yet)' : ''}` })
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, title: r.job?.title, assistOnly: r.assistOnly, applyUrl: r.job?.applyUrl ?? null }))
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }))
        }
      })
      return
    }
    res.writeHead(404).end()
  })
  server.on('error', () => server.listen(0, '127.0.0.1'))
  server.on('listening', () => {
    port = (server.address() as { port: number }).port
  })
  server.listen(EXT_PORT, '127.0.0.1')

  rescheduleRuns()
  email.start()
  app.on('before-quit', () => {
    void browser.close()
    email.stop()
    cron?.stop()
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#07080c',
    title: 'JobSweep',
    // The installed app takes its icon from the .exe; this covers running from source.
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07080c', symbolColor: '#c9b98f', height: 36 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' }
  })
  win.webContents.on('render-process-gone', (_e, d) => logError('renderer', `Renderer stopped: ${d.reason}`))
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  try {
    await boot()
  } catch (e) {
    logError('startup', e)
    dialog.showErrorBox('JobSweep could not start', `${(e as Error).message}\n\nDetails were saved to ${logDir}`)
    app.quit()
    return
  }
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
