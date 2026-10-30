// Detect which application platform (ATS) a URL belongs to.

export type Platform =
  | 'workday'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'icims'
  | 'taleo'
  | 'oracle'
  | 'successfactors'
  | 'neogov'
  | 'usajobs'
  | 'linkedin'
  | 'indeed'
  | 'jobvite'
  | 'bamboohr'
  | 'workable'
  | 'paylocity'
  | 'adp'
  | 'ukg'
  | 'generic'

const RULES: [RegExp, Platform][] = [
  [/myworkdayjobs\.com|myworkday\.com|workdayjobs/i, 'workday'],
  [/greenhouse\.io/i, 'greenhouse'],
  [/lever\.co/i, 'lever'],
  [/ashbyhq\.com/i, 'ashby'],
  [/smartrecruiters\.com/i, 'smartrecruiters'],
  [/icims\.com/i, 'icims'],
  [/taleo\.net/i, 'taleo'],
  [/oraclecloud\.com.*(hcmUI|CandidateExperience)/i, 'oracle'],
  [/successfactors\.(com|eu)|jobs\.sap\.com/i, 'successfactors'],
  [/governmentjobs\.com|schooljobs\.com|neogov\.com/i, 'neogov'],
  [/usajobs\.gov/i, 'usajobs'],
  [/linkedin\.com/i, 'linkedin'],
  [/indeed\.com/i, 'indeed'],
  [/jobvite\.com/i, 'jobvite'],
  [/bamboohr\.com/i, 'bamboohr'],
  [/workable\.com/i, 'workable'],
  [/paylocity\.com/i, 'paylocity'],
  [/adp\.com/i, 'adp'],
  [/ultipro\.com|ukg\.net/i, 'ukg']
]

export function detectPlatform(url: string): Platform {
  for (const [re, p] of RULES) if (re.test(url)) return p
  return 'generic'
}

/** Platforms where we never auto-submit (discovery/assist only). */
export const ASSIST_ONLY: Platform[] = ['linkedin', 'indeed', 'usajobs']

export function parseWorkdayUrl(url: string): { host: string; tenant: string; site: string } | null {
  const m = /https?:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/.exec(url)
  if (!m) return null
  return { host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] }
}
