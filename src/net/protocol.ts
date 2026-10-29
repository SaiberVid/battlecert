// Wire protocol. Every message is validated before use; anything else is dropped.
import { z } from 'zod'
import { REACTIONS } from '../core/sanitize'

export const MAX_MSG_BYTES = 4096 // guest → host
export const MAX_STATE_BYTES = 256 * 1024 // host → guest

// ---------- guest → host
export const Hello = z.object({ t: z.literal('hello'), nick: z.string().max(60), avatar: z.string().max(16), token: z.string().regex(/^[a-z0-9]{8,40}$/), pin: z.string().max(8).optional() })
export const AnswerMsg = z.object({ t: z.literal('answer'), i: z.number().int().min(0).max(10000), ph: z.enum(['q', 'steal']), c: z.array(z.number().int().min(0).max(7)).max(8), ms: z.number().min(0).max(600000), bet: z.number().int().min(1).max(3).optional() })
export const React_ = z.object({ t: z.literal('react'), e: z.enum(REACTIONS as [string, ...string[]]) })
export const Pong = z.object({ t: z.literal('pong'), ts: z.number() })
export const GuestMsg = z.discriminatedUnion('t', [Hello, AnswerMsg, React_, Pong])
export type GuestMsg = z.infer<typeof GuestMsg>

// ---------- host → guest (the host is trusted for game content, but shapes are still checked)
const Str = z.string().max(5000)
const AnswerPub = z.union([
  z.object({ done: z.literal(1), st: z.boolean() }),
  z.object({ c: z.array(z.number()), ms: z.number(), ok: z.boolean(), pts: z.number(), st: z.boolean(), bet: z.number().optional() }),
])
const ScorePub = z.object({ pts: z.number(), ok: z.number(), n: z.number(), ms: z.number(), streak: z.number(), best: z.number(), stl: z.number(), lives: z.number(), out: z.boolean(), dom: z.record(z.string(), z.tuple([z.number(), z.number()])) })
export const PublicStateSchema = z.object({
  code: z.string().max(12),
  settings: z.object({ mode: z.enum(['classic', 'turns', 'blitz', 'survival', 'wager']), n: z.number(), secs: z.number(), domains: z.array(Str).max(200), diff: z.enum(['mix', 'ladder', 'easy', 'medium', 'hard']).optional(), packId: z.string().max(80), packName: z.string().max(120) }),
  players: z.array(z.object({ pid: z.string().max(20), nick: z.string().max(40), avatar: z.string().max(16), online: z.boolean() })).max(8),
  i: z.number(), total: z.number(), phase: z.enum(['lobby', 'countdown', 'q', 'steal', 'reveal', 'end']), active: z.string().max(20).nullable(),
  ans: z.record(z.string().max(20), AnswerPub), sc: z.record(z.string().max(20), ScorePub), round: z.number(), series: z.record(z.string().max(40), z.number()), rem: z.number(),
  q: z.object({ id: z.string().max(80), domain: Str, stem: Str, context: Str.optional(), options: z.array(z.object({ k: z.number(), t: Str })).max(8), need: z.number(), difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), answer: z.array(z.number()).optional(), explanation: Str.optional() }).optional(),
  review: z.array(z.object({ id: z.string().max(80), domain: Str, stem: Str, correct: z.array(Str) })).max(500).optional(),
})
export const HostMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('state'), s: PublicStateSchema }),
  z.object({ t: z.literal('welcome'), pid: z.string().max(20) }),
  z.object({ t: z.literal('reject'), reason: z.string().max(200) }),
  z.object({ t: z.literal('kicked') }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
  z.object({ t: z.literal('react'), pid: z.string().max(20), e: z.enum(REACTIONS as [string, ...string[]]) }),
])
export type HostMsg = z.infer<typeof HostMsg>

/** Token bucket: `rate` messages per second, bursts up to `burst`. */
export class RateLimiter {
  private tokens: number
  private last = Date.now()
  strikes = 0
  private rate: number
  private burst: number
  constructor(rate = 10, burst = 20) { this.rate = rate; this.burst = burst; this.tokens = burst }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.last) / 1000) * this.rate) // clock going backwards never drains the bucket
    this.last = now
    if (this.tokens >= 1) { this.tokens -= 1; return true }
    this.strikes += 1
    return false
  }
}

export const sizeOf = (x: unknown): number => { try { return new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x)).length } catch { return Infinity } }

/** Room codes: 6 characters without look-alikes (≈887 million combinations). */
export const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function randomCode(len = 6): string {
  const b = new Uint32Array(len)
  crypto.getRandomValues(b)
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('')
}
export function randomPin(): string {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return String(b[0] % 10000).padStart(4, '0')
}
export const isCode = (s: string) => new RegExp('^[' + CODE_ALPHABET + ']{6}$').test(s)
