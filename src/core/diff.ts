// Word-level diff (LCS) used to highlight what AI changed in resumes and cover letters.

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string }

export function wordDiff(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/)
  const B = b.split(/(\s+)/)
  const n = A.length
  const m = B.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffPart[] = []
  const push = (type: DiffPart['type'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++])
    else push('add', B[j++])
  }
  while (i < n) push('del', A[i++])
  while (j < m) push('add', B[j++])
  return out
}

/** Fraction of words in `b` that are new compared with `a`. */
export function changeRatio(a: string, b: string): number {
  const parts = wordDiff(a, b)
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  const added = parts.filter((p) => p.type === 'add').reduce((s, p) => s + words(p.text), 0)
  return added / Math.max(1, words(b))
}

export type LineChange = { type: 'add' | 'del'; text: string; words?: DiffPart[] }

/** Changed lines only (LCS on whole lines). A removed line followed by an added one gets a word diff. */
export function lineChanges(a: string, b: string): LineChange[] {
  const A = a.split('\n').filter((l) => l.trim())
  const B = b.split('\n').filter((l) => l.trim())
  const n = A.length
  const m = B.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: LineChange[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      i++
      j++
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) out.push({ type: 'del', text: A[i++] })
    else {
      const prev = out[out.length - 1]
      const text = B[j++]
      if (prev?.type === 'del' && !prev.words) {
        const words = wordDiff(prev.text, text)
        prev.words = words
        out.push({ type: 'add', text, words })
      } else out.push({ type: 'add', text })
    }
  }
  return out
}
