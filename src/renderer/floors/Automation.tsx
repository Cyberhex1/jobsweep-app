import { Fragment, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ApplicationStatus } from '@shared/types'
import { api, type ApiResult } from '../lib/api'
import { errMsg, timeAgo, useEvent, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Callout, Card, Empty, Segmented, Spinner, cx } from '../ui/kit'
import { toast } from '../ui/toast'

type AppItem = ApiResult<'applications', 'list'>[number]

const STATUS_TONE: Record<ApplicationStatus, 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brass'> = {
  queued: 'neutral',
  filling: 'info',
  ready_for_review: 'brass',
  needs_you: 'warn',
  submitted: 'info',
  failed: 'bad',
  confirmed: 'info',
  rejected: 'bad',
  interview: 'ok',
  assessment: 'ok',
  offer: 'ok',
  withdrawn: 'neutral'
}

export function Automation() {
  const { settings, go } = useNav()
  const [tab, setTab] = useState<'deck' | 'needs' | 'all' | 'runs' | 'accounts'>('deck')
  const apps = useLoad(() => api.applications.list())
  const running = useLoad(() => api.applications.isRunning())
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<{ current: string; attempted: number; submitted: number; readyForReview: number; needsYou: number; failed: number } | null>(null)
  useEvent('apply:status', (m: string) => setStatus(m))
  useEvent('run:progress', (p) => setProgress(p))
  useEvent(['apply:changed', 'run:done'], () => {
    void apps.reload()
    void running.reload()
  })
  useEvent('run:done', () => setProgress(null))

  const deck = apps.data?.filter((a) => a.status === 'ready_for_review') ?? []
  const needs = apps.data?.filter((a) => a.status === 'needs_you') ?? []
  const mode = settings?.mode ?? 'review'

  return (
    <div>
      <FloorHeader
        title="Automation"
        sub={mode === 'auto' ? `Auto mode: JobSweep submits up to ${settings?.dailyCap} applications a day and reports back.` : `Review mode: JobSweep fills applications and stacks them here for you to approve.`}
        actions={
          <>
            <Button kind="quiet" onClick={() => go('M', { tab: 'automation' })}>
              Settings
            </Button>
            {running.data ? (
              <Button kind="danger" onClick={async () => void (await api.applications.stop(), toast.info('Stopping after the current application…'))}>
                Stop
              </Button>
            ) : (
              <Button
                kind="brass"
                size="lg"
                onClick={async () => {
                  try {
                    await api.applications.runBatch()
                    await running.reload()
                    toast.info('Running… you can keep using the app.')
                  } catch (e) {
                    toast.error(errMsg(e))
                  }
                }}
              >
                ✦ Apply for me
              </Button>
            )}
          </>
        }
      />
      {(running.data || progress) && (
        <Card className="mb-5">
          <div className="flex items-center gap-4">
            <Spinner className="text-brass" />
            <div className="flex-1">
              <div className="text-sm text-text">{progress?.current ?? 'Starting…'}</div>
              <div className="text-xs text-muted">{status}</div>
            </div>
            {progress && (
              <div className="flex gap-2">
                <Badge>{progress.attempted} tried</Badge>
                <Badge tone="info">{progress.submitted} submitted</Badge>
                <Badge tone="brass">{progress.readyForReview} to review</Badge>
                <Badge tone="warn">{progress.needsYou} need you</Badge>
                <Badge tone="bad">{progress.failed} failed</Badge>
              </div>
            )}
          </div>
        </Card>
      )}
      <div className="mb-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'deck', label: `Review deck (${deck.length})` },
            { value: 'needs', label: `Needs you (${needs.length})` },
            { value: 'all', label: 'All applications' },
            { value: 'runs', label: 'Run history' },
            { value: 'accounts', label: 'Site accounts' }
          ]}
        />
      </div>
      {tab === 'deck' && <Deck items={deck} reload={apps.reload} />}
      {tab === 'needs' && <NeedsYou items={needs} reload={apps.reload} />}
      {tab === 'all' && <AllApps items={apps.data ?? []} reload={apps.reload} />}
      {tab === 'runs' && <Runs />}
      {tab === 'accounts' && <Accounts />}
    </div>
  )
}

