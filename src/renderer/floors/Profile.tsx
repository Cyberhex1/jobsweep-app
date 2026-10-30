import { useEffect, useState } from 'react'
import type { AnswerBankEntry, Profile } from '@shared/types'
import { api } from '../lib/api'
import { errMsg, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Callout, Card, Input, Label, Segmented, Select, Tags, TextArea, Toggle } from '../ui/kit'
import { toast } from '../ui/toast'

const FIELDS = ['Project Management', 'Operations', 'Business & Data Analysis', 'Supply Chain', 'IT & Support', 'Customer Experience', 'Administration', 'Marketing', 'Finance & Accounting', 'Human Resources', 'Government']

export function ProfileFloor() {
  const [tab, setTab] = useState<'profile' | 'answers' | 'blocklist'>('profile')
  return (
    <div>
      <FloorHeader title="Profile" sub="Who you are, what you want, and the answers JobSweep reuses on every application." actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'profile', label: 'About you' }, { value: 'answers', label: 'Answer bank' }, { value: 'blocklist', label: 'Blocklist' }]} />} />
      {tab === 'profile' ? <ProfileForm /> : tab === 'answers' ? <AnswerBank /> : <Blocklist />}
    </div>
  )
}

function ProfileForm() {
  const loaded = useLoad(() => api.profile.get())
  const [p, setP] = useState<Profile | null>(null)
  const [dirty, setDirty] = useState(false)
  const { settings } = useNav()
  useEffect(() => {
    if (loaded.data) setP(loaded.data)
  }, [loaded.data])
  if (!p) return <div className="skeleton h-96 rounded-2xl" />
  const set = (patch: Partial<Profile>) => {
    setP({ ...p, ...patch })
    setDirty(true)
  }
  const save = async () => {
    await api.profile.save(p)
    setDirty(false)
    toast.success('Profile saved. Job matches have been re-scored.')
  }
  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between rounded-xl bg-ink/80 px-2 py-2 backdrop-blur">
        <Button
          onClick={async () => {
            const next = await api.profile.prefillFromResume()
            setP(next)
            setDirty(true)
            toast.info('Filled in what we could from your default resume. Check it and save.')
          }}
        >
          Pre-fill from my resume
        </Button>
        <Button kind="brass" disabled={!dirty} onClick={save}>
          {dirty ? 'Save profile' : 'Saved'}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="About you">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Full name</Label>
              <Input value={p.fullName} onChange={(v) => set({ fullName: v })} />
            </div>
            <div className="col-span-2">
              <Label hint="The dedicated Gmail you made for JobSweep">Application email</Label>
              <Input value={p.email} onChange={(v) => set({ email: v })} placeholder="yourname.jobs@gmail.com" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={p.phone} onChange={(v) => set({ phone: v })} />
            </div>
            <div>
              <Label>LinkedIn URL</Label>
              <Input value={p.linkedin} onChange={(v) => set({ linkedin: v })} placeholder="https://linkedin.com/in/…" />
            </div>
            <div>
              <Label>City</Label>
              <Input value={p.city} onChange={(v) => set({ city: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>State</Label>
                <Input value={p.state} onChange={(v) => set({ state: v.toUpperCase().slice(0, 2) })} placeholder="NC" />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input value={p.zip} onChange={(v) => set({ zip: v })} />
              </div>
            </div>
            <div className="col-span-2">
              <Label hint="Never applied to automatically">Current employer</Label>
              <Input value={p.currentEmployer} onChange={(v) => set({ currentEmployer: v })} />
            </div>
          </div>
        </Card>

        <Card title="Where you want to work">
          <Label>Work arrangement</Label>
          <Segmented
            value={p.remoteMode}
            onChange={(v) => set({ remoteMode: v })}
            options={[
              { value: 'any', label: 'Anything' },
              { value: 'hybrid_ok', label: 'Hybrid OK' },
              { value: 'remote_only', label: 'Remote only' },
              { value: 'onsite_only', label: 'On-site only' }
            ]}
          />
          <div className="mt-4 space-y-2">
            <Label hint="First one is used for searches">Preferred locations</Label>
            {p.locations.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={l.place} onChange={(v) => set({ locations: p.locations.map((x, k) => (k === i ? { ...x, place: v } : x)) })} placeholder="Raleigh, NC" />
                <div className="w-36">
                  <Select
                    value={String(l.radiusMiles)}
                    onChange={(v) => set({ locations: p.locations.map((x, k) => (k === i ? { ...x, radiusMiles: Number(v) } : x)) })}
                    options={[10, 25, 30, 50, 75, 100].map((n) => ({ value: String(n), label: `${n} miles` }))}
                  />
                </div>
                <Button size="sm" kind="quiet" title="Remove this location" onClick={() => set({ locations: p.locations.filter((_, k) => k !== i) })}>
                  ×
                </Button>
              </div>
            ))}
            <Button size="sm" kind="quiet" onClick={() => set({ locations: [...p.locations, { place: '', radiusMiles: 30 }] })}>
              + Add location
            </Button>
          </div>
          <div className="mt-5">
            <Label>Desired pay</Label>
            <div className="flex items-center gap-2">
              <Segmented value={p.pay.unit} onChange={(v) => set({ pay: { ...p.pay, unit: v } })} options={[{ value: 'hourly', label: 'Hourly' }, { value: 'salary', label: 'Salary' }]} />
              <Input type="number" value={p.pay.min} onChange={(v) => set({ pay: { ...p.pay, min: v ? Number(v) : undefined } })} placeholder={p.pay.unit === 'hourly' ? 'Minimum $/hr' : 'Minimum $/yr'} />
              <Input type="number" value={p.pay.target} onChange={(v) => set({ pay: { ...p.pay, target: v ? Number(v) : undefined } })} placeholder="Target" />
            </div>
          </div>
        </Card>

        <Card title="What you’re looking for">
          <Label>Fields you’re interested in</Label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {FIELDS.map((f) => (
              <button
                key={f}
                onClick={() => set({ fields: p.fields.includes(f) ? p.fields.filter((x) => x !== f) : [...p.fields, f] })}
                className={p.fields.includes(f) ? 'rounded-lg border border-brass/50 bg-brass/15 px-2.5 py-1 text-xs text-brass-2' : 'rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-text'}
              >
                {f}
              </button>
            ))}
          </div>
          <Label hint="Suggestions appear as you type">Roles that fit you</Label>
          <Tags values={p.roles} onChange={(v) => set({ roles: v })} placeholder="Start typing a job title…" suggest={(q) => api.profile.suggestRoles(q)} />
          <div className="mt-4">
            <Label hint="Extra search terms beyond your roles">Search keywords</Label>
            <KeywordTags />
          </div>
        </Card>

        <Card title="Education & work eligibility">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Highest education</Label>
              <Select
                value={p.educationLevel}
                onChange={(v) => set({ educationLevel: v })}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'high_school', label: 'High school / GED' },
                  { value: 'some_college', label: 'Some college' },
                  { value: 'associate', label: "Associate's" },
                  { value: 'bachelor', label: "Bachelor's" },
                  { value: 'master', label: "Master's" },
                  { value: 'doctorate', label: 'Doctorate' }
                ]}
              />
            </div>
            <div>
              <Label>Degree field</Label>
              <Input value={p.degrees[0]?.field} onChange={(v) => set({ degrees: [{ ...(p.degrees[0] ?? { level: p.educationLevel, school: '' }), field: v }] })} placeholder="Information Technology" />
            </div>
            <div>
              <Label>School</Label>
              <Input value={p.degrees[0]?.school} onChange={(v) => set({ degrees: [{ ...(p.degrees[0] ?? { level: p.educationLevel, field: '' }), school: v }] })} />
            </div>
            <div>
              <Label>Graduation year</Label>
              <Input value={p.degrees[0]?.year} onChange={(v) => set({ degrees: [{ ...(p.degrees[0] ?? { level: p.educationLevel, field: '', school: '' }), year: v }] })} />
            </div>
            <div className="col-span-2 mt-2 space-y-3">
              <Toggle on={p.workAuthorized === true} onChange={(v) => set({ workAuthorized: v })} label="I’m authorized to work in the United States" />
              <Toggle on={p.needsSponsorship === true} onChange={(v) => set({ needsSponsorship: v })} label="I will need visa sponsorship" />
            </div>
          </div>
        </Card>

        <Card title="Federal resume details" className="xl:col-span-2">
          <Callout>USAJOBS expects hours per week, salary, and supervisor for each job. Fill these once and the federal resume export includes them.</Callout>
          <FederalJobs profile={p} set={set} />
        </Card>

        <SensitiveCard storeSsnDob={!!settings?.storeSsnDob} storeSensitive={!!settings?.storeSensitive} />
      </div>
    </div>
  )
}

