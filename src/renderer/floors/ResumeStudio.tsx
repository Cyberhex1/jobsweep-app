import { useEffect, useMemo, useRef, useState } from 'react'
import type { LintFinding, ResumeExperience, ResumeStructured, ResumeVersion } from '@shared/types'
import { api, type ApiResult } from '../lib/api'
import { errMsg, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Callout, Card, Empty, Input, Label, Segmented, Tags, TextArea, cx } from '../ui/kit'
import { toast } from '../ui/toast'

type ResumeList = ApiResult<'resume', 'list'>

export function ResumeStudio() {
  const [tab, setTab] = useState<'resume' | 'cover'>('resume')
  const list = useLoad(() => api.resume.list())
  const [selected, setSelected] = useState<number | null>(null)
  const { go } = useNav()

  useEffect(() => {
    if (!list.data?.length || selected) return
    const def = list.data.find((r) => r.isDefault) ?? list.data[0]
    setSelected(def.defaultVersionId ?? def.versions[def.versions.length - 1]?.id ?? null)
  }, [list.data, selected])

  const importResume = async () => {
    try {
      const r = await api.resume.import()
      if (!r) return
      await list.reload()
      setSelected(r.atsId)
      toast.success('Resume imported. Your ATS version is on the right — review the suggestions, then set your default.')
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <div>
      <FloorHeader
        title="Resume Studio"
        sub="Your original next to an ATS-friendly version. Edit either, pick a default, and JobSweep tailors a copy for every job."
        actions={
          <>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'resume', label: 'Resumes' }, { value: 'cover', label: 'Cover letter' }]} />
            <Button
              onClick={async () => {
                const r = await api.resume.createBlank('Built in JobSweep')
                await list.reload()
                setSelected(r.versionId)
              }}
            >
              Create from scratch
            </Button>
            <Button kind="brass" onClick={importResume}>
              Import resume
            </Button>
          </>
        }
      />
      {tab === 'cover' ? (
        <CoverLetterEditor />
      ) : !list.data ? (
        <div className="skeleton h-96 rounded-2xl" />
      ) : list.data.length === 0 ? (
        <Empty title="No resume yet" action={<Button kind="brass" onClick={importResume}>Import your resume (.docx or .pdf)</Button>}>
          JobSweep reads your resume, checks it against what applicant tracking systems need, and builds a clean ATS version you can edit side by side.
        </Empty>
      ) : (
        <div className="space-y-5">
          {needsVersionList(list.data) && <VersionList list={list.data} selected={selected} onSelect={setSelected} reload={list.reload} />}
          {selected && list.data.some((r) => r.versions.some((v) => v.id === selected)) && (
            <Workspace key={selected} versionId={selected} list={list.data} onSelect={setSelected} reload={list.reload} onProfile={() => go('2')} onAi={() => go('M')} />
          )}
        </div>
      )}
    </div>
  )
}

