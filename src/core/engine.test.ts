import { describe, expect, it } from 'vitest'
import * as E from './engine'
import type { MatchSettings, Mode, Pack } from './types'

const pack: Pack = {
  format: 'battlecert/1', id: 't', name: 'Test', lang: 'es', source: 'test', license: 'MIT',
  questions: Array.from({ length: 12 }, (_, i) => ({
    id: 'q' + i, domain: 'D' + (i % 3), stem: 'Q' + i, options: ['a', 'b', 'c', 'd'], answer: i === 11 ? [0, 2] : [i % 4], explanation: 'x',
  })),
}
const settings = (mode: Mode, n = 4, secs = 10): MatchSettings => ({ mode, n, secs, domains: [], packId: 't', packName: 'Test' })
const right = (m: E.Match) => pack.questions.find((q) => q.id === m.qids[m.i])!.answer
const wrong = (m: E.Match) => [(right(m)[0] + 1) % 4]

function setup(mode: Mode, players = 2, n = 4) {
  const m = E.newMatch('abcdef', settings(mode, n))
  const ps = Array.from({ length: players }, (_, i) => E.addPlayer(m, 'P' + i, '🦊', 'l' + i, 'tok' + i + 'xxxxxx')!)
  let t = 1_000
  E.start(m, pack, 42, t)
  t += E.COUNTDOWN_MS
  E.tick(m, pack, t)
  return { m, ps, t }
}

describe('pick', () => {
  it('returns n distinct ids spread over domains', () => {
    const ids = E.pick(pack, 6, 1)
    expect(new Set(ids).size).toBe(6)
    const doms = ids.map((id) => pack.questions.find((q) => q.id === id)!.domain)
    expect(new Set(doms.slice(0, 3)).size).toBe(3)
  })
  it('filters domains and avoids excluded ids when possible', () => {
    const ids = E.pick(pack, 3, 2, ['D1'], ['q1'])
    expect(ids).not.toContain('q1')
    expect(ids.every((id) => pack.questions.find((q) => q.id === id)!.domain === 'D1')).toBe(true)
  })
  it('is deterministic for a seed', () => { expect(E.pick(pack, 5, 9)).toEqual(E.pick(pack, 5, 9)) })
})

describe('points', () => {
  it('classic: base + speed + streak', () => {
    expect(E.points('classic', true, 0, 10_000, false, 1)).toBe(150)
    expect(E.points('classic', true, 10_000, 10_000, false, 1)).toBe(100)
    expect(E.points('classic', true, 5_000, 10_000, false, 4)).toBe(100 + 25 + 30)
    expect(E.points('classic', false, 0, 10_000, false, 0)).toBe(0)
  })
  it('blitz doubles the speed bonus', () => { expect(E.points('blitz', true, 0, 8_000, false, 1)).toBe(200) })
  it('wager wins or loses 100 × bet', () => {
    expect(E.points('wager', true, 10_000, 10_000, false, 1, 3)).toBe(300)
    expect(E.points('wager', false, 0, 10_000, false, 0, 2)).toBe(-200)
  })
  it('steal is worth 50', () => { expect(E.points('turns', true, 0, 10_000, true, 1)).toBe(50) })
})

describe('match flow', () => {
  it('countdown → question → reveal → next → end', () => {
    const { m, ps } = setup('classic', 2, 2)
    let t = 10_000
    expect(m.phase).toBe('q')
    expect(E.answer(m, pack, ps[0].pid, right(m), 1000, t)).toBe(true)
    expect(E.tick(m, pack, t)).toBe(false) // P1 still thinking
    expect(E.answer(m, pack, ps[1].pid, wrong(m), 2000, t)).toBe(true)
    E.tick(m, pack, t)
    expect(m.phase).toBe('reveal')
    t += E.REVEAL_MS
    E.tick(m, pack, t)
    expect(m.phase).toBe('q')
    expect(m.i).toBe(1)
    t += 10_000
    E.tick(m, pack, t) // timeout
    expect(m.phase).toBe('reveal')
    expect(m.sc[ps[0].pid].n).toBe(2)
    E.skipReveal(m)
    E.tick(m, pack, t)
    expect(m.phase).toBe('end')
  })

  it('rejects double answers, wrong players and late answers', () => {
    const { m, ps, t } = setup('classic')
    expect(E.answer(m, pack, 'nobody', [0], 1, t)).toBe(false)
    expect(E.answer(m, pack, ps[0].pid, [0], 1, t)).toBe(true)
    expect(E.answer(m, pack, ps[0].pid, [1], 1, t)).toBe(false)
    expect(E.answer(m, pack, ps[1].pid, [1], 1, m.deadline + 5000)).toBe(false)
  })

  it('clamps reported time and ignores invalid option indexes', () => {
    const { m, ps, t } = setup('classic')
    E.answer(m, pack, ps[0].pid, [...right(m), 99, -1], -500, t)
    expect(m.ans[ps[0].pid].ok).toBe(true)
    expect(m.ans[ps[0].pid].ms).toBe(0)
  })

  it('multiple response needs the exact set', () => {
    const m = E.newMatch('abcdef', settings('classic', 1))
    const p = E.addPlayer(m, 'Solo', '🦊', 'l', null)!
    E.start(m, pack, 1, 0)
    m.qids = ['q11']; m.order = { q11: [0, 1, 2, 3] }
    E.tick(m, pack, E.COUNTDOWN_MS)
    expect(E.answer(m, pack, p.pid, [0], 0, E.COUNTDOWN_MS)).toBe(true)
    expect(m.ans[p.pid].ok).toBe(false)
  })
})

