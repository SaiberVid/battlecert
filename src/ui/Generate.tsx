import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { difficultyCounts, importText, mergePacks, slug } from '../core/packs'
import type { Pack } from '../core/types'
import { AiError, fileToPart } from '../ai/gemini'
import { MIXES, STYLES, generatePack, masterPrompt, packFromCheckpoint, splitJsonBlocks, type Checkpoint, type GenResult, type Mix, type Progress, type Source, type Step } from '../ai/pipeline'
import { idb } from '../idb'
import { S, saveCustomPacks, storage, updateSettings, useStore } from '../store'
import { copy } from './common'

const MAX_FILES = 14 * 1024 * 1024
const COUNTS = [0, 20, 40, 60, 100]
const STEP_TEXT: Record<Step, string> = {
  model: 'Conectando con Gemini',
  read: 'Leyendo webs y vídeos',
  map: 'Mapa del examen: dominios, pesos y conceptos clave',
  extract: 'Extrayendo y resolviendo las preguntas de tus fuentes',
  questions: 'Escribiendo preguntas nuevas',
  verify: 'Comprobando las nuevas a ciegas',
  done: 'Listo',
}
const CP_KEY = 'ai-checkpoint'

/** Free daily quotas reset at midnight Pacific time; returns that moment in the user's clock. */
export function quotaReset(now = Date.now()): Date {
  const hourLA = (t: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(t))
  const base = Math.ceil(now / 3_600_000) * 3_600_000
  for (let h = 0; h < 26; h++) { const t = base + h * 3_600_000; if (hourLA(t) === 0) return new Date(t) }
  return new Date(now + 86_400_000)
}

const YT = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}/i

type SrcItem = { id: number; kind: Source['kind']; label: string; size?: number; file?: File; url?: string; text?: string }
const ICON: Record<Source['kind'], string> = { file: '📄', url: '🌐', youtube: '▶️', text: '📝' }

function Drop({ onFiles }: { onFiles(f: File[]): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div className={'drop' + (over ? ' on' : '')} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]) }}>
      <b>Arrastra archivos o toca para elegirlos</b><br /><span className="small">Temario, apuntes, guía oficial, PDFs de preguntas… · .pdf .md .txt .json .csv</span>
      <input ref={ref} type="file" multiple accept=".pdf,.md,.txt,.json,.csv,application/pdf,text/plain,text/markdown,application/json,text/csv" hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
    </div>
  )
}