function VersionList({ list, selected, onSelect, reload }: { list: ResumeList; selected: number | null; onSelect: (id: number) => void; reload: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap gap-3">
      {list.map((r) => (
        <div key={r.id} className="flex items-center gap-1 rounded-xl border border-line bg-panel p-1">
          <span className="truncate px-2 text-sm font-medium">{r.name}</span>
          {r.versions.map((v) => (
            <button
              key={v.id}
              onClick={() => onSelect(v.id)}
              className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition', selected === v.id ? 'bg-brass/10 text-brass-2' : 'text-muted hover:bg-white/[0.03] hover:text-text')}
            >
              <span className="truncate">{v.label}</span>
              {r.isDefault && r.defaultVersionId === v.id && <Badge tone="brass">Default</Badge>}
            </button>
          ))}
          <button
            className="px-2 text-xs text-faint hover:text-bad"
            onClick={async () => {
              if (!confirm(`Delete "${r.name}" and all its versions?`)) return
              await api.resume.delete(r.id)
              await reload()
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}

/** The Original/ATS toggle covers the usual single resume; the strip is only needed for more resumes or extra copies. */
function needsVersionList(list: ResumeList) {
  return list.length > 1 || list.some((r) => r.versions.some((v) => v.kind !== 'original' && v.kind !== 'ats'))
}

function Workspace({ versionId, list, onSelect, reload, onProfile, onAi }: { versionId: number; list: ResumeList; onSelect: (id: number) => void; reload: () => Promise<void>; onProfile: () => void; onAi: () => void }) {
  const all = list.flatMap((r) => r.versions)
  const version = all.find((v) => v.id === versionId)!
  const resume = list.find((r) => r.id === version.resumeId)!
  const original = resume.versions.find((v) => v.kind === 'original')
  const ats = original && resume.versions.find((v) => v.parentId === original.id && v.kind === 'ats')
  const isDefault = resume.isDefault && resume.defaultVersionId === version.id
  const onDelete = async () => {
    if (!confirm(`Delete "${resume.name}" and all its versions?`)) return
    await api.resume.delete(resume.id)
    await reload()
  }

  return (
    <div className="space-y-4">
      {original && ats && (version.id === original.id || version.id === ats.id) && (
        <Segmented
          value={version.id === original.id ? 'original' : 'ats'}
          onChange={(v) => onSelect(v === 'original' ? original.id : ats.id)}
          options={[
            { value: 'ats', label: 'ATS version' },
            { value: 'original', label: 'Original' }
          ]}
        />
      )}
      {version.kind === 'original' ? (
        <OriginalPanel version={version} />
      ) : (
        <EditorPanel key={version.id} version={version} isDefault={isDefault} reload={reload} onProfile={onProfile} onAi={onAi} onDelete={onDelete} />
      )}
    </div>
  )
}

/** Page on the left, notes on the right when there is room; stacked otherwise. */
function TwoColumn({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">{main}</div>
        <div className="min-w-0 space-y-5">{side}</div>
      </div>
    </div>
  )
}

const PAGE_W = 816 // 8.5in at 96dpi

function Preview({ versionId, stamp }: { versionId: number; stamp?: number }) {
  const html = useLoad(() => api.resume.html(versionId), [versionId, stamp])
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / PAGE_W)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const height = 760
  return (
    <div ref={box} className="overflow-hidden rounded-xl bg-white" style={{ height }}>
      <iframe title="preview" className="origin-top-left bg-white" style={{ width: PAGE_W, height: height / scale, transform: `scale(${scale})` }} srcDoc={html.data ?? ''} />
    </div>
  )
}

function Findings({ findings, score }: { findings: LintFinding[]; score: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className={cx('font-display text-3xl font-semibold', score >= 85 ? 'text-ok' : score >= 65 ? 'text-brass-2' : 'text-warn')}>{score}</div>
        <div className="text-xs text-muted">
          ATS score
          <br />
          {findings.length ? `${findings.length} thing${findings.length === 1 ? '' : 's'} to look at` : 'No issues found'}
        </div>
      </div>
      <div className="space-y-2">
        {findings.map((f, i) => (
          <div key={i} className="rounded-xl border border-line bg-black/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Badge tone={f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : 'neutral'}>{f.severity}</Badge>
              <span className="text-sm text-text">{f.title}</span>
              {f.fixable && <Badge tone="ok">auto-fix</Badge>}
            </div>
            <div className="selectable mt-1 text-xs leading-relaxed text-muted">{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OriginalPanel({ version }: { version: ResumeVersion }) {
  const lint = useLoad(() => api.resume.lint(version.id), [version.id])
  return (
    <Card
      title="Your original"
      actions={
        <Button size="sm" onClick={async () => void ((await api.resume.openOriginalFile(version.resumeId)) || toast.error('The uploaded file is no longer in the documents folder.'))}>
          Open the file you uploaded
        </Button>
      }
    >
      <div className="mb-4 text-xs text-muted">The text JobSweep read from your file, in a plain layout. Anything missing here (like a phone number in the page header) is missing for an ATS too.</div>
      <TwoColumn
        main={<Preview versionId={version.id} />}
        side={
          <div>
            <Label>ATS check of your original</Label>
            {lint.data && (
              <>
                <Findings findings={lint.data.findings} score={lint.data.score} />
                {lint.data.suggestions.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
                    {lint.data.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        }
      />
    </Card>
  )
}

type Suggestion = ApiResult<'resume', 'suggestions'>['items'][number]

function EditorPanel({
  version,
  isDefault,
  reload,
  onProfile,
  onAi,
  onDelete
}: {
  version: ResumeVersion
  isDefault: boolean
  reload: () => Promise<void>
  onProfile: () => void
  onAi: () => void
  onDelete: () => void
}) {
  const [data, setData] = useState<ResumeStructured>(version.data)
  const [dirty, setDirty] = useState(false)
  const [stamp, setStamp] = useState(0)
  const [view, setView] = useState<'edit' | 'preview'>(version.kind === 'created' ? 'edit' : 'preview')
  const lint = useLoad(() => api.resume.lint(version.id), [version.id, stamp])
  const [ideas, setIdeas] = useState<Suggestion[] | null>(null)
  const [ideasState, setIdeasState] = useState<'loading' | 'ready' | 'no-ai' | 'error'>('loading')
  const [ideasError, setIdeasError] = useState('')
  const [more, setMore] = useState(false)

  const loadIdeas = async (refresh = false) => {
    setIdeasState('loading')
    try {
      const r = await api.resume.suggestions(version.id, refresh)
      setIdeas(r.items)
      setIdeasState(r.ai ? 'ready' : 'no-ai')
    } catch (e) {
      setIdeasError(errMsg(e))
      setIdeasState('error')
    }
  }
  // Suggestions load on their own, aimed at the ATS check's bullet findings.
  useEffect(() => {
    void loadIdeas()
  }, [version.id])

  /** Accepting saves straight away; a merge removes the other bullet and shifts the remaining suggestions. */
  const accept = async (picked: Suggestion[]) => {
    const next = structuredClone(data)
    let rest = (ideas ?? []).filter((x) => !picked.includes(x))
    const queue = [...picked]
    const shift = (list: Suggestion[], job: number, r: number) =>
      list
        .filter((x) => !(x.job === job && x.bullet === r))
        .map((x) => (x.job === job ? { ...x, bullet: x.bullet > r ? x.bullet - 1 : x.bullet, remove: x.remove?.filter((k) => k !== r).map((k) => (k > r ? k - 1 : k)) } : x))
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i]
      const job = next.experience[s.job]
      if (!job || job.bullets[s.bullet] == null) continue
      job.bullets[s.bullet] = s.text
      for (const r of [...(s.remove ?? [])].filter((k) => k !== s.bullet && k < job.bullets.length).sort((x, y) => y - x)) {
        job.bullets.splice(r, 1)
        rest = shift(rest, s.job, r)
        queue.splice(i + 1, queue.length, ...shift(queue.slice(i + 1), s.job, r))
      }
    }
    setData(next)
    await api.resume.update(version.id, next)
    setDirty(false)
    setStamp((x) => x + 1)
    setIdeas(rest)
    toast.success(picked.length === 1 ? 'Suggestion applied and saved.' : `${picked.length} suggestions applied and saved.`)
  }

  const update = (fn: (d: ResumeStructured) => ResumeStructured) => {
    setData((d) => fn(structuredClone(d)))
    setDirty(true)
  }
  const save = async () => {
    await api.resume.update(version.id, data)
    setDirty(false)
    setStamp((s) => s + 1)
    toast.success('Saved.')
  }

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <h3 className="font-display text-[15px] font-semibold">{version.label}</h3>
          {isDefault && <Badge tone="brass">Default</Badge>}
        </div>
      }
      actions={
        <>
          <Segmented value={view} onChange={setView} options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]} />
          {dirty && (
            <Button size="sm" kind="brass" onClick={save}>
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {!isDefault && (
          <Button
            size="sm"
            kind="brass"
            onClick={async () => {
              if (dirty) await save()
              await api.resume.setDefault(version.resumeId, version.id)
              await reload()
              toast.success('This is now your default resume.')
              if (confirm('Pre-fill your profile from this resume?')) onProfile()
            }}
          >
            Use as my default
          </Button>
        )}
        <Button
          size="sm"
          onClick={async () => {
            const { version: v, changes } = await api.resume.fixAll(version.id)
            if (!changes.length) {
              toast.info('Nothing left to fix automatically. The remaining items in the ATS check need your input.')
              return
            }
            setData(v.data)
            setDirty(false)
            setStamp((s) => s + 1)
            toast.success(`Fixed: ${changes.join('; ')}.`)
          }}
        >
          Fix all automatically
        </Button>
        <Button size="sm" onClick={async () => void (await api.resume.exportDocx(version.id))}>
          Word
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            try {
              const r = await api.resume.exportPdf(version.id)
              toast.info(`PDF created with ${r.via === 'word' ? 'Microsoft Word' : r.via === 'libreoffice' ? 'LibreOffice' : 'the built-in renderer'}.`)
            } catch (e) {
              toast.error(errMsg(e))
            }
          }}
        >
          PDF
        </Button>
        <Button size="sm" kind="quiet" onClick={() => setMore(!more)}>
          {more ? 'Less' : 'More…'}
        </Button>
        {more && (
          <>
            <Button size="sm" onClick={async () => void (await api.resume.exportDocx(version.id, 'federal'))} title="USAJOBS-style long format">
              Federal resume
            </Button>
            <Button
              size="sm"
              kind="quiet"
              onClick={async () => {
                await api.resume.duplicate(version.id)
                await reload()
                toast.success('Copy created.')
              }}
            >
              Duplicate
            </Button>
            <Button size="sm" kind="quiet" onClick={onDelete}>
              Delete this resume
            </Button>
          </>
        )}
      </div>

      <TwoColumn
        main={view === 'preview' ? <Preview versionId={version.id} stamp={stamp} /> : <ResumeEditor data={data} update={update} />}
        side={
          <>
            <Changes versionId={version.id} stamp={stamp} />
            <AiSuggestions state={ideasState} error={ideasError} ideas={ideas} data={data} onAccept={accept} onSkip={(s) => setIdeas((x) => (x ?? []).filter((y) => y !== s))} onRefresh={() => loadIdeas(true)} onAi={onAi} />
            <div>
              <Label>ATS check</Label>
              {lint.data && <Findings findings={lint.data.findings} score={lint.data.score} />}
            </div>
          </>
        }
      />
    </Card>
  )
}

function AiSuggestions({
  state,
  error,
  ideas,
  data,
  onAccept,
  onSkip,
  onRefresh,
  onAi
}: {
  state: 'loading' | 'ready' | 'no-ai' | 'error'
  error: string
  ideas: Suggestion[] | null
  data: ResumeStructured
  onAccept: (s: Suggestion[]) => void
  onSkip: (s: Suggestion) => void
  onRefresh: () => void
  onAi: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>AI suggestions</Label>
        {state === 'ready' && (
          <button className="shrink-0 text-xs text-muted hover:text-text" onClick={onRefresh}>
            Get new ones
          </button>
        )}
      </div>
      <div className="-mt-1 text-xs text-faint">Fixes for the ATS check items, using only what's already true. Accepting saves the change.</div>
      {state === 'loading' && <div className="skeleton h-20 rounded-xl" />}
      {state === 'no-ai' && (
        <div className="rounded-xl border border-line bg-black/20 p-3 text-xs text-muted">
          Set up AI to get rewrites for the items in the ATS check, ready to accept.{' '}
          <button className="text-brass hover:text-brass-2" onClick={onAi}>
            Open Maintenance
          </button>
        </div>
      )}
      {state === 'error' && (
        <div className="rounded-xl border border-line bg-black/20 p-3 text-xs text-muted">
          The AI didn't answer{error ? `: ${error}` : '.'}{' '}
          <button className="text-brass hover:text-brass-2" onClick={onRefresh}>
            Try again
          </button>{' '}
          or check{' '}
          <button className="text-brass hover:text-brass-2" onClick={onAi}>
            Maintenance
          </button>
          .
        </div>
      )}
      {state === 'ready' && ideas?.length === 0 && <div className="text-sm text-muted">No suggestions. Your bullets look strong.</div>}
      {state === 'ready' && ideas && ideas.length > 1 && (
        <Button size="sm" onClick={() => onAccept(ideas)}>
          Accept all {ideas.length}
        </Button>
      )}
      {state === 'ready' &&
        ideas?.map((s, i) => {
          const job = data.experience[s.job]
          const removed = (s.remove ?? []).filter((k) => k !== s.bullet).map((k) => job?.bullets[k]).filter(Boolean)
          return (
            <div key={i} className="rounded-xl border border-line bg-black/20 p-3 text-sm">
              <div className="text-xs text-faint line-through">{job?.bullets[s.bullet]}</div>
              {removed.map((r, k) => (
                <div key={k} className="text-xs text-faint line-through">
                  {r}
                </div>
              ))}
              <div className="selectable mt-1 text-text">{s.text}</div>
              <div className="mt-1 text-xs text-muted">{s.why}</div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => onAccept([s])}>
                  Accept
                </Button>
                <Button size="sm" kind="quiet" onClick={() => onSkip(s)}>
                  Skip
                </Button>
              </div>
            </div>
          )
        })}
    </div>
  )
}

function Changes({ versionId, stamp }: { versionId: number; stamp: number }) {
  const c = useLoad(() => api.resume.changes(versionId), [versionId, stamp])
  const [open, setOpen] = useState(false)
  if (!c.data) return null
  const { parentLabel, fixes, lines } = c.data
  const edits = lines.filter((l) => l.type === 'add').length
  return (
    <div className="mb-5 rounded-xl border border-line bg-black/20 px-3 py-2.5">
      <button className="flex w-full items-center justify-between text-left text-sm" onClick={() => setOpen(!open)}>
        <span className="text-text">
          {lines.length ? `${edits || lines.length} line${(edits || lines.length) === 1 ? '' : 's'} changed from your ${parentLabel.toLowerCase()}` : `Same text as your ${parentLabel.toLowerCase()}`}
        </span>
        {lines.length > 0 && <span className="text-xs text-muted">{open ? 'Hide' : 'Show changes'}</span>}
      </button>
      {fixes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
          {fixes.map((f, i) => (
            <li key={i}>Fixed automatically: {f}</li>
          ))}
        </ul>
      )}
      {!fixes.length && lines.length === 0 && <div className="mt-1 text-xs text-muted">Your file had nothing JobSweep fixes automatically. The ATS check below lists what's left for you.</div>}
      {open && (
        <div className="selectable mt-3 space-y-1 text-xs leading-relaxed">
          {lines.map((l, i) =>
            l.type === 'del' && l.words ? null : (
              <div key={i} className={cx('rounded-md px-2 py-1', l.type === 'add' ? 'bg-ok/10' : 'bg-bad/10')}>
                {l.words ? (
                  l.words.map((w, k) => (
                    <span key={k} className={w.type === 'add' ? 'rounded bg-ok/25 text-ok' : w.type === 'del' ? 'text-bad line-through' : 'text-muted'}>
                      {w.text}
                    </span>
                  ))
                ) : (
                  <span className={l.type === 'add' ? 'text-ok' : 'text-bad line-through'}>{l.text}</span>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

function ResumeEditor({ data, update }: { data: ResumeStructured; update: (fn: (d: ResumeStructured) => ResumeStructured) => void }) {
  const set = <K extends keyof ResumeStructured>(k: K, v: ResumeStructured[K]) => update((d) => ({ ...d, [k]: v }))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <Input value={data.contact.name} onChange={(v) => update((d) => ({ ...d, contact: { ...d.contact, name: v } }))} />
        </div>
        <div>
          <Label>Location</Label>
          <Input value={data.contact.location} onChange={(v) => update((d) => ({ ...d, contact: { ...d.contact, location: v } }))} placeholder="City, ST" />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={data.contact.email} onChange={(v) => update((d) => ({ ...d, contact: { ...d.contact, email: v } }))} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={data.contact.phone} onChange={(v) => update((d) => ({ ...d, contact: { ...d.contact, phone: v } }))} />
        </div>
        <div className="col-span-2">
          <Label hint="LinkedIn, portfolio">Links</Label>
          <Tags values={data.contact.links} onChange={(v) => update((d) => ({ ...d, contact: { ...d.contact, links: v } }))} placeholder="Paste a link and press Enter" />
        </div>
      </div>
      <div>
        <Label hint="Your target title, on its own line">Headline</Label>
        <Input value={data.headline} onChange={(v) => set('headline', v)} placeholder="Project Coordinator | Operations Analyst" />
      </div>
      <div>
        <Label>Summary</Label>
        <TextArea value={data.summary ?? ''} onChange={(v) => set('summary', v)} rows={4} />
      </div>
      <div>
        <Label>Skills</Label>
        <Tags values={data.skills} onChange={(v) => set('skills', v)} placeholder="Add a skill" />
      </div>
      <div>
        <Label>Technical toolkit</Label>
        <Tags values={data.toolkit} onChange={(v) => set('toolkit', v)} placeholder="Excel, SQL, Power BI…" />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Experience</Label>
          <Button size="sm" kind="quiet" onClick={() => set('experience', [{ company: '', title: '', bullets: [''] }, ...data.experience])}>
            + Add job
          </Button>
        </div>
        <div className="space-y-3">
          {data.experience.map((e, i) => (
            <ExperienceEditor
              key={i}
              e={e}
              onChange={(ne) => update((d) => ((d.experience[i] = ne), d))}
              onRemove={() => update((d) => ((d.experience = d.experience.filter((_, k) => k !== i)), d))}
              onMove={(dir) =>
                update((d) => {
                  const j = i + dir
                  if (j < 0 || j >= d.experience.length) return d
                  ;[d.experience[i], d.experience[j]] = [d.experience[j], d.experience[i]]
                  return d
                })
              }
            />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Education</Label>
          <Button size="sm" kind="quiet" onClick={() => set('education', [...data.education, { school: '', details: [] }])}>
            + Add school
          </Button>
        </div>
        {data.education.map((ed, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-line p-3">
            <Input value={ed.school} onChange={(v) => update((d) => ((d.education[i].school = v), d))} placeholder="School" />
            <Input value={ed.date} onChange={(v) => update((d) => ((d.education[i].date = v), d))} placeholder="Year" />
            <Input value={ed.degree} onChange={(v) => update((d) => ((d.education[i].degree = v), d))} placeholder="Degree" />
            <Input value={ed.field} onChange={(v) => update((d) => ((d.education[i].field = v), d))} placeholder="Field of study" />
            <div className="col-span-2">
              <Tags values={ed.details} onChange={(v) => update((d) => ((d.education[i].details = v), d))} placeholder="Coursework, honors…" />
            </div>
          </div>
        ))}
      </div>
      <div>
        <Label>Certifications</Label>
        <Tags values={data.certifications} onChange={(v) => set('certifications', v)} placeholder="Add a certification" />
      </div>
    </div>
  )
}

function ExperienceEditor({ e, onChange, onRemove, onMove }: { e: ResumeExperience; onChange: (e: ResumeExperience) => void; onRemove: () => void; onMove: (d: -1 | 1) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-line bg-black/15">
      <div className="flex items-center gap-2 px-3 py-2">
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
          <div className="truncate text-sm text-text">{e.title || 'Untitled role'}</div>
          <div className="truncate text-xs text-muted">
            {e.company} · {e.start} – {e.end} · {e.bullets.length} bullets
          </div>
        </button>
        <Button size="sm" kind="quiet" onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button size="sm" kind="quiet" onClick={() => onMove(1)}>
          ↓
        </Button>
        <Button size="sm" kind="quiet" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input value={e.title} onChange={(v) => onChange({ ...e, title: v })} placeholder="Title" />
            <Input value={e.company} onChange={(v) => onChange({ ...e, company: v })} placeholder="Company" />
            <Input value={e.location} onChange={(v) => onChange({ ...e, location: v })} placeholder="Location" />
            <div className="flex gap-2">
              <Input value={e.start} onChange={(v) => onChange({ ...e, start: v })} placeholder="Start (Mon YYYY)" />
              <Input value={e.end} onChange={(v) => onChange({ ...e, end: v })} placeholder="End / Present" />
            </div>
          </div>
          {e.bullets.map((b, k) => (
            <div key={k} className="flex gap-2">
              <span className="pt-2 text-brass">•</span>
              <TextArea value={b} rows={2} onChange={(v) => onChange({ ...e, bullets: e.bullets.map((x, j) => (j === k ? v : x)) })} />
              <button className="text-faint hover:text-bad" title="Remove this bullet" aria-label="Remove this bullet" onClick={() => onChange({ ...e, bullets: e.bullets.filter((_, j) => j !== k) })}>
                ×
              </button>
            </div>
          ))}
          <div className="flex justify-between">
            <Button size="sm" kind="quiet" onClick={() => onChange({ ...e, bullets: [...e.bullets, ''] })}>
              + Add bullet
            </Button>
            <Button size="sm" kind="danger" onClick={onRemove}>
              Remove job
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function CoverLetterEditor() {
  const t = useLoad(async () => ({ list: await api.coverLetter.templates(), def: await api.coverLetter.defaultTemplate() }))
  const [body, setBody] = useState('')
  const [id, setId] = useState<number | undefined>()
  const [company, setCompany] = useState('Acme Logistics')
  const [role, setRole] = useState('Operations Analyst')
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!t.data) return
    const cur = t.data.list.find((x) => x.isDefault) ?? t.data.list[0]
    setBody(cur?.body ?? t.data.def)
    setId(cur?.id)
  }, [t.data])
  useEffect(() => {
    const h = setTimeout(async () => setPreview(await api.coverLetter.preview(body, company, role)), 200)
    return () => clearTimeout(h)
  }, [body, company, role])
  const placeholders = useMemo(() => ['{{company}}', '{{role}}', '{{hiring_manager}}', '{{date}}', '{{name}}'], [])
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card
        title="Your cover letter template"
        actions={
          <Button
            kind="brass"
            size="sm"
            onClick={async () => {
              await api.coverLetter.save({ id, name: 'My template', body, isDefault: true })
              await t.reload()
              toast.success('Template saved. JobSweep will only tweak it to fit each job.')
            }}
          >
            Save template
          </Button>
        }
      >
        <Callout>
          Write this in your own voice. For each job, JobSweep fills the placeholders and lets AI adjust at most about a quarter of the words, using only facts from your resume. You'll see exactly what changed before anything is sent.
        </Callout>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {placeholders.map((p) => (
            <button key={p} className="rounded-lg border border-line px-2 py-0.5 font-mono text-xs text-brass hover:border-brass/40" onClick={() => setBody((b) => b + p)}>
              {p}
            </button>
          ))}
        </div>
        <TextArea className="mt-3 font-[inherit]" value={body} onChange={setBody} rows={22} />
      </Card>
      <Card title="Preview">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Input value={company} onChange={setCompany} placeholder="Company" />
          <Input value={role} onChange={setRole} placeholder="Role" />
        </div>
        <div className="selectable whitespace-pre-wrap rounded-xl bg-white p-6 text-[13px] leading-relaxed text-[#222]">{preview}</div>
      </Card>
    </div>
  )
}
