// CERT RAID: co-op boss fight. Heroes take turns as the shooter: a right answer shoots the boss, a
// wrong answer (or running out of time) means the boss hits the shooter, who loses a heart.
// The partner secretly bets on what they would have answered; a knocked-out hero keeps betting and
// is rescued after RESCUE right bets. At half health the boss enrages (less time per question).
// Pure functions: the host runs them, guests only render the result.

export type RaidLength = 'short' | 'normal' | 'epic'
export const RAID_LENGTHS: Record<RaidLength, { name: string; hp: number }> = {
  short: { name: 'Corto', hp: 8 },
  normal: { name: 'Normal', hp: 14 },
  epic: { name: 'Épico', hp: 22 },
}
export const BOSSES = [
  { id: 'gatling', name: 'GATLING-9', hp: 1, color: '#f2b03a' },
  { id: 'voraxia', name: 'VORAXIA', hp: 1.25, color: '#e03ad0' },
  { id: 'skyreaper', name: 'SKYREAPER', hp: 1.5, color: '#ff5a3a' },
] as const
export const HERO_NAMES = ['Rex', 'Nova'] as const
export const HEARTS = 3
export const SOLO_HEARTS = 5
export const RESCUE = 3
export const ENRAGED_TIME = 0.8 // share of the normal time per question once the boss is enraged

export type RaidEventType = 'start' | 'hit' | 'crit' | 'miss' | 'timeout'
export interface RaidEvent {
  n: number
  type: RaidEventType
  by: 0 | 1 // shooter
  dmg: number
  down?: boolean // the shooter was knocked out
  revive?: 0 | 1 // this hero got back up
  bet?: boolean // the partner's bet was right (undefined = no bet)
  enrage?: boolean
}

export interface RaidState {
  boss: number
  hp: number
  max: number
  enraged: boolean
  heroes: 1 | 2
  hearts: number[]
  rescue: number[]
  turn: 0 | 1
  hits: number[]
  result: 'win' | 'wipe' | 'escape' | null
  last: RaidEvent
}

export function bossHp(length: RaidLength, boss: number): number {
  return Math.round((RAID_LENGTHS[length]?.hp ?? 14) * (BOSSES[boss]?.hp ?? 1))
}

export function newRaid(length: RaidLength = 'normal', boss = 0, heroes: number): RaidState {
  const b = Math.max(0, Math.min(BOSSES.length - 1, Math.floor(boss)))
  const n: 1 | 2 = heroes >= 2 ? 2 : 1
  const max = bossHp(length, b)
  return {
    boss: b, hp: max, max, enraged: false, heroes: n,
    hearts: Array(n).fill(n === 1 ? SOLO_HEARTS : HEARTS), rescue: Array(n).fill(0), turn: 0, hits: Array(n).fill(0),
    result: null, last: { n: 0, type: 'start', by: 0, dmg: 0 },
  }
}

/**
 * Resolves one question. `shot`: the shooter's answer (null = no answer in time); `fast`: answered in
 * the first third of the time (critical hit); `bet`: whether the partner's secret bet was right
 * (null = no partner or no bet).
 */
export function resolveRaid(s: RaidState, shot: boolean | null, fast: boolean, bet: boolean | null): RaidState {
  if (s.result) return s
  const by = s.turn
  const r: RaidState = { ...s, hearts: [...s.hearts], rescue: [...s.rescue], hits: [...s.hits] }
  const ev: RaidEvent = { n: s.last.n + 1, type: 'hit', by, dmg: 0 }
  if (shot) {
    ev.type = fast ? 'crit' : 'hit'
    ev.dmg = fast ? 2 : 1
    r.hp = Math.max(0, s.hp - ev.dmg)
    r.hits[by] += 1
    if (!s.enraged && r.hp > 0 && r.hp <= s.max / 2) { r.enraged = true; ev.enrage = true }
  } else {
    ev.type = shot === null ? 'timeout' : 'miss'
    r.hearts[by] = Math.max(0, r.hearts[by] - 1)
    if (r.hearts[by] === 0) ev.down = true
  }
  if (s.heroes === 2 && bet !== null) {
    ev.bet = bet
    const p: 0 | 1 = by === 0 ? 1 : 0
    if (bet && s.hearts[p] === 0) {
      r.rescue[p] += 1
      if (r.rescue[p] >= RESCUE) { r.rescue[p] = 0; r.hearts[p] = 1; ev.revive = p }
    }
  }
  if (r.hp === 0) r.result = 'win'
  else if (r.hearts.every((h) => h === 0)) r.result = 'wipe'
  if (s.heroes === 2) {
    const other: 0 | 1 = by === 0 ? 1 : 0
    r.turn = r.hearts[other] > 0 ? other : by
  }
  r.last = ev
  return r
}

/** The questions ran out before anyone won. */
export const escapeRaid = (s: RaidState): RaidState => (s.result ? s : { ...s, result: 'escape' })
