// Read resumes from DOCX/PDF/TXT into plain text (+ DOCX layout facts for the ATS check).

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import mammoth from 'mammoth'
import JSZip from 'jszip'

export interface ImportedText {
  text: string
  docx?: { hasTables: boolean; hasTextBoxes: boolean; hasImages: boolean; headerFooterHasContact: boolean; columns: number }
}

export async function importResumeFile(path: string): Promise<ImportedText> {
  const ext = extname(path).toLowerCase()
  const buf = await readFile(path)
  if (ext === '.docx') return importDocx(buf)
  if (ext === '.pdf') return { text: await pdfText(buf) }
  if (ext === '.txt' || ext === '.md') return { text: buf.toString('utf8') }
  throw new Error(`Unsupported file type ${ext}. Use .docx, .pdf, or .txt`)
}

export async function importDocx(buf: Buffer): Promise<ImportedText> {
  // HTML keeps list structure (Word bullets), which raw text loses.
  const { value: html } = await mammoth.convertToHtml({ buffer: buf })
  const value = html
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  const zip = await JSZip.loadAsync(buf)
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  let hf = ''
  for (const name of Object.keys(zip.files)) if (/^word\/(header|footer)\d*\.xml$/.test(name)) hf += (await zip.file(name)!.async('string')).replace(/<[^>]+>/g, ' ')
  const cols = /<w:cols[^>]*w:num="(\d+)"/.exec(docXml)
  return {
    // mammoth separates paragraphs with blank lines; collapse to one line per paragraph.
    text: value.replace(/\n{2,}/g, '\n'),
    docx: {
      hasTables: /<w:tbl>/.test(docXml),
      hasTextBoxes: /<w:txbxContent|<v:textbox/.test(docXml),
      hasImages: /<pic:pic|<w:drawing/.test(docXml),
      headerFooterHasContact: /@|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}/.test(hf),
      columns: cols ? Number(cols[1]) : 1
    }
  }
}

/** PDF text with line reconstruction; big horizontal gaps become 3+ spaces (column separators). */
export async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items = (content.items as { str: string; transform: number[]; width: number; hasEOL?: boolean }[]).filter((i) => i.str !== undefined)
    const rows = new Map<number, { x: number; str: string; w: number }[]>()
    for (const it of items) {
      const y = Math.round(it.transform[5] / 2) * 2
      const row = rows.get(y) ?? []
      row.push({ x: it.transform[4], str: it.str, w: it.width })
      rows.set(y, row)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows.get(y)!.sort((a, b) => a.x - b.x)
      let line = ''
      let lastEnd = -1
      for (const r of row) {
        // Wide whitespace runs are tabs between columns (e.g. "Company<TAB>Location").
        if (!r.str.trim() && r.w > 20) {
          if (line && !line.endsWith('    ')) line += '    '
          continue
        }
        if (lastEnd >= 0 && !line.endsWith('    ')) {
          const gap = r.x - lastEnd
          line += gap > 40 ? '    ' : gap > 1.5 && !line.endsWith(' ') && !r.str.startsWith(' ') ? ' ' : ''
        }
        line += r.str
        lastEnd = r.x + r.w
      }
      if (line.trim()) lines.push(line.replace(/\s+$/, ''))
    }
    lines.push('')
  }
  return lines.join('\n')
}
