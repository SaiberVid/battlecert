// Gemini API called straight from the browser with the user's own free key (Google AI Studio).
// No server of ours in between: the key stays in this browser and requests go to Google only.

const API = 'https://generativelanguage.googleapis.com/v1beta'

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } }

export class AiError extends Error {
  code: 'key' | 'quota' | 'blocked' | 'network' | 'format' | 'aborted' | 'other'
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

/** Picks the best available "flash" model for this key (names change over time, so ask the API). */
export async function pickModel(key: string, signal?: AbortSignal): Promise<string> {
  const r = await call(API + '/models?pageSize=200', { headers: headers(key) }, signal)
  if (!r.ok) throw await explain(r)
  const d = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const names = (d.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash(-\d+)?(-preview.*|-latest)?$/.test(n) || n === 'gemini-flash-latest')
  if (!names.length) throw new AiError('other', 'Tu clave no tiene acceso a ningún modelo Gemini Flash.')
  const ver = (n: string) => Number(/gemini-([\d.]+)/.exec(n)?.[1] ?? 0)
  const score = (n: string) => ver(n) * 10 - (/preview|exp/.test(n) ? 3 : 0) + (n === 'gemini-flash-latest' ? 1000 : 0)
  return names.sort((a, b) => score(b) - score(a))[0]
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new AiError('aborted', 'Cancelado.')) }, { once: true })
})

/** One JSON-mode request, retrying politely when the free quota per minute is hit. */
export async function generateJson(key: string, model: string, system: string, parts: Part[], opts: { signal?: AbortSignal; temperature?: number; onWait?(secs: number): void } = {}): Promise<unknown> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: opts.temperature ?? 0.7 },
  })
  for (let attempt = 0; ; attempt++) {
    const r = await call(`${API}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: headers(key), body }, opts.signal)
    if (r.status === 429 || r.status === 503) {
      if (attempt >= 5) throw await explain(r)
      let wait = 20 * (attempt + 1)
      try {
        const e = (await r.clone().json()) as { error?: { details?: { retryDelay?: string }[] } }
        const d = e.error?.details?.find((x) => x.retryDelay)?.retryDelay
        if (d) wait = Math.min(90, Math.ceil(parseFloat(d)) + 2)
      } catch { /* ignore */ }
      opts.onWait?.(wait)
      await sleep(wait * 1000, opts.signal)
      continue
    }
    if (!r.ok) throw await explain(r)
    const d = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
    if (d.promptFeedback?.blockReason) throw new AiError('blocked', 'Gemini ha bloqueado el contenido (' + d.promptFeedback.blockReason + ').')
    const text = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const parsed = parseJsonLoose(text)
    if (parsed === undefined) {
      if (attempt < 2) continue // truncated or malformed: try once more
      throw new AiError('format', 'Gemini devolvió una respuesta que no es JSON válido.')
    }
    return parsed
  }
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