export function StudySheet({ pack }: { pack: Pack }) {
  if (!pack.concepts?.length) return <p className="small muted">Este pack no tiene ficha de conceptos. Los packs creados con IA la generan.</p>
  const byDom = new Map<string, NonNullable<Pack['concepts']>>()
  for (const c of pack.concepts.slice().sort((a, b) => b.weight - a.weight)) { const k = c.domain || 'General'; byDom.set(k, [...(byDom.get(k) ?? []), c]) }
  const weightOf = (d: string) => pack.blueprint?.find((b) => b.domain === d)?.weight
  return (
    <div className="sheet">
      {pack.blueprint && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Peso de cada dominio en el examen</span>
          {pack.blueprint.map((b) => (
            <div key={b.domain} className="stack" style={{ gap: 2 }}>
              <div className="row between small"><span>{b.domain}</span><span className="mono">{b.weight} %</span></div>
              <div className="progress"><i style={{ width: `${Math.min(100, b.weight * 2)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      {[...byDom].map(([dom, cs]) => (
        <section key={dom} className="stack" style={{ gap: 8 }}>
          <span className="label">{dom}{weightOf(dom) ? ` · ${weightOf(dom)} %` : ''}</span>
          {cs.map((c) => (
            <details key={c.name} open={c.weight >= 4}>
              <summary><b>{c.name}</b> <span className="weight" aria-label={`Peso ${c.weight} de 5`}>{'●'.repeat(c.weight)}{'○'.repeat(5 - c.weight)}</span></summary>
              <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{c.summary}</p>
              {c.traps?.length ? <p className="small trap">⚠️ {c.traps.join(' · ')}</p> : null}
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}

export function Generate({ toImport }: { toImport(): void }) {
  const packs = useStore((s) => s.packs)
  const [subject, setSubject] = useState('')
  const [items, setItems] = useState<SrcItem[]>([])
  const [link, setLink] = useState('')
  const [paste, setPaste] = useState('')
  const [extract, setExtract] = useState(true)
  const [count, setCount] = useState(40)
  const [mixId, setMixId] = useState('balanced')
  const [style, setStyle] = useState('auto')
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [verify, setVerify] = useState(true)
  const [target, setTarget] = useState('new')
  const [engine, setEngine] = useState<'auto' | 'manual'>('auto')
  const [key, setKey] = useState(() => storage.get('geminiKey', z.string().max(200), ''))
  const [remember, setRemember] = useState(() => !!storage.get('geminiKey', z.string().max(200), ''))
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ pack: Pack; res: Partial<GenResult> } | null>(null)
  const [pasted, setPasted] = useState('')
  const seq = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const mix: Mix = MIXES.find((m) => m.id === mixId)!.mix
  const custom = packs.filter((p) => !p.builtIn)
  const targetPack = custom.find((p) => p.id === target)
  const size = items.reduce((a, f) => a + (f.size ?? 0), 0)
  const name = subject.trim() || targetPack?.name || ''

  const add = (it: Omit<SrcItem, 'id'>) => setItems((l) => [...l, { ...it, id: ++seq.current }])
  const addFiles = (fs: File[]) => fs.forEach((f) => add({ kind: 'file', label: f.name, size: f.size, file: f }))
  const addLink = () => {
    const u = link.trim()
    try {
      const url = new URL(u)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error()
      add({ kind: YT.test(u) ? 'youtube' : 'url', label: url.hostname + url.pathname.slice(0, 50), url: u })
      setLink('')
    } catch { setError('Ese enlace no es válido. Pega la dirección completa (https://…).') }
  }
  const addText = () => { if (!paste.trim()) return; add({ kind: 'text', label: paste.trim().split('\n')[0].slice(0, 60) || 'Texto', size: paste.length, text: paste }); setPaste('') }

  const toSources = async (): Promise<Source[]> => Promise.all(items.map(async (it): Promise<Source> => {
    if (it.kind === 'file') {
      const f = it.file!
      if (/\.pdf$/i.test(f.name)) return { kind: 'file', label: f.name, part: await fileToPart(f) }
      const t = await f.text()
      return { kind: 'text', label: f.name, text: t.slice(0, 2_000_000) }
    }
    if (it.kind === 'text') return { kind: 'text', label: it.label, text: it.text! }
    return { kind: it.kind, label: it.label, url: it.url! }
  }))

  const save = (pack: Pack, intoId?: string) => {
    let final: Pack
    const into = custom.find((p) => p.id === (intoId ?? target)) ?? S().packs.find((p) => !p.builtIn && p.id === intoId)
    if (into) final = mergePacks(into, pack).pack
    else {
      let id = slug(pack.name) || 'pack'
      while (S().packs.some((p) => p.id === id)) id += '-2'
      final = { ...pack, id }
    }
    useStore.setState({ packs: [...S().packs.filter((p) => p.id !== final.id), { ...final, builtIn: false }] })
    saveCustomPacks()
    updateSettings({ packId: final.id, packName: final.name, domains: [] })
    return final
  }

  const [pending, setPending] = useState<Checkpoint | null>(null)
  const [model, setModel] = useState('')
  useEffect(() => { void idb.get<Checkpoint>(CP_KEY).then((cp) => { if (cp?.v === 1) setPending(cp) }) }, [])

  const execute = async (input: Parameters<typeof generatePack>[1], resume?: Checkpoint) => {
    storage.set('geminiKey', remember ? key.trim() : '')
    const ctrl = new AbortController()
    abort.current = ctrl
    let cp: Checkpoint | undefined = resume
    let lastWrite = 0
    const persist = (c: Checkpoint) => { cp = c; if (Date.now() - lastWrite > 1500 || c.verified) { lastWrite = Date.now(); void idb.set(CP_KEY, c) } }
    setPending(null)
    try {
      const r = await generatePack(key.trim(), input, setProgress, ctrl.signal, { resume, save: persist, onModel: (m) => setModel(m) })
      if (!r.pack || !r.pack.questions.length) throw new AiError('format', r.error || 'No salió ninguna pregunta válida. Revisa que las fuentes tengan texto legible.')
      const saved = save(r.pack, cp?.targetId)
      await idb.del(CP_KEY)
      setResult({ pack: saved, res: r })
    } catch (e) {
      const err = e as AiError
      let msg = err instanceof AiError ? err.message : 'Algo falló: ' + (e as Error).message
      // keep what was done: save the questions so far and remember where to continue
      if (cp && err.code !== 'key') {
        const partial = packFromCheckpoint(cp)
        if (partial.pack?.questions.length) {
          const saved = save(partial.pack, cp.targetId)
          cp.targetId = saved.id
          msg += ` Ya están guardadas ${partial.pack.questions.length} preguntas en “${saved.name}”.`
        }
        await idb.set(CP_KEY, cp)
        if (err.code !== 'aborted') setPending(cp)
        if (err.code === 'quota_day') msg += ` La cuota gratuita se renueva el ${quotaReset().toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}: entonces pulsa “Continuar” y seguirá donde lo dejó.`
      }
      setError(msg)
    } finally { setProgress(null); abort.current = null }
  }

  const run = async () => {
    setError(null); setResult(null)
    if (!name) return setError('Escribe el nombre de la asignatura o certificación.')
    if (!items.length) return setError('Añade al menos una fuente: un PDF, un enlace, un vídeo o texto.')
    if (size > MAX_FILES) return setError('Los archivos suman más de 14 MB. Quita alguno o divide el PDF y hazlo en dos tandas (puedes añadir la segunda al mismo pack).')
    if (!extract && count === 0) return setError('Elige extraer las preguntas de las fuentes, generar nuevas, o ambas cosas.')
    if (!key.trim()) return setError('Pega tu clave gratuita de Gemini (ver el enlace de abajo) o usa el modo manual.')
    const sources = await toSources()
    await execute({ subject: name, sources, extract, count, mix, lang, style, verify, avoid: targetPack?.questions.map((q) => q.stem) })
  }

  const resume = async () => {
    if (!pending) return
    setError(null); setResult(null)
    if (!key.trim()) return setError('Pega tu clave de Gemini para continuar.')
    await execute({ ...pending.input, sources: pending.sources }, pending)
  }
  const discard = async () => { await idb.del(CP_KEY); setPending(null) }

  const master = masterPrompt(name || 'Mi asignatura', { extract, count, mix, lang, style })
  const importPasted = () => {
    setError(null)
    // several answers ("sigue") can be pasted one after another: each JSON block is imported
    const blocks = splitJsonBlocks(pasted)
    let pack: Pack | null = targetPack ?? null
    let n = 0
    for (const b of blocks) {
      const r = importText(b, { name: name || undefined })
      if (!r.pack) continue
      pack = pack ? mergePacks(pack, r.pack).pack : r.pack
      n++
    }
    if (!pack || !n) return setError('No se reconoce la respuesta. Pega el JSON tal cual te lo devolvió la IA.')
    const saved = save(targetPack ? pack : { ...pack, name: name || pack.name })
    setResult({ pack: saved, res: {} })
    setPasted('')
  }

  const busy = !!progress
  const dc = result ? difficultyCounts(result.pack) : null
  const fromSrc = result ? result.pack.questions.filter((q) => q.origin === 'source').length : 0
  const steps: Step[] = ['model', ...(items.some((i) => i.kind === 'url' || i.kind === 'youtube') ? ['read' as Step] : []), 'map', ...(extract ? ['extract' as Step] : []), ...(count ? ['questions' as Step] : []), ...(verify && count ? ['verify' as Step] : [])]
  return (
    <div className="stack" style={{ gap: 16 }}>
      {pending && !progress && (
        <section className="panel hero" aria-labelledby="pend-h">
          <h2 id="pend-h">Tienes “{pending.input.subject}” a medias</h2>
          <p className="small">
            Hecho: {pending.textParts ? 'fuentes leídas' : 'empezando'}{pending.map ? ' · mapa del examen' : ''}{pending.readQuestions.length + pending.extract.raw.length ? ` · ${pending.readQuestions.length + pending.extract.raw.length} preguntas extraídas` : ''}{pending.gen.items.length ? ` · ${pending.gen.items.length} nuevas` : ''}.
            Continuar no repite lo ya hecho. La cuota gratuita diaria se renueva el {quotaReset().toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.
          </p>
          <div className="row"><button className="btn big accent" onClick={() => void resume()}>Continuar</button><button className="btn" onClick={() => void discard()}>Descartar</button></div>
        </section>
      )}
      <div className="grid2">
        <section className="panel">
          <h2>1. Tus fuentes</h2>
          <label className="field"><span className="label">Asignatura o certificación</span><input type="text" value={subject} maxLength={80} onChange={(e) => setSubject(e.target.value)} placeholder="p. ej. MD-102, Bases de datos, Java, Álgebra…" /></label>
          <p className="small muted">Añade todo lo que tengas, como en un cuaderno: la guía oficial del examen, el temario, apuntes, webs o PDFs con preguntas, vídeos de repaso. Cuanto más, mejor.</p>
          <Drop onFiles={addFiles} />
          <form className="row" onSubmit={(e) => { e.preventDefault(); addLink() }}>
            <input className="grow" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Enlace a una web, un PDF o un vídeo de YouTube" />
            <button className="btn" disabled={!link.trim()}>Añadir</button>
          </form>
          <div className="stack" style={{ gap: 6 }}>
            <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…o pega texto: apuntes, preguntas en cualquier formato (Markdown recomendado: ## pregunta, - [x] correcta)" />
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!paste.trim()} onClick={addText}>Añadir texto</button>
          </div>
          {items.length > 0 && (
            <ul className="files" aria-label="Fuentes">
              {items.map((it) => (
                <li key={it.id}><span>{ICON[it.kind]} {it.label}</span>{it.size ? <span className="mono small muted">{it.kind === 'text' ? `${Math.round(it.size / 1000)} k car.` : `${(it.size / 1024 / 1024).toFixed(1)} MB`}</span> : <span className="small muted">{it.kind === 'youtube' ? 'vídeo' : 'web'}</span>}<button className="btn sm ghost" onClick={() => setItems(items.filter((x) => x.id !== it.id))} aria-label={'Quitar ' + it.label}>✕</button></li>
              ))}
            </ul>
          )}
          <p className="small muted">Las webs que piden registro o bloquean robots no se pueden leer: guárdalas como PDF o copia su texto. Vídeos: solo públicos.</p>
        </section>

        <section className="panel">
          <h2>2. Qué quieres</h2>
          <label className="switch"><input type="checkbox" checked={extract} onChange={(e) => setExtract(e.target.checked)} /> <span><b>Extraer todas las preguntas de las fuentes</b>, resolverlas y explicar la correcta (corrige las que vengan mal)</span></label>
          <div className="stack"><span className="label">Preguntas nuevas parecidas al examen</span><div className="seg" role="group" aria-label="Preguntas nuevas">{COUNTS.map((n) => <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{n === 0 ? 'Ninguna' : n}</button>)}</div></div>
          {count > 0 && (
            <>
              <div className="stack"><span className="label">Dificultad (fáciles · medias · difíciles)</span>
                <div className="seg">{MIXES.map((m) => <button key={m.id} aria-pressed={mixId === m.id} onClick={() => setMixId(m.id)}>{m.name} <span className="mono small">{m.mix.join('/')}</span></button>)}</div>
              </div>
              <div className="row">
                <label className="field grow"><span className="label">Estilo del examen</span>
                  <select value={style} onChange={(e) => setStyle(e.target.value)}>{Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
                </label>
                <div className="stack"><span className="label">Idioma (nuevas)</span><div className="seg"><button aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button><button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>Inglés</button></div></div>
              </div>
            </>
          )}
          <label className="field"><span className="label">Guardar en</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">Un pack nuevo</option>
              {custom.map((p) => <option key={p.id} value={p.id}>Añadir a “{p.name}” ({p.questions.length}) sin repetir</option>)}
            </select>
          </label>
          <div className="stack">
            <span className="label">Motor</span>
            <div className="seg" role="group" aria-label="Motor">
              <button aria-pressed={engine === 'auto'} onClick={() => setEngine('auto')}>Automático · Gemini gratis</button>
              <button aria-pressed={engine === 'manual'} onClick={() => setEngine('manual')}>Manual · NotebookLM u otro chat</button>
            </div>
          </div>
          {engine === 'auto' ? (
            <>
              <label className="field"><span className="label">Tu clave de Gemini</span><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" /></label>
              <p className="small muted">Gratis y sin tarjeta: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a> → “Create API key”. Va directa de tu navegador a Google; BattleCert no tiene servidor y nunca la ve.</p>
              <label className="switch"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> <span>Recordar la clave en este dispositivo</span></label>
              {count > 0 && <label className="switch"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> <span>Comprobar las nuevas a ciegas (más lento, menos errores)</span></label>}
              <div className="row">
                <button className="btn big accent grow" disabled={busy} onClick={() => void run()}>{busy ? 'Trabajando…' : 'Crear pack'}</button>
                {busy && <button className="btn big" onClick={() => abort.current?.abort()}>Cancelar</button>}
              </div>
            </>
          ) : (
            <>
              <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
                <li>En <a href="https://notebooklm.google.com" target="_blank" rel="noopener noreferrer">NotebookLM</a> (gratis) crea un cuaderno y añade tus fuentes: PDFs, webs, vídeos de YouTube, texto. También vale Gemini, Claude o ChatGPT adjuntando archivos.</li>
                <li>Copia el prompt maestro y pégalo en el chat.</li>
                <li>Pega aquí cada respuesta. Si te dice <code>"continue": true</code>, escribe <b>sigue</b> y pega también la siguiente.</li>
              </ol>
              <pre className="prompt">{master}</pre>
              <button className="btn accent" onClick={async () => S().say((await copy(master)) ? 'Prompt maestro copiado.' : 'No se pudo copiar; selecciónalo a mano.', 'ok')}>Copiar prompt maestro</button>
              <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='Pega aquí la respuesta (o varias seguidas): {"format":"battlecert/1", …}' />
              <div className="row"><button className="btn primary" disabled={!pasted.trim()} onClick={importPasted}>Guardar pack</button><button className="btn ghost" onClick={toImport}>Importar desde archivo →</button></div>
            </>
          )}
        </section>
      </div>

      {(progress || error || result) && (
        <section className="panel" aria-live="polite">
          {progress && (
            <div className="stack">
              <h2>{STEP_TEXT[progress.step]}…</h2>
              <ol className="stages">
                {steps.map((st, i) => {
                  const cur = steps.indexOf(progress.step)
                  const count = (st === 'questions' || st === 'verify' || st === 'extract' || st === 'read') && i === cur ? ` (${progress.done}${progress.total > progress.done ? '/' + progress.total : ''})` : ''
                  return <li key={st} className={i < cur ? 'done' : i === cur ? 'now' : ''}>{i < cur ? '✓' : i === cur ? '…' : '·'} {STEP_TEXT[st]}{count}</li>
                })}
              </ol>
              {progress.note && <p className="small warn">{progress.note}</p>}
              {model && <p className="small muted">Modelo: <span className="mono">{model}</span></p>}
              <p className="small muted">Con el plan gratuito puede tardar unos minutos. El avance se guarda: si se corta o se acaba la cuota del día, podrás continuar.</p>
            </div>
          )}
          {error && <div className="warn" role="alert">{error}</div>}
          {result && dc && (
            <div className="stack">
              <h2>✅ “{result.pack.name}” guardado</h2>
              <div className="row">
                <span className="chip">{result.pack.questions.length} preguntas</span>
                {fromSrc > 0 && <span className="chip">📥 {fromSrc} de tus fuentes</span>}
                {result.pack.questions.length - fromSrc > 0 && <span className="chip">✨ {result.pack.questions.length - fromSrc} nuevas</span>}
                <span className="chip">🟢 {dc[0]} · 🟡 {dc[1]} · 🔴 {dc[2]}</span>
                {result.pack.concepts && <span className="chip">🧠 {result.pack.concepts.length} conceptos</span>}
                {result.pack.blueprint && <span className="chip">📊 {result.pack.blueprint.length} dominios con peso</span>}
                {!!result.res.corrected && <span className="chip">⚠️ {result.res.corrected} respuestas corregidas</span>}
                {!!result.res.dropped && <span className="chip">🗑 {result.res.dropped} nuevas descartadas</span>}
                {!!result.res.skipped && <span className="chip">🖼 {result.res.skipped} con imagen omitidas</span>}
              </div>
              <p className="small muted">Las preguntas corregidas llevan un aviso en su explicación. Revisa algunas antes del examen: la IA también se equivoca.</p>
              <div className="row">
                <button className="btn big accent" onClick={() => useStore.setState({ view: 'home' })}>Jugar con este pack</button>
                <button className="btn" onClick={() => { setResult(null); setTarget(result.pack.id) }}>Añadir más fuentes a este pack</button>
              </div>
              {result.pack.concepts && <details><summary className="label" style={{ cursor: 'pointer' }}>Ver ficha de repaso</summary><StudySheet pack={result.pack} /></details>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
