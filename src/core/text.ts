// Small text utilities used across the core logic. No dependencies.

const cp = (a: number, b?: number) => (b === undefined ? String.fromCharCode(a) : `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
// Zero-width spaces/joiners, bidi marks, line/paragraph separators, word joiners, BOM, soft hyphen.
export const INVISIBLE_RE = new RegExp(`[${cp(0x200b, 0x200f)}${cp(0x2028, 0x202e)}${cp(0x2060, 0x2064)}${cp(0xfeff)}${cp(0xad)}]`, 'g')
export const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the to was were will with you your we our they their this those these i me my us not but if so than then into over under about after before while during per via within across what which who when where how do does did can could would should please'.split(
    ' '
  )
)

export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_RE, '').replace(CONTROL_RE, '')
}

export function normalize(s: string): string {
  return stripInvisible(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(s: string, keepStopwords = false): string[] {
  return normalize(s)
    .split(' ')
    .map((t) => t.replace(/^[./]+|[./]+$/g, ''))
    .filter((t) => t.length > 1 && (keepStopwords || !STOPWORDS.has(t)))
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function shingles(s: string, k = 3): Set<string> {
  const t = tokens(s)
  const out = new Set<string>()
  if (t.length < k) {
    if (t.length) out.add(t.join(' '))
    return out
  }
  for (let i = 0; i <= t.length - k; i++) out.add(t.slice(i, i + k).join(' '))
  return out
}

/** Cosine similarity of two bag-of-words vectors. */
export function cosineBow(a: string, b: string): number {
  const va = new Map<string, number>()
  const vb = new Map<string, number>()
  for (const t of tokens(a)) va.set(t, (va.get(t) ?? 0) + 1)
  for (const t of tokens(b)) vb.set(t, (vb.get(t) ?? 0) + 1)
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of va) {
    na += v * v
    const w = vb.get(k)
    if (w) dot += v * w
  }
  for (const v of vb.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export function cosineVec(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Levenshtein-based similarity in [0,1]. */
export function stringSimilarity(a: string, b: string): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x.length && !y.length) return 1
  const dp = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return 1 - dp[y.length] / Math.max(x.length, y.length)
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

export function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>()
  return xs.filter((x) => {
    const k = key(x)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

export function companyKey(name: string): string {
  return normalize(name)
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|incorporated|plc|lp|llp|group|holdings|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}
