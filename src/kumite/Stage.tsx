// The fight scene: canvas with the arena, two sprites and effects. It only *renders* the
// KumiteState it receives (from the host); each new event plays its animation once.
import { useEffect, useRef } from 'react'
import type { KumiteEvent, KumiteState } from '../core/kumite'
import { reducedMotion } from '../sound'
import { ksfx } from './audio'
import { FX, KM, POSE, fighterById, loadImage, type Fighter } from './roster'

const W = 960, H = 440
const GAP = 1.15 // half distance between the fighters, in platform units
const SCALE = 0.9 // sprite scale on the 960 px stage
type PoseName = keyof typeof POSE

interface Anim { pose: PoseName; until: number; lunge: number; lungeUntil: number }
interface FxInst { kind: keyof typeof FX; x: number; y: number; t0: number; dur: number; scale: number; flip?: boolean }
interface Sim {
  x: [number, number] // current drawn position, platform units
  from: [number, number]; to: [number, number]; t0: number; dur: number
  anim: [Anim, Anim]
  fx: FxInst[]
  shake: { until: number; amp: number }
  fall: { who: 0 | 1; t0: number } | null
  banner: { text: string; until: number; tone: 'ko' | 'clash' | 'combo' | 'guard' | 'info' } | null
  tags: { i: 0 | 1; ok: boolean; until: number }[]
  lastN: number
  winner: 0 | 1 | null
}

export interface StageProps {
  k: KumiteState & { fighters: [string, string] }
  fighters: [string | undefined, string | undefined] // fighter ids
  names?: [string, string]
  ready?: [boolean, boolean] // answered already (only a "!" bubble, never right/wrong)
  over?: boolean
}

const posOf = (k: KumiteState): [number, number] => [k.c - GAP, k.c + GAP]

