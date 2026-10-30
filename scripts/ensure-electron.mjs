// Electron no longer downloads its binary during `npm install`, and some npm setups skip install scripts entirely.
// Run before dev/start/dist so the binary is always there. Does nothing when it is already installed.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
let dir
try {
  dir = dirname(require.resolve('electron/package.json'))
} catch {
  process.exit(0) // Electron not installed (production-only install): nothing to do.
}
if (!existsSync(join(dir, 'path.txt')) || !existsSync(join(dir, 'dist'))) {
  console.log('Downloading Electron (one time)…')
  const r = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('Could not download Electron. Check your internet connection, then run: npx install-electron')
    process.exit(r.status ?? 1)
  }
}
