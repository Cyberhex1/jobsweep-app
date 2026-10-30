import { api } from '../lib/api'
import { errMsg, timeAgo, useEvent, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Card, Score, Stat, cx } from '../ui/kit'
import { toast } from '../ui/toast'

export function Lobby() {
  const { go } = useNav()
  const d = useLoad(async () => {
    const [apps, resumes, profile, ai, emailOk, lastRefresh, board, emails, settings] = await Promise.all([
      api.applications.list(),
      api.resume.list(),
      api.profile.get(),
      api.ai.status(),
      api.email.configured(),
      api.jobs.lastRefresh(),
      api.jobs.board(),
      api.email.list(),
      api.settings.get()
    ])
    return { apps, resumes, profile, ai, emailOk, lastRefresh, board, emails, settings }
  })
  useEvent(['apply:changed', 'run:done', 'jobs:changed'], () => void d.reload())

  if (!d.data) return <div className="skeleton h-64 rounded-2xl" />
  const { apps, resumes, profile, ai, emailOk, lastRefresh, board, emails, settings } = d.data
  const weekAgo = Date.now() - 7 * 86400000
  const appliedWeek = apps.filter((a) => a.submittedAt && new Date(a.submittedAt).getTime() > weekAgo).length
  const review = apps.filter((a) => a.status === 'ready_for_review').length
  const needs = apps.filter((a) => a.status === 'needs_you').length
  const responses = apps.filter((a) => ['interview', 'assessment', 'offer'].includes(a.status)).length
  const top = board
    .flatMap((c) => c.jobs)
    .filter((j, i, arr) => arr.findIndex((x) => x.id === j.id) === i)
    .sort((a, b) => b.interviewScore - a.interviewScore)
    .slice(0, 6)

  const steps = [
    { done: resumes.length > 0, label: 'Upload your resume', action: () => go('1') },
    { done: profile.roles.length > 0 && !!profile.city, label: 'Fill in your profile and target roles', action: () => go('2') },
    { done: ai.some((a) => a.configured), label: 'Set up AI (local or free Gemini)', action: () => go('M', { tab: 'ai' }) },
    { done: emailOk, label: 'Connect your job-search email', action: () => go('M', { tab: 'email' }) },
    { done: !!lastRefresh, label: 'Refresh the job board', action: () => go('3') }
  ]
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <FloorHeader
        title={`${greeting}${profile.fullName ? ', ' + profile.fullName.split(' ')[0] : ''}.`}
        sub={lastRefresh ? `Jobs last refreshed ${timeAgo(lastRefresh)} · ${settings.mode === 'auto' ? 'Auto mode' : 'Review mode'}` : 'Welcome to JobSweep. Let’s get you set up.'}
        actions={
          <>
            <Button
              onClick={async () => {
                try {
                  const r = await api.jobs.refresh()
                  toast.success(`Found ${r.added} new jobs (${r.merged} duplicates merged).`)
                  void d.reload()
                } catch (e) {
                  toast.error(errMsg(e))
                }
              }}
            >
              Refresh jobs
            </Button>
            <Button kind="brass" onClick={() => go('4')}>
              Apply for me
            </Button>
          </>
        }
      />

      {steps.some((s) => !s.done) && (
        <Card className="mb-6" title="Getting started">
          <div className="grid gap-2 md:grid-cols-5">
            {steps.map((s, i) => (
              <button key={i} onClick={s.action} className={cx('rounded-xl border px-3 py-3 text-left transition', s.done ? 'border-ok/30 bg-ok/5' : 'border-line hover:border-brass/40')}>
                <div className={cx('mb-1 font-mono text-xs', s.done ? 'text-ok' : 'text-brass')}>{s.done ? '✓ Done' : `Step ${i + 1}`}</div>
                <div className="text-sm text-text">{s.label}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Ready for review" value={review} tone={review ? 'brass' : undefined} sub={<button onClick={() => go('4')}>Open review deck →</button>} />
        <Stat label="Needs you" value={needs} tone={needs ? 'warn' : undefined} sub="CAPTCHAs, new questions, sign-ins" />
        <Stat label="Applied this week" value={appliedWeek} sub={`Daily cap ${settings.dailyCap}`} />
        <Stat label="Interviews & responses" value={responses} tone={responses ? 'ok' : undefined} sub={emailOk ? 'Tracked from your inbox' : 'Connect email to track'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Best matches right now" actions={<Button size="sm" kind="quiet" onClick={() => go('3')}>See the board →</Button>}>
          {top.length === 0 ? (
            <div className="py-6 text-sm text-muted">No jobs yet. Refresh the board to pull in listings from government sites, company boards, and remote feeds.</div>
          ) : (
            <div className="divide-y divide-line">
              {top.map((j) => (
                <button key={j.id} onClick={() => go('3', { jobId: j.id })} className="flex w-full items-center gap-4 py-3 text-left hover:bg-white/[0.02]">
                  <Score value={j.interviewScore} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{j.title}</div>
                    <div className="truncate text-xs text-muted">
                      {j.company} · {j.location || j.remoteType}
                    </div>
                  </div>
                  {j.remoteType === 'remote' && <Badge tone="info">Remote</Badge>}
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title="Inbox activity" actions={<Button size="sm" kind="quiet" onClick={() => go('6')}>Analytics →</Button>}>
          {!emailOk ? (
            <div className="text-sm text-muted">
              Connect your dedicated job-search Gmail so JobSweep can spot interview invites and rejections automatically.
              <div className="mt-3">
                <Button size="sm" onClick={() => go('M', { tab: 'email' })}>
                  Set up email
                </Button>
              </div>
            </div>
          ) : emails.length === 0 ? (
            <div className="text-sm text-muted">No job emails yet.</div>
          ) : (
            <div className="space-y-2">
              {emails.slice(0, 7).map((e) => (
                <div key={e.id} className="flex items-start gap-3 text-sm">
                  <Badge tone={e.classification === 'interview' || e.classification === 'offer' ? 'ok' : e.classification === 'rejection' ? 'bad' : e.classification === 'assessment' ? 'warn' : 'neutral'}>{e.classification}</Badge>
                  <div className="min-w-0">
                    <div className="truncate text-text">{e.subject}</div>
                    <div className="truncate text-xs text-faint">
                      {e.from} · {timeAgo(e.receivedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