export function Stage({ k, fighters, names = ['P1', 'P2'], ready = [false, false], over = false }: StageProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Sim | null>(null)
  const props = useRef({ k, fighters, ready, over, names })
  useEffect(() => { props.current = { k, fighters, ready, over, names } })
  const [f0, f1] = fighters

  // new event → schedule its animation
  useEffect(() => {
    const now = performance.now()
    if (!sim.current) {
      const p = posOf(k)
      const idle: Anim = { pose: 'idle1', until: 0, lunge: 0, lungeUntil: 0 }
      sim.current = { x: p, from: p, to: p, t0: now, dur: 1, anim: [{ ...idle }, { ...idle }], fx: [], shake: { until: 0, amp: 0 }, fall: null, banner: null, tags: [], lastN: k.last.n, winner: k.winner }
      if (k.winner !== null) {
        settleWinner(sim.current, k.winner, now)
        // opened after the K.O. (end screen): the loser has already fallen off
        if (k.last.ko !== undefined) sim.current.fall = { who: k.last.ko, t0: now - 10_000 }
      }
      return
    }
    const s = sim.current
    if (k.last.n !== s.lastN) { play(s, k, k.last, now, props.current.names); s.lastN = k.last.n }
    if (k.winner !== null && s.winner === null) s.winner = k.winner
  }, [k])

  // render loop
  useEffect(() => {
    let raf = 0
    let imgs: { bg: HTMLImageElement; plat: HTMLImageElement; fx: HTMLImageElement; f: [HTMLImageElement, HTMLImageElement] } | null = null
    const ids = [fighterById(f0).id, fighterById(f1).id]
    Promise.all([loadImage('background.jpg'), loadImage('platform.png'), loadImage('fx.png'), loadImage(ids[0] + '.png'), loadImage(ids[1] + '.png')])
      .then(([bg, plat, fx, a, b]) => { imgs = { bg, plat, fx, f: [a, b] } })
      .catch(() => {})
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr; cv.height = H * dpr
    const reduce = reducedMotion()
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const s = sim.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.fillStyle = '#0d1020'; ctx.fillRect(0, 0, W, H)
      if (!imgs || !s) return
      const { fighters: fids, ready: rdy, k: kk } = props.current
      const F: [Fighter, Fighter] = [fighterById(fids[0]), fighterById(fids[1])]
      // camera shake
      const shaking = !reduce && now < s.shake.until
      const sx = shaking ? (Math.random() - 0.5) * s.shake.amp : 0
      const sy = shaking ? (Math.random() - 0.5) * s.shake.amp : 0
      ctx.save(); ctx.translate(sx, sy)
      // background (cover, slightly lowered so the moon and town show)
      const bs = Math.max(W / imgs.bg.width, (H + 40) / imgs.bg.height)
      ctx.drawImage(imgs.bg, (W - imgs.bg.width * bs) / 2, -40, imgs.bg.width * bs, imgs.bg.height * bs)
      // platform
      const pw = W * 0.94, ps = pw / KM.platform.size[0], ph = KM.platform.size[1] * ps
      const px = (W - pw) / 2, py = H - ph * 0.72
      ctx.drawImage(imgs.plat, px, py, pw, ph)
      const floor = py + KM.floor * ps
      const left = px + pw * 0.075, right = px + pw * 0.925
      const cx = (left + right) / 2
      const u = (right - left) / 2 / (kk.edge + GAP)
      // positions tween
      const t = Math.min(1, (now - s.t0) / s.dur)
      const e = 1 - Math.pow(1 - t, 3)
      s.x = [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e]
      const moving = t < 1
      // fighters
      for (const i of [0, 1] as const) {
        const a = s.anim[i]
        let pose: PoseName = now < a.until ? a.pose : (Math.floor((now + i * 230) / 420) % 2 ? 'idle2' : 'idle1')
        if (moving && now >= a.until && pose.startsWith('idle')) pose = Math.floor(now / 140) % 2 ? 'walk1' : 'walk2'
        if (s.winner !== null && now >= a.until && !(s.fall && s.fall.who === i)) pose = s.winner === i ? 'win' : 'hurt'
        const lunge = now < a.lungeUntil ? a.lunge * Math.sin(((a.lungeUntil - now) / 260) * Math.PI) : 0
        let x = cx + s.x[i] * u + (i === 0 ? lunge : -lunge)
        let y = floor
        let alpha = 1
        if (s.fall && s.fall.who === i) {
          const ft = (now - s.fall.t0) / 1000
          pose = ft < 0.35 ? 'hurt' : 'ko'
          x += (i === 0 ? -1 : 1) * ft * 260
          y += Math.max(0, ft - 0.15) ** 2 * 900 - Math.min(ft, 0.15) * 300
          alpha = Math.max(0, 1 - Math.max(0, ft - 0.9) * 1.5)
          if (alpha <= 0) continue
        }
        drawFighter(ctx, imgs.f[i], F[i], pose, x, y, i === 1, alpha)
        const head = y - F[i].height * SCALE - 14
        if (rdy[i] && s.winner === null) bubble(ctx, x, head, F[i].color)
        const tag = s.tags.find((t) => t.i === i && now < t.until)
        if (tag) label(ctx, x, head - 6, (props.current.names[i] || '').toUpperCase().slice(0, 12), tag.ok)
      }
      // effects
      s.fx = s.fx.filter((f) => now < f.t0 + f.dur)
      for (const f of s.fx) {
        if (now < f.t0) continue
        const p = (now - f.t0) / f.dur
        const size = KM.fx.cell[0] * f.scale * (0.7 + 0.5 * Math.sin(Math.min(1, p * 2) * Math.PI / 2))
        ctx.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3
        const idx = FX[f.kind]
        ctx.save()
        ctx.translate(cx + f.x * u, f.y === 0 ? floor - 70 : floor + f.y)
        if (f.flip) ctx.scale(-1, 1)
        ctx.drawImage(imgs.fx, (idx % 4) * KM.fx.cell[0], Math.floor(idx / 4) * KM.fx.cell[1], KM.fx.cell[0], KM.fx.cell[1], -size / 2, -size / 2, size, size)
        ctx.restore()
        ctx.globalAlpha = 1
      }
      ctx.restore()
      // banner
      if (s.banner && now < s.banner.until) {
        const b = s.banner
        const size = b.tone === 'ko' ? 110 : b.tone === 'clash' ? 54 : b.tone === 'combo' ? 50 : 34
        const fill = b.tone === 'ko' ? '#ffcc33' : b.tone === 'clash' ? '#bfe6ff' : b.tone === 'combo' ? '#ff9a3c' : b.tone === 'guard' ? '#ffe066' : '#ffffff'
        const pop = Math.min(1, (now - (b.until - (b.tone === 'ko' ? 1e9 : 1000))) / 120)
        ctx.save()
        ctx.translate(W / 2, b.tone === 'ko' ? H * 0.24 : 64)
        ctx.scale(0.6 + 0.4 * Math.max(0, Math.min(1, pop)), 0.6 + 0.4 * Math.max(0, Math.min(1, pop)))
        ctx.font = `${Math.round(size * 0.62)}px 'Press Start 2P', monospace`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'; ctx.lineWidth = size / 6; ctx.strokeStyle = '#1a0a0a'
        ctx.strokeText(b.text, 0, 0)
        ctx.fillStyle = fill; ctx.fillText(b.text, 0, 0)
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [f0, f1])

  return <canvas ref={ref} className="kstage" aria-label="Combate" role="img" />
}

function drawFighter(ctx: CanvasRenderingContext2D, img: HTMLImageElement, f: Fighter, pose: PoseName, x: number, y: number, flip: boolean, alpha: number) {
  const [cw, ch] = KM.cell
  const idx = POSE[pose]
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  if (flip) ctx.scale(-1, 1)
  ctx.scale(SCALE, SCALE)
  // small shadow under the feet
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.beginPath(); ctx.ellipse(0, 2, 46, 9, 0, 0, Math.PI * 2); ctx.fill()
  ctx.drawImage(img, idx * cw, 0, cw, ch, -f.foot[0], -f.foot[1], cw, ch)
  ctx.restore()
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save()
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.roundRect(x - 13, y - 26, 26, 26, 6); ctx.fill(); ctx.stroke()
  ctx.fillStyle = color; ctx.font = '900 20px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', x, y - 6)
  ctx.restore()
}

/** Name tag over a fighter: green "✓ ACIERTA" or red "✗ FALLA". */
function label(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, ok: boolean) {
  ctx.save()
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round'
  ctx.font = `11px 'Press Start 2P', monospace`
  ctx.lineWidth = 4; ctx.strokeStyle = '#000'
  ctx.strokeText(name, x, y - 18); ctx.fillStyle = '#fff'; ctx.fillText(name, x, y - 18)
  ctx.font = `13px 'Press Start 2P', monospace`
  const t = ok ? 'ACIERTA' : 'FALLA'
  ctx.strokeText(t, x, y); ctx.fillStyle = ok ? '#5dff8a' : '#ff5a5a'; ctx.fillText(t, x, y)
  ctx.restore()
}

function settleWinner(s: Sim, w: 0 | 1, now: number) {
  s.winner = w
  s.anim[w] = { pose: 'win', until: now + 1e9, lunge: 0, lungeUntil: 0 }
}

/** Turns one fight event into poses, movement, effects, sounds and a banner. */
function play(s: Sim, k: KumiteState, ev: KumiteEvent, now: number, names: [string, string]) {
  const shout = (n: string) => (n || '').toUpperCase().slice(0, 12)
  const tagUntil = now + 1900
  const to = posOf(k)
  const mid = (s.x[0] + s.x[1]) / 2
  s.from = [...s.x] as [number, number]; s.to = to; s.t0 = now + 180; s.dur = 520
  if (ev.type === 'clash') {
    s.anim = [{ pose: 'strong', until: now + 650, lunge: 22, lungeUntil: now + 260 }, { pose: 'strong', until: now + 650, lunge: 22, lungeUntil: now + 260 }]
    s.fx.push({ kind: 'clash', x: mid, y: -78, t0: now + 90, dur: 520, scale: 1.1 })
    s.shake = { until: now + 220, amp: 5 }
    s.banner = { text: '¡DOBLE ACIERTO!', until: now + 1300, tone: 'clash' }
    s.tags = [{ i: 0, ok: true, until: tagUntil }, { i: 1, ok: true, until: tagUntil }]
    ksfx.clash()
    if (k.combo[0] >= 3 || k.combo[1] >= 3) setTimeout(() => ksfx.combo(Math.max(...k.combo)), 250)
  } else if (ev.type === 'hit' && ev.by !== undefined) {
    const a = ev.by, d = (1 - a) as 0 | 1
    const atk = ev.attack ?? 'quick'
    s.tags = [{ i: a, ok: true, until: tagUntil }, { i: d, ok: false, until: tagUntil }]
    s.banner = { text: `¡GOLPE DE ${shout(names[a])}!`, until: now + 1000, tone: 'info' }
    s.anim[a] = { pose: atk, until: now + 640, lunge: atk === 'special' ? 34 : 24, lungeUntil: now + 260 }
    s.anim[d] = { pose: 'hurt', until: now + 700, lunge: 0, lungeUntil: 0 }
    const hitX = s.x[d] + (d === 1 ? -0.35 : 0.35)
    s.fx.push({ kind: atk === 'quick' ? 'spark' : 'bigspark', x: hitX, y: -86, t0: now + 110, dur: 420, scale: atk === 'quick' ? 0.8 : 1.15 })
    if (atk === 'special') { s.fx.push({ kind: 'flame', x: s.x[a], y: -10, t0: now, dur: 650, scale: 0.9 }); s.shake = { until: now + 320, amp: 9 } }
    else s.shake = { until: now + 140, amp: atk === 'strong' ? 5 : 2 }
    s.fx.push({ kind: 'dust', x: to[d], y: -12, t0: now + 260, dur: 520, scale: 0.55, flip: d === 0 })
    ;(atk === 'special' ? ksfx.special : atk === 'strong' ? ksfx.strong : ksfx.quick)()
    setTimeout(() => ksfx.slide(), 220)
    const combo = k.combo[a]
    if (combo >= 3) { setTimeout(() => ksfx.combo(combo), 300); s.banner = { text: `COMBO ×${combo}`, until: now + 1000, tone: 'combo' } }
    if (ev.guard) { s.banner = { text: '¡SE AGARRA AL BORDE!', until: now + 1100, tone: 'guard' }; setTimeout(() => ksfx.guard(), 380) }
    if (ev.ko !== undefined) {
      s.to = [...s.x] as [number, number]
      s.fall = { who: ev.ko, t0: now + 420 }
      s.fx.push({ kind: 'fall', x: ev.ko === 1 ? k.edge + GAP + 0.6 : -(k.edge + GAP + 0.6), y: 40, t0: now + 700, dur: 900, scale: 1.2 })
      s.banner = { text: 'K.O.', until: now + 1e9, tone: 'ko' }
      setTimeout(() => ksfx.fall(), 450)
      setTimeout(() => ksfx.ko(), 1300)
      setTimeout(() => { s.winner = a; s.anim[a] = { pose: 'win', until: now + 1e9, lunge: 0, lungeUntil: 0 }; s.fx.push({ kind: 'win', x: s.x[a], y: -90, t0: performance.now(), dur: 1400, scale: 1.2 }) }, 1500)
    }
  } else if (ev.type === 'stumble') {
    s.anim = [{ pose: 'hurt', until: now + 450, lunge: 0, lungeUntil: 0 }, { pose: 'hurt', until: now + 450, lunge: 0, lungeUntil: 0 }]
    s.fx.push({ kind: 'dizzy', x: s.x[0], y: -150, t0: now, dur: 1300, scale: 0.55 }, { kind: 'dizzy', x: s.x[1], y: -150, t0: now, dur: 1300, scale: 0.55 })
    s.banner = { text: '¡FALLAN LOS DOS!', until: now + 1100, tone: 'info' }
    s.tags = [{ i: 0, ok: false, until: tagUntil }, { i: 1, ok: false, until: tagUntil }]
    ksfx.stumble()
  }
}
