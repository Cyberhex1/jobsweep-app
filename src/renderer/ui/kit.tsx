import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Button({
  children,
  onClick,
  kind = 'ghost',
  size = 'md',
  disabled,
  busy,
  title,
  className
}: {
  children: ReactNode
  onClick?: () => void | Promise<unknown>
  kind?: 'brass' | 'ghost' | 'danger' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  busy?: boolean
  title?: string
  className?: string
}) {
  const [running, setRunning] = useState(false)
  const isBusy = busy || running
  const styles = {
    brass: 'bg-gradient-to-b from-brass-2 via-brass to-brass-3 text-[#1a1407] font-semibold shadow-[0_8px_24px_-10px_rgba(201,169,97,0.7)] hover:brightness-110',
    ghost: 'border border-line bg-white/[0.03] hover:bg-white/[0.07] text-text',
    danger: 'border border-bad/40 text-bad hover:bg-bad/10',
    quiet: 'text-muted hover:text-text hover:bg-white/[0.05]'
  }[kind]
  const sizes = { sm: 'px-2.5 py-1 text-xs rounded-lg', md: 'px-3.5 py-2 text-sm rounded-xl', lg: 'px-5 py-3 text-base rounded-2xl' }[size]
  return (
    <button
      title={title}
      aria-busy={isBusy || undefined}
      disabled={disabled || isBusy}
      onClick={async () => {
        if (!onClick) return
        const r = onClick()
        if (r instanceof Promise) {
          setRunning(true)
          try {
            await r
          } finally {
            setRunning(false)
          }
        }
      }}
      className={cx('inline-flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap', styles, sizes, className)}
    >
      {isBusy && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin', className)} />
}

export function Card({ children, className, title, actions, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('glass rounded-2xl', pad && 'p-5', className)}>
      {(title || actions) && (
        <header className={cx('flex items-center justify-between gap-3', pad ? 'mb-4' : 'px-5 pt-4 pb-3')}>
          {typeof title === 'string' ? <h3 className="font-display text-[15px] font-semibold tracking-wide text-text">{title}</h3> : title}
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  )
}

export function Input({ value, onChange, placeholder, type = 'text', className, onEnter }: { value: string | number | undefined; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string; onEnter?: () => void }) {
  return <input className={cx('field', className)} type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
}

export function TextArea({ value, onChange, placeholder, rows = 4, className }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string }) {
  return <textarea className={cx('field resize-y leading-relaxed', className)} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function Select<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <select className={cx('field', className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition', on ? 'border-brass/60 bg-brass/30' : 'border-line bg-white/5')}
      >
        <span className={cx('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all', on ? 'left-[18px] bg-brass-2 shadow-[0_0_10px_rgba(231,207,148,0.7)]' : 'left-0.5 bg-muted')} />
      </button>
      {(label || hint) && (
        <span>
          <span className="block text-sm text-text">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      )}
    </label>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-black/20 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-xs font-medium transition', value === o.value ? 'bg-brass/20 text-brass-2 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.4)]' : 'text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brass'; title?: string }) {
  const t = {
    neutral: 'border-line text-muted',
    ok: 'border-ok/40 text-ok bg-ok/5',
    warn: 'border-warn/40 text-warn bg-warn/5',
    bad: 'border-bad/40 text-bad bg-bad/5',
    info: 'border-info/40 text-info bg-info/5',
    brass: 'border-brass/40 text-brass-2 bg-brass/10'
  }[tone]
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', t)}>
      {children}
    </span>
  )
}

export function Score({ value, size = 44, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const color = value >= 75 ? 'var(--color-ok)' : value >= 55 ? 'var(--color-brass-2)' : value >= 35 ? 'var(--color-warn)' : 'var(--color-bad)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={label ?? `${value}% match`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="3" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="3" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[11px] font-semibold" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <div className="mb-1 font-display text-base text-text">{title}</div>
      {children && <div className="mb-4 max-w-md text-sm text-muted">{children}</div>}
      {action}
    </div>
  )
}

export function Drawer({ open, onClose, children, width = 640 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="fixed right-0 top-0 bottom-0 z-50 overflow-y-auto border-l border-line bg-ink-2/95 p-6 pt-12 backdrop-blur-xl"
            style={{ width }}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={{ type: 'spring', damping: 30, stiffness: 260 }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} className="glass w-full max-w-lg rounded-2xl bg-ink-2 p-6" initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-display text-lg font-semibold">{title}</h3>
            <div className="text-sm text-muted">{children}</div>
            {actions && <div className="mt-5 flex justify-end gap-2">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Tags({ values, onChange, placeholder, suggest }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; suggest?: (q: string) => Promise<string[]> }) {
  const [q, setQ] = useState('')
  const [sugs, setSugs] = useState<string[]>([])
  useEffect(() => {
    if (!suggest) return
    let live = true
    const t = setTimeout(async () => {
      const s = await suggest(q)
      if (live) setSugs(s.filter((x) => !values.includes(x)))
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, values, suggest])
  const add = (v: string) => {
    const t = v.trim()
    if (t && !values.includes(t)) onChange([...values, t])
    setQ('')
  }
  return (
    <div>
      <div className="field flex flex-wrap items-center gap-1.5 !py-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-brass/15 px-2 py-0.5 text-xs text-brass-2">
            {v}
            <button className="text-brass/70 hover:text-bad" title={`Remove ${v}`} aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[140px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-faint"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(q)
            }
            if (e.key === 'Backspace' && !q && values.length) onChange(values.slice(0, -1))
          }}
        />
      </div>
      {suggest && sugs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sugs.slice(0, 8).map((s) => (
            <button key={s} onClick={() => add(s)} className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted transition hover:border-brass/40 hover:text-brass-2">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'brass'; sub?: ReactNode }) {
  const c = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'brass' ? 'brass-text' : 'text-text'
  return (
    <div className="glass rounded-2xl px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className={cx('mt-1 font-display text-3xl font-semibold tabular-nums', c)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  )
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const t = { info: 'border-info/30 bg-info/5 text-[#c5d7f2]', warn: 'border-warn/30 bg-warn/5 text-[#f0d9a8]', bad: 'border-bad/30 bg-bad/5 text-[#f2c1bd]', ok: 'border-ok/30 bg-ok/5 text-[#bfe8d4]' }[tone]
  return <div className={cx('rounded-xl border px-4 py-3 text-sm leading-relaxed', t)}>{children}</div>
}
