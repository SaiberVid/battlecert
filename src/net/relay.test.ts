import { describe, expect, it } from 'vitest'
import { isSecret, newSecret, roomCrypto, seal, unseal } from './relay'

describe('relay crypto', () => {
  it('secrets are 128-bit url-safe strings', () => {
    const s = newSecret()
    expect(isSecret(s)).toBe(true)
    expect(newSecret()).not.toBe(s)
    expect(isSecret('short')).toBe(false)
  })
  it('round-trips, and rejects other keys or tampered data', async () => {
    const a = await roomCrypto(newSecret())
    const b = await roomCrypto(newSecret())
    const msg = { f: 'abc', d: { t: 'answer', c: [1] } }
    const sealed = await seal(a, msg)
    expect(await unseal(a, sealed)).toEqual(msg)
    expect(await unseal(b, sealed)).toBeUndefined()
    const bad = sealed.slice(); bad[20] ^= 1
    expect(await unseal(a, bad)).toBeUndefined()
    expect(a.topic).toMatch(/^battlecert\/v1\/[a-f0-9]{32}$/)
    expect(a.topic).not.toBe(b.topic)
  })
  it('topic does not reveal the secret or the room code', async () => {
    const s = newSecret()
    expect((await roomCrypto(s)).topic).not.toContain(s)
  })
})
