import { describe, expect, it } from 'vitest'
import { LIMITS, TEMPLATE_CSV, TEMPLATE_JSON, aiPrompt, cleanTr, importText, PackSchema, translatedCount } from './packs'
import type { Pack } from './types'
import ccdv from '../data/claude-ccdv-f.json'
import ccarf from '../data/claude-ccar-f.json'
import ccarp from '../data/claude-ccar-p.json'

describe('importText', () => {
  it('imports the canonical template', () => {
    const r = importText(JSON.stringify(TEMPLATE_JSON))
    expect(r.error).toBeUndefined()
    expect(r.pack?.questions).toHaveLength(2)
    expect(r.pack?.questions[1].answer).toEqual([0, 2])
    expect(PackSchema.safeParse(r.pack).success).toBe(true)
  })
  it('imports the CSV template with letter answers', () => {
    const r = importText(TEMPLATE_CSV, { name: 'CSV' })
    expect(r.pack?.questions).toHaveLength(2)
    expect(r.pack?.questions[0].answer).toEqual([1])
    expect(r.pack?.questions[1].answer).toEqual([0, 2])
  })
  it('imports a plain array with letter answers and option objects', () => {
    const r = importText(JSON.stringify([{ question: '¿2+2?', options: { a: '3', b: '4' }, answer: 'b', explanation: 'suma' }]), { name: 'Arr' })
    expect(r.pack?.questions[0].answer).toEqual([1])
  })
  it('reports invalid questions instead of failing the whole pack', () => {
    const bad = { ...TEMPLATE_JSON, questions: [...TEMPLATE_JSON.questions, { id: 'x', stem: 'sin opciones', options: [], answer: [0] }, { id: 'y', stem: 'fuera de rango', options: ['a', 'b'], answer: [5] }] }
    const r = importText(JSON.stringify(bad))
    expect(r.pack?.questions).toHaveLength(2)
    expect(r.errors.length).toBe(2)
  })
  it('drops duplicates', () => {
    const q = TEMPLATE_JSON.questions[0]
    const r = importText(JSON.stringify({ ...TEMPLATE_JSON, questions: [q, { ...q, id: 'other' }] }))
    expect(r.pack?.questions).toHaveLength(1)
    expect(r.dups).toBe(1)
  })
  it('does not let __proto__ keys pollute objects', () => {
    importText('{"format":"battlecert/1","name":"x","__proto__":{"polluted":1},"questions":[{"stem":"a","options":["a","b"],"answer":[0],"__proto__":{"polluted":2}}]}')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('refuses oversized input and garbage', () => {
    expect(importText('x'.repeat(LIMITS.textBytes + 10)).error).toBeTruthy()
    expect(importText('esto no es un pack').pack).toBeUndefined()
  })
  it('keeps hostile text as plain text (rendering escapes it)', () => {
    const r = importText(JSON.stringify([{ question: '<img src=x onerror=alert(1)>', options: ['<b>a</b>', 'b'], answer: 0 }]), { name: 'X' })
    expect(r.pack?.questions[0].stem).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('aiPrompt', () => {
  it('embeds the format and the topic', () => {
    const p = aiPrompt('pdf', 'Bioquímica', 30, 'es')
    expect(p).toContain('Bioquímica')
    expect(p).toContain('battlecert/1')
    expect(p).toContain('80/20')
  })
})

describe('translations', () => {
  const es = { stem: '¿Qué puerto?', options: ['80', '443'], explanation: 'HTTPS usa 443.' }
  it('cleanTr keeps well-formed translations and drops mismatched option counts', () => {
    expect(cleanTr({ es }, 2)).toEqual({ es })
    expect(cleanTr({ es }, 3)).toBeUndefined()
    expect(cleanTr({ es: { stem: 'x' } }, 2)).toBeUndefined()
    expect(cleanTr('nope', 2)).toBeUndefined()
  })
  it('imports a pack with tr and counts translated questions', () => {
    const raw = { name: 'T', questions: [{ question: 'Which port?', options: ['80', '443'], answer: 'b', explanation: 'HTTPS uses 443.', tr: { es } }, { question: 'Other?', options: ['a', 'b'], answer: 'a' }] }
    const r = importText(JSON.stringify(raw))
    expect(r.error).toBeUndefined()
    expect(r.pack!.questions[0].tr?.es?.stem).toBe('¿Qué puerto?')
    expect(translatedCount(r.pack!, 'es')).toBe(1)
    expect(PackSchema.safeParse(r.pack).success).toBe(true)
  })
  it('built-in packs are valid and fully translated to Spanish, keeping technical names in English', () => {
    for (const p of [ccdv, ccarf, ccarp] as unknown as Pack[]) {
      expect(PackSchema.safeParse(p).success).toBe(true)
      expect(translatedCount(p, 'es')).toBe(p.questions.length)
      for (const q of p.questions) expect(q.tr!.es!.options).toHaveLength(q.options.length)
    }
    const all = JSON.stringify([ccdv, ccarf, ccarp])
    for (const term of ['Message Batches API', 'tool_choice', 'CLAUDE.md', 'PreToolUse', 'stop_reason']) expect(all).toContain(term)
  })
})