function KeywordTags() {
  const { settings, refreshSettings } = useNav()
  return <Tags values={settings?.searchKeywords ?? []} onChange={async (v) => void (await api.settings.save({ searchKeywords: v }), await refreshSettings())} placeholder="e.g. ERP, logistics" />
}

function FederalJobs({ profile, set }: { profile: Profile; set: (p: Partial<Profile>) => void }) {
  const r = useLoad(() => api.resume.list())
  const def = r.data?.find((x) => x.isDefault)
  const v = def?.versions.find((x) => x.id === def.defaultVersionId) ?? def?.versions[0]
  if (!v) return <div className="mt-3 text-sm text-muted">Choose a default resume first.</div>
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Citizenship</Label>
          <Input value={profile.federal.citizenship} onChange={(c) => set({ federal: { ...profile.federal, citizenship: c } })} placeholder="United States" />
        </div>
        <div>
          <Label>Veterans’ preference</Label>
          <Input value={profile.federal.veteranPreference} onChange={(c) => set({ federal: { ...profile.federal, veteranPreference: c } })} placeholder="None" />
        </div>
      </div>
      {v.data.experience.map((e) => {
        const key = `${e.company}|${e.title}`
        const f = profile.federal.jobs[key] ?? {}
        const up = (patch: object) => set({ federal: { ...profile.federal, jobs: { ...profile.federal.jobs, [key]: { ...f, ...patch } } } })
        return (
          <div key={key} className="grid grid-cols-6 items-center gap-2 rounded-xl border border-line p-3">
            <div className="col-span-6 text-sm text-text md:col-span-2">
              {e.title} <span className="text-muted">· {e.company}</span>
            </div>
            <Input value={f.hoursPerWeek} onChange={(x) => up({ hoursPerWeek: Number(x) || undefined })} placeholder="Hrs/week" type="number" />
            <Input value={f.salary} onChange={(x) => up({ salary: x })} placeholder="Salary" />
            <Input value={f.supervisor} onChange={(x) => up({ supervisor: x })} placeholder="Supervisor" />
            <Input value={f.supervisorPhone} onChange={(x) => up({ supervisorPhone: x })} placeholder="Supervisor phone" />
          </div>
        )
      })}
    </div>
  )
}

