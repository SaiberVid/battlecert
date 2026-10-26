import { useRef, useState } from 'react'
import { LIMITS, TEMPLATE_CSV, TEMPLATE_JSON, aiPrompt, domains, fixPrompt, importText, type ImportResult, type PromptKind } from '../core/packs'
import type { Pack } from '../core/types'
import { saveCustomPacks, updateSettings, useStore, S } from '../store'
import { copy } from './common'

type Tab = 'mine' | 'import' | 'ai' | 'format'

export function Packs() {
  const [tab, setTab] = useState<Tab>('mine')
  const set = useStore((s) => s.set)
  const tabs: [Tab, string][] = [['mine', 'Mis packs'], ['import', 'Importar'], ['ai', 'Crear con IA'], ['format', 'Formato']]
  return (
    <>
      <div className="row between">
        <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)' }}>Packs de preguntas</h1>
        <button className="btn" onClick={() => set({ view: 'home' })}>← Volver</button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'mine' && <Mine onImport={() => setTab('import')} />}
      {tab === 'import' && <Import done={() => setTab('mine')} />}
      {tab === 'ai' && <Ai />}
      {tab === 'format' && <Format />}
    </>
  )
}

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Mine({ onImport }: { onImport: () => void }) {
  const packs = useStore((s) => s.packs)
  const [open, setOpen] = useState<string | null>(null)
  const remove = (p: Pack) => {
    if (!confirmDelete(p)) return
    useStore.setState({ packs: S().packs.filter((x) => x.id !== p.id) })
    saveCustomPacks()
    if (S().settings.packId === p.id) updateSettings({ packId: S().packs[0].id, packName: S().packs[0].name, domains: [] })
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      {packs.map((p) => {
        const doms = domains(p)
        return (
          <section key={p.id} className="panel flat" style={{ gap: 10 }}>
            <div className="row between">
              <div className="stack" style={{ gap: 2 }}>
                <h3>{p.builtIn ? '📦 ' : '📝 '}{p.name}</h3>
                <span className="small muted">{p.questions.length} preguntas · {doms.length} dominios · {p.lang.toUpperCase()} · {p.license}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => { updateSettings({ packId: p.id, packName: p.name, domains: [] }); useStore.setState({ view: 'home' }) }}>Jugar</button>
                <button className="btn sm" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>Detalles</button>
                <button className="btn sm" onClick={() => download(p.id + '.json', JSON.stringify({ ...p, builtIn: undefined, format: 'battlecert/1' }, null, 1))}>Exportar</button>
                {!p.builtIn && <button className="btn sm danger" onClick={() => remove(p)}>Borrar</button>}
              </div>
            </div>
            {open === p.id && (
              <div className="stack small">
                <p className="muted">Fuente: {p.source}</p>
                <div className="row" style={{ gap: 6 }}>{doms.map((d) => <span key={d.name} className="chip">{d.name} <span className="mono muted">{d.count}</span></span>)}</div>
              </div>
            )}
          </section>
        )
      })}
      <button className="btn big accent" onClick={onImport}>+ Añadir un pack</button>
    </div>
  )
}

// Kept as a tiny wrapper so tests/e2e can stub it; the native dialog is fine for a destructive action.
function confirmDelete(p: Pack) { return window.confirm(`¿Borrar el pack "${p.name}"? Esta acción no se puede deshacer.`) }

function rawUrl(u: string): string | null {
  try {
    const url = new URL(u.trim())
    if (url.protocol !== 'https:') return null
    // github.com/<o>/<r>/blob/<branch>/<path> → raw file
    if (url.hostname === 'github.com') {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
    }
    if (url.hostname === 'gist.github.com') return null
    return url.toString()
  } catch { return null }
}

