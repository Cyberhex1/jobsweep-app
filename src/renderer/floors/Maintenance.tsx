import { useEffect, useState } from 'react'
import type { AiProviderId, HardwareInfo, ModelJob, ModelRecommendation, Settings } from '@shared/types'
import { SOURCE_LABELS } from '@shared/defaults'
import { api, type ApiResult } from '../lib/api'
import { errMsg, useEvent, useLoad } from '../lib/hooks'
import { FloorHeader, useNav } from '../App'
import { Badge, Button, Callout, Card, Input, Label, Modal, Segmented, Spinner, Toggle, cx } from '../ui/kit'
import { toast } from '../ui/toast'

type Tab = 'ai' | 'cloud' | 'email' | 'extension' | 'sources' | 'automation' | 'audio' | 'backup'

export function Maintenance() {
  const { params } = useNav()
  const [tab, setTab] = useState<Tab>((params.tab as Tab) ?? 'ai')
  const tabs: { value: Tab; label: string }[] = [
    { value: 'ai', label: 'Local AI' },
    { value: 'cloud', label: 'Cloud AI & keys' },
    { value: 'email', label: 'Email' },
    { value: 'extension', label: 'Edge extension' },
    { value: 'sources', label: 'Job sources' },
    { value: 'automation', label: 'Automation' },
    { value: 'audio', label: 'Sound & motion' },
    { value: 'backup', label: 'Backup & help' }
  ]
  return (
    <div>
      <FloorHeader title="Maintenance" sub="Set up AI, email, the Edge extension, and how hard JobSweep works for you." />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)} className={cx('rounded-xl px-3.5 py-2 text-sm transition', tab === t.value ? 'bg-brass/15 text-brass-2 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.35)]' : 'text-muted hover:bg-white/[0.04] hover:text-text')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ai' && <LocalAi />}
      {tab === 'cloud' && <CloudAi />}
      {tab === 'email' && <EmailSetup />}
      {tab === 'extension' && <ExtensionSetup />}
      {tab === 'sources' && <Sources />}
      {tab === 'automation' && <AutomationSettings />}
      {tab === 'audio' && <Audio />}
      {tab === 'backup' && <Backup />}
    </div>
  )
}

function useSettings() {
  const { settings, refreshSettings } = useNav()
  const save = async (patch: Partial<Settings>) => {
    await api.settings.save(patch)
    await refreshSettings()
  }
  return { s: settings, save }
}

// ---------------- Local AI wizard ----------------

