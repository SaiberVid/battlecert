// CERT KUMITE: a tug-of-war fight on a floating platform. No health bars — every right answer
// pushes the rival towards the edge; whoever is pushed off loses.
//   both right  → CLASH: fists collide, nobody moves (combos keep growing)
//   one right   → HIT: the rival is pushed back 1 + 0.5 per combo step (max 3)
//   both wrong  → both stumble, combos reset
//   at the edge → the defender grabs on: pushes against them are halved, so comebacks happen
// Pure functions: the host runs them, guests only render the result.

export type KumiteLength = 'short' | 'normal' | 'epic'
export const KUMITE_LENGTHS: Record<KumiteLength, { name: string; edge: number }> = {
  short: { name: 'Corto', edge: 4 },
  normal: { name: 'Normal', edge: 7 },
  epic: { name: 'Épico', edge: 11 },
}
export const GUARD_ZONE = 1.5 // distance from the edge where the defender holds on
export const MAX_COMBO_BONUS = 4 // combo steps that add push (1 + 0.5 × 4 = 3)

export type KumiteEventType = 'clash' | 'hit' | 'stumble' | 'start'
export type Attack = 'quick' | 'strong' | 'special'

export interface KumiteEvent {
  n: number // event counter, so screens know when to animate
  type: KumiteEventType
  by?: 0 | 1 // attacker (index in fighters)
  attack?: Attack
  push: number
  guard?: boolean // defender was holding on at the edge
  faster?: 0 | 1 // in a clash, who answered first (only cosmetic)
  ko?: 0 | 1 // the fighter who fell off
}

export interface KumiteState {
  edge: number
  c: number // position of the clash point: < 0 towards fighter 0's edge, > 0 towards fighter 1's edge
  combo: [number, number]
  best: [number, number]
  winner: 0 | 1 | null
  last: KumiteEvent
}

export function newKumite(length: KumiteLength = 'normal'): KumiteState {
  return { edge: KUMITE_LENGTHS[length]?.edge ?? 10, c: 0, combo: [0, 0], best: [0, 0], winner: null, last: { n: 0, type: 'start', push: 0 } }
}

export function pushFor(combo: number, defenderAtEdge: boolean): number {
  const base = 1 + 0.5 * Math.min(combo, MAX_COMBO_BONUS)
  return defenderAtEdge ? base / 2 : base
}

const attackFor = (combo: number): Attack => (combo >= 3 ? 'special' : combo >= 1 ? 'strong' : 'quick')

/** Distance from the defender to their edge. Fighter 0 loses at c ≤ -edge, fighter 1 at c ≥ edge. */
const roomLeft = (k: KumiteState, defender: 0 | 1) => (defender === 1 ? k.edge - k.c : k.edge + k.c)

/**
 * Resolves one question. `ok[i]` is whether fighter i answered right (a timeout is wrong);
 * `ms[i]` the response time (only used to show who was faster in a clash).
 */
export function resolve(k: KumiteState, ok: [boolean, boolean], ms: [number | null, number | null] = [null, null]): KumiteState {
  if (k.winner !== null) return k
  const n = k.last.n + 1
  const next: KumiteState = { ...k, combo: [...k.combo] as [number, number], best: [...k.best] as [number, number] }
  if (ok[0] && ok[1]) {
    next.combo = [k.combo[0] + 1, k.combo[1] + 1]
    const faster = ms[0] != null && ms[1] != null ? (ms[0] <= ms[1] ? 0 : 1) : undefined
    next.last = { n, type: 'clash', push: 0, faster }
  } else if (ok[0] || ok[1]) {
    const by: 0 | 1 = ok[0] ? 0 : 1
    const def: 0 | 1 = by === 0 ? 1 : 0
    const guard = roomLeft(k, def) <= GUARD_ZONE
    const push = pushFor(k.combo[by], guard)
    next.c = by === 0 ? k.c + push : k.c - push
    next.combo[by] = k.combo[by] + 1
    next.combo[def] = 0
    const out = by === 0 ? next.c >= k.edge : next.c <= -k.edge
    if (out) { next.winner = by; next.c = by === 0 ? k.edge : -k.edge }
    next.last = { n, type: 'hit', by, attack: attackFor(k.combo[by]), push, guard, ...(out ? { ko: def } : {}) }
  } else {
    next.combo = [0, 0]
    next.last = { n, type: 'stumble', push: 0 }
  }
  next.best = [Math.max(k.best[0], next.combo[0]), Math.max(k.best[1], next.combo[1])]
  return next
}

/** When the questions run out: whoever gained ground wins; dead centre is a draw. */
export function decide(k: KumiteState): 0 | 1 | null {
  if (k.winner !== null) return k.winner
  return k.c > 0 ? 0 : k.c < 0 ? 1 : null
}

// ---------------------------------------------------------------- CPU opponents

export interface Cpu { accuracy: number; minMs: number; maxMs: number }

/** Tournament ladder: each rival is a bit sharper and quicker than the last. */
export function cpuFor(stage: number, total: number, secs: number): Cpu {
  const t = total > 1 ? stage / (total - 1) : 0
  const limit = secs * 1000
  return {
    accuracy: 0.55 + 0.35 * t, // 55 % → 90 %
    minMs: Math.round(limit * (0.35 - 0.2 * t)),
    maxMs: Math.round(limit * (0.85 - 0.35 * t)),
  }
}

/** One CPU decision: right or wrong, and after how long. `rand` in [0, 1). */
export function cpuAnswer(cpu: Cpu, rand: () => number): { ok: boolean; ms: number } {
  return { ok: rand() < cpu.accuracy, ms: Math.round(cpu.minMs + (cpu.maxMs - cpu.minMs) * rand()) }
}
