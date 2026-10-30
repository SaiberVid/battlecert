// Game engine: a pure state machine run by the host. Guests only render the PublicState the
// host broadcasts, so they never hold the pack or the answers before a reveal.
import type { Answer, DiffMode, MatchSettings, Mode, Pack, Phase, Player, PublicState, Question, Score } from './types'
import { dict } from './sanitize'
import { decide, newKumite, resolve, type KumiteState } from './kumite'

export const STEAL_MS = 10_000
export const REVEAL_MS = 8_000
export const COUNTDOWN_MS = 3_000
export const LIVES = 3

export const MODES: Record<Mode, { name: string; desc: string; defaultSecs: number }> = {
  classic: { name: 'Clásico', desc: 'Todos a la vez. Acierto + rapidez + racha.', defaultSecs: 30 },
  turns: { name: 'Turnos + robo', desc: 'Una pregunta por jugador; si falla, el siguiente roba.', defaultSecs: 30 },
  blitz: { name: 'Relámpago', desc: 'Pocos segundos; la rapidez vale el doble.', defaultSecs: 8 },
  survival: { name: 'Supervivencia', desc: '3 vidas. Fallar o no responder quita una. Gana quien quede.', defaultSecs: 20 },
  wager: { name: 'Apuesta', desc: 'Apuesta 1, 2 o 3 a tu respuesta: ganas o pierdes 100 × apuesta.', defaultSecs: 30 },
  kumite: { name: 'CERT KUMITE', desc: '1 contra 1 en una plataforma: cada acierto empuja al rival. Échalo y ganas.', defaultSecs: 20 },
}

export interface HostPlayer extends Player { label: string; token: string | null }

export interface Match {
  code: string
  s: MatchSettings
  players: HostPlayer[]
  qids: string[]
  order: Record<string, number[]>
  i: number
  phase: Phase
  active: string | null
  ans: Record<string, Answer>
  sc: Record<string, Score>
  round: number
  series: Record<string, number>
  deadline: number
  qStart: number
  /** Scores when the current question (or steal) opened: shown until the reveal, so nothing leaks. */
  before: Record<string, Score>
  /** CERT KUMITE: the fight and its two fighters (other players watch) */
  k?: KumiteState
  kf?: [string, string]
}

export const KUMITE_REVEAL_MS = 6_000

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
export const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every((x) => a.includes(x))
const blank = (): Score => ({ pts: 0, ok: 0, n: 0, ms: 0, streak: 0, best: 0, stl: 0, lives: LIVES, out: false, dom: dict() })
const qOf = (pack: Pack, id: string) => pack.questions.find((q) => q.id === id) as Question

const level = (q: Question) => q.difficulty ?? 2
const DIFF_ONLY: Partial<Record<DiffMode, number>> = { easy: 1, medium: 2, hard: 3 }

/**
 * n question ids, round-robin across domains, avoiding ids already used in this series.
 * diff: 'mix' (shuffled), 'ladder' (easy → hard) or only one level (falls back to all if too few).
 */
export function pick(pack: Pack, n: number, seed: number, domains: string[] = [], exclude: string[] = [], diff: DiffMode = 'mix'): string[] {
  const rand = rng(seed)
  const used = new Set(exclude)
  const doms = domains.length ? new Set(domains) : null
  const only = DIFF_ONLY[diff]
  const base = pack.questions.filter((q) => !doms || doms.has(q.domain))
  const leveled = only ? base.filter((q) => level(q) === only) : base
  const src = leveled.length >= Math.min(n, 3) ? leveled : base
  let pool = src.filter((q) => !used.has(q.id))
  if (pool.length < n) pool = src
  const by = new Map<string, Question[]>()
  for (const q of shuffle(pool, rand)) { const l = by.get(q.domain) || []; l.push(q); by.set(q.domain, l) }
  const keys = shuffle([...by.keys()], rand)
  const out: Question[] = []
  // Like the real exam: when the pack has the official outline, each domain gets its share.
  const bp = !doms && pack.blueprint?.length ? pack.blueprint.filter((b) => by.has(b.domain)) : []
  if (bp.length) {
    const W = bp.reduce((a, b) => a + b.weight, 0) || 1
    for (const b of bp) { const want = Math.round((n * b.weight) / W); const l = by.get(b.domain)!; while (out.length < n && want > out.filter((q) => q.domain === b.domain).length && l.length) out.push(l.shift()!) }
  }
  while (out.length < n && keys.some((k) => by.get(k)!.length)) for (const k of keys) if (out.length < n && by.get(k)!.length) out.push(by.get(k)!.shift()!)
  if (bp.length && diff !== 'ladder') return shuffle(out, rand).map((q) => q.id)
  if (diff === 'ladder') out.sort((a, b) => level(a) - level(b))
  return out.map((q) => q.id)
}

