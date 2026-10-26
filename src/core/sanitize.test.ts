import { describe, expect, it } from 'vitest'
import { cleanNick, cleanText, dict } from './sanitize'

describe('sanitize', () => {
  it('removes control, zero-width and bidi characters', () => {
    expect(cleanText('a\u0000b​c‮d e', 50)).toBe('abcde')
  })
  it('normalises and collapses whitespace', () => { expect(cleanText('  ｈｏｌａ \n\t mundo ', 50)).toBe('hola mundo') })
  it('nick needs 2–20 visible characters', () => {
    expect(cleanNick('a')).toBe('')
    expect(cleanNick('​​x')).toBe('')
    expect(cleanNick('x'.repeat(40))).toHaveLength(20)
  })
  it('dict has no prototype', () => {
    const d = dict<number>()
    d['__proto__'] = 1
    expect(Object.getPrototypeOf(d)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
