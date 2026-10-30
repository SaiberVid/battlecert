import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as E from '../core/engine'
import { REACTIONS } from '../core/sanitize'
import type { PublicState } from '../core/types'
import { applySettings, choose, joinUrl, kick, kumiteNext, leave, myTurn, react, rematch, setBet, setFighter, skip, startMatch } from '../session'
import { Arena } from '../kumite/Arena'
import { FighterPicker, Portrait } from '../kumite/Hud'
import { ksfx } from '../kumite/audio'
import { FIGHTERS, fighterById } from '../kumite/roster'
import { useStore, S } from '../store'
import type { Stage } from '../net/transport'
import { sfx } from '../sound'
import { Settings } from './Settings'
import { Confetti, Count, Qr, Ring, SHAPES, colorOf, copy, fmtMs, useNow } from './common'

export function Room() {
  const P = useStore((s) => s.P)
  const role = useStore((s) => s.role)
  const code = useStore((s) => s.code)
  useSounds(P)
  if (!P) return <Connecting role={role} code={code} />
  if (P.phase === 'lobby') return <Lobby P={P} />
  if (P.phase === 'end') return P.kumite ? <KumiteEnd P={P} /> : <End P={P} />
  return <Play P={P} />
}

const STAGES: { key: Stage; text: string }[] = [
  { key: 'broker', text: 'Buscando la sala' },
  { key: 'direct', text: 'Abriendo conexión directa' },
  { key: 'relay', text: 'Probando la conexión alternativa (cifrada)' },
  { key: 'connected', text: 'Conectado, entrando…' },
]

function Connecting({ role, code }: { role: string | null; code: string | null }) {
  const stage = useStore((s) => s.stage)
  const [t0] = useState(() => Date.now())
  const now = useNow(500)
  const secs = Math.floor((now - t0) / 1000)
  const idx = STAGES.findIndex((x) => x.key === stage)
  return (
    <section className="panel codebox" aria-live="polite">
      <h2>{role === 'guest' ? 'Conectando con la sala…' : 'Abriendo la sala…'}</h2>
      <p className="mono code" style={{ fontSize: '2rem' }}>{code}</p>
      {role === 'guest' && (
        <ol className="stages">
          {STAGES.map((st, i) => (
            <li key={st.key} className={i < idx ? 'done' : i === idx ? 'now' : ''}>{i < idx ? '✓' : i === idx ? '…' : '·'} {st.text}</li>
          ))}
        </ol>
      )}
      <p className="muted small">{secs > 8 ? 'Tu red no deja conectar directamente; probando la vía alternativa. Puede tardar hasta 25 s.' : 'Suele tardar 2–5 segundos.'}</p>
      <button className="btn" onClick={leave}>Cancelar</button>
    </section>
  )
}

function NetStatus() {
  const role = useStore((s) => s.role)
  const net = useStore((s) => s.net)
  const via = useStore((s) => s.via)
  if (role === 'guest') return <p className="small muted"><span className="dot on" /> Conectado {via === 'relay' ? 'por la vía alternativa cifrada' : 'directamente'}</p>
  if (!net) return null
  return (
    <p className="small muted row" style={{ gap: 12, justifyContent: 'center' }}>
      <span><span className={'dot' + (net.direct ? ' on' : '')} /> Directa</span>
      <span><span className={'dot' + (net.relay ? ' on' : '')} /> Alternativa cifrada</span>
    </p>
  )
}

