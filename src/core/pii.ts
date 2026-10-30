// PII scrubbing before text goes to a free cloud AI. Placeholders are restored in the response.

export interface ScrubResult {
  text: string
  map: Record<string, string>
}

export function scrubPII(text: string, known: { name?: string; email?: string; phone?: string; address?: string; city?: string } = {}): ScrubResult {
  const map: Record<string, string> = {}
  let out = text
  let n = 0
  const put = (value: string, tag: string) => {
    if (!value || value.length < 3) return
    const ph = `[[${tag}_${++n}]]`
    const re = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    if (re.test(out)) {
      map[ph] = value
      out = out.replace(re, ph)
    }
  }
  if (known.email) put(known.email, 'EMAIL')
  if (known.phone) put(known.phone, 'PHONE')
  if (known.address) put(known.address, 'ADDRESS')
  if (known.name) put(known.name, 'NAME')
  // Generic patterns for anything not in the profile.
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => {
    const ph = `[[EMAIL_${++n}]]`
    map[ph] = m
    return ph
  })
  out = out.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, (m) => {
    const ph = `[[PHONE_${++n}]]`
    map[ph] = m
    return ph
  })
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, (m) => {
    const ph = `[[SSN_${++n}]]`
    map[ph] = m
    return ph
  })
  out = out.replace(/\b\d{1,6}\s+[A-Z][a-z]+(\s[A-Z][a-z]+)*\s(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b\.?/g, (m) => {
    const ph = `[[ADDRESS_${++n}]]`
    map[ph] = m
    return ph
  })
  return { text: out, map }
}

export function restorePII(text: string, map: Record<string, string>): string {
  let out = text
  for (const [ph, v] of Object.entries(map)) out = out.split(ph).join(v)
  return out
}
