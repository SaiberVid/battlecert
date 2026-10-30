// Translates a pack's questions with Gemini, keeping technical terms, commands and product names in
// English. Translations live next to the original (question.tr.es / .en), never replace it.
import type { Pack, QLang, Question } from '../core/types'
import { cleanTr } from '../core/packs'
import { Gemini, listModels } from './gemini'

const NAME: Record<QLang, string> = { es: 'español de España', en: 'English' }

export function translatePrompt(qs: Question[], lang: QLang): string {
  return `Traduce estas preguntas tipo test al ${NAME[lang]}, para estudiar una certificación técnica.

Reglas:
- Traducción natural y precisa, como la escribiría un profesor nativo. No cambies el significado, no añadas ni quites información y mantén el MISMO número y orden de opciones.
- Deja EXACTAMENTE en inglés, sin traducir:
  · nombres de productos, servicios, herramientas, funciones, roles y opciones de menú tal como aparecen en la interfaz real (p. ej. Claude Code, Messages API, Intune, Autopilot, Conditional Access, Microsoft Entra ID);
  · comandos, cmdlets, flags, parámetros de API, nombres de campos y claves de configuración, valores, rutas y nombres de archivo, mensajes de error;
  · código y todo lo que esté entre comillas invertidas o en "context" si es código o configuración (traduce solo los comentarios y el texto narrativo);
  · términos técnicos que en el sector se usan en inglés (prompt, prompt caching, tool use, subagent, endpoint, token, batch, deployment, tenant…).
- Si un término en inglés puede no entenderse, NO lo traduzcas: déjalo tal cual.
- "explanation" también se traduce con las mismas reglas.
Preguntas:
${JSON.stringify(qs.map((q, i) => ({ i, stem: q.stem, context: q.context, options: q.options, explanation: q.explanation })))}
Devuelve SOLO: {"items": [{"i": 0, "stem": "...", "context": "", "options": ["..."], "explanation": "..."}]}`
}

export async function translatePack(key: string, pack: Pack, lang: QLang, opts: { signal?: AbortSignal; onProgress?(done: number, total: number, note?: string): void; onBatch?(pack: Pack): void } = {}): Promise<Pack> {
  const ai = new Gemini(key, await listModels(key, opts.signal))
  let cur: Pack = { ...pack, questions: pack.questions.map((q) => ({ ...q })) }
  const todo = cur.questions.filter((q) => !q.tr?.[lang])
  const total = cur.questions.length
  const BATCH = 25
  for (let b = 0; b < todo.length; b += BATCH) {
    const group = todo.slice(b, b + BATCH)
    opts.onProgress?.(total - todo.length + b, total)
    const res = (await ai.json('Eres un traductor técnico experto. Respondes solo con JSON válido.', [{ text: translatePrompt(group, lang) }], {
      signal: opts.signal, temperature: 0.2, onWait: (s) => opts.onProgress?.(total - todo.length + b, total, `Límite gratuito por minuto: esperando ${s} s…`),
    })) as { items?: { i?: number; stem?: string; context?: string; options?: string[]; explanation?: string }[] }
    const byId = new Map<string, Question['tr']>()
    for (const it of res.items ?? []) {
      const q = group[Number(it.i)]
      if (!q) continue
      const t = cleanTr({ [lang]: { stem: it.stem, context: it.context || undefined, options: it.options, explanation: it.explanation ?? '' } }, q.options.length)
      if (t) byId.set(q.id, t)
    }
    cur = { ...cur, questions: cur.questions.map((q) => (byId.has(q.id) ? { ...q, tr: { ...q.tr, ...byId.get(q.id) } } : q)) }
    opts.onBatch?.(cur) // save as we go: a cut-off keeps what was translated
  }
  opts.onProgress?.(total, total)
  return cur
}
