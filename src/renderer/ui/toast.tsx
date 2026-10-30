import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useEvent } from '../lib/hooks'
import { cx } from './kit'

type Toast = { id: number; kind: 'info' | 'success' | 'error'; text: string }
let push: (t: Omit<Toast, 'id'>) => void = () => {}
export const toast = {
  info: (text: string) => push({ kind: 'info', text }),
  success: (text: string) => push({ kind: 'success', text }),
  error: (text: string) => push({ kind: 'error', text })
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x.slice(-3), { ...t, id }])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === 'error' ? 9000 : 5000)
    }
  }, [])
  useEvent('toast', (p: { kind: Toast['kind']; text: string }) => push(p))
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[380px] flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className={cx(
              'glass pointer-events-auto whitespace-pre-line rounded-xl bg-ink-2/90 px-4 py-3 text-sm',
              t.kind === 'error' ? 'border-bad/40 text-[#f2c1bd]' : t.kind === 'success' ? 'border-ok/40 text-[#bfe8d4]' : 'text-text'
            )}
            onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
