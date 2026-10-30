// Scam & ghost-job heuristics. Returns a 0-100 risk score with human-readable reasons.

import type { NormalizedJob } from '@shared/types'
import { annualize } from './match'

const RED_FLAGS: [RegExp, number, string][] = [
  [/\b(telegram|whatsapp|signal app|google hangouts|wire app)\b/i, 35, 'Interview over a chat app (Telegram/WhatsApp)'],
  [/\b(check deposit|deposit (a|the) check|mobile deposit|cashier'?s check)\b/i, 45, 'Mentions depositing a check'],
  [/\b(purchase|buy) (your own )?(equipment|laptop|software)\b.*\b(reimburse|refund)/i, 40, 'Asks you to buy equipment for reimbursement'],
  [/\b(no interview|without an interview|hired immediately|instant hire)\b/i, 30, 'Promises hiring without an interview'],
  [/\b(gift ?cards?|bitcoin|crypto(currency)? payment|western union|zelle me)\b/i, 35, 'Payment by gift card / crypto / Zelle'],
  [/\b(training fee|starter kit fee|registration fee|pay for (your )?training)\b/i, 40, 'Asks you to pay a fee'],
  [/\b(ssn|social security number|bank account (number|details))\b.*\b(apply|application|before)\b/i, 30, 'Asks for SSN/bank details up front'],
  [/\b(reshipping|package (forwarding|inspector)|reship)\b/i, 45, 'Reshipping / package forwarding'],
  [/\b(earn \$?\d{3,}[^.]{0,20}(per|a) (day|week)|unlimited earning|be your own boss)\b/i, 20, 'Too-good-to-be-true earnings language'],
  [/\b(data entry clerk|personal assistant|mystery shopper)\b/i, 8, 'Role type often used by scammers']
]

export function scamCheck(job: NormalizedJob, ctx: { timesSeen?: number; firstSeen?: string } = {}): { score: number; reasons: string[] } {
  const text = `${job.title}\n${job.description}`
  let score = 0
  const reasons: string[] = []
  for (const [re, w, why] of RED_FLAGS)
    if (re.test(text)) {
      score += w
      reasons.push(why)
    }
  const emails = text.match(/[\w.+-]+@([\w-]+\.)+[a-z]{2,}/gi) ?? []
  if (emails.some((e) => /@(gmail|yahoo|outlook|hotmail|aol|proton|icloud)\./i.test(e))) {
    score += 25
    reasons.push('Recruiter uses a personal email address')
  }
  if (!job.company || /^(confidential|private|undisclosed|company)$/i.test(job.company.trim())) {
    score += 15
    reasons.push('Company name is hidden')
  }
  if (job.description.length < 250) {
    score += 10
    reasons.push('Very short description')
  }
  const pay = annualize(job.payMax ?? job.payMin, job.payUnit)
  if (pay && pay > 150000 && /\b(entry level|no experience|data entry|customer service|assistant)\b/i.test(text)) {
    score += 25
    reasons.push('Pay is unusually high for an entry-level role')
  }
  // Ghost-job signals: old or repeatedly reposted.
  const posted = job.postedAt ?? ctx.firstSeen
  if (posted) {
    const days = (Date.now() - new Date(posted).getTime()) / 86400000
    if (days > 60) {
      score += 15
      reasons.push(`Posted ${Math.round(days)} days ago (may be a ghost job)`)
    }
  }
  if ((ctx.timesSeen ?? 0) >= 4) {
    score += 10
    reasons.push('Reposted many times')
  }
  return { score: Math.min(100, score), reasons }
}
