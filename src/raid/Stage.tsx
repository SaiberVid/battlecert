// CERT RAID scene: a boss up front, the heroes seen from behind at the bottom. It only *renders*
// the RaidState the host sends; each new event plays its animation once.
import { useEffect, useRef } from 'react'
import { BOSSES, type RaidEvent, type RaidState } from '../core/raid'
import { reducedMotion } from '../sound'
import { ksfx } from '../kumite/audio'
import { BOSS_IDS, HERO_IDS, RM, frame, rload, type Sheet } from './assets'

const W = 960, H = 440
const HERO_SCALE = 2, BOSS_SCALE = 1.6
const HERO_Y = 446, BOSS_Y = 292

type Step = [pose: string, ms: number]
interface Track { steps: Step[]; t0: number }
interface Shot { kind: string; from: [number, number]; to: [number, number]; t0: number; dur: number; scale: number }
interface Puff { kind: string; x: number; y: number; t0: number; dur: number; scale: number }
interface Floater { text: string; x: number; y: number; t0: number; color: string; size: number }
interface Sim {
  lastN: number
  boss: Track | null
  heroes: (Track | null)[]
  shots: Shot[]
  puffs: Puff[]
  floats: Floater[]
  shake: { until: number; amp: number }
  flash: number
  banner: { text: string; color: string; t0: number; until: number } | null
  hp: number // drawn HP (tweens)
  dead: number // time the boss blew up (0 = alive)
  escaped: number
}

export interface RaidStageProps {
  r: RaidState & { party: string[] }
  names: string[]
  ready: boolean[] // answered already (never says right or wrong)
  phase: string
}

const heroX = (n: number, i: number) => (n === 1 ? W / 2 : i === 0 ? 300 : 660)

/** Pose from a timeline, or null when it has finished. */
function trackPose(t: Track | null, now: number): string | null {
  if (!t) return null
  let x = now - t.t0
  if (x < 0) return null
  for (const [p, ms] of t.steps) { if (x < ms) return p; x -= ms }
  return null
}
const trackEnd = (t: Track) => t.t0 + t.steps.reduce((a, [, ms]) => a + ms, 0)