describe('no leaks', () => {
  it('public state hides answers, correctness and score changes until the reveal', () => {
    const { m, ps, t } = setup('classic')
    const before = E.publicState(m, pack, t)
    E.answer(m, pack, ps[0].pid, right(m), 500, t)
    const P = E.publicState(m, pack, t)
    expect(P.q?.answer).toBeUndefined()
    expect(P.q?.explanation).toBeUndefined()
    expect(P.ans[ps[0].pid]).toEqual({ done: 1, st: false })
    expect(P.sc[ps[0].pid].pts).toBe(before.sc[ps[0].pid].pts)
    expect(P.sc[ps[0].pid].streak).toBe(before.sc[ps[0].pid].streak)
    expect(JSON.stringify(P)).not.toContain('"ok":true')
    E.answer(m, pack, ps[1].pid, wrong(m), 500, t)
    E.tick(m, pack, t)
    const R = E.publicState(m, pack, t)
    expect(R.q?.answer).toEqual(right(m))
    expect(R.sc[ps[0].pid].pts).toBeGreaterThan(0)
  })
  it('options are shuffled per question but keep their original index', () => {
    const { m, t } = setup('classic')
    const P = E.publicState(m, pack, t)
    expect(P.q!.options.map((o) => o.k).sort()).toEqual([0, 1, 2, 3])
  })
})

describe('modes', () => {
  it('turns: wrong answer opens a steal for the next player', () => {
    const { m, ps, t } = setup('turns')
    const first = m.active!
    const other = ps.find((p) => p.pid !== first)!.pid
    expect(E.answer(m, pack, other, right(m), 0, t)).toBe(false) // not your turn
    E.answer(m, pack, first, wrong(m), 0, t)
    E.tick(m, pack, t)
    expect(m.phase).toBe('steal')
    expect(m.active).toBe(other)
    E.answer(m, pack, other, right(m), 0, t)
    E.tick(m, pack, t)
    expect(m.phase).toBe('reveal')
    expect(m.sc[other].stl).toBe(1)
    expect(m.sc[other].pts).toBe(50)
  })

  it('survival: three misses and you are out; last one standing wins', () => {
    const { m, ps } = setup('survival', 2, 5)
    let t = 50_000
    for (let k = 0; k < 3; k++) {
      E.answer(m, pack, ps[0].pid, right(m), 0, t)
      E.answer(m, pack, ps[1].pid, wrong(m), 0, t)
      E.tick(m, pack, t)
      t += E.REVEAL_MS
      E.tick(m, pack, t)
    }
    expect(m.sc[ps[1].pid].out).toBe(true)
    expect(m.phase).toBe('end')
    expect(E.standings(m)[0].pid).toBe(ps[0].pid)
  })

  it('survival plays at least 50 questions (or the whole pack)', () => {
    const { m } = setup('survival', 2, 5)
    expect(m.qids.length).toBe(pack.questions.length)
  })

  it('wager: bets are clamped and timeouts cost 100', () => {
    const { m, ps, t } = setup('wager')
    E.answer(m, pack, ps[0].pid, wrong(m), 0, t, 9)
    expect(m.ans[ps[0].pid].bet).toBe(3)
    expect(m.sc[ps[0].pid].pts).toBe(-300)
    E.tick(m, pack, m.deadline)
    expect(m.sc[ps[1].pid].pts).toBe(-100)
  })
})

describe('players', () => {
  it('max 8 players and unique aliases', () => {
    const m = E.newMatch('abcdef', settings('classic'))
    for (let i = 0; i < 8; i++) expect(E.addPlayer(m, 'N' + i, '🦊', 'l' + i, null)).not.toBeNull()
    expect(E.addPlayer(m, 'N9', '🦊', 'l9', null)).toBeNull()
    const m2 = E.newMatch('abcdef', settings('classic'))
    E.addPlayer(m2, 'Ana', '🦊', 'l1', 'tokenaaaa')
    expect(E.addPlayer(m2, 'ana', '🦊', 'l2', 'tokenbbbb')).toBeNull()
  })
  it('rejoin with the same device token keeps the seat and the score', () => {
    const { m, ps, t } = setup('classic')
    E.answer(m, pack, ps[0].pid, right(m), 0, t)
    const again = E.addPlayer(m, 'P0', '🐼', 'new-label', 'tok0xxxxxx')!
    expect(again.pid).toBe(ps[0].pid)
    expect(m.sc[again.pid].pts).toBeGreaterThan(0)
  })
  it('series counts wins across rematches', () => {
    const { m, ps, t } = setup('classic', 2, 1)
    E.answer(m, pack, ps[0].pid, right(m), 0, t)
    E.answer(m, pack, ps[1].pid, wrong(m), 0, t)
    E.tick(m, pack, t); E.skipReveal(m); E.tick(m, pack, t)
    expect(m.phase).toBe('end')
    E.finish(m)
    const m2 = E.newMatch(m.code, m.s, m)
    expect(m2.series['p0']).toBe(1)
    expect(m2.round).toBe(1)
  })
})
