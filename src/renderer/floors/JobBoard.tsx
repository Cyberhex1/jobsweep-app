import { useEffect, useState } from 'react'
import type { Job } from '@shared/types'
import { api } from '../lib/api'
import { errMsg, money, timeAgo, useEvent, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Callout, Card, Drawer, Empty, Input, Score, Segmented, Select, Spinner, cx } from '../ui/kit'
import { toast } from '../ui/toast'

type Sort = 'interview' | 'match' | 'newest' | 'pay'

export function JobBoard() {
  const { params } = useNav()
  const board = useLoad(() => api.jobs.board())
  const [source, setSource] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>((params.jobId as number) ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [importUrl, setImportUrl] = useState('')
  useEvent('jobs:progress', (p: { source: string; status: string }) => setProgress((x) => ({ ...x, [p.source]: p.status })))
  useEvent('jobs:changed', () => void board.reload())

  const refresh = async () => {
    setRefreshing(true)
    setProgress({})
    try {
      const r = await api.jobs.refresh()
      const errors = Object.entries(r.bySource).filter(([, v]) => v.error)
      toast.success(`${r.added} new jobs · ${r.merged} duplicates merged${errors.length ? ` · ${errors.length} source(s) had errors` : ''}`)
      await board.reload()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <FloorHeader
        title="Job Board"
        sub="Every source in one place. Expand a card for its best matches; JobSweep learns which sources you like."
        actions={
          <>
            <div className="flex w-[380px] gap-2">
              <Input value={importUrl} onChange={setImportUrl} placeholder="Paste a job link to import…" onEnter={() => void doImport()} />
              <Button onClick={doImport}>Import</Button>
            </div>
            <Button kind="brass" onClick={refresh} busy={refreshing}>
              Refresh jobs
            </Button>
          </>
        }
      />
      {refreshing && (
        <Card className="mb-5">
          <div className="flex flex-wrap gap-2">
            {Object.entries(progress).map(([s, st]) => (
              <Badge key={s} tone={st.startsWith('error') ? 'bad' : st.startsWith('found') ? 'ok' : 'neutral'} title={st}>
                {s}: {st.startsWith('error') ? 'error' : st}
              </Badge>
            ))}
            {!Object.keys(progress).length && <span className="text-sm text-muted">Starting…</span>}
          </div>
        </Card>
      )}
      {source ? (
        <SourceList source={source} onBack={() => setSource(null)} onOpen={setOpen} />
      ) : !board.data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-72 rounded-2xl" />
          ))}
        </div>
      ) : board.data.every((c) => c.total === 0) ? (
        <Empty title="The board is empty" action={<Button kind="brass" onClick={refresh}>Refresh jobs now</Button>}>
          Refresh to pull jobs from NC state and local government, USAJOBS, company boards, and remote feeds. Fill in your profile first for better matches — without it you’ll see the newest jobs near you.
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {board.data.map((c) => (
            <SourceCard key={c.source} card={c} onOpen={setOpen} onMore={() => (setSource(c.source), void api.jobs.sourceSignal(c.source))} />
          ))}
        </div>
      )}
      <JobDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void board.reload()} />
    </div>
  )

  async function doImport() {
    if (!importUrl.trim()) return
    try {
      const r = await api.jobs.importUrl(importUrl.trim())
      toast.success(r.assistOnly ? `Imported "${r.job?.title}". No company application site found yet — it will use assist mode.` : `Imported "${r.job?.title}".`)
      setImportUrl('')
      await board.reload()
      if (r.job) setOpen(r.job.id)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}

function SourceCard({ card, onOpen, onMore }: { card: { source: string; label: string; total: number; jobs: Job[] }; onOpen: (id: number) => void; onMore: () => void }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <Card
      pad={false}
      title={
        <button className="flex items-center gap-3 text-left" onClick={() => setExpanded(!expanded)}>
          <SourceMark source={card.source} />
          <div>
            <div className="font-display text-[15px] font-semibold">{card.label}</div>
            <div className="text-xs text-muted">{card.total} jobs</div>
          </div>
        </button>
      }
      actions={
        <Button size="sm" kind="quiet" onClick={() => setExpanded(!expanded)}>
          {expanded ? '−' : '+'}
        </Button>
      }
    >
      {expanded && (
        <div className="pb-2">
          {card.jobs.length === 0 ? (
            <div className="px-5 pb-4 text-sm text-muted">{card.source === 'imported' ? 'Use the Edge extension’s “Import to JobSweep” button on LinkedIn, Indeed, Hiring Cafe, and more.' : 'No jobs yet.'}</div>
          ) : (
            card.jobs.map((j) => <JobRow key={j.id} job={j} onOpen={onOpen} />)
          )}
          {card.total > 5 && (
            <button onClick={onMore} className="mx-5 mt-1 mb-2 text-sm text-brass hover:text-brass-2 hover:underline">
              See all {card.total} →
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function SourceMark({ source }: { source: string }) {
  const map: Record<string, [string, string]> = {
    imported: ['IN', '#7aa7e8'],
    ncstate: ['NC', '#5bc79a'],
    governmentjobs: ['GOV', '#5bc79a'],
    usajobs: ['US', '#e5675f'],
    workday: ['WD', '#e6b450'],
    greenhouse: ['GH', '#5bc79a'],
    lever: ['LV', '#c9a961'],
    ashby: ['AB', '#a78bfa'],
    smartrecruiters: ['SR', '#7aa7e8'],
    adzuna: ['AZ', '#e5675f'],
    jsearch: ['JS', '#7aa7e8'],
    remotive: ['RM', '#5bc79a'],
    remoteok: ['RO', '#e6b450'],
    themuse: ['TM', '#a78bfa'],
    arbeitnow: ['AN', '#9a968c']
  }
  const [t, c] = map[source] ?? [source.slice(0, 2).toUpperCase(), '#9a968c']
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl border font-mono text-[11px] font-bold" style={{ borderColor: c + '66', color: c, background: c + '14' }}>
      {t}
    </span>
  )
}

export function JobRow({ job, onOpen }: { job: Job; onOpen: (id: number) => void }) {
  return (
    <button onClick={() => (onOpen(job.id), void api.jobs.signal(job.id, 'view'))} className="flex w-full items-center gap-4 border-t border-line px-5 py-3 text-left transition hover:bg-white/[0.025]">
      <Score value={job.interviewScore} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{job.title}</div>
        <div className="truncate text-xs text-muted">
          {job.company} · {job.location || '—'} {job.postedAt && `· ${timeAgo(job.postedAt)}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {money(job.payMin, job.payMax, job.payUnit) && <Badge>{money(job.payMin, job.payMax, job.payUnit)}</Badge>}
        {job.remoteType === 'remote' && <Badge tone="info">Remote</Badge>}
        {job.remoteType === 'hybrid' && <Badge tone="info">Hybrid</Badge>}
        {job.scamScore >= 40 && <Badge tone="bad">Risky</Badge>}
        {job.sightings.length > 1 && <Badge title={job.sightings.map((s) => s.source).join(', ')}>×{job.sightings.length}</Badge>}
        {job.saved && <Badge tone="brass">Saved</Badge>}
      </div>
    </button>
  )
}

function SourceList({ source, onBack, onOpen }: { source: string; onBack: () => void; onOpen: (id: number) => void }) {
  const [sort, setSort] = useState<Sort>('interview')
  const [remote, setRemote] = useState('any')
  const [q, setQ] = useState('')
  const [minPay, setMinPay] = useState('')
  const [page, setPage] = useState(0)
  const list = useLoad(() => api.jobs.list({ source, sort, remote, q, minPay: minPay ? Number(minPay) : undefined, limit: 40, offset: page * 40 }), [source, sort, remote, q, minPay, page])
  useEffect(() => setPage(0), [sort, remote, q, minPay])
  return (
    <Card
      pad={false}
      title={
        <div className="flex items-center gap-3">
          <Button size="sm" kind="quiet" onClick={onBack}>
            ← Back
          </Button>
          <SourceMark source={source} />
          <span className="font-display text-[15px] font-semibold">{list.data?.total ?? '…'} jobs</span>
        </div>
      }
      actions={
        <>
          <Input value={q} onChange={setQ} placeholder="Filter by title, company…" className="w-56" />
          <Input value={minPay} onChange={setMinPay} placeholder="Min $/yr" type="number" className="w-28" />
          <Select value={remote} onChange={setRemote} options={[{ value: 'any', label: 'Any arrangement' }, { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'onsite', label: 'On-site' }]} className="w-40" />
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'interview', label: 'Likely interview' },
              { value: 'match', label: 'Best match' },
              { value: 'newest', label: 'Newest' },
              { value: 'pay', label: 'Highest pay' }
            ]}
          />
        </>
      }
    >
      {list.loading && !list.data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : (
        list.data?.jobs.map((j) => <JobRow key={j.id} job={j} onOpen={onOpen} />)
      )}
      {list.data && list.data.total > 40 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
          <Button size="sm" kind="quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Previous
          </Button>
          Page {page + 1} of {Math.ceil(list.data.total / 40)}
          <Button size="sm" kind="quiet" disabled={(page + 1) * 40 >= list.data.total} onClick={() => setPage(page + 1)}>
            Next →
          </Button>
        </div>
      )}
    </Card>
  )
}

export function JobDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const d = useLoad(async () => (id ? api.jobs.get(id) : null), [id])
  const { go } = useNav()
  const job = d.data?.job
  const app = d.data?.application
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) toast.success(msg)
      await d.reload()
      onChanged()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
  return (
    <Drawer open={!!id} onClose={onClose} width={720}>
      {!job ? (
        <Spinner />
      ) : (
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            {job.sightings.map((s) => (
              <Badge key={s.source + s.url}>{s.source}</Badge>
            ))}
            {job.platform && <Badge tone="info">{job.platform}</Badge>}
            <span>{job.postedAt ? `Posted ${timeAgo(job.postedAt)}` : `Found ${timeAgo(job.firstSeen)}`}</span>
          </div>
          <h2 className="selectable font-display text-2xl font-semibold">{job.title}</h2>
          <div className="selectable mt-1 text-sm text-muted">
            {job.company} · {job.location} · {job.remoteType !== 'unknown' && job.remoteType} {money(job.payMin, job.payMax, job.payUnit) && `· ${money(job.payMin, job.payMax, job.payUnit)}`}
          </div>
          <div className="mt-5 flex items-center gap-5">
            <Score value={job.matchScore} size={64} label="Match" />
            <Score value={job.interviewScore} size={64} label="Likely to get an interview" />
            <div className="text-xs text-muted">
              <div>Match / likely interview</div>
              <ul className="mt-1 list-disc pl-4">
                {job.matchReasons.slice(0, 4).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          {job.missingKeywords.length > 0 && (
            <div className="mt-4 text-xs text-muted">
              Not on your resume: {job.missingKeywords.map((k) => <Badge key={k} tone="warn">{k}</Badge>)}
            </div>
          )}
          {job.scamScore >= 25 && (
            <div className="mt-4">
              <Callout tone="bad">
                <b>Possible scam or ghost job ({job.scamScore}/100).</b> {job.scamReasons.join(' · ')}
              </Callout>
            </div>
          )}
          {job.blocked && (
            <div className="mt-4">
              <Callout tone="warn">This company is on your blocklist.</Callout>
            </div>
          )}
          {!job.applyUrl && (
            <div className="mt-4">
              <Callout tone="info">JobSweep hasn’t found this job on the company’s own site yet, so it will use assist mode: it fills the form and you click submit.</Callout>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {app ? (
              <Button kind="brass" onClick={() => (onClose(), go('4'))}>
                Application: {app.status.replace(/_/g, ' ')} →
              </Button>
            ) : (
              <>
                <Button kind="brass" disabled={job.blocked} onClick={() => act(() => api.applications.prepare(job.id), 'Prepared. It’s waiting in your review deck.')}>
                  Prepare application
                </Button>
                <Button disabled={job.blocked} onClick={() => act(() => api.applications.assist(job.id), 'Filled in the browser — review and submit it there.')}>
                  Fill it for me (I’ll submit)
                </Button>
              </>
            )}
            <Button onClick={() => act(() => api.jobs.signal(job.id, 'open'))}>Open posting</Button>
            <Button kind="quiet" onClick={() => act(() => api.jobs.signal(job.id, 'save'), job.saved ? 'Unsaved.' : 'Saved.')}>
              {job.saved ? 'Unsave' : 'Save'}
            </Button>
            <Button kind="quiet" onClick={() => act(async () => (await api.jobs.signal(job.id, 'dismiss'), onClose()), 'Hidden. JobSweep will show fewer like it.')}>
              Not interested
            </Button>
          </div>
          <div className={cx('prose-job selectable mt-6 rounded-xl border border-line bg-black/20 p-5 text-[13px]')}>{job.description || 'No description available. Open the posting to read it.'}</div>
        </div>
      )}
    </Drawer>
  )
}
