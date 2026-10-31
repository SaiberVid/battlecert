import { describe, expect, it } from 'vitest'
import { HEARTS, RESCUE, SOLO_HEARTS, bossHp, escapeRaid, newRaid, resolveRaid } from './raid'

describe('raid', () => {
  it('scales boss health with length and campaign stage', () => {
    expect(newRaid('normal', 0, 2).max).toBe(14)
    expect(bossHp('normal', 2)).toBe(21)
    expect(newRaid('short', 0, 1).hearts).toEqual([SOLO_HEARTS])
    expect(newRaid('short', 0, 2).hearts).toEqual([HEARTS, HEARTS])
  })
  it('right answers shoot, fast ones crit, and turns alternate', () => {
    let r = newRaid('normal', 0, 2)
    r = resolveRaid(r, true, false, null)
    expect(r).toMatchObject({ hp: 13, turn: 1, last: { type: 'hit', by: 0, dmg: 1 } })
    r = resolveRaid(r, true, true, true)
    expect(r).toMatchObject({ hp: 11, turn: 0, last: { type: 'crit', by: 1, dmg: 2, bet: true } })
  })
  it('wrong answers cost the shooter a heart; a knocked-out hero is rescued by right bets', () => {
    let r = newRaid('epic', 0, 2)
    for (let i = 0; i < HEARTS; i++) { r = { ...r, turn: 0 }; r = resolveRaid(r, false, false, null) }
    expect(r.hearts[0]).toBe(0)
    expect(r.last.down).toBe(true)
    expect(r.turn).toBe(1) // only the standing hero shoots now
    for (let i = 0; i < RESCUE; i++) { expect(r.turn).toBe(1); r = resolveRaid(r, true, false, true) }
    expect(r.hearts[0]).toBe(1)
    expect(r.last.revive).toBe(0)
    expect(r.turn).toBe(0)
  })
  it('enrages at half health, wins at zero, wipes when everyone is down', () => {
    let r = newRaid('short', 0, 1)
    for (let i = 0; i < 4; i++) r = resolveRaid(r, true, false, null)
    expect(r.enraged).toBe(true)
    while (!r.result) r = resolveRaid(r, true, true, null)
    expect(r.result).toBe('win')
    let w = newRaid('short', 0, 1)
    for (let i = 0; i < SOLO_HEARTS; i++) w = resolveRaid(w, null, false, null)
    expect(w).toMatchObject({ result: 'wipe', last: { type: 'timeout' } })
    expect(escapeRaid(newRaid('short', 0, 1)).result).toBe('escape')
  })
})
