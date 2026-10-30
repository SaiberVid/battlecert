import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react'
import qrcode from 'qrcode-generator'
import { useStore } from '../store'
import { reducedMotion } from '../sound'

export const SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export function colorOf(index: number) { return `var(--p${(index % 8) + 1})` }

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19 19 5M14 5h5v5M19 19 5 5M5 10V5h5" />
      </svg>
    </span>
  )
}

/** QR code drawn as one SVG path from the module matrix (no HTML strings). */
export function Qr({ text, label }: { text: string; label: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { d, n }
  }, [text])
  return (
    <div className="qr">
      <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <path d={d} fill="#111" />
      </svg>
    </div>
  )
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 200) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export function Ring({ left, total, calm = false }: { left: number; total: number; calm?: boolean }) {
  const r = 26
  const c = 2 * Math.PI * r
  const f = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0
  const secs = Math.ceil(left / 1000)
  return (
    <div className={'ring' + (calm ? ' calm' : secs <= 5 ? ' low' : '')} role="timer" aria-label={`${secs} segundos`}>
      <svg viewBox="0 0 64 64"><circle className="bg" cx="32" cy="32" r={r} /><circle className="fg" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - f)} /></svg>
      <b>{secs}</b>
    </div>
  )
}

/** Number that counts up/down smoothly when it changes. */
export function Count({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 120, damping: 20 })
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString('es-ES'))
  useEffect(() => { if (reducedMotion()) spring.jump(value); else spring.set(value) }, [value, spring])
  return <motion.span>{text}</motion.span>
}

export function Toast() {
  const msg = useStore((s) => s.msg)
  const set = useStore((s) => s.set)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => set({ msg: null }), msg.tone === 'ok' ? 2500 : 6000)
    return () => clearTimeout(t)
  }, [msg, set])
  return (
    <AnimatePresence>
      {msg && (
        <motion.div key={msg.text} className={'toast ' + msg.tone} role={msg.tone === 'warn' ? 'alert' : 'status'} initial={{ opacity: 0, y: 20, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 20, x: '-50%' }}>
          <span>{msg.text}</span>
          <button onClick={() => set({ msg: null })} aria-label="Cerrar aviso">✕</button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Emoji reactions floating up from the bottom of the screen. */
export function Floaters() {
  const reactions = useStore((s) => s.reactions)
  const P = useStore((s) => s.P)
  return (
    <div className="floaters" aria-hidden="true">
      <AnimatePresence>
        {reactions.map((r) => {
          const idx = P ? Math.max(0, P.players.findIndex((p) => p.pid === r.pid)) : 0
          const left = 8 + ((r.id * 37 + idx * 11) % 80)
          return (
            <motion.div key={r.id} className="floater" style={{ left: left + '%' }} initial={{ opacity: 0, y: 0, scale: .6 }} animate={{ opacity: [0, 1, 1, 0], y: -320, scale: 1.1 }} exit={{ opacity: 0 }} transition={{ duration: 2, ease: 'easeOut' }}>
              {r.e}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** Short confetti burst on a canvas; skipped when the user prefers reduced motion. */
export function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!fire || reducedMotion()) return
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
    ctx.scale(dpr, dpr)
    const css = getComputedStyle(document.documentElement)
    const colors = ['--p1', '--p2', '--p3', '--p4', '--p5', '--accent', '--gold'].map((v) => css.getPropertyValue(v).trim() || '#3cc2ad')
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * innerWidth * .3, y: innerHeight * .35,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 10, c: colors[Math.floor(Math.random() * colors.length)],
    }))
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      for (const p of parts) {
        p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore()
      }
      if (t - t0 < 3500) raf = requestAnimationFrame(step)
      else ctx.clearRect(0, 0, innerWidth, innerHeight)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [fire])
  return <canvas ref={ref} className="confetti" aria-hidden="true" style={{ width: '100vw', height: '100vh' }} />
}

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export function fmtMs(ms: number) { return (ms / 1000).toFixed(1) + ' s' }

export function Icon({ name }: { name: 'sound' | 'mute' | 'auto' | 'light' | 'dark' }) {
  const d: Record<string, React.ReactNode> = {
    sound: <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="m17 9 5 6M22 9l-5 6" /></>,
    auto: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></>,
    light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  }
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d[name]}</svg>
}
