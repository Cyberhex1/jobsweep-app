import { useState } from 'react'
import type { SiteRecipe } from '@shared/types'
import { api } from '../lib/api'
import { errMsg, timeAgo, useEvent, useLoad } from '../lib/hooks'
import { FloorHeader } from '../App'
import { Badge, Button, Callout, Card, Empty, Input, Spinner, TextArea, cx } from '../ui/kit'
import { toast } from '../ui/toast'

const KEYS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'address_line1', 'city', 'state', 'zip', 'country', 'linkedin', 'website', 'current_employer', 'current_title', 'work_authorized', 'needs_sponsorship', 'salary_expectation', 'start_date', 'relocate', 'how_heard', 'years_experience', 'education_level', 'school', 'degree', 'field_of_study', 'graduation_year', 'resume_upload', 'cover_letter', 'why_company', 'skip']

export function SiteLearningFloor() {
  const recipes = useLoad(() => api.sites.recipes())
  const [url, setUrl] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [current, setCurrent] = useState<{ scope: string; recipe: SiteRecipe; expectedMissing: string[] } | null>(null)
  useEvent('apply:status', (m: string) => setStatus(m))

  const run = async () => {
    if (!url.trim()) return
    setBusy(true)
    try {
      setCurrent(await api.sites.test(url.trim(), shots))
      await recipes.reload()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <FloorHeader title="Site Learning" sub="Show JobSweep a new application site. It test-fills the form without ever submitting, shows you the result, and learns from your corrections." />
      <Card className="mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <Input value={url} onChange={setUrl} placeholder="https://company.wd5.myworkdayjobs.com/… or any application link" onEnter={run} />
          <Button onClick={async () => setShots(await api.sites.pickScreenshots())}>{shots.length ? `${shots.length} screenshot(s)` : 'Add screenshots (optional)'}</Button>
          <Button kind="brass" onClick={run} busy={busy}>
            Run test
          </Button>
        </div>
        <div className="mt-3 text-xs text-muted">The submit button is locked during tests. If the site needs an account, JobSweep uses (or creates) one for you. Screenshots help it notice fields it missed.</div>
        {busy && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner className="text-brass" /> {status || 'Opening the site…'}
          </div>
        )}
      </Card>
      {current && <TestResult key={current.recipe.version + current.recipe.lastTest!.at} data={current} onUpdate={setCurrent} reload={recipes.reload} />}
      <h2 className="mt-8 mb-3 font-display text-lg font-semibold">Learned sites</h2>
      {!recipes.data?.length ? (
        <Empty title="No sites learned yet">Greenhouse, Lever, Ashby, Workday, and most standard forms work out of the box. Teach JobSweep any site that gives it trouble.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recipes.data.map((r) => (
            <Card key={r.scope}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-text">{r.scope}</div>
                {r.approved ? <Badge tone="ok">Auto-apply ready</Badge> : <Badge tone="warn">Not approved</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted">
                v{r.version} · {Object.keys(r.mappings).length} custom rules · tested {timeAgo(r.lastTest?.at)}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => {
                    if (r.lastTest) setCurrent({ scope: r.scope, recipe: r, expectedMissing: [] })
                  }}>
                  View last test
                </Button>
                <Button size="sm" kind="quiet" onClick={async () => void (await api.sites.delete(r.scope), await recipes.reload())}>
                  Forget
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function TestResult({ data, onUpdate, reload }: { data: { scope: string; recipe: SiteRecipe; expectedMissing: string[] }; onUpdate: (d: { scope: string; recipe: SiteRecipe; expectedMissing: string[] }) => void; reload: () => Promise<void> }) {
  const test = data.recipe.lastTest!
  const [page, setPage] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [manual, setManual] = useState<Record<string, string>>({})
  const img = useLoad(() => (test.pages[page] ? api.app.readImage(test.pages[page].screenshot) : Promise.resolve(null)), [page, test.at])
  const p = test.pages[page]
  const filled = test.pages.flatMap((x) => x.fields).filter((f) => f.value).length
  const total = test.pages.flatMap((x) => x.fields).length
  return (
    <Card
      title={`Test of ${data.scope}`}
      actions={
        <>
          <Badge tone={filled === total ? 'ok' : 'warn'}>
            {filled}/{total} fields filled
          </Badge>
          <Badge tone="ok">Submit locked</Badge>
        </>
      }
    >
      {test.errors.length > 0 && (
        <div className="mb-4">
          <Callout tone="warn">{test.errors.join(' · ')}</Callout>
        </div>
      )}
      {data.expectedMissing.length > 0 && (
        <div className="mb-4">
          <Callout tone="info">Seen in your screenshots but not found on the page: {data.expectedMissing.join(', ')}</Callout>
        </div>
      )}
      {!test.pages.length ? (
        <div className="text-sm text-muted">No form pages were reached.</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <div>
            <div className="mb-2 flex gap-1.5">
              {test.pages.map((pg, i) => (
                <button key={i} onClick={() => setPage(i)} className={cx('rounded-lg px-2.5 py-1 text-xs', i === page ? 'bg-brass/20 text-brass-2' : 'text-muted hover:text-text')}>
                  Page {i + 1}
                </button>
              ))}
            </div>
            {img.data && <img src={img.data} className="max-h-[600px] w-full rounded-xl border border-line object-contain object-top" />}
          </div>
          <div className="max-h-[640px] overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-ink-2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Filled with</th>
                  <th className="px-3 py-2">Rule</th>
                </tr>
              </thead>
              <tbody>
                {p?.fields.map((f, i) => (
                  <tr key={i} className={cx('border-t border-line/60', !f.value && f.required && 'bg-bad/5', !f.value && !f.required && 'bg-warn/[0.03]')}>
                    <td className="px-3 py-2 align-top">
                      <div className="text-text">
                        {f.label}
                        {f.required && <span className="text-bad"> *</span>}
                      </div>
                      <div className="text-faint">{f.type}</div>
                    </td>
                    <td className="selectable px-3 py-2 align-top text-text">{f.value || <span className="text-faint">empty</span>}</td>
                    <td className="px-3 py-2 align-top">
                      <select className="field !py-1 text-xs" value={manual[f.label] ?? f.key ?? ''} onChange={(e) => setManual((m) => ({ ...m, [f.label]: e.target.value }))}>
                        <option value="">auto</option>
                        {KEYS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <TextArea value={feedback} onChange={setFeedback} rows={2} placeholder="Tell JobSweep what went wrong, e.g. “Desired salary got my hourly rate — use $55,000” or “skip the middle name box”." />
        <div className="flex flex-col gap-2">
          <Button
            onClick={async () => {
              try {
                onUpdate(await api.sites.feedback(data.scope, feedback, manual))
                setFeedback('')
                setManual({})
                toast.success('Updated the rules and re-tested.')
              } catch (e) {
                toast.error(errMsg(e))
              }
            }}
          >
            Fix & re-test
          </Button>
          <Button
            kind="brass"
            onClick={async () => {
              await api.sites.approve(data.scope)
              await reload()
              toast.success(`${data.scope} added to your auto sites.`)
            }}
          >
            Looks right — approve
          </Button>
        </div>
      </div>
    </Card>
  )
}
