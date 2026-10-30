// Analytics over applications: funnel and response rates by group, with sample sizes.

import type { ApplicationStatus } from '@shared/types'

export interface AppRow {
  id: number
  status: ApplicationStatus
  mode: string
  source: string
  platform: string
  resumeLabel: string
  submittedAt: string | null
  firstResponseAt: string | null
}

const RESPONDED: ApplicationStatus[] = ['interview', 'assessment', 'offer', 'rejected']
const POSITIVE: ApplicationStatus[] = ['interview', 'assessment', 'offer']

export function funnel(rows: AppRow[]) {
  const submitted = rows.filter((r) => r.submittedAt)
  return {
    total: rows.length,
    submitted: submitted.length,
    responded: submitted.filter((r) => RESPONDED.includes(r.status)).length,
    interviews: submitted.filter((r) => POSITIVE.includes(r.status)).length,
    offers: submitted.filter((r) => r.status === 'offer').length,
    pending: rows.filter((r) => ['queued', 'filling', 'ready_for_review', 'needs_you'].includes(r.status)).length,
    failed: rows.filter((r) => r.status === 'failed').length
  }
}

export interface GroupStat {
  group: string
  applied: number
  responses: number
  positive: number
  responseRate: number
  positiveRate: number
  enoughData: boolean
  avgDaysToResponse: number | null
}

export function byGroup(rows: AppRow[], key: (r: AppRow) => string): GroupStat[] {
  const groups = new Map<string, AppRow[]>()
  for (const r of rows.filter((x) => x.submittedAt)) {
    const k = key(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([group, rs]) => {
      const responses = rs.filter((r) => RESPONDED.includes(r.status)).length
      const positive = rs.filter((r) => POSITIVE.includes(r.status)).length
      const days = rs
        .filter((r) => r.firstResponseAt && r.submittedAt)
        .map((r) => (new Date(r.firstResponseAt!).getTime() - new Date(r.submittedAt!).getTime()) / 86400000)
      return {
        group,
        applied: rs.length,
        responses,
        positive,
        responseRate: rs.length ? responses / rs.length : 0,
        positiveRate: rs.length ? positive / rs.length : 0,
        enoughData: rs.length >= 10,
        avgDaysToResponse: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null
      }
    })
    .sort((a, b) => b.applied - a.applied)
}

export function perDay(rows: AppRow[], days = 30): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
    out.push({ date: d, count: rows.filter((r) => r.submittedAt?.slice(0, 10) === d).length })
  }
  return out
}
