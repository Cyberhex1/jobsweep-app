// DOCX -> PDF. Prefers Microsoft Word (exact formatting), then LibreOffice, then a caller-supplied fallback.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function viaWord(docx: string, pdf: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const ps = `$ErrorActionPreference='Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {
  $d = $w.Documents.Open('${docx.replace(/'/g, "''")}', $false, $true)
  $d.ExportAsFixedFormat('${pdf.replace(/'/g, "''")}', 17)
  $d.Close([ref]0)
} finally { $w.Quit() }`
  try {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 90000, windowsHide: true })
    return existsSync(pdf)
  } catch {
    return false
  }
}

async function viaLibreOffice(docx: string, pdf: string): Promise<boolean> {
  const candidates =
    process.platform === 'win32' ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'] : ['soffice', 'libreoffice']
  for (const bin of candidates) {
    try {
      await exec(bin, ['--headless', '--convert-to', 'pdf', '--outdir', dirname(pdf), docx], { timeout: 120000, windowsHide: true })
      const produced = join(dirname(pdf), basename(docx).replace(/\.docx$/i, '.pdf'))
      if (existsSync(produced)) {
        if (produced !== pdf) await (await import('node:fs/promises')).rename(produced, pdf)
        return true
      }
    } catch {
      /* try next */
    }
  }
  return false
}

export async function docxToPdf(docx: string, fallback?: (pdf: string) => Promise<boolean>): Promise<{ path: string; via: 'word' | 'libreoffice' | 'html' }> {
  const pdf = docx.replace(/\.docx$/i, '.pdf')
  if (await viaWord(docx, pdf)) return { path: pdf, via: 'word' }
  if (await viaLibreOffice(docx, pdf)) return { path: pdf, via: 'libreoffice' }
  if (fallback && (await fallback(pdf))) return { path: pdf, via: 'html' }
  throw new Error('Could not convert to PDF: Microsoft Word and LibreOffice were not found.')
}