function useSounds(P: PublicState | null) {
  const prev = useRef<{ phase?: string; i?: number; players?: number }>({})
  const myPid = useStore((s) => s.myPid)
  useEffect(() => {
    if (!P) return
    const p = prev.current
    if (P.phase === 'lobby' && p.players !== undefined && P.players.length > p.players) sfx.join()
    if (P.phase !== p.phase || P.i !== p.i) {
      if (P.phase === 'steal') sfx.steal()
      if (P.phase === 'reveal' && myPid && P.settings.mode !== 'kumite') {
        const a = P.ans[myPid]
        if (a && 'ok' in a) { if (a.ok) sfx.correct(P.sc[myPid]?.streak || 1); else sfx.wrong() }
      }
      if (P.phase === 'end' && myPid && P.kumite) {
        const won = P.kumite.winner !== null && P.kumite.fighters[P.kumite.winner] === myPid
        setTimeout(() => (won ? ksfx.win : ksfx.lose)(), 1700)
      } else if (P.phase === 'end' && myPid) {
        const st = E.standings(P)
        const won = st.length < 2 ? (st[0]?.ok || 0) / Math.max(1, st[0]?.n || 1) >= .7 : st[0]?.pid === myPid && st[0].pts !== st[1]?.pts
        if (won) sfx.fanfare(); else sfx.lose()
      }
    }
    prev.current = { phase: P.phase, i: P.i, players: P.players.length }
  }, [P, myPid])
}

// ---------------------------------------------------------------- lobby
function Lobby({ P }: { P: PublicState }) {
  const role = useStore((s) => s.role)
  const pin = useStore((s) => s.pin)
  const secret = useStore((s) => s.secret)
  const myPid = useStore((s) => s.myPid)
  const host = role === 'host'
  const url = joinUrl(P.code, pin, secret)
  const share = async () => {
    const data = { title: 'BattleCert', text: `¡Te reto en BattleCert! Sala ${P.code}${pin ? ' (PIN ' + pin + ')' : ''}`, url }
    try { if (navigator.share) { await navigator.share(data); return } } catch { return }
    S().say((await copy(url)) ? 'Enlace copiado.' : 'No se pudo copiar el enlace.', 'ok')
  }
  const wa = 'https://wa.me/?text=' + encodeURIComponent(`¡Te reto en BattleCert! Entra aquí: ${url}`)

  return (
    <div className="grid2">
      <div className="stack" style={{ gap: 16 }}>
        <section className="panel codebox hero" aria-labelledby="code-h">
          <span className="label" id="code-h">{host ? 'Invita a tus amigos' : 'Estás dentro de la sala'}</span>
          <div className="code" aria-label={'Código ' + P.code.split('').join(' ')}>{P.code}</div>
          {pin && <span className="chip">🔒 PIN <b className="mono">{pin}</b></span>}
          {host && <Qr text={url} label={'Código QR para unirse a la sala ' + P.code} />}
          {host && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn accent" onClick={() => void share()}>Compartir enlace</button>
              <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <button className="btn" onClick={async () => S().say((await copy(url)) ? 'Enlace copiado.' : 'No se pudo copiar.', 'ok')}>Copiar</button>
            </div>
          )}
          {host && <p className="small"><b>Mantén esta pestaña abierta y en primer plano</b>: la sala vive en tu navegador. En el móvil, si cambias de app la sala se pausa; vuelve aquí antes de que entren.</p>}
          {host && <p className="small muted">Invita con el enlace o el QR: incluyen la conexión alternativa para redes que no permiten la directa (datos móviles, Wi-Fi de empresa). Con solo el código, esa vía no está disponible.</p>}
          <NetStatus />
        </section>

        <section className="panel" aria-labelledby="pl-h">
          <div className="row between"><h2 id="pl-h">Jugadores</h2><span className="mono muted">{P.players.length}/8</span></div>
          <div className="players">
            <AnimatePresence>
              {P.players.map((p, i) => (
                <motion.div key={p.pid} layout className={'pl' + (p.online ? '' : ' off')} style={{ ['--c' as string]: colorOf(i) }} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }}>
                  <span className="em" aria-hidden="true">{p.avatar}</span>
                  <span className="nick">{p.nick}{p.pid === myPid ? ' (tú)' : ''}</span>
                  {host && p.pid !== myPid && <button className="x" onClick={() => kick(p.pid)} aria-label={'Expulsar a ' + p.nick} title="Expulsar">✕</button>}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {P.players.length < 2 && <p className="small muted">Esperando a que entre alguien…</p>}
        </section>
        {P.settings.mode === 'kumite' && <LobbyFighters P={P} />}
      </div>

      <section className="panel" aria-labelledby="set-h">
        <h2 id="set-h">{host ? 'Ajustes de la partida' : 'Partida'}</h2>
        {host ? <Settings compact onChange={applySettings} /> : <Summary P={P} />}
        <div className="row">
          {host && <button className="btn big accent grow" onClick={() => { sfx.tap(); startMatch() }}>{P.players.length < 2 ? 'Empezar (solo tú)' : `Empezar con ${P.players.length}`}</button>}
          {!host && <p className="muted grow">Esperando a que el anfitrión empiece…</p>}
          <button className="btn" onClick={() => { if (!host || confirm('¿Cerrar la sala? Los demás se desconectarán.')) leave() }}>Salir</button>
        </div>
      </section>
    </div>
  )
}