export function RaidStage({ r, names, ready, phase }: RaidStageProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Sim | null>(null)
  const props = useRef({ r, names, ready, phase })
  useEffect(() => { props.current = { r, names, ready, phase } })

  useEffect(() => {
    const now = performance.now()
    if (!sim.current) {
      sim.current = { lastN: r.last.n, boss: null, heroes: [null, null], shots: [], puffs: [], floats: [], shake: { until: 0, amp: 0 }, flash: 0, banner: null, hp: r.hp, dead: 0, escaped: 0 }
      const s = sim.current
      if (r.last.n === 0) { s.boss = { steps: [['spawn', 450], ['appear', 550]], t0: now }; ksfx.whoosh() }
      if (r.result === 'win') s.dead = now - 5000
      if (r.result === 'escape') s.escaped = now - 5000
      if (r.result) s.banner = { text: r.result === 'win' ? '¡JEFE DERROTADO!' : r.result === 'wipe' ? 'GAME OVER' : 'EL JEFE HUYE', color: r.result === 'win' ? '#ffd23d' : r.result === 'wipe' ? '#ff5a5a' : '#ffb03a', t0: now - 1000, until: now + 9e9 }
      return
    }
    const s = sim.current
    if (r.last.n !== s.lastN) { play(s, r, r.last, now); s.lastN = r.last.n }
  }, [r])

  useEffect(() => {
    let raf = 0
    let imgs: { heroes: HTMLImageElement[]; boss: HTMLImageElement; fx: HTMLImageElement } | null = null
    const bossId = BOSS_IDS[r.boss] ?? BOSS_IDS[0]
    Promise.all([rload('rex.png'), rload('nova.png'), rload(bossId + '.png'), rload('fx.png')])
      .then(([a, b, boss, fx]) => { imgs = { heroes: [a, b], boss, fx } })
      .catch(() => {})
    const bg = backdrop(r.boss)
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr; cv.height = H * dpr
    const reduce = reducedMotion()
    const sheet = (id: string) => RM[id as keyof typeof RM] as Sheet
    const sprite = (img: HTMLImageElement, sh: Sheet, pose: string, cx: number, by: number, scale: number, alpha = 1) => {
      const f = frame(sh, pose)
      const w = sh.w * scale, h = sh.h * scale
      ctx.globalAlpha = alpha
      ctx.drawImage(img, f * sh.w, 0, sh.w, sh.h, Math.round(cx - w / 2), Math.round(by - h), Math.round(w), Math.round(h))
      ctx.globalAlpha = 1
      return { w, h }
    }
    const fxDraw = (kind: string, x: number, y: number, scale: number, alpha = 1, rot = 0) => {
      if (!imgs) return
      const sh = RM.fx, f = frame(sh, kind)
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot)
      ctx.drawImage(imgs.fx, f * sh.w, 0, sh.w, sh.h, -sh.w * scale / 2, -sh.h * scale / 2, sh.w * scale, sh.h * scale)
      ctx.restore()
    }
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const s = sim.current
      const { r: rr, ready: rd, phase: ph } = props.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      const shaking = !reduce && now < s!.shake.until
      ctx.save()
      if (shaking) ctx.translate((Math.random() - 0.5) * s!.shake.amp, (Math.random() - 0.5) * s!.shake.amp)
      ctx.drawImage(bg, -8, -8, W + 16, H + 16)
      if (!imgs || !s) { ctx.restore(); return }
      const bossSh = sheet(BOSS_IDS[rr.boss] ?? 'gatling')
      // ---- boss
      const bob = reduce ? 0 : Math.sin(now / 600) * (rr.boss === 2 ? 9 : 4)
      let by = BOSS_Y + bob
      if (s.escaped) by -= Math.min(420, (now - s.escaped) * 0.35)
      const bx = W / 2
      if (rr.enraged && !s.dead) {
        const pulse = 0.35 + 0.25 * Math.sin(now / 160)
        const g = ctx.createRadialGradient(bx, by - 110, 10, bx, by - 110, 190)
        g.addColorStop(0, `rgba(255,40,40,${pulse})`); g.addColorStop(1, 'rgba(255,40,40,0)')
        ctx.fillStyle = g; ctx.fillRect(bx - 200, by - 310, 400, 400)
      }
      const deadFor = s.dead ? now - s.dead : -1
      if (deadFor < 0 || deadFor < 1500) {
        let pose = trackPose(s.boss, now) ?? (Math.floor(now / 520) % 2 ? 'idle2' : 'idle1')
        if (deadFor >= 0) pose = deadFor < 700 ? (Math.floor(now / 70) % 2 ? 'hurt' : 'idle1') : 'boom'
        // in the reveal of a missed question, the boss keeps its attack pose a moment longer
        const enragedJitter = rr.enraged && !reduce && !s.dead ? (Math.random() - 0.5) * 2 : 0
        sprite(imgs.boss, bossSh, pose, bx + enragedJitter, by, BOSS_SCALE, deadFor >= 700 ? Math.max(0, 1 - (deadFor - 700) / 800) : 1)
      }
      // ---- heroes
      const n = rr.heroes
      for (let i = 0; i < n; i++) {
        const hs = sheet(HERO_IDS[i])
        const x = heroX(n, i)
        const down = rr.hearts[i] === 0
        let pose = trackPose(s.heroes[i], now)
        if (!pose) {
          if (down) pose = 'down'
          else if (rr.result === 'win' && s.dead && now - s.dead > 900) pose = Math.floor(now / 400) % 2 ? 'win' : 'idle1'
          else if (ph === 'q' && rr.party[rr.turn] && i === rr.turn) pose = 'aim'
          else pose = ['idle1', 'idle2', 'idle3', 'idle4'][Math.floor((now + i * 300) / 220) % 4]
        }
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'
        ctx.beginPath(); ctx.ellipse(x, HERO_Y - 8, 54, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
        const { h } = sprite(imgs.heroes[i], hs, pose, x, HERO_Y, HERO_SCALE, down && !s.heroes[i] ? 0.8 : 1)
        // labels
        ctx.textAlign = 'center'
        ctx.font = '10px "Press Start 2P", monospace'
        void h
        const lx = x + (n === 2 && i === 0 ? -86 : 86), ly = HERO_Y - 120
        if (ph === 'q' && !rr.result) {
          ctx.lineWidth = 4; ctx.strokeStyle = '#000'
          const txt = i === rr.turn ? 'TURNO' : down ? 'RESCATE' : 'APUESTA'
          const yy = ly + (i === rr.turn && !reduce ? Math.sin(now / 180) * 3 : 0)
          ctx.strokeText(txt, lx, yy); ctx.fillStyle = i === rr.turn ? '#ffd23d' : 'rgba(255,255,255,.8)'; ctx.fillText(txt, lx, yy)
          if (rd[i]) { ctx.font = '16px "Press Start 2P", monospace'; ctx.strokeText('!', lx, yy + 26); ctx.fillStyle = '#fff'; ctx.fillText('!', lx, yy + 26) }
        }
      }
      // ---- projectiles
      s.shots = s.shots.filter((p) => now < p.t0 + p.dur)
      for (const p of s.shots) {
        if (now < p.t0) continue
        const t = (now - p.t0) / p.dur
        const x = p.from[0] + (p.to[0] - p.from[0]) * t, y = p.from[1] + (p.to[1] - p.from[1]) * t
        const rot = Math.atan2(p.to[1] - p.from[1], p.to[0] - p.from[0]) - Math.PI / 2
        fxDraw(p.kind, x, y, p.scale, 1, p.kind.startsWith('bullet') ? rot : 0)
      }
      // ---- explosions, sparks, smoke
      s.puffs = s.puffs.filter((p) => now < p.t0 + p.dur)
      for (const p of s.puffs) {
        if (now < p.t0) continue
        const t = (now - p.t0) / p.dur
        fxDraw(p.kind, p.x, p.y - t * 10, p.scale * (0.7 + t * 0.5), 1 - t * t)
      }
      ctx.restore()
      // ---- floating text and banner (not shaken)
      s.floats = s.floats.filter((f) => now < f.t0 + 1300)
      ctx.textAlign = 'center'
      for (const f of s.floats) {
        if (now < f.t0) continue
        const t = (now - f.t0) / 1300
        ctx.globalAlpha = 1 - t * t
        ctx.font = `${f.size}px "Press Start 2P", monospace`
        ctx.lineWidth = 5; ctx.strokeStyle = '#000'
        ctx.strokeText(f.text, f.x, f.y - t * 40); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - t * 40)
        ctx.globalAlpha = 1
      }
      if (s.flash && now < s.flash) { ctx.fillStyle = `rgba(255,255,255,${(s.flash - now) / 400})`; ctx.fillRect(0, 0, W, H) }
      const b = s.banner
      if (b && now >= b.t0 && now < b.until) {
        const t = Math.min(1, (now - b.t0) / 220)
        ctx.save(); ctx.translate(W / 2, H * 0.3); ctx.scale(0.6 + 0.4 * t, 0.6 + 0.4 * t)
        ctx.font = '30px "Press Start 2P", monospace'; ctx.lineWidth = 8; ctx.strokeStyle = '#000'
        ctx.strokeText(b.text, 0, 0); ctx.fillStyle = b.color; ctx.fillText(b.text, 0, 0)
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [r.boss])

  const boss = BOSSES[r.boss] ?? BOSSES[0]
  return <canvas ref={ref} className="kstage" aria-label={`Combate contra ${boss.name}`} role="img" />
}

/** Schedules the animation and sounds of one event. */
function play(s: Sim, r: RaidState, ev: RaidEvent, now: number) {
  const n = r.heroes
  const hx = heroX(n, ev.by)
  const gun: [number, number] = [hx + 6, HERO_Y - RM.rex.h * HERO_SCALE + 30]
  const bossC: [number, number] = [W / 2, BOSS_Y - 120]
  const heroC: [number, number] = [hx, HERO_Y - 130]
  if (ev.type === 'hit' || ev.type === 'crit') {
    const crit = ev.type === 'crit'
    s.heroes[ev.by] = { steps: [['shoot1', 110], ['shoot2', 110], ['shoot3', 220], ['aim', 250]], t0: now }
    const kind = ev.by === 0 ? 'bullet' : 'bullet2'
    const volley = crit ? 3 : 1
    for (let i = 0; i < volley; i++) s.shots.push({ kind, from: gun, to: [bossC[0] + (i - 1) * 26 * (volley > 1 ? 1 : 0), bossC[1] + i * 10], t0: now + 120 + i * 90, dur: 260, scale: 1.1 })
    const hit = now + 380 + (volley - 1) * 90
    s.puffs.push({ kind: crit ? 'boom2' : 'spark', x: bossC[0], y: bossC[1], t0: hit, dur: 520, scale: crit ? 1.5 : 1.2 })
    if (crit) s.puffs.push({ kind: 'boom1', x: bossC[0] - 40, y: bossC[1] + 30, t0: hit + 120, dur: 500, scale: 1.1 })
    s.boss = { steps: [['hurt', 420]], t0: hit }
    s.floats.push({ text: crit ? `-${ev.dmg} ¡CRÍTICO!` : `-${ev.dmg}`, x: bossC[0] + 70, y: bossC[1] - 40, t0: hit, color: crit ? '#ffd23d' : '#fff', size: crit ? 18 : 16 })
    s.shake = { until: hit + (crit ? 380 : 180), amp: crit ? 9 : 4 }
    if (crit) ksfx.crit(); else ksfx.shot()
    setTimeout(() => ksfx.strong(), hit - now)
    if (ev.enrage) {
      s.banner = { text: '¡FURIA!', color: '#ff4040', t0: now + 1100, until: now + 2600 }
      setTimeout(() => ksfx.enrage(), 1100)
    }
  } else {
    // the boss strikes the shooter
    s.heroes[ev.by] = { steps: [['aim', 520], ['stun', 750], ...(ev.down ? [['kneel', 380] as Step] : [])], t0: now }
    s.boss = { steps: [['attack1', 300], ['attack2', 520]], t0: now }
    const proj = r.boss === 1 ? 'orb2' : 'bullet'
    const count = r.boss === 1 ? 1 : 3
    for (let i = 0; i < count; i++) s.shots.push({ kind: proj, from: [bossC[0] + (r.boss === 0 ? 120 : 0), bossC[1] + 60], to: [heroC[0] + (i - 1) * 14, heroC[1]], t0: now + 260 + i * 80, dur: 300, scale: r.boss === 1 ? 1.3 : 1.1 })
    const hit = now + 560 + (count - 1) * 80
    s.puffs.push({ kind: 'boom1', x: heroC[0], y: heroC[1], t0: hit, dur: 520, scale: 1.2 })
    s.floats.push({ text: ev.type === 'timeout' ? '¡TIEMPO! -♥' : '-♥', x: hx, y: heroC[1] - 60, t0: hit, color: '#ff5a5a', size: 15 })
    s.shake = { until: hit + 260, amp: 7 }
    if (r.boss === 1) ksfx.laser(); else ksfx.bossShot()
    setTimeout(() => ksfx.hurt(), hit - now)
    if (ev.down) {
      s.banner = { text: 'K.O.', color: '#ff5a5a', t0: hit + 300, until: hit + 1600 }
      setTimeout(() => ksfx.fall(), hit - now + 300)
    }
  }
  if (ev.revive !== undefined) {
    const x = heroX(n, ev.revive)
    const t = now + 1300
    s.heroes[ev.revive] = { steps: [['down', t - now], ['kneel', 350], ['idle1', 200], ['win', 600]], t0: now }
    s.puffs.push({ kind: 'spark', x, y: HERO_Y - 110, t0: t, dur: 800, scale: 2.6 })
    s.floats.push({ text: '¡RESCATE!', x, y: HERO_Y - 220, t0: t, color: '#ffd23d', size: 16 })
    setTimeout(() => ksfx.revive(), t - now)
  }
  if (r.result === 'win') {
    const t = now + 900
    s.dead = t
    s.flash = t + 400
    for (let i = 0; i < 7; i++) s.puffs.push({ kind: i % 2 ? 'boom2' : 'boom1', x: W / 2 + (Math.random() - 0.5) * 220, y: BOSS_Y - 40 - Math.random() * 200, t0: t + i * 160, dur: 650, scale: 1.4 + Math.random() })
    s.shake = { until: t + 1400, amp: 12 }
    s.banner = { text: '¡JEFE DERROTADO!', color: '#ffd23d', t0: t + 1200, until: t + 9e9 }
    setTimeout(() => { ksfx.explode(); setTimeout(() => ksfx.win(), 1200) }, t - now)
  } else if (r.result === 'wipe') {
    s.banner = { text: 'GAME OVER', color: '#ff5a5a', t0: now + 1600, until: now + 9e9 }
    setTimeout(() => ksfx.lose(), 1600)
  } else if (r.result === 'escape') {
    s.escaped = now + 1200
    s.banner = { text: 'EL JEFE HUYE', color: '#ffb03a', t0: now + 1400, until: now + 9e9 }
    setTimeout(() => ksfx.lose(), 1400)
  }
  for (const t of s.heroes) if (t && trackEnd(t) < now) s.heroes[s.heroes.indexOf(t)] = null
}

// ---------- procedural pixel backdrop per boss (until real stage art arrives)
const PALETTES = [
  { sky: ['#2a1640', '#a8433a', '#f2a650'], hills: ['#5a2a3a', '#3a1c2c', '#24121e'], ground: ['#6b4a2e', '#4e3420'], sun: '#ffd27a' }, // frontier sunset
  { sky: ['#07041a', '#2a0f45', '#5c1a6e'], hills: ['#3a1450', '#250c38', '#160624'], ground: ['#2a1838', '#1c0f26'], sun: '#f0c8ff' }, // alien night
  { sky: ['#0d1a3a', '#3a4f8a', '#f08a4a'], hills: ['#3a2a40', '#2a1e30', '#1a1220'], ground: ['#7a5232', '#5a3a22'], sun: '#ffe2a0' }, // desert dusk
]
const backdrops = new Map<number, HTMLCanvasElement>()
function backdrop(boss: number): HTMLCanvasElement {
  const hit = backdrops.get(boss)
  if (hit) return hit
  const P = PALETTES[boss] ?? PALETTES[0]
  const w = W / 4, h = H / 4 // drawn small, scaled up without smoothing: chunky pixels
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')!
  let seed = 1234 + boss * 77
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  // sky bands (dithered steps, not a smooth gradient)
  for (let y = 0; y < h; y++) {
    const t = Math.min(0.999, y / (h * 0.7)) * P.sky.length
    const i = Math.floor(t)
    // checkerboard dither on the rows where two bands meet
    for (let px = 0; px < w; px++) {
      const j = t - i > 0.8 && (px + y) % 2 ? Math.min(P.sky.length - 1, i + 1) : i
      g.fillStyle = P.sky[j]; g.fillRect(px, y, 1, 1)
    }
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.4 + rnd() * 0.6) + ')'; g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h * 0.45), 1, 1) }
  g.fillStyle = P.sun; g.beginPath(); g.arc(w * (boss === 1 ? 0.78 : 0.2), h * 0.28, boss === 1 ? 9 : 12, 0, Math.PI * 2); g.fill()
  // three ridges of hills / mesas
  P.hills.forEach((col, li) => {
    g.fillStyle = col
    const base = h * (0.5 + li * 0.1)
    let y = base - rnd() * 10
    for (let px = 0; px < w; px += 2) {
      if (boss === 2 && rnd() < 0.04) y = base - 6 - rnd() * 16 // flat-topped mesas
      else y += (rnd() - 0.5) * (boss === 1 ? 4 : 2.4)
      y = Math.max(base - 22, Math.min(base + 4, y))
      g.fillRect(px, Math.floor(y), 2, h - Math.floor(y))
    }
  })
  // ground strip with planks / cracks
  const gy = Math.floor(h * 0.78)
  g.fillStyle = P.ground[0]; g.fillRect(0, gy, w, h - gy)
  g.fillStyle = P.ground[1]
  for (let y = gy + 3; y < h; y += 5) g.fillRect(0, y, w, 1)
  for (let i = 0; i < 30; i++) g.fillRect(Math.floor(rnd() * w), gy + Math.floor(rnd() * (h - gy)), 3, 1)
  const out = document.createElement('canvas'); out.width = W; out.height = H
  const o = out.getContext('2d')!
  o.imageSmoothingEnabled = false
  o.drawImage(c, 0, 0, W, H)
  backdrops.set(boss, out)
  return out
}
