// Company blocklist matching (names, aliases, domains). The profile's current employer is always included.

import { companyKey } from './text'

export interface BlockEntry {
  company: string
  aliases: string[]
  domains: string[]
  reason: string
}

export function buildBlocklist(entries: BlockEntry[], currentEmployer?: string): BlockEntry[] {
  const list = [...entries]
  if (currentEmployer && !list.some((e) => companyKey(e.company) === companyKey(currentEmployer)))
    list.push({ company: currentEmployer, aliases: [], domains: [], reason: 'Your current employer' })
  return list
}

export function isBlocked(company: string, url: string | undefined, list: BlockEntry[]): BlockEntry | null {
  const key = companyKey(company)
  let host = ''
  try {
    host = url ? new URL(url).hostname.toLowerCase() : ''
  } catch {
    host = ''
  }
  for (const e of list) {
    const keys = [e.company, ...e.aliases].map(companyKey).filter(Boolean)
    if (keys.includes(key)) return e
    if (host && e.domains.some((d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()))) return e
  }
  return null
}
