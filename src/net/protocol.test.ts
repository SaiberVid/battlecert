import { describe, expect, it } from 'vitest'
import { GuestMsg, HostMsg, RateLimiter, isCode, randomCode, randomPin, sizeOf } from './protocol'

describe('protocol', () => {
  it('accepts valid guest messages', () => {
    expect(GuestMsg.safeParse({ t: 'hello', nick: 'Ana', avatar: '🦊', token: 'abcdefgh12' }).success).toBe(true)
    expect(GuestMsg.safeParse({ t: 'answer', i: 0, ph: 'q', c: [1], ms: 1200 }).success).toBe(true)
    expect(GuestMsg.safeParse({ t: 'react', e: '🔥' }).success).toBe(true)
  })
  it('rejects malformed or hostile ones', () => {
    expect(GuestMsg.safeParse({ t: 'answer', i: 0, ph: 'q', c: [1], ms: -1 }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'answer', i: 0, ph: 'reveal', c: [1], ms: 1 }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'answer', i: 0, ph: 'q', c: Array(50).fill(0), ms: 1 }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'hello', nick: 'x'.repeat(500), avatar: '🦊', token: 'abcdefgh' }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'hello', nick: 'Ana', avatar: '🦊', token: '../../etc' }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'react', e: '<img src=x onerror=alert(1)>' }).success).toBe(false)
    expect(GuestMsg.safeParse({ t: 'state' }).success).toBe(false)
    expect(GuestMsg.safeParse('hello').success).toBe(false)
  })
  it('guests only accept known host messages', () => {
    expect(HostMsg.safeParse({ t: 'welcome', pid: 'p1' }).success).toBe(true)
    expect(HostMsg.safeParse({ t: 'eval', code: 'x' }).success).toBe(false)
  })
  it('rate limiter allows bursts then throttles', () => {
    const r = new RateLimiter(10, 20)
    let ok = 0
    for (let i = 0; i < 100; i++) if (r.take(1000)) ok++
    expect(ok).toBe(20)
    expect(r.take(1000 + 1000)).toBe(true)
    expect(r.strikes).toBe(80)
  })
  it('codes and pins', () => {
    for (let i = 0; i < 50; i++) expect(isCode(randomCode())).toBe(true)
    expect(isCode('ABCDEF')).toBe(false)
    expect(isCode('abc1ef')).toBe(false) // 1 is excluded
    expect(randomPin()).toMatch(/^\d{4}$/)
    expect(sizeOf({ a: 'ñ' })).toBe(10)
  })
})
