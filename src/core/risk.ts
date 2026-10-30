// Daily-cap risk tiers shown in Settings.

export type RiskTier = 'green' | 'yellow' | 'orange' | 'red'

export function capTier(cap: number): { tier: RiskTier; message: string; confirmations: number } {
  if (cap <= 10) return { tier: 'green', message: 'Comfortable pace. Quality stays high and sites see normal activity.', confirmations: 0 }
  if (cap <= 25) return { tier: 'yellow', message: 'Busy pace. Fine for most people, but you will have more applications to track and fewer of them will be strong matches.', confirmations: 1 }
  if (cap <= 50)
    return { tier: 'orange', message: 'High volume. Some sites may flag your account for unusual activity, and recruiters notice mass-applying. Make sure your minimum match score is high.', confirmations: 1 }
  return { tier: 'red', message: 'Very high volume. Expect CAPTCHAs, account flags, and weaker applications. Recruiters at the same companies will see many applications from you.', confirmations: 2 }
}