function LobbyFighters({ P }: { P: PublicState }) {
  const fighter = useStore((s) => s.fighter)
  const myPid = useStore((s) => s.myPid)
  const fighters = P.players.filter((p) => p.online).slice(0, 2)
  return (
    <section className="panel" aria-labelledby="kf-h">
      <h2 id="kf-h">🥋 Elige tu luchador</h2>
      <div className="kvs">
        {[0, 1].map((i) => {
          const p = fighters[i]
          const f = fighterById(p?.fighter)
          return (
            <div key={i} className={'kvs-side' + (i ? ' r' : '')} style={{ ['--c' as string]: f.color }}>
              {p ? <Portrait f={f} size={72} flip={i === 1} /> : <span className="kport empty" />}
              <b>{p ? p.nick + (p.pid === myPid ? ' (tú)' : '') : 'Esperando rival…'}</b>
              {p && <span className="small muted">{f.name}</span>}
            </div>
          )
        })}
        <span className="kvs-x" aria-hidden="true">VS</span>
      </div>
      {P.players.filter((p) => p.online).length > 2 && <p className="small muted">Pelean los 2 primeros jugadores; el resto mira el combate.</p>}
      <FighterPicker value={fighter} onPick={setFighter} taken={P.players.map((p) => p.fighter ?? '')} />
      <p className="small muted">{FIGHTERS.length} luchadores. Cada acierto empuja al rival; si aciertan los dos, chocan y nadie se mueve.</p>
    </section>
  )
}