function SensitiveCard({ storeSsnDob, storeSensitive }: { storeSsnDob: boolean; storeSensitive: boolean }) {
  const { refreshSettings } = useNav()
  const has = useLoad(() => api.settings.hasSensitive())
  const [ssn, setSsn] = useState('')
  const [dob, setDob] = useState('')
  return (
    <Card title="Sensitive information" className="xl:col-span-2">
      <div className="grid gap-4 md:grid-cols-2">
        <Toggle
          on={storeSensitive}
          onChange={async (v) => {
            await api.settings.save({ storeSensitive: v })
            await refreshSettings()
          }}
          label="Store sensitive answers (encrypted)"
          hint="Demographic answers, address, and similar. When off, JobSweep pauses and asks you each time, and anything stored is erased."
        />
        <Toggle
          on={storeSsnDob}
          onChange={async (v) => {
            if (v && !confirm('Store your SSN and date of birth on this PC, encrypted with your Windows login? Only turn this on if you apply to many government jobs that require them.')) return
            await api.settings.save({ storeSsnDob: v })
            await refreshSettings()
            await has.reload()
          }}
          label="Store SSN and date of birth (separate switch)"
          hint="Off by default. When off, these are never filled automatically."
        />
      </div>
      {storeSsnDob && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <Label hint={has.data?.ssn ? 'Saved' : 'Not saved'}>SSN</Label>
            <div className="flex gap-2">
              <Input type="password" value={ssn} onChange={setSsn} placeholder="•••-••-••••" />
              <Button onClick={async () => void (await api.settings.setSensitive('ssn', ssn), setSsn(''), await has.reload(), toast.success('Saved encrypted.'))}>Save</Button>
            </div>
          </div>
          <div>
            <Label hint={has.data?.dob ? 'Saved' : 'Not saved'}>Date of birth</Label>
            <div className="flex gap-2">
              <Input type="date" value={dob} onChange={setDob} />
              <Button onClick={async () => void (await api.settings.setSensitive('dob', dob), setDob(''), await has.reload(), toast.success('Saved encrypted.'))}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnswerBank() {
  const list = useLoad(() => api.answers.list())
  const [newQ, setNewQ] = useState('')
  if (!list.data) return <div className="skeleton h-96 rounded-2xl" />
  const pending = list.data.filter((a) => !a.approved)
  return (
    <div className="space-y-4">
      <Callout>
        Answer common questions once. JobSweep reuses approved answers on every application. New questions it meets get an AI draft here — approve it once and it’s used from then on. Unapproved answers pause auto mode.
      </Callout>
      <Card
        title={`Answers (${list.data.length - pending.length} approved, ${pending.length} waiting)`}
        actions={
          <div className="flex gap-2">
            <Input value={newQ} onChange={setNewQ} placeholder="Add your own question…" />
            <Button
              onClick={async () => {
                if (!newQ.trim()) return
                list.set(await api.answers.save({ key: `custom_${Date.now()}`, question: newQ, variants: [], answer: '', sensitivity: 'normal', approved: false }))
                setNewQ('')
              }}
            >
              Add
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {[...pending, ...list.data.filter((a) => a.approved)].map((a) => (
            <AnswerRow key={a.id} a={a} onSaved={(l) => list.set(l)} onDelete={async () => (await api.answers.delete(a.id), list.reload())} />
          ))}
        </div>
      </Card>
    </div>
  )
}

function AnswerRow({ a, onSaved, onDelete }: { a: AnswerBankEntry; onSaved: (l: AnswerBankEntry[]) => void; onDelete: () => void }) {
  const [answer, setAnswer] = useState(a.answer)
  const yesNo = /^(are|do|will|have|can|is)\b/i.test(a.question)
  return (
    <div className="rounded-xl border border-line bg-black/15 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 text-sm text-text">{a.question}</span>
        {a.sensitivity !== 'normal' && <Badge tone="warn">sensitive</Badge>}
        {a.approved ? <Badge tone="ok">approved</Badge> : <Badge tone="brass">needs approval</Badge>}
      </div>
      <div className="flex items-start gap-2">
        {yesNo && answer.length < 4 ? (
          <Segmented value={answer || ''} onChange={setAnswer} options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} />
        ) : (
          <TextArea value={answer} onChange={setAnswer} rows={answer.length > 120 ? 3 : 1} />
        )}
        {yesNo && answer.length < 4 && <div className="flex-1" />}
        <Button
          size="sm"
          kind={a.approved && answer === a.answer ? 'ghost' : 'brass'}
          onClick={async () => {
            try {
              onSaved(await api.answers.save({ ...a, answer, approved: true }))
              toast.success('Answer approved.')
            } catch (e) {
              toast.error(errMsg(e))
            }
          }}
        >
          {a.approved && answer === a.answer ? 'Saved' : 'Approve'}
        </Button>
        {!answer && (
          <Button size="sm" onClick={async () => setAnswer(await api.answers.draft(a.question))}>
            AI draft
          </Button>
        )}
        <Button size="sm" kind="quiet" title="Delete this answer" onClick={onDelete}>
          ×
        </Button>
      </div>
    </div>
  )
}

function Blocklist() {
  const list = useLoad(() => api.blocklist.list())
  const profile = useLoad(() => api.profile.get())
  const [company, setCompany] = useState('')
  const [domain, setDomain] = useState('')
  return (
    <Card title="Companies JobSweep will never apply to">
      <Callout>
        Your current employer{profile.data?.currentEmployer ? ` (${profile.data.currentEmployer})` : ''} is always blocked automatically. Add anyone else you don’t want to hear from you.
      </Callout>
      <div className="mt-4 flex gap-2">
        <Input value={company} onChange={setCompany} placeholder="Company name" />
        <Input value={domain} onChange={setDomain} placeholder="Website domain (optional)" />
        <Button
          kind="brass"
          onClick={async () => {
            if (!company.trim()) return
            list.set(await api.blocklist.add({ company, aliases: [], domains: domain ? [domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')] : [], reason: 'Added by you' }))
            setCompany('')
            setDomain('')
          }}
        >
          Block
        </Button>
      </div>
      <div className="mt-4 divide-y divide-line">
        {list.data?.map((b) => (
          <div key={b.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {b.company} {b.domains.length > 0 && <span className="text-xs text-faint">· {b.domains.join(', ')}</span>}
            </span>
            <Button size="sm" kind="quiet" onClick={async () => list.set(await api.blocklist.remove(b.id))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}
