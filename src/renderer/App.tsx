import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'
import { api } from './lib/api'
import { muzak } from './audio/muzak'
import { ToastHost } from './ui/toast'
import { Button, Card, cx, Spinner } from './ui/kit'

// Each floor is its own chunk, loaded the first time you visit it.
const Lobby = lazy(() => import('./floors/Lobby').then((m) => ({ default: m.Lobby })))
const ResumeStudio = lazy(() => import('./floors/ResumeStudio').then((m) => ({ default: m.ResumeStudio })))
const ProfileFloor = lazy(() => import('./floors/Profile').then((m) => ({ default: m.ProfileFloor })))
const JobBoard = lazy(() => import('./floors/JobBoard').then((m) => ({ default: m.JobBoard })))
const Automation = lazy(() => import('./floors/Automation').then((m) => ({ default: m.Automation })))
const SiteLearningFloor = lazy(() => import('./floors/SiteLearning').then((m) => ({ default: m.SiteLearningFloor })))
const Analytics = lazy(() => import('./floors/Analytics').then((m) => ({ default: m.Analytics })))
const Maintenance = lazy(() => import('./floors/Maintenance').then((m) => ({ default: m.Maintenance })))

export type FloorId = 'L' | '1' | '2' | '3' | '4' | '5' | '6' | 'M'
export const FLOORS: { id: FloorId; name: string; sub: string }[] = [
  { id: 'L', name: 'Lobby', sub: 'Today at a glance' },
  { id: '1', name: 'Resume Studio', sub: 'ATS check, versions, cover letters' },
  { id: '2', name: 'Profile', sub: 'You, your targets, your answers' },
  { id: '3', name: 'Job Board', sub: 'Matches from every source' },
  { id: '4', name: 'Automation', sub: 'Apply for me · review deck' },
  { id: '5', name: 'Site Learning', sub: 'Teach JobSweep new sites' },
  { id: '6', name: 'Analytics', sub: 'What’s working' },
  { id: 'M', name: 'Maintenance', sub: 'AI, email, extension, settings' }
]

interface Nav {
  go: (f: FloorId, params?: Record<string, unknown>) => void
  params: Record<string, unknown>
  settings: Settings | null
  refreshSettings: () => Promise<void>
}
const NavCtx = createContext<Nav>(null as never)
export const useNav = () => useContext(NavCtx)