function LocalAi() {
  const { s, save } = useSettings()
  const [consent, setConsent] = useState(false)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [recs, setRecs] = useState<ModelRecommendation[]>([])
  const [scanning, setScanning] = useState(false)
  const [jobs, setJobs] = useState<Record<string, ModelJob>>({})
  const [prompt, setPrompt] = useState('')
  const [hf, setHf] = useState<ApiResult<'hw', 'hfSearch'> | null>(null)
  const [log, setLog] = useState('')
  const [installingOllama, setInstallingOllama] = useState(false)
  const ollama = useLoad(() => api.hw.ollama())
  const freedom = s?.freedomMode ?? false

  // Installs keep running in the background; pick up the scan, progress and log from before leaving this floor.
  useEffect(() => {
    void api.hw.state().then((st) => {
      if (st.hw) setHw(st.hw)
      setJobs(Object.fromEntries(st.jobs.map((j) => [j.tag, j])))
      setLog(st.ollamaLog)
      setInstallingOllama(st.ollamaInstalling)
    })
  }, [])
  useEvent('hw:job', (j: ModelJob) => {
    setJobs((x) => ({ ...x, [j.tag]: j }))
    if (j.phase === 'done' || j.phase === 'failed') {
      void ollama.reload()
      void save({})
      if (j.phase === 'done') toast.success(`${j.tag}: ${j.status}`)
      else toast.error(`${j.tag}: ${j.error ?? j.status}`)
    }
  })
  useEvent('hw:log', (l: string) => setLog((x) => (x + l).slice(-2000)))

  const scan = async () => {
    setScanning(true)
    try {
      setHw(await api.hw.scan())
      setRecs(await api.hw.recommend(freedom))
      await ollama.reload()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setScanning(false)
    }
  }
  useEffect(() => {
    if (hw) void api.hw.recommend(freedom).then(setRecs)
  }, [freedom, hw])

  // The embedding model is a helper, not something to pick or test.
  const chatModels = (ollama.data?.models ?? []).filter((m) => !m.startsWith('nomic-embed-text'))
  const busy = (tag: string) => ['starting', 'downloading', 'testing'].includes(jobs[tag]?.phase ?? '')
  const installed = (tag: string) => !!ollama.data?.models.some((m) => sameModel(m, tag))
  const install = (tag: string) => void api.hw.install(tag).catch((e) => toast.error(errMsg(e)))
  const test = (tag: string) => void api.hw.test(tag).catch((e) => toast.error(errMsg(e)))
  const use = async (tag: string) => {
    await api.hw.use(tag)
    await save({})
  }
  const uninstall = async (tag: string) => {
    const inUse = sameModel(s?.ollamaModel ?? '', tag)
    if (!confirm(`Uninstall ${tag}? This frees its disk space.${inUse ? ' It is your local AI right now, so JobSweep will use your cloud AI until you pick another model.' : ''}`)) return
    try {
      await api.hw.remove(tag)
      setJobs(({ [tag]: _, ...rest }) => rest)
      await ollama.reload()
      await save({})
      toast.success(`${tag} uninstalled.`)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  /** Progress bar, live status, or the last test result for one model. */
  const status = (tag: string) => {
    const j = jobs[tag]
    if (j && busy(tag))
      return (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className={cx('h-full bg-brass transition-all', j.phase === 'testing' && 'animate-pulse')} style={{ width: `${j.pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-faint">
            {j.status} {j.phase === 'downloading' && j.pct ? `${j.pct}%` : ''}
          </div>
        </div>
      )
    if (j?.phase === 'failed') return <div className="mt-2 text-xs text-bad">✗ {j.error ?? j.status}</div>
    const t = s?.modelTests?.[tag] ?? s?.modelTests?.[tag.replace(/:latest$/, '')]
    if (!t) return null
    return (
      <div className="mt-2 text-xs text-text">
        {t.ok ? '✓' : '✗'} {t.message}{' '}
        <span className="text-faint">
          ({t.loadSeconds ? `${t.loadSeconds.toFixed(1)}s to load, ` : ''}
          {t.answerSeconds.toFixed(1)}s to answer{t.tokensPerSec ? `, ${t.tokensPerSec} tokens/s` : ''})
        </span>
      </div>
    )
  }

  const actions = (tag: string, primary: boolean) =>
    installed(tag) ? (
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {sameModel(s?.ollamaModel ?? '', tag) ? (
          <Badge tone="brass">In use</Badge>
        ) : (
          <Button size="sm" disabled={busy(tag)} onClick={() => void use(tag)}>
            Use this
          </Button>
        )}
        <Button size="sm" kind="ghost" busy={jobs[tag]?.phase === 'testing'} disabled={busy(tag)} onClick={() => test(tag)}>
          Test
        </Button>
        <Button size="sm" kind="quiet" disabled={busy(tag)} onClick={() => void uninstall(tag)}>
          Uninstall
        </Button>
      </div>
    ) : (
      <Button size="sm" kind={primary ? 'brass' : 'ghost'} onClick={() => install(tag)} busy={busy(tag)}>
        Install & test
      </Button>
    )

  return (
    <div className="space-y-6">
      <Card title="Your local AI" actions={ollama.data && <Badge tone={ollama.data.running ? 'ok' : ollama.data.installed ? 'warn' : 'neutral'}>{ollama.data.running ? 'Ollama running' : ollama.data.installed ? 'Ollama installed, not running' : 'Ollama not installed'}</Badge>}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">In use:</span>
          <span className="font-mono text-brass-2">{s?.ollamaModel || 'none yet'}</span>
          {s?.ollamaModel && ollama.data?.running && !ollama.data.models.some((m) => sameModel(m, s.ollamaModel)) && (
            <Badge tone="warn">not installed in this Ollama. Install it or pick another model below</Badge>
          )}
          {!ollama.data?.installed && (
            <Button
              size="sm"
              busy={installingOllama}
              onClick={async () => {
                setInstallingOllama(true)
                try {
                  const r = await api.hw.installOllama()
                  r.ok ? toast.success(r.message) : toast.error(r.message)
                } finally {
                  setInstallingOllama(false)
                  await ollama.reload()
                }
              }}
            >
              Install Ollama (free)
            </Button>
          )}
          {ollama.data?.installed && !ollama.data.running && (
            <Button size="sm" onClick={async () => void (await api.hw.startOllama(), await ollama.reload())}>
              Start Ollama
            </Button>
          )}
        </div>
        {!!chatModels.length && (
          <div className="mt-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-faint">Installed models</div>
            {chatModels.map((m) => (
                <div key={m} className="flex items-start gap-3 rounded-xl border border-line bg-black/15 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-text">{m}</div>
                    {status(m)}
                  </div>
                  {actions(m, false)}
                </div>
            ))}
          </div>
        )}
        {log && <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-muted">{log}</pre>}
      </Card>

      <Card title="Find the best model for this PC">
        {!hw ? (
          <div>
            <Callout>
              JobSweep can look at this computer’s processor, memory, graphics card, and free disk space to recommend the five local AI models that will run best here. Nothing leaves your PC.
            </Callout>
            <div className="mt-4 flex items-center gap-4">
              <Toggle on={consent} onChange={setConsent} label="Allow JobSweep to scan my hardware" />
              <Button kind="brass" disabled={!consent} onClick={scan} busy={scanning}>
                Scan my PC
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Spec label="Graphics" value={hw.gpus.map((g) => `${g.model} · ${g.vramGB} GB`).join(', ') || 'None detected'} />
              <Spec label="Memory" value={`${hw.ramGB} GB`} />
              <Spec label="Processor" value={`${hw.cpu} (${hw.cores} cores)`} />
              <Spec label="Free disk" value={`${hw.freeDiskGB} GB`} />
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Toggle
                on={freedom}
                onChange={(v) => void save({ freedomMode: v })}
                label="Freedom mode"
                hint="Include uncensored models from Hugging Face. They refuse less but follow formatting instructions less reliably — not better for job applications."
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={async () => setPrompt(await api.hw.setupPrompt(freedom))}>
                  Get a setup prompt for any chatbot
                </Button>
                <Button size="sm" kind="quiet" onClick={scan}>
                  Rescan
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {recs.map((r, i) => (
                <div key={r.model.id} className="flex items-start gap-4 rounded-xl border border-line bg-black/15 p-4">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-brass/50 font-mono text-sm text-brass-2">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{r.model.name}</span>
                      <Badge tone={r.fitsAt === '16k' ? 'ok' : r.fitsAt === '8k' ? 'warn' : 'bad'}>{r.fitsAt === 'cpu' ? 'partly CPU' : `${r.fitsAt} context`}</Badge>
                      {r.model.vision && <Badge tone="info">reads images</Badge>}
                      {r.model.uncensored && <Badge tone="warn">uncensored</Badge>}
                      <span className="font-mono text-xs text-faint">{r.model.ollamaTag}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">{r.model.notes}</div>
                    <ul className="mt-1 list-disc pl-4 text-xs text-faint">
                      {r.reasons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                    {status(r.model.ollamaTag)}
                  </div>
                  {actions(r.model.ollamaTag, i === 0)}
                </div>
              ))}
            </div>
            {freedom && (
              <div className="mt-5">
                <Button size="sm" onClick={async () => setHf(await api.hw.hfSearch())}>
                  Search Hugging Face for uncensored models that fit
                </Button>
                {hf && (
                  <div className="mt-3 space-y-2">
                    {hf.length === 0 && <div className="text-sm text-muted">Nothing found (or offline).</div>}
                    {hf.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate text-text">{m.id}</div>
                          <div className="text-xs text-faint">
                            {m.sizeHint} · {m.downloads.toLocaleString()} downloads
                          </div>
                        </div>
                        {actions(m.tag, false)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
      <Modal
        open={!!prompt}
        onClose={() => setPrompt('')}
        title="Setup prompt"
        actions={
          <Button kind="brass" onClick={async () => void (await navigator.clipboard.writeText(prompt), toast.success('Copied. Paste it into ChatGPT, Claude, or Gemini.'))}>
            Copy
          </Button>
        }
      >
        <p className="mb-3">Paste this into any chatbot and it will walk you through setup step by step for this exact PC.</p>
        <pre className="selectable max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-[11px] text-text">{prompt}</pre>
      </Modal>
    </div>
  )
}

/** Ollama reports untagged models as "name:latest". */
function sameModel(a: string, b: string): boolean {
  const norm = (x: string) => (x.includes(':') ? x : `${x}:latest`)
  return !!a && !!b && norm(a) === norm(b)
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-black/15 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="text-text">{value}</div>
    </div>
  )
}

// ---------------- Cloud AI ----------------

function CloudAi() {
  const { s, save } = useSettings()
  const status = useLoad(() => api.ai.status())
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const provider = (id: AiProviderId) => status.data?.find((x) => x.id === id)
  const setKey = async (id: Exclude<AiProviderId, 'ollama'>) => {
    const r = await api.ai.setKey(id, keys[id] ?? '')
    r.ok ? toast.success(r.message) : toast.error(r.message)
    setKeys((k) => ({ ...k, [id]: '' }))
    await status.reload()
    await save({})
  }
  const move = async (id: AiProviderId, dir: -1 | 1) => {
    const order = [...(s?.aiOrder ?? [])]
    const i = order.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    await save({ aiOrder: order })
    await status.reload()
  }
  return (
    <div className="space-y-6">
      <Callout>
        Your Claude, ChatGPT, and Gemini <i>chat</i> subscriptions don’t include API access, so apps can’t use them. These free options work instead. Anything sent to a cloud AI has your name, phone, email, and address replaced with placeholders first.
      </Callout>
      <Card title="Order JobSweep tries AI providers in">
        <div className="space-y-2">
          {s?.aiOrder.map((id, i) => (
            <div key={id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="w-5 font-mono text-brass">{i + 1}</span>
              <span className="flex-1 capitalize text-text">{id}</span>
              <span className="font-mono text-xs text-faint">{provider(id)?.model}</span>
              {provider(id)?.configured ? <Badge tone="ok">ready</Badge> : provider(id)?.problem ? <Badge tone="warn" title={provider(id)?.problem}>{provider(id)?.problem?.includes('installed') ? 'model missing' : 'not running'}</Badge> : <Badge>not set up</Badge>}
              <Button
                size="sm"
                kind="quiet"
                onClick={async () => {
                  setTesting(id)
                  const r = await api.ai.test(id)
                  setTesting(null)
                  r.ok ? toast.success(`${id}: working (${(r.ms / 1000).toFixed(1)}s)`) : toast.error(`${id}: ${r.message}`)
                }}
              >
                {testing === id ? <Spinner /> : 'Test'}
              </Button>
              <Button size="sm" kind="quiet" onClick={() => move(id, -1)}>
                ↑
              </Button>
              <Button size="sm" kind="quiet" onClick={() => move(id, 1)}>
                ↓
              </Button>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Gemini (free key)" actions={provider('gemini')?.configured && <Badge tone="ok">connected</Badge>}>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Click <b>Get my free key</b> — Google AI Studio opens. Sign in with your Google account.
            </li>
            <li>
              Click <b>Create API key</b>, then copy it.
            </li>
            <li>Paste it below. JobSweep picks the best free model automatically.</li>
          </ol>
          <div className="flex gap-2">
            <Button onClick={() => api.app.openExternal('https://aistudio.google.com/app/apikey')}>Get my free key</Button>
            <Input type="password" value={keys.gemini} onChange={(v) => setKeys((k) => ({ ...k, gemini: v }))} placeholder="Paste key (AIza…)" />
            <Button kind="brass" onClick={() => setKey('gemini')}>
              Connect
            </Button>
          </div>
          <div className="mt-3 text-xs text-faint">Free-tier prompts may be used by Google to improve its products — that’s why personal details are removed first.</div>
        </Card>
        <Card title="OpenRouter (sign in, free models)" actions={provider('openrouter')?.configured && <Badge tone="ok">connected</Badge>}>
          <p className="mb-4 text-sm text-muted">Sign in and approve JobSweep — no key to copy. Includes free models; JobSweep defaults to automatic model choice.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              kind="brass"
              onClick={async () => {
                toast.info('Your browser opened OpenRouter. Approve JobSweep there.')
                const r = await api.ai.openrouterLogin()
                r.ok ? toast.success(r.message) : toast.error(r.message)
                await status.reload()
              }}
            >
              Sign in with OpenRouter
            </Button>
            <Input value={s?.openrouterModel} onChange={(v) => void save({ openrouterModel: v })} placeholder="Model, e.g. openrouter/auto" className="w-64" />
          </div>
        </Card>
        <KeyCard title="DeepSeek key (pay as you go, low cost)" id="deepseek" model={s?.deepseekModel} onModel={(v) => save({ deepseekModel: v })} keys={keys} setKeys={setKeys} setKey={setKey} configured={!!provider('deepseek')?.configured} getKeyUrl="https://platform.deepseek.com/api_keys" note="Uses DeepSeek Flash by default. Text only, so screenshot reading still uses local AI or Gemini." />
        <KeyCard title="OpenAI key (pay as you go)" id="openai" model={s?.openaiModel} onModel={(v) => save({ openaiModel: v })} keys={keys} setKeys={setKeys} setKey={setKey} configured={!!provider('openai')?.configured} />
        <KeyCard title="Anthropic key (pay as you go)" id="anthropic" model={s?.anthropicModel} onModel={(v) => save({ anthropicModel: v })} keys={keys} setKeys={setKeys} setKey={setKey} configured={!!provider('anthropic')?.configured} />
      </div>
    </div>
  )
}

function KeyCard({ title, id, model, onModel, keys, setKeys, setKey, configured, getKeyUrl, note }: { title: string; id: 'deepseek' | 'openai' | 'anthropic'; model?: string; onModel: (v: string) => void; keys: Record<string, string>; setKeys: (fn: (k: Record<string, string>) => Record<string, string>) => void; setKey: (id: 'deepseek' | 'openai' | 'anthropic') => Promise<void>; configured: boolean; getKeyUrl?: string; note?: string }) {
  return (
    <Card title={title} actions={configured && <Badge tone="ok">connected</Badge>}>
      <div className="flex gap-2">
        {getKeyUrl && <Button onClick={() => api.app.openExternal(getKeyUrl)}>Get a key</Button>}
        <Input type="password" value={keys[id]} onChange={(v) => setKeys((k) => ({ ...k, [id]: v }))} placeholder={configured ? 'Saved — paste to replace, or leave empty and click Save to remove' : 'Paste API key'} />
        <Button onClick={() => setKey(id)}>Save</Button>
      </div>
      <div className="mt-3">
        <Label>Model</Label>
        <Input value={model} onChange={onModel} />
      </div>
      {note && <div className="mt-3 text-xs text-faint">{note}</div>}
    </Card>
  )
}

// ---------------- Email ----------------

function EmailSetup() {
  const { s } = useSettings()
  const [user, setUser] = useState(s?.emailUser ?? '')
  const [pass, setPass] = useState('')
  const configured = useLoad(() => api.email.configured())
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card title="1 · Make an email just for job hunting">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Create a new Gmail account (e.g. <span className="font-mono text-text">yourname.jobs@gmail.com</span>).{' '}
            <button className="text-brass underline" onClick={() => api.app.openExternal('https://accounts.google.com/signup')}>
              Create account
            </button>
          </li>
          <li>
            Turn on <b>2-Step Verification</b> for it.{' '}
            <button className="text-brass underline" onClick={() => api.app.openExternal('https://myaccount.google.com/signinoptions/twosv')}>
              Open settings
            </button>
          </li>
          <li>
            Create an <b>app password</b> named “JobSweep” and copy the 16 letters.{' '}
            <button className="text-brass underline" onClick={() => api.app.openExternal('https://myaccount.google.com/apppasswords')}>
              Open app passwords
            </button>
          </li>
          <li>Put the same address in your Profile as your application email.</li>
        </ol>
        <div className="mt-4">
          <Callout>Why a separate inbox: every sign-up and application uses it, so JobSweep only ever reads job mail — never your personal email.</Callout>
        </div>
      </Card>
      <Card title="2 · Connect it" actions={configured.data && <Badge tone="ok">connected</Badge>}>
        <div className="space-y-3">
          <div>
            <Label>Gmail address</Label>
            <Input value={user} onChange={setUser} placeholder="yourname.jobs@gmail.com" />
          </div>
          <div>
            <Label>App password</Label>
            <Input type="password" value={pass} onChange={setPass} placeholder={configured.data ? 'Saved' : 'xxxx xxxx xxxx xxxx'} />
          </div>
          <div className="flex gap-2">
            <Button
              kind="brass"
              onClick={async () => {
                const r = await api.email.save(user, pass)
                r.ok ? toast.success(r.message) : toast.error(r.message)
                setPass('')
                await configured.reload()
              }}
            >
              Connect & test
            </Button>
            <Button
              onClick={async () => {
                try {
                  const r = await api.email.checkNow()
                  toast.success(`Checked ${r.processed} new emails. ${r.updates.length} application updates.`)
                } catch (e) {
                  toast.error(errMsg(e))
                }
              }}
            >
              Check inbox now
            </Button>
          </div>
          <div className="text-xs text-faint">JobSweep checks every {s?.emailPollMinutes ?? 10} minutes while it’s open, finishes account verifications, and updates application statuses.</div>
        </div>
      </Card>
    </div>
  )
}

// ---------------- Extension ----------------

function ExtensionSetup() {
  const pair = useLoad(() => api.app.pairing())
  const info = useLoad(() => api.app.info())
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Install the JobSweep extension in Edge">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Open <span className="font-mono text-text">edge://extensions</span> in Edge.
          </li>
          <li>
            Turn on <b>Developer mode</b> (bottom-left).
          </li>
          <li>
            Click <b>Load unpacked</b> and choose the JobSweep <span className="font-mono text-text">extension</span> folder.{' '}
            <button className="text-brass-2 underline underline-offset-2 hover:brightness-110" onClick={() => void api.app.openExtensionFolder()}>
              Show me the folder
            </button>
          </li>
          <li>Click the JobSweep icon in the toolbar and paste the pairing code below.</li>
        </ol>
        <div className="mt-4">
          <Callout>
            The extension only reads the job you’re looking at, and only when you click <b>Import to JobSweep</b>. It never clicks, scrolls, or browses on its own — that keeps your LinkedIn and Indeed accounts safe.
          </Callout>
        </div>
      </Card>
      <Card title="Pairing code">
        {pair.data && (
          <div className="space-y-3">
            <div className="selectable rounded-xl border border-brass/40 bg-black/40 px-4 py-3 text-center font-mono text-lg tracking-widest text-brass-2">
              {pair.data.port}-{pair.data.token}
            </div>
            <Button onClick={async () => void (await navigator.clipboard.writeText(`${pair.data!.port}-${pair.data!.token}`), toast.success('Copied.'))}>Copy pairing code</Button>
            <div className="text-xs text-faint">The app listens only on this computer (127.0.0.1). Data folder: {info.data?.dataDir}</div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------- Sources ----------------

function Sources() {
  const { s, save } = useSettings()
  const [keys, setKeys] = useState<Record<string, string>>({})
  const has = useLoad(async () => ({ usajobs: await api.ai.hasSourceKey('usajobs'), adzuna: await api.ai.hasSourceKey('adzuna'), jsearch: await api.ai.hasSourceKey('jsearch') }))
  const [board, setBoard] = useState('')
  if (!s) return null
  const keyRow = (id: 'usajobs' | 'adzuna' | 'jsearch', label: string, help: string, link: string, ph: string) => (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm text-text">{label}</span>
        {has.data?.[id] ? <Badge tone="ok">key saved</Badge> : <Badge>needs free key</Badge>}
      </div>
      <div className="mb-2 text-xs text-muted">
        {help}{' '}
        <button className="text-brass underline" onClick={() => api.app.openExternal(link)}>
          Get a key
        </button>
      </div>
      <div className="flex gap-2">
        <Input type="password" value={keys[id]} onChange={(v) => setKeys((k) => ({ ...k, [id]: v }))} placeholder={ph} />
        <Button onClick={async () => void (await api.ai.setSourceKey(id, keys[id] ?? ''), setKeys((k) => ({ ...k, [id]: '' })), await has.reload(), toast.success('Saved.'))}>Save</Button>
      </div>
    </div>
  )
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Sources on your board">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(SOURCE_LABELS).map(([id, label]) => (
            <Toggle key={id} on={s.sources[id] !== false} onChange={(v) => void save({ sources: { ...s.sources, [id]: v } })} label={label} />
          ))}
        </div>
      </Card>
      <Card title="Free API keys">
        <div className="space-y-3">
          {keyRow('usajobs', 'USAJOBS', 'Federal jobs. Free key emailed to you; uses your profile email.', 'https://developer.usajobs.gov/apirequest/', 'Authorization key')}
          {keyRow('adzuna', 'Adzuna', 'Broad job search. Paste as app_id:app_key.', 'https://developer.adzuna.com/signup', 'app_id:app_key')}
          {keyRow('jsearch', 'JSearch (RapidAPI)', 'Google-for-Jobs listings incl. LinkedIn/Indeed postings. Small free quota.', 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch', 'RapidAPI key')}
        </div>
      </Card>
      <Card title="Company career sites JobSweep watches" className="xl:col-span-2">
        <div className="mb-3 flex gap-2">
          <Input value={board} onChange={setBoard} placeholder="Paste a careers link (Workday, Greenhouse, Lever, Ashby, SmartRecruiters)" />
          <Button
            kind="brass"
            onClick={async () => {
              try {
                toast.success(await api.jobs.addCompanyBoard(board))
                setBoard('')
                await save({})
              } catch (e) {
                toast.error(errMsg(e))
              }
            }}
          >
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.workdayTenants.map((t) => (
            <Badge key={t} tone="warn">
              Workday · {t.replace(/^https:\/\//, '').split('.')[0]}
              <button className="ml-1 hover:text-bad" title={`Remove ${t}`} aria-label={`Remove ${t}`} onClick={() => void save({ workdayTenants: s.workdayTenants.filter((x) => x !== t) })}>
                ×
              </button>
            </Badge>
          ))}
          {s.companyBoards.map((b) => (
            <Badge key={b.platform + b.slug} tone="info">
              {b.platform} · {b.company}
              <button className="ml-1 hover:text-bad" onClick={() => void save({ companyBoards: s.companyBoards.filter((x) => x !== b) })}>
                ×
              </button>
            </Badge>
          ))}
        </div>
        <div className="mt-3 text-xs text-faint">New company boards are also added automatically when imported or aggregated jobs link to them.</div>
      </Card>
    </div>
  )
}

// ---------------- Automation ----------------

function AutomationSettings() {
  const { s, save } = useSettings()
  const [cap, setCap] = useState(s?.dailyCap ?? 10)
  const tier = useLoad(() => api.settings.capTier(cap), [cap])
  if (!s) return null
  const tierColor = { green: 'text-ok', yellow: 'text-brass-2', orange: 'text-warn', red: 'text-bad' }[tier.data?.tier ?? 'green']
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="How applications go out">
        <Segmented value={s.mode} onChange={(v) => void save({ mode: v })} options={[{ value: 'review', label: 'Review mode — I approve each one' }, { value: 'auto', label: 'Auto mode — submit for me' }]} />
        <div className="mt-3 text-sm text-muted">
          {s.mode === 'review' ? 'Applications are filled and stacked in your review deck. Nothing is submitted without your click.' : 'JobSweep submits on its own, then shows a summary. It always pauses for CAPTCHAs, sign-ins, and unapproved answers. LinkedIn and Indeed stay in assist mode.'}
        </div>
      </Card>
      <Card title="Daily limit">
        <div className="flex items-center gap-4">
          <input type="range" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="flex-1 accent-[#c9a961]" />
          <span className={cx('w-12 text-right font-display text-2xl font-semibold tabular-nums', tierColor)}>{cap}</span>
        </div>
        {tier.data && <div className={cx('mt-2 text-sm', tierColor)}>{tier.data.message}</div>}
        <div className="mt-3">
          <Button
            kind="brass"
            disabled={cap === s.dailyCap}
            onClick={async () => {
              const t = tier.data!
              for (let i = 0; i < t.confirmations; i++) if (!confirm(i === 0 ? `Set the daily limit to ${cap}? ${t.message}` : 'Are you sure? This is a very high volume.')) return
              await save({ dailyCap: cap })
              toast.success(`Daily limit set to ${cap}.`)
            }}
          >
            Save limit
          </Button>
        </div>
      </Card>
      <Card title="Quality guards">
        <div className="space-y-4">
          <RangeSetting label="Minimum match score" value={s.minMatchScore} min={0} max={95} onSave={(v) => save({ minMatchScore: v })} hint="Only jobs at or above this score are applied to automatically." />
          <RangeSetting label="Per-company limit (per month)" value={s.perCompanyMonthlyCap} min={1} max={10} onSave={(v) => save({ perCompanyMonthlyCap: v })} hint="Recruiters see every application you send them." />
          <RangeSetting label="Maximum scam risk" value={s.maxScamScore} min={0} max={80} onSave={(v) => save({ maxScamScore: v })} hint="Jobs riskier than this are skipped." />
        </div>
      </Card>
      <Card title="Schedule (only while this PC is on)">
        <div className="space-y-4">
          <Toggle on={s.scheduleEnabled} onChange={(v) => void save({ scheduleEnabled: v })} label="Run every day" hint="Refresh jobs, then Apply for me, at this time." />
          <Input type="time" value={s.scheduleTime} onChange={(v) => void save({ scheduleTime: v })} className="w-40" />
          <Toggle on={s.startAtLogin} onChange={(v) => void save({ startAtLogin: v })} label="Start JobSweep when I sign in to Windows" />
        </div>
      </Card>
    </div>
  )
}

function RangeSetting({ label, value, min, max, onSave, hint }: { label: string; value: number; min: number; max: number; onSave: (v: number) => void; hint: string }) {
  const [v, setV] = useState(value)
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} value={v} onChange={(e) => setV(Number(e.target.value))} onMouseUp={() => onSave(v)} className="flex-1 accent-[#c9a961]" />
        <span className="w-10 text-right font-mono text-brass-2">{v}</span>
      </div>
    </div>
  )
}

function Audio() {
  const { s, save } = useSettings()
  if (!s) return null
  return (
    <Card title="Sound & motion">
      <div className="space-y-4">
        <Toggle on={s.musicOn} onChange={(v) => void save({ musicOn: v })} label="Elevator music" hint="Generated live — copyright-free, and never the exact same loop twice." />
        <Toggle on={s.sfxOn} onChange={(v) => void save({ sfxOn: v })} label="Floor chime" />
        <Toggle
          on={s.reduceMotion}
          onChange={(v) => void save({ reduceMotion: v })}
          label="Reduce motion"
          hint="Skip the elevator doors and other animations. Also follows the Windows “Show animations” setting."
        />
        <div>
          <Label>Volume</Label>
          <input
            type="range"
            aria-label="Music volume"
            min={0}
            max={1}
            step={0.05}
            value={s.musicVolume}
            onChange={(e) => void save({ musicVolume: Number(e.target.value) })}
            className="w-64 accent-[#c9a961]"
          />
        </div>
      </div>
    </Card>
  )
}

function Backup() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Backup">
        <p className="mb-4 text-sm text-muted">
          Save everything (profile, resumes, applications, site accounts) into one file. Passwords and keys stay encrypted and only open on this Windows account.
        </p>
        <Button
          kind="brass"
          onClick={async () => {
            const p = await api.app.exportBackup()
            if (p) toast.success(`Saved to ${p}`)
          }}
        >
          Save a backup
        </Button>
      </Card>
      <Card title="Something not working?">
        <p className="mb-4 text-sm text-muted">JobSweep keeps a short log of errors. Open the folder and send the jobsweep.log file along with a description of what happened.</p>
        <Button onClick={() => void api.app.openLogs()}>Open the error log folder</Button>
      </Card>
    </div>
  )
}
