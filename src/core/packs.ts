// Question packs: one open format for any subject or certification, importers for common
// shapes, strict validation and limits (packs are untrusted input).
import { z } from 'zod'
import type { Pack, Question } from './types'

export const LIMITS = {
  textBytes: 5 * 1024 * 1024,
  questions: 5000,
  stem: 4000,
  option: 1000,
  explanation: 4000,
  options: 8,
  domain: 120,
  name: 80,
}

const LET = 'abcdefgh'

export function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const slug = (s: string) => norm(s).replace(/ /g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'pack'

const QuestionSchema = z.object({
  id: z.string().min(1).max(80),
  domain: z.string().min(1).max(LIMITS.domain),
  stem: z.string().min(1).max(LIMITS.stem),
  context: z.string().max(LIMITS.stem).optional(),
  options: z.array(z.string().min(1).max(LIMITS.option)).min(2).max(LIMITS.options),
  answer: z.array(z.number().int().min(0).max(LIMITS.options - 1)).min(1),
  explanation: z.string().max(LIMITS.explanation),
}).refine((q) => q.answer.every((a) => a < q.options.length), { message: 'respuesta fuera de las opciones' })

export const PackSchema = z.object({
  format: z.enum(['cert-arena/1', 'battlecert/1']),
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(LIMITS.name),
  lang: z.string().max(12),
  source: z.string().max(500),
  license: z.string().max(200),
  builtIn: z.boolean().optional(),
  questions: z.array(QuestionSchema).max(LIMITS.questions),
})

type RawQ = { id?: unknown; domain?: unknown; stem?: unknown; context?: unknown; options?: unknown[]; answer?: unknown[]; explanation?: unknown }

/** Normalises one raw question. Returns [question, error]. */
function cleanQuestion(q: RawQ, i: number): [Question | null, string | null] {
  const stem = String(q.stem ?? '').trim()
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim())
  if (!stem) return [null, `#${i + 1}: falta el enunciado`]
  if (stem.length > LIMITS.stem) return [null, `#${i + 1}: enunciado demasiado largo`]
  if (options.length < 2 || options.some((o) => !o)) return [null, `#${i + 1}: necesita al menos 2 opciones con texto`]
  if (options.length > LIMITS.options) return [null, `#${i + 1}: más de ${LIMITS.options} opciones`]
  if (options.some((o) => o.length > LIMITS.option)) return [null, `#${i + 1}: opción demasiado larga`]
  const answer = [...new Set((Array.isArray(q.answer) ? q.answer : []).map(Number))].filter((n) => Number.isInteger(n))
  if (!answer.length || answer.some((n) => n < 0 || n >= options.length)) return [null, `#${i + 1}: la respuesta correcta no existe entre las opciones`]
  const id = String(q.id ?? '').replace(/[^\w.-]/g, '').slice(0, 60) || 'q' + hash(norm(stem))
  return [{
    id,
    domain: String(q.domain ?? '').trim().slice(0, LIMITS.domain) || 'General',
    stem,
    context: q.context ? String(q.context).slice(0, LIMITS.stem) : undefined,
    options,
    answer: answer.sort((a, b) => a - b),
    explanation: String(q.explanation ?? '').slice(0, LIMITS.explanation),
  }, null]
}

export interface ImportResult { pack?: Pack; errors: string[]; dups: number; kind: string; error?: string }

export function makePack(meta: { id?: string; name?: string; lang?: string; source?: string; license?: string }, raw: RawQ[]): ImportResult {
  const errors: string[] = []
  const seen = new Set<string>()
  const ids = new Set<string>()
  const questions: Question[] = []
  let dups = 0
  raw.slice(0, LIMITS.questions).forEach((q, i) => {
    const [c, err] = cleanQuestion(q, i)
    if (!c) { errors.push(err!); return }
    const key = norm(c.stem)
    if (seen.has(key)) { dups++; return }
    seen.add(key)
    while (ids.has(c.id)) c.id += '_'
    ids.add(c.id)
    questions.push(c)
  })
  if (raw.length > LIMITS.questions) errors.push(`Solo se importan las primeras ${LIMITS.questions} preguntas`)
  const name = String(meta.name || 'Pack sin nombre').trim().slice(0, LIMITS.name)
  const pack: Pack = {
    format: 'battlecert/1',
    id: slug(meta.id || name),
    name,
    lang: String(meta.lang || 'es').slice(0, 12),
    source: String(meta.source || '').slice(0, 500),
    license: String(meta.license || '').slice(0, 200),
    questions,
  }
  const v = PackSchema.safeParse(pack)
  if (!v.success) return { errors: [...errors, ...v.error.issues.slice(0, 5).map((x) => x.path.join('.') + ': ' + x.message)], dups, kind: '', error: 'El pack no supera la validación.' }
  return { pack: v.data as Pack, errors, dups, kind: '' }
}