/** Points for one answer. */
export function points(mode: Mode, ok: boolean, ms: number, limitMs: number, steal: boolean, streak: number, bet = 1): number {
  if (steal) return ok ? 50 : 0
  const left = Math.max(0, Math.min(1, 1 - ms / limitMs))
  if (mode === 'wager') return ok ? 100 * bet + Math.round(25 * left) : -100 * bet
  if (!ok) return 0
  const speed = mode === 'blitz' ? 100 : 50
  const bonus = Math.min(30, Math.max(0, (streak - 1) * 10))
  return 100 + Math.round(speed * left) + bonus
}

export function newMatch(code: string, s: MatchSettings, prev?: Match): Match {
  return { code, s: { ...s }, players: [], qids: [], order: {}, i: -1, phase: 'lobby', active: null, ans: dict(), sc: dict(), round: prev?.round ?? 0, series: prev?.series ?? dict(), deadline: 0, qStart: 0, before: dict() }
}

/** Adds a player or gives a returning player (same alias + same device token) their seat back. */
export function addPlayer(m: Match, nick: string, avatar: string, label: string, token: string | null, fighter?: string): HostPlayer | null {
  const ex = m.players.find((p) => p.nick.toLowerCase() === nick.toLowerCase())
  if (ex) {
    if (ex.online && ex.label !== label && !(token && ex.token === token)) return null
    ex.label = label; ex.online = true; ex.avatar = avatar || ex.avatar
    if (fighter) ex.fighter = fighter
    if (token) ex.token = token
    return ex
  }
  if (m.players.length >= 8) return null
  const p: HostPlayer = { pid: 'p' + (m.players.length + 1) + Math.random().toString(36).slice(2, 6), nick, avatar, label, online: true, token, ...(fighter ? { fighter } : {}), ...(label === 'cpu' ? { cpu: true } : {}) }
  m.players.push(p)
  if (m.phase !== 'lobby') m.sc[p.pid] = { ...blank(), out: m.s.mode === 'survival' }
  return p
}

function snapshot(m: Match) {
  m.before = dict()
  for (const [pid, sc] of Object.entries(m.sc)) m.before[pid] = { ...sc, dom: dict() }
}

const alive = (m: Match) => m.players.filter((p) => p.online && !m.sc[p.pid]?.out)

export function start(m: Match, pack: Pack, seed: number, now: number, exclude: string[] = []): Match {
  const max = m.s.mode === 'survival' ? Math.max(m.s.n, 50) : m.s.mode === 'kumite' ? Math.max(m.s.n, 80) : m.s.n
  m.qids = pick(pack, max, seed, m.s.domains, exclude, m.s.diff ?? 'mix')
  const rand = rng(seed ^ 0x9e3779b9)
  m.order = dict()
  for (const id of m.qids) m.order[id] = shuffle(qOf(pack, id).options.map((_, k) => k), rand)
  m.sc = dict()
  for (const p of m.players) m.sc[p.pid] = blank()
  if (m.s.mode === 'kumite') {
    const fighters = m.players.filter((p) => p.online).slice(0, 2)
    m.k = newKumite(m.s.kLen ?? 'normal')
    m.kf = fighters.length === 2 ? [fighters[0].pid, fighters[1].pid] : undefined
  } else { m.k = undefined; m.kf = undefined }
  m.round += 1
  m.i = -1
  m.phase = 'countdown'
  m.deadline = now + COUNTDOWN_MS
  return m
}

