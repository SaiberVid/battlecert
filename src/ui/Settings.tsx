import { MODES } from '../core/engine'
import { KUMITE_LENGTHS, type KumiteLength } from '../core/kumite'
import { difficultyCounts, domains, translatedCount } from '../core/packs'
import type { DiffMode, Mode } from '../core/types'
import { useStore, updateSettings } from '../store'

const MODE_ICON: Record<Mode, string> = { classic: '⚔️', turns: '🔁', blitz: '⚡', survival: '❤️', wager: '🎲', kumite: '🥋' }
const COUNTS = [5, 10, 15, 20, 30, 50]
const SPEEDS: { label: string; secs: number }[] = [{ label: 'Rayo 5 s', secs: 5 }, { label: 'Rápido 10 s', secs: 10 }, { label: 'Normal 20 s', secs: 20 }, { label: 'Calma 30 s', secs: 30 }, { label: 'Examen 60 s', secs: 60 }, { label: 'Lento 90 s', secs: 90 }]

/** Pack, mode, length, time and domains. `onChange` lets the lobby push changes to guests. */
export function Settings({ onChange, compact = false }: { onChange?: () => void; compact?: boolean }) {
  const packs = useStore((s) => s.packs)
  const st = useStore((s) => s.settings)
  const set = useStore((s) => s.set)
  const pack = packs.find((p) => p.id === st.packId) || packs[0]
  const doms = pack ? domains(pack) : []
  const upd = (p: Parameters<typeof updateSettings>[0]) => { updateSettings(p); onChange?.() }
  const pickMode = (mode: Mode) => upd({ mode, secs: MODES[mode].defaultSecs })

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack">
        <div className="row between"><span className="label">Pack de preguntas</span><button className="btn sm ghost" onClick={() => set({ view: 'packs' })}>Gestionar packs →</button></div>
        <div className="packpick" role="radiogroup" aria-label="Pack de preguntas">
          {packs.map((p) => (
            <button key={p.id} className="packrow" role="radio" aria-checked={p.id === pack?.id} aria-pressed={p.id === pack?.id} onClick={() => upd({ packId: p.id, packName: p.name, domains: [] })}>
              <span aria-hidden="true">{p.builtIn ? '📦' : '📝'}</span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="n">{p.questions.length} preg.</span>
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        <span className="label">Modo de juego</span>
        <div className="modes">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button key={m} className="mode" aria-pressed={st.mode === m} onClick={() => pickMode(m)}>
              <span className="ico" aria-hidden="true">{MODE_ICON[m]}</span>
              <b>{MODES[m].name}</b>
              {!compact && <span>{MODES[m].desc}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        {st.mode === 'kumite' ? (
          <div className="stack">
            <span className="label">Plataforma (cuánto dura el combate)</span>
            <div className="seg" role="group" aria-label="Plataforma">
              {(Object.keys(KUMITE_LENGTHS) as KumiteLength[]).map((k) => <button key={k} aria-pressed={(st.kLen ?? 'normal') === k} onClick={() => upd({ kLen: k })}>{KUMITE_LENGTHS[k].name}</button>)}
            </div>
          </div>
        ) : (
        <div className="stack">
          <span className="label">{st.mode === 'survival' ? 'Preguntas (hasta que quede uno)' : 'Preguntas'}</span>
          <div className="seg" role="group" aria-label="Número de preguntas">
            {COUNTS.map((n) => <button key={n} aria-pressed={st.n === n} onClick={() => upd({ n })}>{n}</button>)}
          </div>
        </div>
        )}
        <div className="stack">
          <label className="label" htmlFor="secs">Tiempo por pregunta: <b className="mono" style={{ color: 'var(--ink)' }}>{st.secs} s</b></label>
          <input id="secs" type="range" min={5} max={120} step={1} value={st.secs} onChange={(e) => upd({ secs: Number(e.target.value) })} />
          <div className="row" style={{ gap: 6 }}>
            {SPEEDS.map((s) => <button key={s.secs} className="tag" aria-pressed={st.secs === s.secs} onClick={() => upd({ secs: s.secs })}>{s.label}</button>)}
          </div>
        </div>
      </div>

      {pack && (() => {
        const es = translatedCount(pack, 'es'), en = translatedCount(pack, 'en')
        const n = pack.questions.length
        const cur = st.qlang === 'en' ? 'en' : 'es'
        if (!es && !en) return pack.lang !== 'es' ? <p className="small muted">Preguntas en {pack.lang.toUpperCase()}. Para jugarlas en español, tradúcelas en <b>Gestionar packs</b>.</p> : null
        return (
          <div className="stack">
            <span className="label">Idioma de las preguntas</span>
            <div className="seg" role="group" aria-label="Idioma de las preguntas">
              <button aria-pressed={cur === 'es'} onClick={() => upd({ qlang: 'es' })}>Español{pack.lang !== 'es' && es < n ? ` (${es}/${n})` : ''}</button>
              <button aria-pressed={cur === 'en'} onClick={() => upd({ qlang: 'en' })}>English{pack.lang !== 'en' && en < n ? ` (${en}/${n})` : ''}</button>
            </div>
            <span className="small muted">Los comandos y los nombres de herramientas se quedan en inglés, como en el examen.</span>
          </div>
        )
      })()}

      {pack && pack.questions.some((q) => q.difficulty) && (() => {
        const dc = difficultyCounts(pack)
        const opts: [DiffMode, string][] = [['mix', 'Rebujado'], ['ladder', 'Escalera ↗'], ['easy', `Fáciles · ${dc[0]}`], ['medium', `Medias · ${dc[1]}`], ['hard', `Difíciles · ${dc[2]}`]]
        return (
          <div className="stack">
            <span className="label">Dificultad{pack.blueprint ? ' · reparto por dominios como el examen real' : ''}</span>
            <div className="seg" role="group" aria-label="Dificultad">
              {opts.map(([k, l]) => <button key={k} aria-pressed={(st.diff ?? 'mix') === k} onClick={() => upd({ diff: k })}>{l}</button>)}
            </div>
          </div>
        )
      })()}

      {doms.length > 1 && (
        <div className="stack">
          <div className="row between"><span className="label">Dominios {st.domains.length ? `(${st.domains.length})` : '(todos)'}</span>{st.domains.length > 0 && <button className="btn sm ghost" onClick={() => upd({ domains: [] })}>Todos</button>}</div>
          <div className="row" style={{ gap: 6 }}>
            {doms.map((d) => {
              const on = st.domains.includes(d.name)
              return <button key={d.name} className="tag" aria-pressed={on} onClick={() => upd({ domains: on ? st.domains.filter((x) => x !== d.name) : [...st.domains, d.name] })}>{d.name} <span className="mono">· {d.count}</span></button>
            })}
          </div>
        </div>
      )}
    </div>
  )
}