function Summary({ P }: { P: PublicState }) {
  const m = E.MODES[P.settings.mode]
  return (
    <div className="stack">
      <div className="row"><span className="chip">📦 {P.settings.packName}</span><span className="chip">🎮 {m.name}</span><span className="chip">❓ {P.settings.n}</span><span className="chip">⏱ {P.settings.secs} s</span>{P.settings.diff && P.settings.diff !== 'mix' && <span className="chip">📶 {{ ladder: 'Escalera', easy: 'Fáciles', medium: 'Medias', hard: 'Difíciles', mix: '' }[P.settings.diff]}</span>}</div>
      <p className="muted">{m.desc}</p>
      {P.settings.domains.length > 0 && <p className="small muted">Dominios: {P.settings.domains.join(', ')}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- play
function Play({ P }: { P: PublicState }) {
  const local = useStore((s) => s.local)
  const myPid = useStore((s) => s.myPid)
  const role = useStore((s) => s.role)
  const now = useNow(100)
  const left = Math.max(0, local.deadline - now)
  const q = P.q
  const mode = P.settings.mode
  const steal = P.phase === 'steal'
  const reveal = P.phase === 'reveal'
  const canAnswer = myTurn()
  const lastSec = useRef(-1)

  // urgent ticks in the last 5 seconds
  useEffect(() => {
    if (P.phase !== 'q' && P.phase !== 'steal') return
    const s = Math.ceil(left / 1000)
    if (s !== lastSec.current && s <= 5 && s > 0) sfx.tick(s <= 3)
    lastSec.current = s
  }, [left, P.phase])

  // keyboard: 1–8 or A–H
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!q || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key.toLowerCase()
      const idx = '12345678'.indexOf(k) >= 0 ? '12345678'.indexOf(k) : 'abcdefgh'.indexOf(k)
      if (idx >= 0 && idx < q.options.length) choose(q.options[idx].k)
      if ((k === 'enter' || k === ' ') && reveal && role !== 'guest') skip()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [q, reveal, role])

  if (P.phase === 'countdown') return <>{mode === 'kumite' && <Arena P={P} />}<Countdown P={P} left={left} /></>
  if (!q) return null
  const total = steal ? E.STEAL_MS : P.settings.secs * 1000
  const activeIdx = P.players.findIndex((p) => p.pid === P.active)
  const active = P.players[activeIdx]
  const mine = myPid ? P.ans[myPid] : undefined
  const myAns = mine && 'c' in mine ? mine : undefined
  const sc = myPid ? P.sc[myPid] : undefined
  const out = mode === 'survival' && sc?.out

  const kumite = mode === 'kumite'
  return (
    <div className={'stage' + (kumite ? ' kumite' : '')}>
      {kumite && <div className="kfight"><Arena P={P} /></div>}
      <div className="stack qcol" style={{ gap: 12 }}>
        <div className="hud">
          <Ring left={left} total={reveal ? (mode === 'kumite' ? E.KUMITE_REVEAL_MS : E.REVEAL_MS) : total} calm={reveal} />
          <div className="meta">
            <div className="row between small"><span className="label">{kumite ? `Asalto ${P.i + 1}` : `Pregunta ${P.i + 1}`}{mode === 'survival' || kumite ? '' : ' de ' + P.total}</span><span className="label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{q.domain}</span></div>
            <div className="progress" aria-hidden="true"><i style={{ width: `${((P.i + (reveal ? 1 : 0)) / Math.max(1, P.total)) * 100}%` }} /></div>
            <div className="row small" style={{ gap: 8 }}>
              <span className="chip">{E.MODES[mode].name}</span>
              {q.difficulty && <span className={'diff d' + q.difficulty}>{['Fácil', 'Media', 'Difícil'][q.difficulty - 1]}</span>}
              {mode === 'survival' && sc && <span className="chip lives" aria-label={`${sc.lives} vidas`}>{'❤️'.repeat(Math.max(0, sc.lives))}{'🖤'.repeat(Math.max(0, E.LIVES - sc.lives))}</span>}
              {sc && sc.streak >= 2 && <span className="chip streak">🔥 racha {sc.streak}</span>}
            </div>
          </div>
        </div>

        {(mode === 'turns' || steal) && active && !reveal && (
          <div className="banner" style={{ ['--c' as string]: colorOf(activeIdx) }} role="status">
            {steal ? '⚡ ¡Robo! ' : ''}{active.pid === myPid ? (steal ? 'Puedes robar: responde en 10 s' : 'Te toca a ti') : `Turno de ${active.avatar} ${active.nick}`}
          </div>
        )}

        <motion.section key={q.id + P.phase} className="panel qcard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>
          <p className="qtext">{q.stem}</p>
          {q.context && <div className="ctx">{q.context}</div>}
          {q.need > 1 && <span className="need">☑ Elige {q.need}</span>}
        </motion.section>

        {mode === 'wager' && !reveal && canAnswer && (
          <div className="bets" role="group" aria-label="Apuesta">
            <span className="label">Apuesta</span>
            {[1, 2, 3].map((b) => <button key={b} className="btn sm" aria-pressed={local.bet === b} onClick={() => { sfx.tap(); setBet(b) }}>×{b}</button>)}
            <span className="small muted">{local.bet === 1 ? '±100' : local.bet === 2 ? '±200' : '±300'}</span>
          </div>
        )}

        <div className="opts" role="group" aria-label="Opciones">
          {q.options.map((o, idx) => {
            const right = reveal && q.answer?.includes(o.k)
            const picked = reveal ? !!myAns?.c.includes(o.k) : local.chosen.includes(o.k)
            const cls = ['opt', picked ? 'sel' : '', reveal ? (right ? 'right' : picked ? 'wrong' : 'dim') : (!canAnswer && !picked ? 'dim' : '')].join(' ')
            return (
              <motion.button key={o.k} className={cls} disabled={reveal || !canAnswer} onClick={() => { sfx.lock(); choose(o.k) }} aria-pressed={picked}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reveal ? 0 : idx * .04 }}>
                <span className="shape" aria-hidden="true">{SHAPES[idx]}</span>
                <span className="t">{o.t}</span>
                {reveal && right && <span className="mark2" aria-label="Correcta">✓</span>}
                {reveal && picked && !right && <span className="mark2" aria-label="Tu respuesta, incorrecta">✗</span>}
                {!reveal && <kbd aria-hidden="true">{idx + 1}</kbd>}
              </motion.button>
            )
          })}
        </div>

        {!reveal && <Status P={P} canAnswer={canAnswer} out={!!out} />}
        {reveal && <Reveal P={P} left={left} />}
      </div>
      {!kumite && <Board P={P} />}
    </div>
  )
}