function Deck({ items, reload }: { items: AppItem[]; reload: () => Promise<void> }) {
  const [i, setI] = useState(0)
  const item = items[Math.min(i, items.length - 1)]
  if (!items.length)
    return (
      <Empty title="Nothing waiting for review">
        Press <b>Apply for me</b> and JobSweep will fill out applications for your best matches and stack them here. Nothing is submitted until you approve it.
      </Empty>
    )
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>
          Card {Math.min(i, items.length - 1) + 1} of {items.length}
        </span>
        <div className="flex gap-2">
          <Button size="sm" kind="quiet" disabled={i === 0} onClick={() => setI(i - 1)}>
            ← Previous
          </Button>
          <Button size="sm" kind="quiet" disabled={i >= items.length - 1} onClick={() => setI(i + 1)}>
            Next →
          </Button>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={item.id} initial={{ opacity: 0, x: 30, rotate: 0.5 }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={{ opacity: 0, x: -60, rotate: -1 }} transition={{ duration: 0.25 }}>
          <AppCard item={item} reload={reload} onDone={() => setI((x) => Math.max(0, Math.min(x, items.length - 2)))} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function AppCard({ item, reload, onDone }: { item: AppItem; reload: () => Promise<void>; onDone?: () => void }) {
  const [shot, setShot] = useState(0)
  const img = useLoad(() => (item.screenshots[shot] ? api.app.readImage(item.screenshots[shot]) : Promise.resolve(null)), [item.id, shot])
  const resume = useLoad(() => (item.job ? api.resume.tailoredFor(item.job.id) : Promise.resolve([])), [item.id])
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      toast.success(msg)
      onDone?.()
      await reload()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
  const low = item.fieldValues.filter((f) => f.confidence < 0.7)
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="grid xl:grid-cols-[1.1fr_1fr]">
        <div className="border-r border-line bg-black/30 p-4">
          {img.data ? <img src={img.data} className="max-h-[560px] w-full rounded-lg object-contain object-top" /> : <div className="grid h-[400px] place-items-center text-sm text-faint">No screenshot</div>}
          {item.screenshots.length > 1 && (
            <div className="mt-3 flex justify-center gap-1.5">
              {item.screenshots.map((_, k) => (
                <button key={k} onClick={() => setShot(k)} className={cx('h-2 w-6 rounded-full', k === shot ? 'bg-brass' : 'bg-white/15')} />
              ))}
            </div>
          )}
        </div>
        <div className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={STATUS_TONE[item.status]}>{item.status.replace(/_/g, ' ')}</Badge>
            {item.job?.platform && <Badge tone="info">{item.job.platform}</Badge>}
          </div>
          <h3 className="font-display text-xl font-semibold">{item.job?.title}</h3>
          <div className="text-sm text-muted">
            {item.job?.company} · {item.job?.location}
          </div>
          {resume.data && resume.data.length > 0 && (
            <div className="mt-2 text-xs text-muted">
              Resume: <span className="text-brass-2">{String((resume.data[0] as { label: string }).label)}</span>{' '}
              <button className="underline" onClick={() => api.app.openPath(String((resume.data![0] as { docx_path: string }).docx_path))}>
                open
              </button>
            </div>
          )}
          {item.needsReason && (
            <div className="mt-3">
              <Callout tone="warn">{item.needsReason}</Callout>
            </div>
          )}
          {item.job && <QuickAnswers reason={item.needsReason} jobId={item.job.id} onRetried={reload} />}
          {low.length > 0 && (
            <div className="mt-3">
              <Callout tone="info">{low.length} answer(s) are AI drafts or low-confidence — they’re highlighted below.</Callout>
            </div>
          )}
          <div className="mt-4 max-h-[340px] overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <tbody>
                {item.fieldValues.map((f, k) => (
                  <tr key={k} className={cx('border-b border-line/60', f.confidence < 0.7 && 'bg-warn/5')}>
                    <td className="w-[42%] px-3 py-2 align-top text-muted">{f.label}</td>
                    <td className="selectable px-3 py-2 text-text">{f.value.length > 160 ? f.value.slice(0, 160) + '…' : f.value}</td>
                    <td className="px-2 py-2 text-right">
                      <Badge tone={f.source === 'ai' ? 'warn' : f.confidence >= 0.85 ? 'ok' : 'neutral'}>{f.source === 'answer_bank' ? 'answers' : f.source}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {item.status === 'ready_for_review' && (
              <Button kind="brass" onClick={() => act(() => api.applications.approve(item.id), 'Submitted!')}>
                Approve & submit
              </Button>
            )}
            {item.job && (
              <Button onClick={() => act(() => api.applications.assist(item.job!.id), 'Opened and filled in the browser. Submit it there, then mark it submitted here.')}>
                Open filled form in browser
              </Button>
            )}
            {item.status === 'needs_you' && (
              <Button kind="brass" onClick={() => act(() => api.applications.markSubmitted(item.id), 'Marked as submitted.')}>
                I submitted it
              </Button>
            )}
            {item.job && item.status === 'needs_you' && (
              <Button onClick={() => act(() => api.applications.prepare(item.job!.id), 'Retried.')}>
                Retry
              </Button>
            )}
            <Button kind="quiet" onClick={() => act(() => api.applications.discard(item.id), 'Discarded.')}>
              Discard
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function NeedsYou({ items, reload }: { items: AppItem[]; reload: () => Promise<void> }) {
  if (!items.length) return <Empty title="Nothing needs you">When JobSweep hits a CAPTCHA, a sign-in, or a question it can’t answer, it parks the application here and notifies you.</Empty>
  return (
    <div className="space-y-4">
      {items.map((a) => (
        <AppCard key={a.id} item={a} reload={reload} />
      ))}
    </div>
  )
}

function AllApps({ items, reload }: { items: AppItem[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!items.length) return <Empty title="No applications yet" />
  return (
    <Card pad={false}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="px-5 py-3">Job</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Mode</th>
            <th className="px-3 py-3">Submitted</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <Fragment key={a.id}>
              <tr className="border-b border-line/60 hover:bg-white/[0.02]">
                <td className="px-5 py-2.5">
                  <div className="text-text">{a.job?.title}</div>
                  <div className="text-xs text-muted">{a.job?.company}</div>
                </td>
                <td className="px-3">
                  <Badge tone={STATUS_TONE[a.status]}>{a.status.replace(/_/g, ' ')}</Badge>
                </td>
                <td className="px-3 text-xs text-muted">{a.mode}</td>
                <td className="px-3 text-xs text-muted">{a.submittedAt ? timeAgo(a.submittedAt) : '—'}</td>
                <td className="px-3 text-right">
                  <select
                    className="field !w-36 !py-1 text-xs"
                    value=""
                    onChange={async (e) => {
                      if (!e.target.value) return
                      await api.applications.setStatus(a.id, e.target.value as ApplicationStatus)
                      await reload()
                    }}
                  >
                    <option value="">Set status…</option>
                    {['submitted', 'interview', 'assessment', 'offer', 'rejected', 'withdrawn'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" kind="quiet" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {open === a.id ? 'Hide' : 'Timeline'}
                  </Button>
                </td>
              </tr>
              {open === a.id && (
                <tr>
                  <td colSpan={5} className="bg-black/20 px-5 py-3">
                    <Timeline id={a.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function Timeline({ id }: { id: number }) {
  const ev = useLoad(() => api.applications.events(id), [id])
  return (
    <div className="space-y-1 text-xs">
      {ev.data?.map((e, i) => (
        <div key={i} className="flex gap-3">
          <span className="w-28 text-faint">{new Date(e.at).toLocaleString()}</span>
          <span className="text-muted">{e.kind}</span>
          <span className="text-text">{e.details}</span>
        </div>
      ))}
    </div>
  )
}

function Runs() {
  const runs = useLoad(() => api.applications.runs())
  if (!runs.data?.length) return <Empty title="No runs yet" />
  return (
    <div className="space-y-3">
      {runs.data.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text">{new Date(r.startedAt).toLocaleString()}</span>
            <Badge tone="brass">{r.mode}</Badge>
            <Badge>{r.attempted} tried</Badge>
            <Badge tone="info">{r.submitted} submitted</Badge>
            <Badge tone="brass">{r.readyForReview} to review</Badge>
            <Badge tone="warn">{r.needsYou} need you</Badge>
            <Badge tone="bad">{r.failed} failed</Badge>
          </div>
          {r.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  )
}

function Accounts() {
  const acc = useLoad(() => api.applications.accounts())
  const [shown, setShown] = useState<Record<string, string>>({})
  if (!acc.data?.length) return <Empty title="No site accounts yet">When a site needs an account, JobSweep creates one with your application email and a unique strong password, and stores it here encrypted.</Empty>
  return (
    <Card pad={false}>
      {acc.data.map((a) => (
        <div key={a.scope} className="flex items-center gap-4 border-b border-line/60 px-5 py-3 text-sm">
          <div className="flex-1">
            <div className="text-text">{a.scope}</div>
            <div className="text-xs text-muted">
              {a.username} · created {timeAgo(a.createdAt)} · {a.status}
            </div>
          </div>
          <span className="selectable font-mono text-xs text-brass-2">{shown[a.scope] ?? '••••••••••••'}</span>
          <Button size="sm" kind="quiet" onClick={async () => {
              const pw = shown[a.scope] ? '' : ((await api.applications.revealPassword(a.scope)) ?? '')
              setShown((s) => ({ ...s, [a.scope]: pw }))
            }}>
            {shown[a.scope] ? 'Hide' : 'Show'}
          </Button>
          <Button size="sm" kind="quiet" onClick={async () => {
              if (!confirm('Forget this account?')) return
              await api.applications.deleteAccount(a.scope)
              await acc.reload()
            }}>
            Forget
          </Button>
        </div>
      ))}
    </Card>
  )
}

/** Answer the new questions an application stopped on, then retry it. */
function QuickAnswers({ reason, jobId, onRetried }: { reason: string | null; jobId: number; onRetried: () => Promise<void> }) {
  const questions = [...(reason ?? '').matchAll(/(?:New question|needs your answer|Approve the drafted answer for): ?"([^"]+)"/g)].map((m) => m[1])
  const fromNeeds = [...(reason ?? '').matchAll(/"([^"]+)" needs your answer/g)].map((m) => m[1])
  const all = [...new Set([...questions, ...fromNeeds])]
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (!all.length) return null
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-brass/30 bg-brass/5 p-3">
      <div className="text-xs font-medium uppercase tracking-wider text-brass">Answer once — saved to your answer bank</div>
      {all.map((q) => (
        <div key={q}>
          <div className="mb-1 text-xs text-text">{q}</div>
          <div className="flex gap-2">
            <input className="field !py-1.5 text-sm" value={answers[q] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} placeholder="Your answer" />
            <Button size="sm" onClick={async () => setAnswers((a) => ({ ...a, [q]: 'Yes' }))}>
              Yes
            </Button>
            <Button size="sm" onClick={async () => setAnswers((a) => ({ ...a, [q]: 'No' }))}>
              No
            </Button>
          </div>
        </div>
      ))}
      <Button
        kind="brass"
        size="sm"
        disabled={all.some((q) => !answers[q]?.trim())}
        onClick={async () => {
          try {
            for (const q of all) await api.answers.answerQuestion(q, answers[q].trim())
            toast.info('Saved. Retrying the application…')
            await api.applications.prepare(jobId)
            await onRetried()
          } catch (e) {
            toast.error(errMsg(e))
          }
        }}
      >
        Save answers & retry
      </Button>
    </div>
  )
}