function nextQuestion(m: Match, now: number): void {
  m.i += 1
  m.ans = dict()
  const left = alive(m)
  const survivalOver = m.s.mode === 'survival' && (left.length === 0 || (m.players.length > 1 && left.length <= 1))
  const kumiteOver = m.s.mode === 'kumite' && (!m.kf || m.k?.winner != null)
  if (m.i >= m.qids.length || survivalOver || kumiteOver) {
    if (m.k && m.k.winner == null) m.k = { ...m.k, winner: decide(m.k) }
    m.phase = 'end'; m.deadline = 0; m.active = null; return
  }
  m.phase = 'q'
  snapshot(m)
  m.qStart = now
  m.deadline = now + m.s.secs * 1000
  m.active = m.s.mode === 'turns' && left.length ? left[m.i % left.length].pid : null
}

export function eligible(m: Match): string[] {
  if (m.phase === 'q' && m.s.mode === 'kumite') return (m.kf ?? []).filter((pid) => m.players.some((p) => p.pid === pid && p.online))
  if (m.phase === 'q') return m.s.mode === 'turns' && m.active ? [m.active] : alive(m).map((p) => p.pid)
  if (m.phase === 'steal' && m.active) return [m.active]
  return []
}

function record(s: Score, domain: string, ok: boolean, ms: number) {
  s.n += 1; s.ms += ms
  const d = s.dom[domain] || (s.dom[domain] = [0, 0])
  d[1] += 1
  if (ok) { s.ok += 1; d[0] += 1; s.streak += 1; s.best = Math.max(s.best, s.streak) } else s.streak = 0
}

/** Applies an answer; `ms` must already be the host-trusted response time. */
export function answer(m: Match, pack: Pack, pid: string, choice: number[], ms: number, now: number, bet = 1): boolean {
  if (!eligible(m).includes(pid)) return false
  const steal = m.phase === 'steal'
  if (m.ans[pid] && m.ans[pid].st === steal) return false
  if (now > m.deadline + 1500) return false
  const q = qOf(pack, m.qids[m.i])
  const limit = steal ? STEAL_MS : m.s.secs * 1000
  const msC = Math.max(0, Math.min(limit, ms))
  const c = [...new Set(choice)].filter((k) => Number.isInteger(k) && k >= 0 && k < q.options.length)
  const ok = sameSet(c, q.answer)
  const s = m.sc[pid] || (m.sc[pid] = blank())
  const b = m.s.mode === 'wager' ? Math.min(3, Math.max(1, Math.round(bet))) : 1
  if (!steal) record(s, q.domain, ok, msC)
  else if (ok) s.stl += 1
  const pts = points(m.s.mode, ok, msC, limit, steal, s.streak, b)
  s.pts += pts
  if (m.s.mode === 'survival' && !ok && !steal) { s.lives -= 1; if (s.lives <= 0) s.out = true }
  m.ans[pid] = { c, ms: msC, ok, pts, st: steal, bet: m.s.mode === 'wager' ? b : undefined }
  return true
}

/** Time-driven transitions. Returns true when the state changed. */
export function tick(m: Match, pack: Pack, now: number): boolean {
  if (m.phase === 'countdown') { if (now >= m.deadline) { nextQuestion(m, now); return true } return false }
  if (m.phase === 'reveal') { if (now >= m.deadline) { nextQuestion(m, now); return true } return false }
  if (m.phase !== 'q' && m.phase !== 'steal') return false
  const need = eligible(m)
  const steal = m.phase === 'steal'
  const done = need.every((p) => m.ans[p] && m.ans[p].st === steal)
  if (!done && now < m.deadline) return false
  const q = qOf(pack, m.qids[m.i])
  if (!steal) for (const pid of need) if (!m.ans[pid]) {
    const s = m.sc[pid] || (m.sc[pid] = blank())
    record(s, q.domain, false, m.s.secs * 1000)
    if (m.s.mode === 'wager') s.pts -= 100
    if (m.s.mode === 'survival') { s.lives -= 1; if (s.lives <= 0) s.out = true }
  }
  const seated = alive(m)
  if (m.s.mode === 'turns' && !steal && seated.length > 1 && m.active) {
    const a = m.ans[m.active]
    if (!a || !a.ok) {
      const idx = seated.findIndex((p) => p.pid === m.active)
      m.active = seated[(idx + 1) % seated.length].pid
      m.phase = 'steal'
      snapshot(m)
      m.deadline = now + STEAL_MS
      return true
    }
  }
  if (m.s.mode === 'kumite' && m.k && m.kf) {
    const a0 = m.ans[m.kf[0]], a1 = m.ans[m.kf[1]]
    m.k = resolve(m.k, [!!a0?.ok, !!a1?.ok], [a0 ? a0.ms : null, a1 ? a1.ms : null])
  }
  m.phase = 'reveal'
  m.deadline = now + (m.s.mode === 'kumite' ? KUMITE_REVEAL_MS : REVEAL_MS)
  return true
}