// ---------- adapters
type AnyObj = Record<string, unknown>

function fromArrayLike(list: AnyObj[]): RawQ[] {
  return list.filter((q) => q && typeof q === 'object').map((q) => {
    let opts: unknown = q.options ?? q.choices ?? q.o ?? []
    let keys: string[] | null = null
    if (Array.isArray(opts)) {
      const arr = opts as unknown[]
      if (arr.length && Array.isArray(arr[0])) { keys = arr.map((o) => String((o as unknown[])[0])); opts = arr.map((o) => (o as unknown[])[1]) }
      else if (arr.length && arr[0] && typeof arr[0] === 'object' && 'text' in (arr[0] as AnyObj)) { keys = arr.map((o, i) => String((o as AnyObj).id ?? LET[i])); opts = arr.map((o) => (o as AnyObj).text) }
    } else if (opts && typeof opts === 'object') { keys = Object.keys(opts); opts = keys.map((k) => (opts as AnyObj)[k]) }
    let ans: unknown = q.answer ?? q.correct ?? q.k ?? q.answers
    const ansArr: unknown[] = Array.isArray(ans) ? ans : String(ans ?? '').split(/[\s,;|]+/).filter(Boolean)
    const idx = ansArr.map((a) => {
      if (keys) { const k = keys.findIndex((x) => x.toLowerCase() === String(a).toLowerCase()); if (k >= 0) return k }
      if (typeof a === 'number') return a
      const s = String(a).trim()
      return /^\d+$/.test(s) ? Number(s) : LET.indexOf(s.toLowerCase())
    })
    let expl: unknown = q.explanation ?? q.rationale ?? q.e ?? ''
    if (expl && typeof expl === 'object') expl = (expl as AnyObj).short ?? ''
    let explanation = String(expl ?? '')
    if (keys) explanation = explanation.replace(/\{([a-h])\}/gi, '($1)')
    return {
      id: q.id,
      domain: q.domain ?? q.topic ?? q.d ?? q.category,
      stem: q.stem ?? q.question ?? q.s ?? q.prompt,
      context: q.context ?? q.x ?? (typeof q.scenario === 'string' ? q.scenario : undefined),
      options: opts as unknown[],
      answer: idx,
      explanation,
    }
  })
}

export function parseCsv(text: string): string[][] {
  const first = text.split('\n')[0] ?? ''
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

function fromCsv(text: string): RawQ[] {
  const [head = [], ...rows] = parseCsv(text)
  const H = head.map((x) => x.trim().toLowerCase())
  const col = (r: string[], ...names: string[]) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return (r[i] || '').trim() } return '' }
  const optCols = H.map((h, i) => (/^([a-h]|option ?\d|opci[oó]n ?\d)$/.test(h) ? i : -1)).filter((i) => i >= 0)
  return rows.map((r) => ({
    stem: col(r, 'question', 'stem', 'pregunta', 'enunciado'),
    options: optCols.map((i) => (r[i] || '').trim()).filter(Boolean),
    answer: col(r, 'answer', 'correct', 'respuesta', 'correcta').split(/[;|,\s]+/).filter(Boolean).map((a) => (/^\d+$/.test(a) ? Number(a) - 1 : LET.indexOf(a.toLowerCase()))),
    explanation: col(r, 'explanation', 'explicacion', 'explicación'),
    domain: col(r, 'domain', 'dominio', 'topic', 'tema'),
    context: col(r, 'context', 'contexto') || undefined,
  }))
}