function Import({ done }: { done: () => void }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [res, setRes] = useState<ImportResult | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = (t: string, fallbackName?: string) => {
    const r = importText(t, { name: name.trim() || fallbackName })
    setRes(r)
  }
  const readFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > LIMITS.textBytes) return setRes({ errors: [], dups: 0, kind: '', error: `El archivo pesa más de ${Math.round(LIMITS.textBytes / 1e6)} MB.` })
    const t = await f.text()
    setText(t.length > 200_000 ? t.slice(0, 200_000) + '\n…' : t)
    run(t, f.name.replace(/\.[^.]+$/, ''))
  }
  const fetchUrl = async () => {
    const u = rawUrl(url)
    if (!u) return setRes({ errors: [], dups: 0, kind: '', error: 'Usa un enlace https a un archivo .json, .csv o .md (en GitHub vale el enlace normal del archivo).' })
    setBusy(true)
    try {
      const r = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const len = Number(r.headers.get('content-length') || 0)
      if (len > LIMITS.textBytes) throw new Error('el archivo es demasiado grande')
      const t = await r.text()
      if (t.length > LIMITS.textBytes) throw new Error('el archivo es demasiado grande')
      setText(t.length > 200_000 ? t.slice(0, 200_000) + '\n…' : t)
      run(t, decodeURIComponent(u.split('/').pop() || '').replace(/\.[^.]+$/, ''))
    } catch (e) {
      setRes({ errors: [], dups: 0, kind: '', error: 'No se pudo descargar (' + (e as Error).message + '). Si el sitio no lo permite, descárgalo y súbelo como archivo.' })
    } finally { setBusy(false) }
  }
  const save = () => {
    if (!res?.pack) return
    const exists = S().packs.find((x) => x.id === res.pack!.id)
    const p = { ...res.pack, id: exists?.builtIn ? res.pack.id + '-mio' : res.pack.id }
    useStore.setState({ packs: [...S().packs.filter((x) => x.id !== p.id), { ...p, builtIn: false }] })
    saveCustomPacks()
    updateSettings({ packId: p.id, packName: p.name, domains: [] })
    S().say(`Pack "${p.name}" guardado con ${p.questions.length} preguntas.`, 'ok')
    done()
  }

  return (
    <div className="grid2">
      <section className="panel">
        <h2>Importar</h2>
        <p className="small muted">Acepta el formato BattleCert (JSON), listas JSON de preguntas de otros proyectos, CSV y Markdown. Todo se valida y se guarda solo en este navegador.</p>
        <label className="field"><span className="label">Nombre del pack (opcional)</span><input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Se toma del archivo si lo trae" /></label>
        <div className={'drop' + (over ? ' on' : '')} role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void readFile(e.dataTransfer.files[0]) }}>
          <b>Arrastra un archivo</b> o toca para elegirlo<br /><span className="small">.json · .csv · .md · .txt — máx. {Math.round(LIMITS.textBytes / 1e6)} MB</span>
          <input ref={fileRef} type="file" accept=".json,.csv,.md,.txt,application/json,text/csv,text/markdown,text/plain" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void fetchUrl() }}>
          <input className="grow" type="url" placeholder="https://github.com/usuario/repo/blob/main/preguntas.json" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" disabled={busy || !url}>{busy ? 'Descargando…' : 'Desde URL'}</button>
        </form>
        <label className="field"><span className="label">…o pega el contenido</span><textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"battlecert/1", "questions":[…]}' /></label>
        <button className="btn primary" disabled={!text.trim()} onClick={() => run(text)}>Validar</button>
      </section>

      <section className="panel" aria-live="polite">
        <h2>Resultado</h2>
        {!res && <p className="muted">Aquí verás cuántas preguntas son válidas y los errores, con un prompt para que la IA los corrija.</p>}
        {res?.error && <div className="warn">{res.error}</div>}
        {res?.pack && (
          <>
            <div className="okbox"><b>{res.pack.questions.length} preguntas válidas</b> en “{res.pack.name}” · {domains(res.pack).length} dominios · formato detectado: {res.kind}{res.dups ? ` · ${res.dups} duplicadas descartadas` : ''}</div>
            <div className="row" style={{ gap: 6 }}>{domains(res.pack).slice(0, 20).map((d) => <span key={d.name} className="chip">{d.name} <span className="mono muted">{d.count}</span></span>)}</div>
            <button className="btn big accent" onClick={save}>Guardar pack</button>
          </>
        )}
        {res && res.errors.length > 0 && (
          <>
            <div className="warn">{res.errors.length} preguntas con errores (se omiten).</div>
            <pre className="errors">{res.errors.slice(0, 60).join('\n')}</pre>
            <button className="btn" onClick={async () => S().say((await copy(fixPrompt(res.errors))) ? 'Prompt copiado. Pégalo en tu IA junto al JSON.' : 'No se pudo copiar.', 'ok')}>Copiar prompt para corregirlo con IA</button>
          </>
        )}
      </section>
    </div>
  )
}

