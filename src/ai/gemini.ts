// Gemini API called straight from the browser with the user's own free key (Google AI Studio).
// No server of ours in between: the key stays in this browser and requests go to Google only.

const API = 'https://generativelanguage.googleapis.com/v1beta'

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { file_uri: string; mime_type?: string } }

export class AiError extends Error {
  code: 'key' | 'quota' | 'quota_day' | 'blocked' | 'network' | 'format' | 'aborted' | 'other'
  constructor(code: AiError['code'], message: string) { super(message); this.code = code }
}

const headers = (key: string) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' })

async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try { return await fetch(url, { ...init, signal, credentials: 'omit', referrerPolicy: 'no-referrer' }) } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('aborted', 'Cancelado.')
    throw new AiError('network', 'No se pudo contactar con Google. Revisa tu conexión.')
  }
}

async function explain(r: Response): Promise<AiError> {
  let msg = ''
  try { msg = ((await r.json()) as { error?: { message?: string } }).error?.message ?? '' } catch { /* ignore */ }
  if (r.status === 400 && /api key/i.test(msg)) return new AiError('key', 'La clave de Gemini no es válida. Copia de nuevo la clave de Google AI Studio.')
  if (r.status === 401 || r.status === 403) return new AiError('key', 'Google ha rechazado la clave (' + r.status + '). Comprueba que es una clave de Google AI Studio y que la API de Gemini está activa.')
  if (r.status === 429) return new AiError('quota', 'Has alcanzado el límite gratuito de Gemini. ' + (msg.slice(0, 160) || ''))
  return new AiError('other', `Gemini respondió ${r.status}: ${msg.slice(0, 200)}`)
}

/** Free-tier quotas are per model, so we keep an ordered list and move on when one runs out for the day. */
export async function listModels(key: string, signal?: AbortSignal): Promise<string[]> {
  const r = await call(API + '/models?pageSize=200', { headers: headers(key) }, signal)
  if (!r.ok) throw await explain(r)
  const d = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const names = (d.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?(-\d+)?(-preview.*|-latest)?$/.test(n) || n === 'gemini-flash-latest' || n === 'gemini-flash-lite-latest')
  if (!names.length) throw new AiError('other', 'Tu clave no tiene acceso a ningún modelo Gemini Flash.')
  const ver = (n: string) => Number(/gemini-([\d.]+)/.exec(n)?.[1] ?? 0)
  // full flash models first (better questions), then lite ones (more free requests); newest first; previews last
  const score = (n: string) => (/lite/.test(n) ? 0 : 1000) + ver(n) * 10 - (/preview|exp/.test(n) ? 5 : 0) + (/latest/.test(n) ? 50 : 0)
  return [...new Set(names)].sort((a, b) => score(b) - score(a)).slice(0, 8)
}
/** @deprecated kept for callers that need a single model */
export async function pickModel(key: string, signal?: AbortSignal): Promise<string> { return (await listModels(key, signal))[0] }

type QuotaInfo = { perDay: boolean; retry: number | null; message: string }
async function quotaInfo(r: Response): Promise<QuotaInfo> {
  try {
    const e = (await r.clone().json()) as { error?: { message?: string; details?: { '@type'?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] } }
    const det = e.error?.details ?? []
    const ids = det.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? '')
    const retry = det.find((d) => d.retryDelay)?.retryDelay
    const msg = e.error?.message ?? ''
    // "limit: 0" means this model has no free quota at all for this key
    const perDay = ids.some((id) => /PerDay/i.test(id)) && !ids.some((id) => /PerMinute/i.test(id)) || /limit: 0\b/.test(msg) || (ids.some((id) => /PerDay/i.test(id)) && !retry)
    return { perDay, retry: retry ? Math.ceil(parseFloat(retry)) : null, message: msg }
  } catch { return { perDay: false, retry: null, message: '' } }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new AiError('aborted', 'Cancelado.')) }, { once: true })
})

export interface CallOpts { signal?: AbortSignal; temperature?: number; readUrls?: boolean; onWait?(secs: number): void }

/**
 * A Gemini session with the user's key and a list of models. Waits when the per-minute limit is
 * hit; when a model's daily free quota runs out it continues with the next model.
 */
export class Gemini {
  readonly key: string
  models: string[]
  private i = 0
  exhausted: string[] = []
  requests = 0
  onModel: (model: string, reason: 'start' | 'switch') => void = () => {}
  constructor(key: string, models: string[]) { this.key = key; this.models = models }
  get model() { return this.models[this.i] }

  async json(system: string, parts: Part[], opts: CallOpts = {}): Promise<unknown> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      // JSON mode cannot be combined with tools, so with URL reading we parse the JSON from the text.
      ...(opts.readUrls ? { tools: [{ url_context: {} }] } : {}),
      generationConfig: { ...(opts.readUrls ? {} : { responseMimeType: 'application/json' }), temperature: opts.temperature ?? 0.7 },
    })
    let waits = 0, badJson = 0
    for (;;) {
      if (this.i >= this.models.length) throw new AiError('quota_day', 'Se ha agotado la cuota gratuita de hoy en todos los modelos Gemini disponibles para tu clave.')
      const model = this.models[this.i]
      this.requests++
      const r = await call(`${API}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: headers(this.key), body }, opts.signal)
      if (r.status === 429) {
        const q = await quotaInfo(r)
        if (q.perDay || waits >= 4) { this.exhausted.push(model); this.i++; waits = 0; if (this.i < this.models.length) this.onModel(this.models[this.i], 'switch'); continue }
        const wait = Math.min(90, (q.retry ?? 20 * (waits + 1)) + 2)
        waits++
        opts.onWait?.(wait)
        await sleep(wait * 1000, opts.signal)
        continue
      }
      if (r.status === 503 || r.status === 500) {
        if (waits++ >= 4) throw await explain(r)
        opts.onWait?.(10)
        await sleep(10_000, opts.signal)
        continue
      }
      if (r.status === 404) { this.i++; continue } // model retired: try the next one
      if (!r.ok) throw await explain(r)
      const d = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
      if (d.promptFeedback?.blockReason) throw new AiError('blocked', 'Gemini ha bloqueado el contenido (' + d.promptFeedback.blockReason + ').')
      const text = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      const parsed = parseJsonLoose(text)
      if (parsed === undefined) {
        if (badJson++ < 1) continue // truncated or malformed: try once more
        throw new AiError('format', 'Gemini devolvió una respuesta que no es JSON válido.')
      }
      return parsed
    }
  }
}

/** One-off request with a fixed model (kept for simple callers and tests). */
export async function generateJson(key: string, model: string, system: string, parts: Part[], opts: CallOpts = {}): Promise<unknown> {
  return new Gemini(key, [model]).json(system, parts, opts)
}

/** Parses JSON even if wrapped in ```json fences or followed by stray text. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const start = t.search(/[[{]/)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start >= 0 && end > start) try { return JSON.parse(t.slice(start, end + 1)) } catch { /* ignore */ }
  return undefined
}

export async function fileToPart(f: File): Promise<Part> {
  const buf = new Uint8Array(await f.arrayBuffer())
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { inline_data: { mime_type: 'application/pdf', data: btoa(bin) } }
  }
  return { text: `--- ${f.name} ---\n` + new TextDecoder().decode(buf) }
}
