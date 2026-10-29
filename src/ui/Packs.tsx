import { useRef, useState } from 'react'
import { LIMITS, TEMPLATE_CSV, TEMPLATE_JSON, TEMPLATE_MD, difficultyCounts, domains, fixPrompt, importText, type ImportResult } from '../core/packs'
import { Generate, StudySheet } from './Generate'
import type { Pack } from '../core/types'
import { saveCustomPacks, updateSettings, useStore, S } from '../store'
import { copy } from './common'

type Tab = 'mine' | 'import' | 'ai' | 'format'

export function Packs() {
  const [tab, setTab] = useState<Tab>('mine')
  const set = useStore((s) => s.set)
  const tabs: [Tab, string][] = [['mine', 'Mis packs'], ['import', 'Importar'], ['ai', '✨ Crear con IA'], ['format', 'Formato']]
  return (
    <>
      <div className="row between">
        <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)' }}>Packs de preguntas</h1>
        <button className="btn" onClick={() => set({ view: 'home' })}>← Volver</button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'mine' && <Mine onImport={() => setTab('import')} onAi={() => setTab('ai')} />}
      {tab === 'import' && <Import done={() => setTab('mine')} />}
      {tab === 'ai' && <Generate toImport={() => setTab('import')} />}
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

function Mine({ onImport, onAi }: { onImport: () => void; onAi: () => void }) {
  const packs = useStore((s) => s.packs)
  const [open, setOpen] = useState<string | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
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
                {(() => { const d = difficultyCounts(p); return p.questions.some((q) => q.difficulty) ? <span className="small muted">🟢 {d[0]} · 🟡 {d[1]} · 🔴 {d[2]}{p.concepts ? ` · 🧠 ${p.concepts.length} conceptos` : ''}</span> : null })()}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => { updateSettings({ packId: p.id, packName: p.name, domains: [] }); useStore.setState({ view: 'home' }) }}>Jugar</button>
                {p.concepts && <button className="btn sm" onClick={() => setSheet(sheet === p.id ? null : p.id)} aria-expanded={sheet === p.id}>Ficha</button>}
                <button className="btn sm" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>Detalles</button>
                <button className="btn sm" onClick={() => download(p.id + '.json', JSON.stringify({ ...p, builtIn: undefined, format: 'battlecert/1' }, null, 1))}>Exportar</button>
                {!p.builtIn && <button className="btn sm danger" onClick={() => remove(p)}>Borrar</button>}
              </div>
            </div>
            {sheet === p.id && <StudySheet pack={p} />}
            {open === p.id && (
              <div className="stack small">
                <p className="muted">Fuente: {p.source}</p>
                <div className="row" style={{ gap: 6 }}>{doms.map((d) => <span key={d.name} className="chip">{d.name} <span className="mono muted">{d.count}</span></span>)}</div>
              </div>
            )}
          </section>
        )
      })}
      <div className="row"><button className="btn big accent grow" onClick={onAi}>✨ Crear un pack con IA</button><button className="btn big" onClick={onImport}>Importar</button></div>
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

function Format() {
  const json = JSON.stringify(TEMPLATE_JSON, null, 2)
  return (
    <div className="grid2">
      <section className="panel">
        <h2>Markdown: el más fácil de escribir</h2>
        <p className="small">Recomendado para tus propias preguntas y para los ejemplos que das a la IA. Se escribe en cualquier editor, se lee bien en GitHub y admite código.</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li><code># Título</code> al principio: nombre del pack.</li>
          <li><code>## </code> abre cada pregunta; debajo, el enunciado y, si hace falta, un bloque de código.</li>
          <li><code>- [ ]</code> opción incorrecta, <code>- [x]</code> correcta (varias = respuesta múltiple).</li>
          <li><code>&gt;</code> explicación.</li>
          <li>Opcionales: <code>dominio:</code>, <code>dificultad:</code> (fácil, media, difícil), <code>concepto:</code>.</li>
        </ul>
        <pre className="prompt">{TEMPLATE_MD}</pre>
        <button className="btn" onClick={() => download('plantilla-battlecert.md', TEMPLATE_MD, 'text/markdown')}>Descargar plantilla Markdown</button>
      </section>
      <section className="panel">
        <h2>JSON y CSV</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li><code>stem</code>: enunciado · <code>context</code>: escenario o código (opcional).</li>
          <li><code>options</code>: de 2 a 8 · <code>answer</code>: índices desde 0.</li>
          <li><code>domain</code>, <code>difficulty</code> (1–3), <code>concept</code>, <code>explanation</code>.</li>
          <li><code>concepts</code> (opcional): la ficha de repaso del pack.</li>
          <li>Límites: {LIMITS.questions} preguntas y {Math.round(LIMITS.textBytes / 1e6)} MB por pack.</li>
        </ul>
        <div className="row">
          <button className="btn" onClick={() => download('plantilla-battlecert.json', json)}>Plantilla JSON</button>
          <button className="btn" onClick={() => download('plantilla-battlecert.csv', TEMPLATE_CSV, 'text/csv')}>Plantilla CSV</button>
        </div>
        <pre className="prompt">{json}</pre>
      </section>
    </div>
  )
}