export function App() {
  const [floor, setFloor] = useState<FloorId>('L')
  const [shown, setShown] = useState<FloorId>('L')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [doors, setDoors] = useState<'open' | 'closing' | 'opening'>('open')
  const [settings, setSettings] = useState<Settings | null>(null)
  // Collapsed floors menu is a per-PC display preference, so it lives in localStorage rather than settings.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('navCollapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleNav = () =>
    setNavCollapsed((c) => {
      try {
        localStorage.setItem('navCollapsed', c ? '0' : '1')
      } catch {
        /* display preference only */
      }
      return !c
    })
  const moving = useRef(false)
  const osReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const reduceMotion = !!settings?.reduceMotion || !!osReduced

  const refreshSettings = useCallback(async () => setSettings(await api.settings.get()), [])
  useEffect(() => {
    void refreshSettings()
  }, [refreshSettings])
  useEffect(() => {
    if (!settings) return
    muzak.setVolume(settings.musicVolume)
    if (settings.musicOn) void muzak.start()
    else muzak.stop()
  }, [settings?.musicOn, settings?.musicVolume, settings])

  const go = useCallback(
    (f: FloorId, p: Record<string, unknown> = {}) => {
      setParams(p)
      if (f === floor || moving.current || reduceMotion) {
        setShown(f)
        setFloor(f)
        return
      }
      moving.current = true
      setFloor(f)
      setDoors('closing')
      setTimeout(() => {
        setShown(f)
        if (settings?.sfxOn !== false) void muzak.ding(Math.max(0.15, (settings?.musicVolume ?? 0.35) * 0.9))
        setDoors('opening')
        setTimeout(() => {
          setDoors('open')
          moving.current = false
        }, 520)
      }, 420)
    },
    [floor, settings, reduceMotion]
  )

  const toggleMusic = async () => {
    const next = !(settings?.musicOn ?? true)
    setSettings(await api.settings.save({ musicOn: next }))
  }

  const current = FLOORS.find((f) => f.id === floor)!
  const dir = FLOORS.findIndex((f) => f.id === floor) >= FLOORS.findIndex((f) => f.id === shown) ? '▲' : '▼'

  return (
    <NavCtx.Provider value={{ go, params, settings, refreshSettings }}>
      <MotionConfig reducedMotion={settings?.reduceMotion ? 'always' : 'user'}>
        <div className={cx('flex h-full flex-col', settings?.reduceMotion && 'reduce-motion')}>
          {/* Title bar */}
          <div className="drag flex h-9 shrink-0 items-center gap-4 border-b border-line/60 pl-4 pr-[150px]">
            <div className="flex items-center gap-2">
              <span className="brass-text font-display text-[15px] font-bold tracking-[0.2em]">JOBSWEEP</span>
            </div>
            <div aria-live="polite" className="no-drag flex items-center gap-3 rounded-md border border-[#3a2a10] bg-black/70 px-3 py-0.5">
              <span className="led text-xs">{doors === 'open' ? '■' : dir}</span>
              <span className="led text-xs">{floor === 'L' ? 'L' : floor === 'M' ? 'M' : `0${floor}`}</span>
              <span className="led text-[10px] opacity-80">{current.name.toUpperCase()}</span>
            </div>
            <div className="flex-1" />
            <div className="no-drag flex items-center gap-2 text-xs text-muted">
              <button
                onClick={toggleMusic}
                aria-pressed={!!settings?.musicOn}
                className="rounded-md px-2 py-1 hover:bg-white/5 hover:text-text"
                title={settings?.musicOn ? 'Mute music' : 'Play music'}
              >
                {settings?.musicOn ? '♪ Music on' : '♪ Muted'}
              </button>
              <input
                type="range"
                aria-label="Music volume"
                min={0}
                max={1}
                step={0.05}
                value={settings?.musicVolume ?? 0.35}
                onChange={(e) => setSettings((s) => (s ? { ...s, musicVolume: Number(e.target.value) } : s))}
                onMouseUp={(e) => void api.settings.save({ musicVolume: Number((e.target as HTMLInputElement).value) })}
                className="w-20 accent-[#c9a961]"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Elevator panel */}
            <nav
              aria-label="Floors"
              className={cx('flex shrink-0 flex-col gap-1 border-r border-line/60 bg-black/20 py-5 transition-[width] duration-200', navCollapsed ? 'w-[68px] px-2' : 'w-[230px] px-3')}
            >
              <div className={cx('mb-3 flex items-center px-2', navCollapsed ? 'justify-center' : 'justify-between')}>
                {!navCollapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-faint">Floors</span>}
                <button
                  onClick={toggleNav}
                  className="rounded-md px-1.5 text-sm text-faint hover:bg-white/5 hover:text-text"
                  title={navCollapsed ? 'Show the floors menu' : 'Collapse the floors menu'}
                  aria-label={navCollapsed ? 'Show the floors menu' : 'Collapse the floors menu'}
                >
                  {navCollapsed ? '»' : '«'}
                </button>
              </div>
              {[...FLOORS].map((f) => (
                <button
                  key={f.id}
                  onClick={() => go(f.id)}
                  aria-current={floor === f.id ? 'page' : undefined}
                  aria-label={navCollapsed ? f.name : undefined}
                  title={navCollapsed ? `${f.name}: ${f.sub}` : undefined}
                  className={cx('group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition', floor === f.id ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]')}
                >
                  <span
                    className={cx(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full border font-mono text-xs font-bold transition',
                      floor === f.id
                        ? 'border-brass-2 bg-gradient-to-b from-[#f6dfa2] to-[#9b7c3e] text-[#2a1e08] shadow-[0_0_18px_rgba(231,207,148,0.55),inset_0_1px_0_rgba(255,255,255,0.6)]'
                        : 'border-brass-3/60 bg-gradient-to-b from-[#2a2418] to-[#13110c] text-brass shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] group-hover:border-brass/70'
                    )}
                  >
                    {f.id}
                  </span>
                  {!navCollapsed && (
                    <span className="min-w-0">
                      <span className={cx('block truncate text-sm', floor === f.id ? 'text-text' : 'text-muted group-hover:text-text')}>{f.name}</span>
                      <span className="block truncate text-[11px] text-faint">{f.sub}</span>
                    </span>
                  )}
                </button>
              ))}
              <div className="flex-1" />
              {!navCollapsed && <div className="px-2 text-[10px] leading-relaxed text-faint">Everything stays on this PC. Music is generated live and copyright-free.</div>}
            </nav>

            {/* Car interior */}
            <main className="relative min-w-0 flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto px-8 py-7">
                <AnimatePresence mode="wait">
                  <motion.div key={shown} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="mx-auto max-w-[1280px]">
                    <FloorBoundary key={shown}>
                      <Suspense
                        fallback={
                          <div className="grid h-64 place-items-center text-muted">
                            <Spinner />
                          </div>
                        }
                      >
                        <FloorView id={shown} />
                      </Suspense>
                    </FloorBoundary>
                  </motion.div>
                </AnimatePresence>
              </div>
              {/* Elevator doors */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 flex">
                <motion.div
                  className="h-full w-1/2 border-r border-black/60 bg-gradient-to-r from-[#1b1a17] via-[#2b2822] to-[#3a352b]"
                  animate={{ x: doors === 'closing' ? '0%' : '-101%' }}
                  initial={false}
                  transition={{ duration: doors === 'closing' ? 0.4 : 0.5, ease: [0.65, 0, 0.35, 1] }}
                >
                  <div className="h-full w-full bg-[repeating-linear-gradient(90deg,transparent_0,transparent_3px,rgba(255,255,255,0.015)_3px,rgba(255,255,255,0.015)_4px)]" />
                </motion.div>
                <motion.div
                  className="h-full w-1/2 border-l border-black/60 bg-gradient-to-l from-[#1b1a17] via-[#2b2822] to-[#3a352b]"
                  animate={{ x: doors === 'closing' ? '0%' : '101%' }}
                  initial={false}
                  transition={{ duration: doors === 'closing' ? 0.4 : 0.5, ease: [0.65, 0, 0.35, 1] }}
                >
                  <div className="h-full w-full bg-[repeating-linear-gradient(90deg,transparent_0,transparent_3px,rgba(255,255,255,0.015)_3px,rgba(255,255,255,0.015)_4px)]" />
                </motion.div>
              </div>
            </main>
          </div>
        </div>
      </MotionConfig>
      <ToastHost />
    </NavCtx.Provider>
  )
}

/** If a floor crashes, show a way back instead of a blank window, and log what happened. */
class FloorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    void api.app.logError('floor', `${error.stack ?? error.message}${info.componentStack ?? ''}`)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Card title="Something went wrong on this floor">
        <p className="mb-2 text-sm text-muted">Your data is safe. The problem was saved to the error log, so it can be fixed.</p>
        <p className="selectable mb-4 font-mono text-xs text-faint">{this.state.error.message}</p>
        <div className="flex gap-2">
          <Button kind="brass" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button onClick={() => location.reload()}>Reload JobSweep</Button>
          <Button kind="quiet" onClick={() => void api.app.openLogs()}>
            Open the error log
          </Button>
        </div>
      </Card>
    )
  }
}

function FloorView({ id }: { id: FloorId }) {
  switch (id) {
    case 'L':
      return <Lobby />
    case '1':
      return <ResumeStudio />
    case '2':
      return <ProfileFloor />
    case '3':
      return <JobBoard />
    case '4':
      return <Automation />
    case '5':
      return <SiteLearningFloor />
    case '6':
      return <Analytics />
    case 'M':
      return <Maintenance />
  }
}

export function FloorHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-tight text-text">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  )
}