export function skipReveal(m: Match) { if (m.phase === 'reveal') m.deadline = 0 }

export function standings(m: Match | PublicState) {
  const k = 'k' in m ? (m.k && m.kf ? { ...m.k, fighters: m.kf } : undefined) : (m as PublicState).kumite
  if (k && k.winner != null) {
    const w = k.fighters[k.winner]
    return m.players.map((p) => ({ ...p, ...(m.sc[p.pid] || blank()) })).sort((a, b) => Number(b.pid === w) - Number(a.pid === w) || b.pts - a.pts)
  }
  return m.players
    .map((p) => ({ ...p, ...(m.sc[p.pid] || blank()) }))
    .sort((a, b) => ('s' in m ? m.s : m.settings).mode === 'survival'
      ? Number(a.out) - Number(b.out) || b.lives - a.lives || b.pts - a.pts
      : b.pts - a.pts || b.ok - a.ok || a.ms - b.ms)
}

/** Records the winner in the series (rematches). */
export function finish(m: Match) {
  const st = standings(m)
  if (st.length > 1) {
    const tie = m.s.mode === 'kumite' ? m.k?.winner == null : m.s.mode === 'survival' ? !st[0].out === !st[1].out && st[0].lives === st[1].lives && st[0].pts === st[1].pts : st[0].pts === st[1].pts
    if (!tie) { const k = st[0].nick.toLowerCase(); m.series[k] = (m.series[k] || 0) + 1 }
  }
}

/** Everything screens need, without leaking the answer before the reveal. */
export function publicState(m: Match, pack: Pack, now: number): PublicState {
  const reveal = m.phase === 'reveal' || m.phase === 'end'
  const playing = m.phase === 'q' || m.phase === 'steal'
  const ans: PublicState['ans'] = dict()
  for (const [pid, a] of Object.entries(m.ans)) ans[pid] = reveal ? a : { done: 1, st: a.st }
  const sc: PublicState['sc'] = dict()
  for (const [pid, s] of Object.entries(m.sc)) {
    // while a question is open, show scores (points, streak, lives…) as they were when it opened
    sc[pid] = playing && m.before[pid] ? { ...m.before[pid], dom: dict() } : { ...s, dom: m.phase === 'end' ? s.dom : dict() }
  }
  const out: PublicState = {
    code: m.code, settings: m.s, i: m.i, total: m.qids.length, phase: m.phase, active: m.active,
    players: m.players.map((p) => ({ pid: p.pid, nick: p.nick, avatar: p.avatar, online: p.online, ...(p.fighter ? { fighter: p.fighter } : {}), ...(p.cpu ? { cpu: true } : {}) })),
    ans, sc, round: m.round, series: m.series, rem: m.deadline ? Math.max(0, m.deadline - now) : 0,
  }
  if (m.k && m.kf) out.kumite = { ...m.k, fighters: m.kf }
  if (m.i >= 0 && m.i < m.qids.length && m.phase !== 'end') {
    const q = qOf(pack, m.qids[m.i])
    out.q = { id: q.id, domain: q.domain, stem: q.stem, context: q.context, options: (m.order[q.id] || q.options.map((_, k) => k)).map((k) => ({ k, t: q.options[k] })), need: q.answer.length, difficulty: q.difficulty }
    if (reveal) { out.q.answer = q.answer; out.q.explanation = q.explanation }
  }
  if (m.phase === 'end') out.review = m.qids.slice(0, Math.max(0, m.i)).map((id) => { const x = qOf(pack, id); return { id, domain: x.domain, stem: x.stem, correct: x.answer.map((k) => x.options[k]) } })
  return out
}