function Ai() {
  const [kind, setKind] = useState<PromptKind>('pdf')
  const [topic, setTopic] = useState('')
  const [n, setN] = useState(40)
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const prompt = aiPrompt(kind, topic.trim() || 'Mi asignatura', n, lang)
  const kinds: [PromptKind, string, string][] = [
    ['pdf', 'Desde un PDF o apuntes', 'Extrae los conceptos 80/20 y crea preguntas sobre ellos.'],
    ['guide', 'Guía oficial de una cert', 'Reparte preguntas según el peso de cada dominio.'],
    ['syllabus', 'Temario de asignatura', 'Preguntas por tema.'],
    ['extend', 'Ampliar un pack', 'Preguntas nuevas sin repetir las tuyas.'],
  ]
  return (
    <div className="grid2">
      <section className="panel">
        <h2>Crea un pack con cualquier IA</h2>
        <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li>Elige qué tienes y copia el prompt.</li>
          <li>Pégalo en Claude, ChatGPT, Gemini… y adjunta el PDF, la guía o tus apuntes.</li>
          <li>Copia el JSON que te devuelva y pégalo en <b>Importar</b>. Si tiene errores, BattleCert te da otro prompt para corregirlos.</li>
        </ol>
        <div className="modes">
          {kinds.map(([k, t, d]) => <button key={k} className="mode" aria-pressed={kind === k} onClick={() => setKind(k)}><b>{t}</b><span>{d}</span></button>)}
        </div>
        <label className="field"><span className="label">Certificación o asignatura</span><input type="text" value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} placeholder="p. ej. AWS Cloud Practitioner, Bioquímica II…" /></label>
        <div className="row">
          <label className="field grow"><span className="label">Preguntas</span><input type="number" min={5} max={200} value={n} onChange={(e) => setN(Math.max(5, Math.min(200, Number(e.target.value) || 40)))} /></label>
          <div className="stack"><span className="label">Idioma</span><div className="seg"><button aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button><button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>Inglés</button></div></div>
        </div>
      </section>
      <section className="panel">
        <div className="row between"><h2>Prompt</h2><button className="btn accent" onClick={async () => S().say((await copy(prompt)) ? 'Prompt copiado.' : 'No se pudo copiar; selecciónalo a mano.', 'ok')}>Copiar</button></div>
        <pre className="prompt">{prompt}</pre>
        <p className="small muted">Las preguntas son originales: el prompt pide no copiar preguntas reales de examen. Revisa siempre lo que genere la IA.</p>
      </section>
    </div>
  )
}

function Format() {
  const json = JSON.stringify(TEMPLATE_JSON, null, 2)
  return (
    <div className="grid2">
      <section className="panel">
        <h2>Formato BattleCert</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li><code>stem</code>: el enunciado. <code>context</code> (opcional): un escenario o fragmento de código.</li>
          <li><code>options</code>: de 2 a 8 opciones.</li>
          <li><code>answer</code>: índices desde 0. Con varios, la pregunta es de respuesta múltiple.</li>
          <li><code>domain</code>: el tema o dominio, para filtrar y ver tus puntos débiles.</li>
          <li><code>explanation</code>: se muestra al revelar la respuesta.</li>
          <li>Límites: {LIMITS.questions} preguntas y {Math.round(LIMITS.textBytes / 1e6)} MB por pack.</li>
        </ul>
        <div className="row">
          <button className="btn" onClick={() => download('plantilla-battlecert.json', json)}>Descargar plantilla JSON</button>
          <button className="btn" onClick={() => download('plantilla-battlecert.csv', TEMPLATE_CSV, 'text/csv')}>Descargar plantilla CSV</button>
        </div>
      </section>
      <section className="panel"><h2>Ejemplo</h2><pre className="prompt">{json}</pre></section>
    </div>
  )
}