function fromMarkdown(text: string): RawQ[] {
  return text.split(/^\s*##\s*(?:Q:|P:)?\s*/m).slice(1).map((b) => {
    const lines = b.split('\n')
    const isOpt = (l: string) => /^\s*[-*]\s*\[( |x|X)\]/.test(l)
    const isDom = (l: string) => /^\s*(domain|dominio|tema):/i.test(l)
    const stemLines: string[] = []
    for (const l of lines) { if (isOpt(l) || isDom(l)) break; stemLines.push(l) }
    const opts = lines.filter(isOpt)
    const dom = lines.find(isDom)
    return {
      stem: stemLines.join('\n').trim(),
      domain: dom ? dom.split(':').slice(1).join(':').trim() : undefined,
      options: opts.map((l) => l.replace(/^\s*[-*]\s*\[( |x|X)\]\s*/, '')),
      answer: opts.map((l, k) => (/\[(x|X)\]/.test(l) ? k : -1)).filter((k) => k >= 0),
      explanation: lines.filter((l) => /^\s*>/.test(l)).map((l) => l.replace(/^\s*>\s?/, '')).join(' '),
    }
  })
}

/** Imports any supported text: canonical JSON, generic JSON lists, CSV or Markdown. */
export function importText(text: string, meta: { name?: string; license?: string } = {}): ImportResult {
  if (new Blob([text]).size > LIMITS.textBytes) return { errors: [], dups: 0, kind: '', error: 'El archivo supera 5 MB.' }
  const t = text.trim()
  let kind = 'unknown'
  let raw: RawQ[] = []
  let m: AnyObj = {}
  if (t.startsWith('{') || t.startsWith('[')) {
    let d: unknown
    try { d = JSON.parse(t) } catch (e) { return { errors: [], dups: 0, kind: 'json', error: 'JSON no válido: ' + (e as Error).message } }
    if (Array.isArray(d)) { kind = 'json-array'; raw = fromArrayLike(d as AnyObj[]) }
    else if (d && typeof d === 'object' && Array.isArray((d as AnyObj).questions)) {
      const dd = d as AnyObj
      kind = dd.format === 'battlecert/1' || dd.format === 'cert-arena/1' ? 'canonical' : 'json-questions'
      const exams = (dd.exams && typeof dd.exams === 'object' ? dd.exams : null) as Record<string, { title?: string }> | null
      const domNames: Record<string, string> = Array.isArray(dd.domains) ? Object.fromEntries((dd.domains as AnyObj[]).map((x) => [String(x.id), String(x.name)])) : {}
      const qs = (dd.questions as AnyObj[]).filter((q) => q && typeof q === 'object').map((q) => ({
        ...q,
        domain: exams ? (exams[String(q.exam)]?.title || String(q.exam ?? '')) + ' · ' + String(q.domain ?? '') : domNames[String(q.domain)] ?? q.domain,
      }))
      raw = kind === 'canonical' ? (qs as RawQ[]) : fromArrayLike(qs)
      m = { id: dd.id, name: dd.name || dd.title || dd.code, lang: dd.lang, source: dd.source, license: dd.license }
    } else return { errors: [], dups: 0, kind: 'json', error: 'El JSON no tiene una lista "questions".' }
  } else if (/^\s*##\s*/m.test(t) && /\[(x|X| )\]/.test(t)) { kind = 'markdown'; raw = fromMarkdown(t) }
  else if (/^[^\n]*(question|stem|pregunta|enunciado)[^\n]*[,;]/i.test(t)) { kind = 'csv'; raw = fromCsv(t) }
  else return { errors: [], dups: 0, kind, error: 'Formato no reconocido. Usa JSON, CSV con cabecera o Markdown (## pregunta, - [x] correcta).' }
  const r = makePack({ ...(m as object), ...(meta.name ? { name: meta.name, id: undefined } : {}), ...(meta.license ? { license: meta.license } : {}) }, raw)
  r.kind = kind
  return r
}

export function domains(pack: Pack): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const q of pack.questions) m.set(q.domain, (m.get(q.domain) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
}

/** A prompt that asks another AI to fix the errors the validator found. */
export function fixPrompt(errors: string[]): string {
  return [
    'Este JSON de preguntas tiene errores al importarlo en BattleCert. Corrígelos y devuelve SOLO el JSON completo y válido, con el mismo formato.',
    'Recuerda: "answer" es una lista de índices desde 0 que deben existir en "options"; cada pregunta necesita "stem" y al menos 2 opciones con texto.',
    '',
    'Errores:',
    ...errors.slice(0, 30).map((e) => '- ' + e),
  ].join('\n')
}

export const TEMPLATE_JSON = {
  format: 'battlecert/1',
  id: 'mi-asignatura',
  name: 'Mi asignatura',
  lang: 'es',
  source: 'Preguntas escritas a partir de mis apuntes',
  license: 'Uso personal',
  questions: [
    { id: 'q1', domain: 'Redes', stem: '¿Qué puerto usa HTTPS por defecto?', options: ['80', '443', '22', '8080'], answer: [1], explanation: 'HTTPS usa 443; 80 es HTTP sin cifrar.' },
    { id: 'q2', domain: 'Seguridad', stem: 'Elige DOS controles preventivos.', options: ['Firewall', 'Logs de auditoría', 'MFA', 'Alertas SIEM'], answer: [0, 2], explanation: 'Firewall y MFA impiden; logs y alertas detectan.' },
  ],
}
export const TEMPLATE_CSV = 'question,a,b,c,d,answer,explanation,domain\n"¿Qué puerto usa HTTPS por defecto?",80,443,22,8080,b,"HTTPS usa 443; 80 es HTTP sin cifrar.",Redes\n"Elige DOS controles preventivos.",Firewall,Logs de auditoría,MFA,Alertas SIEM,a;c,"Firewall y MFA impiden; logs y alertas detectan.",Seguridad\n'

export type PromptKind = 'pdf' | 'guide' | 'syllabus' | 'extend'

/** Prompts to create a pack with any AI assistant. */
export function aiPrompt(kind: PromptKind, topic: string, n: number, lang: 'es' | 'en'): string {
  const intro: Record<PromptKind, string> = {
    pdf: `Te adjunto un PDF o mis apuntes de "${topic}". Primero identifica los conceptos que más se repiten y más pesan (enfoque 80/20). Después crea ${n} preguntas tipo test que evalúen sobre todo esos conceptos. En "explanation" indica la página o sección de donde sale la respuesta.`,
    guide: `Te adjunto la guía oficial del examen de la certificación "${topic}". Usa sus dominios y su peso para repartir ${n} preguntas: más preguntas en los dominios que más pesan. Cada pregunta evalúa un objetivo concreto de la guía.`,
    syllabus: `Este es el temario de la asignatura "${topic}". Crea ${n} preguntas tipo test repartidas por temas; usa el nombre del tema como "domain".`,
    extend: `Te adjunto mi pack de preguntas de "${topic}" en JSON. Crea ${n} preguntas NUEVAS que no repitan ninguna existente, centradas en los dominios con menos preguntas.`,
  }
  return [
    'Actúa como redactor experto de preguntas de examen.',
    intro[kind],
    '',
    'Reglas:',
    '- Preguntas ORIGINALES. No copies preguntas reales de examen ni de bancos con copyright.',
    '- Escenarios realistas; 4 opciones plausibles del mismo estilo y longitud; una sola correcta salvo que el enunciado diga "Elige DOS".',
    '- Evita pistas involuntarias (la opción más larga o la más técnica no debe ser siempre la correcta).',
    '- "explanation": por qué la correcta lo es y por qué fallan las demás, en 1–3 frases.',
    `- Idioma de enunciados y opciones: ${lang === 'es' ? 'español' : 'inglés (como el examen)'}.`,
    '',
    'Devuelve SOLO un JSON válido, sin texto antes ni después, con este formato exacto ("answer" = índices desde 0):',
    JSON.stringify({ format: 'battlecert/1', id: slug(topic), name: topic, lang, source: 'Generado con IA; revisado por mí', license: 'Uso personal', questions: [{ id: 'q1', domain: 'Nombre del dominio o tema', stem: '…', options: ['…', '…', '…', '…'], answer: [0], explanation: '…' }] }, null, 1),
  ].join('\n')
}