function Status({ P, canAnswer, out }: { P: PublicState; canAnswer: boolean; out: boolean }) {
  const myPid = useStore((s) => s.myPid)
  const local = useStore((s) => s.local)
  const done = Object.keys(P.ans).length
  const need = P.q?.need || 1
  let text = ''
  if (out) text = '💀 Estás eliminado. Mira cómo acaba.'
  else if (canAnswer) text = need > 1 && local.chosen.length ? `Elegidas ${local.chosen.length} de ${need}` : ''
  else if (myPid && (P.ans[myPid] || local.sent)) text = '🔒 Respuesta enviada. Esperando al resto…'
  else text = 'Mira y aprende: no es tu turno.'
  return (
    <div className="row between small muted" aria-live="polite">
      <span>{text}</span>
      <span className="mono">{done}/{P.players.filter((p) => p.online).length} han respondido</span>
    </div>
  )
}

function Reveal({ P, left }: { P: PublicState; left: number }) {
  const myPid = useStore((s) => s.myPid)
  const role = useStore((s) => s.role)
  const a = myPid ? P.ans[myPid] : undefined
  const full = a && 'ok' in a ? a : undefined
  const isTurn = P.settings.mode === 'turns'
  const kind = full ? (full.ok ? 'ok' : 'bad') : 'none'
  const title = full ? (full.ok ? (full.st ? '¡Robo conseguido!' : '¡Correcto!') : 'Fallaste') : isTurn ? 'Resultado' : 'Sin respuesta'
  return (
    <motion.div className="stack" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className={'result ' + kind} role="status">
        <span aria-hidden="true">{kind === 'ok' ? '🎉' : kind === 'bad' ? '😬' : '⏱'}</span>
        <span>{title}{full?.ok && full.ms ? <span className="small" style={{ fontWeight: 400 }}> en {fmtMs(full.ms)}</span> : null}</span>
        {full && <span className="pts">{full.pts >= 0 ? '+' : ''}{full.pts}</span>}
      </div>
      {isTurn && <OthersLine P={P} />}
      {P.kumite && <KumiteLine P={P} />}
      {P.q?.explanation && <div className="explain"><span className="label">Por qué</span><br />{P.q.explanation}</div>}
      <div className="row between">
        <div className="reactbar" role="group" aria-label="Reacciones">
          {REACTIONS.map((e) => <button key={e} onClick={() => react(e)} aria-label={'Reaccionar ' + e}>{e}</button>)}
        </div>
        <div className="row">
          <span className="small muted mono">Siguiente en {Math.ceil(left / 1000)} s</span>
          {role !== 'guest' && <button className="btn primary" onClick={skip}>Siguiente →</button>}
        </div>
      </div>
    </motion.div>
  )
}

