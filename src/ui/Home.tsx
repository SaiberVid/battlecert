import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AVATARS, cleanNick } from '../core/sanitize'
import { isCode } from '../net/protocol'
import { MODES } from '../core/engine'
import { createRoom, join } from '../session'
import { storage, useStore } from '../store'
import { unlockAudio, sfx } from '../sound'
import { Settings } from './Settings'
import { fmtMs } from './common'

function readHash(): { code: string; pin: string | null } | null {
  const h = new URLSearchParams(location.hash.slice(1))
  const code = (h.get('j') || '').toLowerCase()
  if (!isCode(code)) return null
  const pin = h.get('p')
  return { code, pin: pin && /^\d{4}$/.test(pin) ? pin : null }
}

export function Profile() {
  const nick = useStore((s) => s.nick)
  const avatar = useStore((s) => s.avatar)
  const set = useStore((s) => s.set)
  return (
    <section className="panel" aria-labelledby="me-h">
      <h2 id="me-h">Tu jugador</h2>
      <label className="field">
        <span className="label">Alias</span>
        <input type="text" value={nick} maxLength={20} autoComplete="nickname" placeholder="Cómo te verán los demás" onChange={(e) => set({ nick: e.target.value })} onBlur={() => storage.set('nick', cleanNick(nick))} />
      </label>
      <div className="avatars" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((a) => (
          <button key={a} className="av" role="radio" aria-checked={a === avatar} aria-pressed={a === avatar} onClick={() => { set({ avatar: a }); storage.set('avatar', a); sfx.tap() }}>{a}</button>
        ))}
      </div>
    </section>
  )
}

export function Home() {
  const [invite, setInvite] = useState(readHash)
  const [code, setCode] = useState(invite?.code || '')
  const [busy, setBusy] = useState(false)
  const usePin = useStore((s) => s.usePin)
  const set = useStore((s) => s.set)
  const history = useStore((s) => s.history)

  useEffect(() => {
    const on = () => { const i = readHash(); setInvite(i); if (i) setCode(i.code) }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  const doJoin = async () => {
    unlockAudio()
    const c = code.trim().toLowerCase()
    if (!isCode(c)) return useStore.getState().say('El código tiene 6 caracteres (letras y números).')
    setBusy(true)
    await join(c, invite?.code === c ? invite.pin : null)
    setBusy(false)
  }
  const doCreate = async (solo: boolean) => { unlockAudio(); setBusy(true); await createRoom(solo); setBusy(false) }

  return (
    <>
      <motion.div className="hero-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Estudia compitiendo. <em>En directo.</em></h1>
        <p>Crea una sala, comparte el QR y responde tests contra tus amigos, de cualquier certificación o asignatura. Gratis, sin cuentas y sin servidores: la partida vive en tu navegador.</p>
      </motion.div>

      {invite && (
        <section className="panel hero" aria-labelledby="inv-h">
          <h2 id="inv-h">Te han invitado a la sala <span className="mono">{invite.code}</span></h2>
          <p className="muted">Escribe tu alias, elige avatar y entra.</p>
        </section>
      )}

      <div className="grid2">
        <div className="stack" style={{ gap: 16 }}>
          <Profile />
          <section className="panel" aria-labelledby="join-h">
            <h2 id="join-h">Unirse a una sala</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void doJoin() }}>
              <label className="sr" htmlFor="code">Código de sala</label>
              <input id="code" className="codein grow" type="text" inputMode="text" autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={6} placeholder="código" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} />
              <button className={'btn big ' + (invite ? 'accent' : 'primary')} disabled={busy || code.length !== 6}>Entrar</button>
            </form>
            <p className="small muted">¿Tienes un QR? Escanéalo con la cámara y se abrirá aquí con el código puesto.</p>
          </section>
        </div>

        <section className="panel" aria-labelledby="new-h">
          <h2 id="new-h">Crear partida</h2>
          <Settings />
          <label className="switch"><input type="checkbox" checked={usePin} onChange={(e) => { set({ usePin: e.target.checked }); storage.set('usePin', e.target.checked) }} /> <span>Proteger la sala con PIN <span className="muted small">(va incluido en el QR y el enlace)</span></span></label>
          <div className="row">
            <button className="btn big accent grow" disabled={busy} onClick={() => void doCreate(false)}>Crear sala</button>
            <button className="btn big" disabled={busy} onClick={() => void doCreate(true)}>Practicar solo</button>
          </div>
        </section>
      </div>

      {history.length > 0 && <History />}
    </>
  )
}

function History() {
  const history = useStore((s) => s.history)
  const [all, setAll] = useState(false)
  const list = all ? history : history.slice(0, 6)
  const wins = history.filter((h) => !h.solo && h.winner && h.winner.toLowerCase() === h.me.toLowerCase()).length
  const duels = history.filter((h) => !h.solo).length
  const mine = history.map((h) => h.players.find((p) => p.nick.toLowerCase() === h.me.toLowerCase())).filter((p) => !!p)
  const acc = mine.reduce((a, p) => a + p.ok, 0) / Math.max(1, mine.reduce((a, p) => a + p.n, 0))
  return (
    <section className="panel" aria-labelledby="hist-h">
      <div className="row between">
        <h2 id="hist-h">Tu historial</h2>
        <div className="row small muted"><span>{duels} partidas · {wins} victorias</span><span>· {Math.round(acc * 100)} % aciertos</span></div>
      </div>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Fecha</th><th>Pack</th><th>Modo</th><th>Resultado</th><th className="r">Tú</th></tr></thead>
          <tbody>
            {list.map((h) => {
              const me = h.players.find((p) => p.nick.toLowerCase() === h.me.toLowerCase())
              const res = h.solo ? 'Solo' : !h.winner ? 'Empate' : h.winner.toLowerCase() === h.me.toLowerCase() ? '🏆 Victoria' : 'Ganó ' + h.winner
              return (
                <tr key={h.at}>
                  <td className="mono small">{new Date(h.at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</td>
                  <td>{h.pack}</td>
                  <td>{MODES[h.mode as keyof typeof MODES]?.name ?? h.mode}</td>
                  <td>{res}</td>
                  <td className="r mono">{me ? `${me.ok}/${me.n} · ${me.pts} · ${fmtMs(me.ms / Math.max(1, me.n))}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {history.length > 6 && <button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver las ${history.length}`}</button>}
    </section>
  )
}
