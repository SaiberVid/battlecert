import { useRef, useState } from 'react'
import { z } from 'zod'
import { difficultyCounts, importText, mergePacks, slug, type ImportResult } from '../core/packs'
import type { Pack } from '../core/types'
import { AiError, fileToPart, type Part } from '../ai/gemini'
import { MIXES, generatePack, manualPrompt, type Mix, type Progress } from '../ai/pipeline'
import { S, saveCustomPacks, storage, updateSettings, useStore } from '../store'
import { copy } from './common'

const MAX_SYLLABUS = 14 * 1024 * 1024
const COUNTS = [20, 40, 60, 100]
const STEP_TEXT: Record<Progress['step'], string> = {
  model: 'Conectando con Gemini',
  concepts: 'Leyendo el temario y sacando los conceptos clave',
  questions: 'Escribiendo preguntas',
  verify: 'Comprobando cada respuesta a ciegas',
  done: 'Listo',
}

/** Example questions as compact text: the model only needs style and level, not our JSON. */
function examplesToText(r: ImportResult): string {
  if (!r.pack) return ''
  return r.pack.questions.slice(0, 40).map((q, i) => [
    `${i + 1}. ${q.stem}${q.context ? '\n' + q.context : ''}`,
    ...q.options.map((o, k) => `  ${q.answer.includes(k) ? '[x]' : '[ ]'} ${o}`),
    q.difficulty ? `  dificultad: ${q.difficulty}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

function FileList({ files, onRemove }: { files: File[]; onRemove(i: number): void }) {
  if (!files.length) return null
  return (
    <ul className="files">
      {files.map((f, i) => (
        <li key={f.name + i}><span>📄 {f.name}</span><span className="mono small muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span><button className="btn sm ghost" onClick={() => onRemove(i)} aria-label={'Quitar ' + f.name}>✕</button></li>
      ))}
    </ul>
  )
}

function Drop({ label, hint, accept, onFiles }: { label: string; hint: string; accept: string; onFiles(f: File[]): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div className={'drop' + (over ? ' on' : '')} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]) }}>
      <b>{label}</b><br /><span className="small">{hint}</span>
      <input ref={ref} type="file" multiple accept={accept} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
    </div>
  )
}

export function StudySheet({ pack }: { pack: Pack }) {
  if (!pack.concepts?.length) return <p className="small muted">Este pack no tiene ficha de conceptos. Los packs creados con IA la generan.</p>
  const byDom = new Map<string, NonNullable<Pack['concepts']>>()
  for (const c of pack.concepts.slice().sort((a, b) => b.weight - a.weight)) { const k = c.domain || 'General'; byDom.set(k, [...(byDom.get(k) ?? []), c]) }
  return (
    <div className="sheet">
      {[...byDom].map(([dom, cs]) => (
        <section key={dom} className="stack" style={{ gap: 8 }}>
          <span className="label">{dom}</span>
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
  const [syllabus, setSyllabus] = useState<File[]>([])
  const [exFiles, setExFiles] = useState<File[]>([])
  const [exText, setExText] = useState('')
  const [count, setCount] = useState(40)
  const [mixId, setMixId] = useState('balanced')
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [verify, setVerify] = useState(true)
  const [target, setTarget] = useState('new')
  const [engine, setEngine] = useState<'auto' | 'manual'>('auto')
  const [key, setKey] = useState(() => storage.get('geminiKey', z.string().max(200), ''))
  const [remember, setRemember] = useState(() => !!storage.get('geminiKey', z.string().max(200), ''))
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ pack: Pack; dropped: number; errors: number; model: string } | null>(null)
  const [pasted, setPasted] = useState('')
  const abort = useRef<AbortController | null>(null)
  const mix: Mix = MIXES.find((m) => m.id === mixId)!.mix
  const custom = packs.filter((p) => !p.builtIn)
  const targetPack = custom.find((p) => p.id === target)
  const size = syllabus.reduce((a, f) => a + f.size, 0)
  const name = subject.trim() || targetPack?.name || ''

  const exampleText = async (): Promise<{ text: string; parts: Part[] }> => {
    const parts: Part[] = []
    let text = exText.trim() ? examplesToText(importText(exText)) || exText.trim() : ''
    for (const f of exFiles) {
      if (/\.pdf$/i.test(f.name)) parts.push(await fileToPart(f))
      else { const t = await f.text(); const r = importText(t); text += '\n\n' + (examplesToText(r) || t.slice(0, 20000)) }
    }
    return { text: text.trim(), parts }
  }

  const save = (pack: Pack) => {
    let final: Pack
    if (targetPack) final = mergePacks(targetPack, pack).pack
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

  const run = async () => {
    setError(null); setResult(null)
    if (!name) return setError('Escribe el nombre de la asignatura o certificación.')
    if (!syllabus.length) return setError('Añade al menos un PDF o archivo de apuntes del temario.')
    if (size > MAX_SYLLABUS) return setError('El temario supera 14 MB. Divide el PDF o sube solo los temas que entran.')
    if (!key.trim()) return setError('Pega tu clave gratuita de Gemini (ver el enlace de abajo).')
    storage.set('geminiKey', remember ? key.trim() : '')
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const syl = await Promise.all(syllabus.map(fileToPart))
      const ex = await exampleText()
      const r = await generatePack(key.trim(), { subject: name, syllabus: syl, examples: ex.text, examplesParts: ex.parts, count, mix, lang, verify, avoid: targetPack?.questions.map((q) => q.stem) }, setProgress, ctrl.signal)
      if (!r.pack || !r.pack.questions.length) throw new AiError('format', r.error || 'La IA no devolvió preguntas válidas.')
      const saved = save(r.pack)
      setResult({ pack: saved, dropped: r.dropped, errors: r.errors.length, model: r.model })
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Algo falló: ' + (e as Error).message)
    } finally { setProgress(null); abort.current = null }
  }

  const [manual, setManual] = useState('')
  const buildManual = async () => {
    const ex = await exampleText()
    setManual(manualPrompt(name || 'Mi asignatura', count, mix, lang, ex.text))
  }
  const importPasted = () => {
    setError(null)
    const r = importText(pasted, { name: name || undefined })
    if (!r.pack) return setError(r.error || 'No se reconoce el formato. Pega el JSON que te devolvió la IA.')
    const saved = save(r.pack)
    setResult({ pack: saved, dropped: 0, errors: r.errors.length, model: 'manual' })
  }

  const busy = !!progress
  const dc = result ? difficultyCounts(result.pack) : null
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid2">
        <section className="panel">
          <h2>1. Tu material</h2>
          <label className="field"><span className="label">Asignatura o certificación</span><input type="text" value={subject} maxLength={80} onChange={(e) => setSubject(e.target.value)} placeholder="p. ej. Bases de datos, Java, Álgebra, GH-300…" /></label>
          <div className="stack">
            <span className="label">Temario (obligatorio)</span>
            <Drop label="PDF o apuntes del temario" hint=".pdf · .md · .txt — varios archivos, hasta 14 MB" accept=".pdf,.md,.txt,application/pdf,text/plain,text/markdown" onFiles={(f) => setSyllabus([...syllabus, ...f])} />
            <FileList files={syllabus} onRemove={(i) => setSyllabus(syllabus.filter((_, k) => k !== i))} />
          </div>
          <div className="stack">
            <span className="label">Preguntas de ejemplo (opcional, muy recomendable)</span>
            <Drop label="Ejemplos de examen o de práctica" hint=".md (recomendado) · .json · .csv · .pdf · .txt" accept=".pdf,.md,.txt,.json,.csv" onFiles={(f) => setExFiles([...exFiles, ...f])} />
            <FileList files={exFiles} onRemove={(i) => setExFiles(exFiles.filter((_, k) => k !== i))} />
            <textarea rows={4} value={exText} onChange={(e) => setExText(e.target.value)} placeholder={'…o pégalas aquí. Formato recomendado:\n## ¿Pregunta?\n- [ ] opción\n- [x] correcta\n> explicación'} />
            <p className="small muted">La IA imita su estilo y nivel, pero escribe preguntas nuevas. No uses volcados de exámenes oficiales.</p>
          </div>
        </section>

        <section className="panel">
          <h2>2. Cómo lo quieres</h2>
          <div className="stack"><span className="label">Preguntas</span><div className="seg">{COUNTS.map((n) => <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}</div></div>
          <div className="stack"><span className="label">Dificultad (fáciles · medias · difíciles)</span>
            <div className="seg">{MIXES.map((m) => <button key={m.id} aria-pressed={mixId === m.id} onClick={() => setMixId(m.id)}>{m.name} <span className="mono small">{m.mix.join('/')}</span></button>)}</div>
          </div>
          <div className="row">
            <div className="stack"><span className="label">Idioma</span><div className="seg"><button aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button><button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>Inglés</button></div></div>
            <label className="field grow"><span className="label">Guardar en</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">Un pack nuevo</option>
                {custom.map((p) => <option key={p.id} value={p.id}>Añadir a “{p.name}” ({p.questions.length})</option>)}
              </select>
            </label>
          </div>
          <div className="stack">
            <span className="label">Motor</span>
            <div className="seg" role="group" aria-label="Motor">
              <button aria-pressed={engine === 'auto'} onClick={() => setEngine('auto')}>Automático · Gemini gratis</button>
              <button aria-pressed={engine === 'manual'} onClick={() => setEngine('manual')}>Manual · cualquier chat</button>
            </div>
          </div>
          {engine === 'auto' ? (
            <>
              <label className="field"><span className="label">Tu clave de Gemini</span><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" /></label>
              <p className="small muted">Gratis y sin tarjeta: entra en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a>, pulsa “Create API key” y pégala. Va directa de tu navegador a Google; BattleCert no tiene servidor y nunca la ve.</p>
              <label className="switch"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> <span>Recordar la clave en este dispositivo</span></label>
              <label className="switch"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> <span>Comprobar cada respuesta (más lento, menos errores)</span></label>
              <div className="row">
                <button className="btn big accent grow" disabled={busy} onClick={() => void run()}>{busy ? 'Generando…' : `Generar ${count} preguntas`}</button>
                {busy && <button className="btn big" onClick={() => abort.current?.abort()}>Cancelar</button>}
              </div>
            </>
          ) : (
            <>
              <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
                <li>Copia el prompt y pégalo en Claude, ChatGPT o Gemini adjuntando el temario {exFiles.some((f) => /\.pdf$/i.test(f.name)) ? 'y el PDF de ejemplos' : ''}.</li>
                <li>Pega abajo el JSON que te devuelva.</li>
              </ol>
              <button className="btn" onClick={async () => { await buildManual(); }}>Preparar prompt</button>
              {manual && (
                <>
                  <pre className="prompt">{manual}</pre>
                  <button className="btn accent" onClick={async () => S().say((await copy(manual)) ? 'Prompt copiado.' : 'No se pudo copiar; selecciónalo a mano.', 'ok')}>Copiar prompt</button>
                </>
              )}
              <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='Pega aquí la respuesta de la IA ({"format":"battlecert/1", …})' />
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
                {(['model', 'concepts', 'questions', ...(verify ? ['verify'] : [])] as Progress['step'][]).map((st, i, arr) => {
                  const cur = arr.indexOf(progress.step)
                  return <li key={st} className={i < cur ? 'done' : i === cur ? 'now' : ''}>{i < cur ? '✓' : i === cur ? '…' : '·'} {STEP_TEXT[st]}{i === cur && (st === 'questions' || st === 'verify') ? ` (${progress.done}/${progress.total})` : ''}</li>
                })}
              </ol>
              {progress.note && <p className="small warn">{progress.note}</p>}
              <div className="progress"><i style={{ width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
              <p className="small muted">Con el plan gratuito puede tardar 1–3 minutos. No cierres la pestaña.</p>
            </div>
          )}
          {error && <div className="warn" role="alert">{error}</div>}
          {result && dc && (
            <div className="stack">
              <h2>✅ “{result.pack.name}” guardado</h2>
              <div className="row">
                <span className="chip">{result.pack.questions.length} preguntas</span>
                <span className="chip">🟢 {dc[0]} fáciles</span><span className="chip">🟡 {dc[1]} medias</span><span className="chip">🔴 {dc[2]} difíciles</span>
                {result.pack.concepts && <span className="chip">🧠 {result.pack.concepts.length} conceptos</span>}
                {result.dropped > 0 && <span className="chip">🗑 {result.dropped} descartadas al comprobarlas</span>}
              </div>
              <p className="small muted">Revisa algunas antes del examen: la IA puede equivocarse, sobre todo en cálculos. Lo tienes en Mis packs, con su ficha de repaso.</p>
              <div className="row">
                <button className="btn big accent" onClick={() => useStore.setState({ view: 'home' })}>Jugar con este pack</button>
                <button className="btn" onClick={() => setResult(null)}>Generar más</button>
              </div>
              {result.pack.concepts && <details><summary className="label" style={{ cursor: 'pointer' }}>Ver ficha de repaso</summary><StudySheet pack={result.pack} /></details>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