function KumiteLine({ P }: { P: PublicState }) {
  const myPid = useStore((s) => s.myPid)
  const k = P.kumite!
  return (
    <div className="kline" role="status">
      {k.fighters.map((pid) => {
        const p = P.players.find((x) => x.pid === pid)
        const a = P.ans[pid]
        const res = a && 'ok' in a ? (a.ok ? 'ok' : 'bad') : 'none'
        return <span key={pid} className={'kl ' + res}>{res === 'ok' ? '✓' : '✗'} <b>{p?.nick ?? '—'}{pid === myPid ? ' (tú)' : ''}</b> {res === 'ok' ? 'acierta' : res === 'bad' ? 'falla' : 'no responde'}</span>
      })}
    </div>
  )
}

function OthersLine({ P }: { P: PublicState }) {
  const parts = P.players.map((p) => { const a = P.ans[p.pid]; return a && 'ok' in a ? `${p.avatar} ${p.nick}: ${a.ok ? '✓' : '✗'} ${a.pts >= 0 ? '+' : ''}${a.pts}` : null }).filter(Boolean)
  return parts.length ? <p className="small muted">{parts.join(' · ')}</p> : null
}

function Board({ P }: { P: PublicState }) {
  const myPid = useStore((s) => s.myPid)
  const st = E.standings(P)
  const reveal = P.phase === 'reveal'
  return (
    <aside className="board" aria-label="Marcador">
      {st.map((p, rank) => {
        const idx = P.players.findIndex((x) => x.pid === p.pid)
        const a = P.ans[p.pid]
        const flag = reveal && a && 'ok' in a ? (a.ok ? '✓' : '✗') : a ? '✓' : ''
        return (
          <motion.div layout key={p.pid} className={['score', p.pid === P.active && !reveal ? 'turn' : '', p.out ? 'out' : '', p.pid === myPid ? 'me' : ''].join(' ')} style={{ ['--c' as string]: colorOf(idx) }}>
            <span className="mono small muted">{rank + 1}</span>
            <span className="em" aria-hidden="true">{p.avatar}</span>
            <div className="who">
              <span className="nick">{p.nick}{!p.online ? ' · desconectado' : ''}</span>
              <span className="n"><Count value={p.pts} /></span>
              {P.settings.mode === 'survival' ? <span className="small">{p.out ? '💀 fuera' : '❤️'.repeat(Math.max(0, p.lives))}</span> : p.streak >= 2 ? <span className="streak">🔥 {p.streak}</span> : null}
            </div>
            {flag && <span className="flag" style={{ color: flag === '✗' ? 'var(--bad)' : 'var(--ok)' }}>{flag}</span>}
          </motion.div>
        )
      })}
    </aside>
  )
}

