import { describe, expect, it } from 'vitest'
import { cpuAnswer, cpuFor, decide, newKumite, pushFor, resolve } from './kumite'
import * as E from './engine'
import type { Pack } from './types'

describe('kumite rules', () => {
  it('clash: both right, nobody moves, combos grow', () => {
    const k = resolve(newKumite(), [true, true], [900, 1200])
    expect(k.c).toBe(0)
    expect(k.last).toMatchObject({ type: 'clash', push: 0, faster: 0 })
    expect(k.combo).toEqual([1, 1])
  })
  it('hit: the one who is right pushes, the other loses the combo', () => {
    let k = resolve(newKumite(), [true, true])
    k = resolve(k, [false, true])
    expect(k.c).toBe(-1.5) // combo 1 → 1.5
    expect(k.combo).toEqual([0, 2])
    expect(k.last).toMatchObject({ type: 'hit', by: 1, attack: 'strong' })
  })
  it('combo push grows up to 3', () => {
    expect([0, 1, 2, 3, 4, 9].map((c) => pushFor(c, false))).toEqual([1, 1.5, 2, 2.5, 3, 3])
    expect(pushFor(4, true)).toBe(1.5)
  })
  it('both wrong: stumble, combos reset', () => {
    let k = resolve(newKumite(), [true, false])
    k = resolve(k, [false, false])
    expect(k.combo).toEqual([0, 0])
    expect(k.last.type).toBe('stumble')
    expect(k.c).toBe(1)
  })
  it('a normal fight lasts: even a perfect streak needs 4 questions, an even fight much longer', () => {
    let k = newKumite('normal'); let q = 0
    while (k.winner === null) { k = resolve(k, [true, false]); q++ }
    expect(q).toBeGreaterThanOrEqual(4)
    expect(k.winner).toBe(0)
    expect(k.last.ko).toBe(1)
    // alternating hits: nobody runs away with it
    let e = newKumite('normal')
    for (let i = 0; i < 20; i++) e = resolve(e, i % 2 ? [true, false] : [false, true])
    expect(e.winner).toBeNull()
  })
  it('the edge guard halves pushes so comebacks are possible', () => {
    let g = { ...newKumite('normal'), c: 6 } // defender 1 from the edge → guard
    g = resolve(g, [true, false])
    expect(g.last.guard).toBe(true)
    expect(g.c).toBe(6.5)
    expect(g.winner).toBeNull()
    g = resolve(g, [true, false]) // combo 1 → 1.5 / 2 = 0.75 → out
    expect(g.winner).toBe(0)
    expect(g.c).toBe(7)
  })
  it('decides by ground when questions run out', () => {
    expect(decide({ ...newKumite(), c: 2 })).toBe(0)
    expect(decide({ ...newKumite(), c: -0.5 })).toBe(1)
    expect(decide(newKumite())).toBeNull()
  })
  it('cpu gets harder through the ladder', () => {
    const a = cpuFor(0, 7, 20), b = cpuFor(6, 7, 20)
    expect(a.accuracy).toBeCloseTo(0.55)
    expect(b.accuracy).toBeCloseTo(0.9)
    expect(b.maxMs).toBeLessThan(a.maxMs)
    const r = cpuAnswer(b, () => 0.5)
    expect(r.ok).toBe(true)
    expect(r.ms).toBeGreaterThanOrEqual(b.minMs)
  })
})

describe('kumite in the match engine', () => {
  const pack: Pack = { format: 'battlecert/1', id: 't', name: 'T', lang: 'es', source: '', license: '', questions: Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, domain: 'D', stem: 'Q' + i, options: ['a', 'b', 'c'], answer: [0], explanation: '' })) }
  const right = (m: E.Match) => pack.questions.find((q) => q.id === m.qids[m.i])!.answer
  it('only the two fighters answer, fight resolves at reveal and ends at ring-out', () => {
    const m = E.newMatch('abcdef', { mode: 'kumite', n: 10, secs: 10, domains: [], packId: 't', packName: 'T', kLen: 'short' })
    const a = E.addPlayer(m, 'Ana', '🦊', 'l1', null, 'cyber')!
    const b = E.addPlayer(m, 'Bot', '🤖', 'cpu', null, 'sumo')!
    const watcher = E.addPlayer(m, 'Eva', '🐼', 'l3', null)!
    let t = 0
    E.start(m, pack, 1, t)
    expect(m.qids.length).toBe(30) // plays until someone falls
    t += E.COUNTDOWN_MS; E.tick(m, pack, t)
    expect(E.eligible(m)).toEqual([a.pid, b.pid])
    expect(E.answer(m, pack, watcher.pid, right(m), 0, t)).toBe(false)
    let rounds = 0
    while (m.phase !== 'end' && rounds < 40) {
      if (m.phase === 'q') { E.answer(m, pack, a.pid, right(m), 500, t); E.answer(m, pack, b.pid, [9], 800, t); E.tick(m, pack, t) }
      const P = E.publicState(m, pack, t)
      if (m.phase === 'reveal') { expect(P.kumite?.last.type).toBe('hit'); E.skipReveal(m); E.tick(m, pack, t) }
      rounds++
    }
    expect(m.phase).toBe('end')
    const P = E.publicState(m, pack, t)
    expect(P.kumite?.winner).toBe(0)
    expect(E.standings(P)[0].pid).toBe(a.pid)
    expect(P.players.find((p) => p.pid === b.pid)).toMatchObject({ fighter: 'sumo', cpu: true })
  })
  it('the fight state never moves before the reveal', () => {
    const m = E.newMatch('abcdef', { mode: 'kumite', n: 10, secs: 10, domains: [], packId: 't', packName: 'T' })
    const a = E.addPlayer(m, 'Ana', '🦊', 'l1', null)!
    E.addPlayer(m, 'Bea', '🐼', 'l2', null)
    E.start(m, pack, 1, 0); E.tick(m, pack, E.COUNTDOWN_MS)
    E.answer(m, pack, a.pid, right(m), 100, E.COUNTDOWN_MS)
    const P = E.publicState(m, pack, E.COUNTDOWN_MS)
    expect(P.kumite?.c).toBe(0)
    expect(P.kumite?.last.n).toBe(0)
  })
})
