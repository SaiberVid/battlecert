import { describe, expect, it } from 'vitest'
import { planQuotas, manualPrompt, verifyPrompt } from './pipeline'
import { parseJsonLoose } from './gemini'
import { TEMPLATE_MD, importText, mergePacks, parseDifficulty, difficultyCounts } from '../core/packs'
import * as E from '../core/engine'

describe('planQuotas', () => {
  const cs = [{ name: 'A', weight: 5 }, { name: 'B', weight: 3 }, { name: 'C', weight: 1 }, { name: 'D', weight: 1 }]
  it('hits the exact total and the difficulty mix', () => {
    const q = planQuotas(cs, 40, [30, 45, 25])
    expect(q.reduce((a, x) => a + x.n, 0)).toBe(40)
    const by = [1, 2, 3].map((d) => q.filter((x) => x.difficulty === d).reduce((a, x) => a + x.n, 0))
    expect(by).toEqual([12, 18, 10])
  })
  it('gives heavier concepts more questions, and a spread of levels', () => {
    const q = planQuotas(cs, 40, [30, 45, 25])
    const n = (c: string) => q.filter((x) => x.concept === c).reduce((a, x) => a + x.n, 0)
    expect(n('A')).toBeGreaterThan(n('B'))
    expect(n('B')).toBeGreaterThan(n('C'))
    expect(new Set(q.filter((x) => x.concept === 'A').map((x) => x.difficulty)).size).toBe(3)
  })
})

describe('AI helpers', () => {
  it('parses JSON wrapped in fences or with stray text', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonLoose('Aquí tienes: {"a":[1,2]} ¡suerte!')).toEqual({ a: [1, 2] })
    expect(parseJsonLoose('nada')).toBeUndefined()
  })
  it('prompts carry the subject, the mix and never the answers for verification', () => {
    expect(manualPrompt('Java', 20, [30, 45, 25], 'es', '')).toContain('6 de dificultad 1')
    const v = verifyPrompt([{ id: 'x', domain: 'd', stem: 'S', options: ['a', 'b'], answer: [1], explanation: 'porque b' }])
    expect(v).not.toContain('porque b')
    expect(v).not.toContain('"answer":[1]')
  })
})

describe('pack format v2', () => {
  it('reads difficulty words in Spanish and English', () => {
    expect([parseDifficulty('Fácil'), parseDifficulty('media'), parseDifficulty('HARD'), parseDifficulty(3), parseDifficulty('x')]).toEqual([1, 2, 3, 3, undefined])
  })
  it('imports the Markdown template with code, metadata and title', () => {
    const r = importText(TEMPLATE_MD)
    expect(r.pack?.name).toBe('Bases de datos — ejemplos')
    const [a, b] = r.pack!.questions
    expect(a.difficulty).toBe(2)
    expect(a.concept).toBe('Formas normales')
    expect(a.domain).toBe('Normalización')
    expect(b.context).toContain('SELECT COUNT(edad)')
    expect(b.stem).not.toContain('```')
    expect(b.difficulty).toBe(3)
  })
  it('keeps concepts and merges packs without duplicates', () => {
    const r = importText(JSON.stringify({ format: 'battlecert/1', name: 'X', concepts: [{ name: 'C1', weight: 9, summary: 's' }], questions: [{ stem: 'a?', options: ['1', '2'], answer: [0], difficulty: 'dificil' }] }))
    expect(r.pack?.concepts?.[0].weight).toBe(5)
    const extra = importText(TEMPLATE_MD).pack!
    const m = mergePacks(r.pack!, { ...extra, questions: [...extra.questions, r.pack!.questions[0]] })
    expect(m.added).toBe(2)
    expect(m.dups).toBe(1)
    expect(difficultyCounts(m.pack)).toEqual([0, 1, 2])
  })
  it('difficulty modes pick the right questions', () => {
    const pack = importText(JSON.stringify({ format: 'battlecert/1', name: 'D', questions: Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, stem: 'Q' + i, options: ['a', 'b'], answer: [0], difficulty: (i % 3) + 1 })) })).pack!
    const lvl = (id: string) => pack.questions.find((q) => q.id === id)!.difficulty!
    expect(E.pick(pack, 6, 1, [], [], 'hard').every((id) => lvl(id) === 3)).toBe(true)
    const ladder = E.pick(pack, 9, 1, [], [], 'ladder').map(lvl)
    expect(ladder).toEqual([...ladder].sort())
  })
})