function Countdown({ P, left }: { P: PublicState; left: number }) {
  const n = Math.ceil(left / 1000)
  const last = useRef(-1)
  const kumite = P.settings.mode === 'kumite'
  useEffect(() => { if (n !== last.current && n >= 1 && n <= 3) (kumite ? ksfx.count : sfx.count)(n); last.current = n }, [n, kumite])
  useEffect(() => () => { if (kumite) ksfx.count(0) }, [kumite])
  return (
    <div className="overlay" role="status" aria-live="assertive">
      <div className="stack" style={{ alignItems: 'center' }}>
        <AnimatePresence mode="popLayout">
          <motion.div key={n} className="countnum" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .6, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>{Math.max(1, n)}</motion.div>
        </AnimatePresence>
        <p className="countsub">{P.i < 0 ? `${E.MODES[P.settings.mode].name} · ${P.settings.packName}` : 'Preparados…'}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- end
function KumiteEnd({ P }: { P: PublicState }) {
  const role = useStore((s) => s.role)
  const myPid = useStore((s) => s.myPid)
  const tour = useStore((s) => s.tour)
  const k = P.kumite!
  const w = k.winner
  const wp = w !== null ? P.players.find((p) => p.pid === k.fighters[w]) : undefined
  const iWon = !!wp && wp.pid === myPid
  const ko = k.last.ko !== undefined
  const champion = role === 'solo' && tour && iWon && tour.stage >= tour.order.length - 1
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Arena P={P} />
      <section className="panel" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="label">{ko ? 'K.O.' : 'Fin del combate'}{tour ? ` · Torneo ${Math.min(tour.stage + 1, tour.order.length)}/${tour.order.length}` : ''}</span>
        <h1>{champion ? '🏆 ¡Campeón del torneo!' : !wp ? '¡Empate!' : iWon ? '¡Victoria!' : `${wp.nick} gana`}</h1>
        <p className="muted">{ko ? (wp ? `${wp.nick} echa a su rival de la plataforma.` : '') : 'Se acabaron las preguntas: gana quien más terreno había ganado.'} Mejor racha: {k.best[0]} – {k.best[1]}.</p>
        {tour && (
          <div className="ladder" aria-label="Rivales del torneo">
            {tour.order.map((id, i) => (
              <span key={id} className={'rung' + (i < tour.stage || (i === tour.stage && iWon) ? ' done' : i === tour.stage ? ' now' : '')} title={fighterById(id).name}>
                <Portrait f={fighterById(id)} size={40} />
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          {role === 'solo' && tour && <button className="btn big accent" onClick={kumiteNext}>{champion ? 'Nuevo torneo' : iWon ? 'Siguiente rival →' : 'Reintentar'}</button>}
          {role === 'host' && <button className="btn big accent" onClick={rematch}>Revancha</button>}
          {role === 'guest' && <span className="muted small">El anfitrión puede lanzar la revancha.</span>}
          <button className="btn" onClick={leave}>Salir</button>
        </div>
      </section>
      <End P={P} compact />
    </div>
  )
}

function End({ P, compact = false }: { P: PublicState; compact?: boolean }) {
  const myPid = useStore((s) => s.myPid)
  const role = useStore((s) => s.role)
  const myLog = useStore((s) => s.myLog)
  const [fire] = useState(() => Date.now())
  const st = E.standings(P)
  const solo = st.length < 2
  const tie = !solo && st[0].pts === st[1].pts && (P.settings.mode !== 'survival' || st[0].lives === st[1].lives)
  const me = st.find((p) => p.pid === myPid)
  const podium = [st[1], st[0], st[2]].filter(Boolean)
  const heights = (p: (typeof st)[number]) => (p === st[0] || (tie && p === st[1]) ? 120 : p === st[1] ? 90 : 64)
  const doms = me ? Object.entries(me.dom).map(([d, [ok, n]]) => ({ d, ok, n, r: ok / Math.max(1, n) })).sort((a, b) => a.r - b.r) : []
  const shareText = () => `BattleCert · ${P.settings.packName} · ${E.MODES[P.settings.mode].name}\n` + st.map((p, i) => `${i + 1}. ${p.avatar} ${p.nick} — ${p.pts} pts (${p.ok}/${p.n})`).join('\n')

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!compact && <><Confetti fire={fire} />
      <section className="panel" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="label">Fin de la partida{P.round > 1 ? ` · ronda ${P.round}` : ''}</span>
        <h1>{solo ? (me && me.ok / Math.max(1, me.n) >= .7 ? '¡Buen trabajo!' : 'Sigue practicando') : tie ? '¡Empate!' : `${st[0].avatar} ${st[0].nick} gana`}</h1>
        {solo && me && <p className="muted">{me.ok} de {me.n} correctas · {me.pts} puntos · mejor racha {me.best}</p>}
        {!solo && (
          <div className="podium" aria-label="Podio">
            {podium.map((p) => {
              const idx = P.players.findIndex((x) => x.pid === p.pid)
              return (
                <motion.div key={p.pid} className="step" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: p === st[0] ? .5 : p === st[1] ? .25 : 0 }}>
                  <span className="em" aria-hidden="true">{p === st[0] && !tie ? '👑' : ''}{p.avatar}</span>
                  <span className="nick">{p.nick}</span>
                  <div className="bar" style={{ ['--c' as string]: colorOf(idx), height: heights(p) }}>{tie && p === st[1] ? 1 : st.indexOf(p) + 1}</div>
                </motion.div>
              )
            })}
          </div>
        )}
        {Object.keys(P.series).length > 0 && P.round > 1 && (
          <p className="small muted">Serie: {Object.entries(P.series).map(([k, v]) => `${P.players.find((p) => p.nick.toLowerCase() === k)?.nick ?? k} ${v}`).join(' · ')}</p>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          {role !== 'guest' && <button className="btn big accent" onClick={rematch}>Revancha</button>}
          {role === 'guest' && <span className="muted small">El anfitrión puede lanzar la revancha.</span>}
          <button className="btn" onClick={async () => S().say((await copy(shareText())) ? 'Resultado copiado.' : 'No se pudo copiar.', 'ok')}>Copiar resultado</button>
          <button className="btn" onClick={leave}>Salir</button>
        </div>
      </section>
</>}
      <div className="grid2">
        <section className="panel">
          <h2>Clasificación</h2>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>#</th><th>Jugador</th><th className="r">Puntos</th><th className="r">Aciertos</th><th className="r">Media</th><th className="r">Racha</th>{P.settings.mode === 'turns' && <th className="r">Robos</th>}</tr></thead>
              <tbody>
                {st.map((p, i) => (
                  <tr key={p.pid}>
                    <td className="mono">{i + 1}</td>
                    <td>{p.avatar} {p.nick}{p.pid === myPid ? ' (tú)' : ''}</td>
                    <td className="r mono"><b>{p.pts}</b></td>
                    <td className="r mono">{p.ok}/{p.n}</td>
                    <td className="r mono">{p.n ? fmtMs(p.ms / p.n) : '—'}</td>
                    <td className="r mono">{p.best}</td>
                    {P.settings.mode === 'turns' && <td className="r mono">{p.stl}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {doms.length > 0 && (
            <div className="stack">
              <span className="label">Tus dominios (de peor a mejor)</span>
              {doms.slice(0, 8).map((d) => (
                <div key={d.d} className="stack" style={{ gap: 3 }}>
                  <div className="row between small"><span>{d.d}</span><span className="mono">{d.ok}/{d.n}</span></div>
                  <div className="progress"><i style={{ width: `${d.r * 100}%`, background: d.r < .5 ? 'var(--bad)' : d.r < .8 ? 'var(--warn)' : 'var(--ok)' }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>

        {P.review && P.review.length > 0 && (
          <section className="panel">
            <h2>Repaso</h2>
            <div className="review">
              {P.review.map((r, i) => {
                const l = myLog[r.id]
                return (
                  <details key={r.id}>
                    <summary><span aria-label={l ? (l.ok ? 'Acertada' : 'Fallada') : 'Sin datos'}>{l ? (l.ok ? '✅' : '❌') : '▫️'}</span><span><b className="mono small">{i + 1}.</b> {r.stem.length > 140 ? r.stem.slice(0, 140) + '…' : r.stem}</span></summary>
                    <p className="small" style={{ marginTop: 8 }}><span className="label">{r.domain}</span><br />Correcta: <b>{r.correct.join(' · ')}</b></p>
                  </details>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
