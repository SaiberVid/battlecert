// Question packs: one canonical format for any certification, plus importers.
//
// Canonical pack:
// {
//   "format": "cert-arena/1",
//   "id": "aws-saa-c03", "name": "AWS Solutions Architect Associate",
//   "lang": "en", "source": "…", "license": "…",
//   "questions": [
//     { "id": "q1", "domain": "Design Secure Architectures", "stem": "…", "context": "optional",
//       "options": ["…", "…", "…", "…"], "answer": [1], "explanation": "…" }
//   ]
// }
// `answer` holds 0-based option indexes; more than one index = multiple response.
;(function (root) {
  'use strict'

  const LET = 'abcdefgh'
  const letterToIdx = (x) => {
    if (typeof x === 'number') return x
    const s = String(x).trim().toLowerCase()
    if (/^\d+$/.test(s)) return Number(s) - (s === '0' ? 0 : 0) // numeric: treated as 0-based below
    return LET.indexOf(s)
  }

  function hash(s) {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return (h >>> 0).toString(36)
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, ' ').trim()
  const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 40) || 'pack'

  /** Validates and normalises one question. Returns [question, error]. */
  function cleanQuestion(q, i) {
    const stem = String(q.stem || '').trim()
    const options = (q.options || []).map((o) => String(o == null ? '' : o).trim()).filter((o, k, a) => o || k < a.length)
    if (!stem) return [null, `#${i + 1}: falta el enunciado`]
    if (options.length < 2 || options.some((o) => !o)) return [null, `#${i + 1}: necesita al menos 2 opciones con texto`]
    const answer = [...new Set((q.answer || []).map(Number))].filter((n) => Number.isInteger(n))
    if (!answer.length || answer.some((n) => n < 0 || n >= options.length)) return [null, `#${i + 1}: respuesta correcta fuera de las opciones`]
    return [{
      id: String(q.id || 'q' + hash(norm(stem))),
      domain: String(q.domain || 'General').trim() || 'General',
      stem,
      context: q.context ? String(q.context) : undefined,
      options,
      answer: answer.sort((a, b) => a - b),
      explanation: q.explanation ? String(q.explanation) : '',
    }, null]
  }

  /** Builds a pack from raw questions: validates, dedupes by normalised stem. */
  function makePack(meta, raw) {
    const errors = []
    const seen = new Set()
    const ids = new Set()
    const questions = []
    let dups = 0
    raw.forEach((q, i) => {
      const [c, err] = cleanQuestion(q, i)
      if (err) { errors.push(err); return }
      const key = norm(c.stem)
      if (seen.has(key)) { dups++; return }
      seen.add(key)
      while (ids.has(c.id)) c.id += '_'
      ids.add(c.id)
      questions.push(c)
    })
    const name = String(meta.name || 'Pack sin nombre').slice(0, 80)
    return {
      pack: {
        format: 'cert-arena/1',
        id: String(meta.id || slug(name)),
        name,
        lang: meta.lang || 'en',
        source: meta.source || '',
        license: meta.license || '',
        questions,
      },
      errors,
      dups,
    }
  }

  // ---------- adapters for known shapes
  function fromCanonical(d) {
    return { meta: d, raw: d.questions }
  }
  function fromArrayLike(list, meta) {
    // generic objects: {question|stem, options|choices (array or {a:..}), answer|correct (letters/indices), explanation|rationale, domain|topic}
    return {
      meta,
      raw: list.map((q) => {
        let opts = q.options || q.choices || q.o || []
        let keys = null
        if (!Array.isArray(opts)) { keys = Object.keys(opts); opts = keys.map((k) => opts[k]) }
        else if (opts.length && Array.isArray(opts[0])) { keys = opts.map((o) => String(o[0])); opts = opts.map((o) => o[1]) } // [[id,text]]
        else if (opts.length && typeof opts[0] === 'object' && opts[0] && 'text' in opts[0]) { keys = opts.map((o, i) => String(o.id ?? LET[i])); opts = opts.map((o) => o.text) }
        let ans = q.answer ?? q.correct ?? q.k ?? q.answers
        if (!Array.isArray(ans)) ans = String(ans ?? '').split(/[\s,;|]+/).filter(Boolean)
        const idx = ans.map((a) => {
          if (keys) { const k = keys.findIndex((x) => x.toLowerCase() === String(a).toLowerCase()); if (k >= 0) return k }
          if (typeof a === 'number') return a
          const s = String(a).trim()
          return /^\d+$/.test(s) ? Number(s) : LET.indexOf(s.toLowerCase())
        })
        let expl = q.explanation ?? q.rationale ?? q.e ?? ''
        if (typeof expl === 'object' && expl) expl = expl.short || ''
        if (keys) expl = String(expl).replace(/\{([a-h])\}/gi, '($1)') // preporato placeholders
        return {
          id: q.id,
          domain: q.domain || q.topic || q.d || q.category,
          stem: q.stem || q.question || q.s || q.prompt,
          context: q.context || q.x || (typeof q.scenario === 'string' ? q.scenario : undefined),
          options: opts,
          answer: idx,
          explanation: expl,
        }
      }),
    }
  }

  /** CSV with a header row. Recognised columns (any case): question/stem, a..h or option1..option8,
   *  answer/correct (letters or 1-based numbers, several separated by ; or |), explanation, domain, context. */
  function parseCsv(text) {
    const rows = []
    let row = []
    let cell = ''
    let q = false
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ','
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
  function fromCsv(text, meta) {
    const [head, ...rows] = parseCsv(text)
    const H = head.map((x) => x.trim().toLowerCase())
    const col = (r, ...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return (r[i] || '').trim() } return '' }
    const optCols = H.map((h, i) => (/^([a-h]|option ?\d|opcion ?\d|opción ?\d)$/.test(h) ? i : -1)).filter((i) => i >= 0)
    return {
      meta,
      raw: rows.map((r) => {
        const opts = optCols.map((i) => (r[i] || '').trim()).filter(Boolean)
        const ans = col(r, 'answer', 'correct', 'respuesta', 'correcta').split(/[;|,\s]+/).filter(Boolean).map((a) => (/^\d+$/.test(a) ? Number(a) - 1 : LET.indexOf(a.toLowerCase())))
        return { stem: col(r, 'question', 'stem', 'pregunta', 'enunciado'), options: opts, answer: ans, explanation: col(r, 'explanation', 'explicacion', 'explicación'), domain: col(r, 'domain', 'dominio', 'topic', 'tema'), context: col(r, 'context', 'contexto') || undefined }
      }),
    }
  }

  /** Markdown:
   *  ## Q: question text            (or "1. question")
   *  domain: Networking             (optional)
   *  - [x] correct option
   *  - [ ] wrong option
   *  > explanation                   (optional) */
  function fromMarkdown(text, meta) {
    const blocks = text.split(/^\s*##\s*(?:Q:|P:)?\s*/m).slice(1)
    return {
      meta,
      raw: blocks.map((b) => {
        const lines = b.split('\n')
        const stemLines = []
        let i = 0
        while (i < lines.length && !/^\s*[-*]\s*\[( |x|X)\]/.test(lines[i]) && !/^\s*(domain|dominio):/i.test(lines[i])) { stemLines.push(lines[i]); i++ }
        const opts = lines.filter((l) => /^\s*[-*]\s*\[( |x|X)\]/.test(l))
        const dom = lines.find((l) => /^\s*(domain|dominio):/i.test(l))
        return {
          stem: stemLines.join('\n').trim(),
          domain: dom ? dom.split(':').slice(1).join(':').trim() : undefined,
          options: opts.map((l) => l.replace(/^\s*[-*]\s*\[( |x|X)\]\s*/, '')),
          answer: opts.map((l, k) => (/\[(x|X)\]/.test(l) ? k : -1)).filter((k) => k >= 0),
          explanation: lines.filter((l) => /^\s*>/.test(l)).map((l) => l.replace(/^\s*>\s?/, '')).join(' '),
        }
      }),
    }
  }

  function detect(text) {
    const t = text.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const d = JSON.parse(t)
        if (Array.isArray(d)) return { kind: 'json-array', data: d }
        if (d.format === 'cert-arena/1') return { kind: 'canonical', data: d }
        if (Array.isArray(d.questions)) return { kind: 'json-questions', data: d }
        return { kind: 'unknown' }
      } catch (e) { return { kind: 'invalid-json', error: e.message } }
    }
    if (/^\s*##\s*/m.test(t) && /\[(x|X| )\]/.test(t)) return { kind: 'markdown' }
    if (/^[^\n]*(question|stem|pregunta|enunciado)[^\n]*[,;]/i.test(t)) return { kind: 'csv' }
    return { kind: 'unknown' }
  }

  /** Imports any supported text. Returns {pack, errors, dups, kind} or {error}. */
  function importText(text, meta) {
    const d = detect(text)
    meta = meta || {}
    let r
    if (d.kind === 'canonical') r = fromCanonical(d.data)
    else if (d.kind === 'json-questions') {
      const dd = d.data
      const name = meta.name || dd.name || dd.title || (dd.exams ? 'Banco importado' : dd.code) || 'Pack importado'
      // Amey-style multi-exam banks: keep the exam as part of the domain label
      const qs = dd.exams ? dd.questions.map((q) => ({ ...q, domain: (dd.exams[q.exam]?.title || q.exam || '') + ' · ' + (q.domain || '') })) : dd.questions
      const domainNames = Array.isArray(dd.domains) ? Object.fromEntries(dd.domains.map((x) => [x.id, x.name])) : {}
      r = fromArrayLike(qs.map((q) => ({ ...q, domain: domainNames[q.domain] || q.domain })), { ...meta, name, source: meta.source || dd.source || '', license: meta.license || dd.license || '' })
    } else if (d.kind === 'json-array') r = fromArrayLike(d.data, { ...meta, name: meta.name || 'Pack importado' })
    else if (d.kind === 'csv') r = fromCsv(text, { ...meta, name: meta.name || 'Pack CSV' })
    else if (d.kind === 'markdown') r = fromMarkdown(text, { ...meta, name: meta.name || 'Pack Markdown' })
    else return { error: d.kind === 'invalid-json' ? 'JSON no válido: ' + d.error : 'Formato no reconocido. Usa JSON, CSV con cabecera o Markdown (## pregunta, - [x] correcta).' }
    const out = makePack({ ...r.meta, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v)) }, r.raw)
    out.kind = d.kind
    return out
  }

  function domains(pack) {
    const m = {}
    for (const q of pack.questions) m[q.domain] = (m[q.domain] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  }

  const TEMPLATE_JSON = {
    format: 'cert-arena/1',
    id: 'mi-certificacion',
    name: 'Mi certificación',
    lang: 'es',
    source: 'Preguntas escritas por nosotros a partir de la guía oficial',
    license: 'Uso personal',
    questions: [
      { id: 'q1', domain: 'Redes', stem: '¿Qué puerto usa HTTPS por defecto?', options: ['80', '443', '22', '8080'], answer: [1], explanation: 'HTTPS usa 443; 80 es HTTP sin cifrar.' },
      { id: 'q2', domain: 'Seguridad', stem: 'Elige DOS controles preventivos.', options: ['Firewall', 'Logs de auditoría', 'MFA', 'Alertas SIEM'], answer: [0, 2], explanation: 'Firewall y MFA impiden; logs y alertas detectan.' },
    ],
  }
  const TEMPLATE_CSV = 'question,a,b,c,d,answer,explanation,domain\n"¿Qué puerto usa HTTPS por defecto?",80,443,22,8080,b,"HTTPS usa 443; 80 es HTTP sin cifrar.",Redes\n"Elige DOS controles preventivos.",Firewall,Logs de auditoría,MFA,Alertas SIEM,a;c,"Firewall y MFA impiden; logs y alertas detectan.",Seguridad\n'

  /** Prompt to create a pack with any AI assistant from an official exam guide. */
  function aiPrompt(cert, n, lang) {
    return [
      `Actúa como redactor experto de preguntas de certificación. Crea ${n} preguntas ORIGINALES de práctica para la certificación "${cert}".`,
      '',
      'Reglas:',
      '- Básate en los dominios y objetivos de la guía oficial del examen; reparte las preguntas según el peso de cada dominio.',
      '- No copies preguntas reales del examen ni de bancos con copyright.',
      '- Escenarios realistas; 4 opciones plausibles; una sola respuesta correcta salvo que el enunciado diga "Elige DOS".',
      '- La explicación dice por qué la correcta lo es y por qué fallan las demás, en 1–3 frases.',
      `- Idioma de enunciados y opciones: ${lang === 'es' ? 'español' : 'inglés (como el examen)'}.`,
      '',
      'Devuelve SOLO un JSON válido con este formato exacto (answer = índices desde 0):',
      JSON.stringify({ format: 'cert-arena/1', id: slug(cert), name: cert, lang: lang || 'en', source: 'Generado con IA a partir de la guía oficial; revisar', license: 'Uso personal', questions: [{ id: 'q1', domain: 'Nombre del dominio', stem: '…', options: ['…', '…', '…', '…'], answer: [0], explanation: '…' }] }, null, 1),
    ].join('\n')
  }

  root.Packs = { importText, makePack, detect, parseCsv, domains, TEMPLATE_JSON, TEMPLATE_CSV, aiPrompt, slug, hash }
})(typeof globalThis !== 'undefined' ? globalThis : this)
