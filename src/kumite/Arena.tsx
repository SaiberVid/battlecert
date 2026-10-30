import { useEffect } from 'react'
import type { PublicState } from '../core/types'
import { useStore } from '../store'
import { Stage } from './Stage'
import { KumiteHud } from './Hud'
import { music } from './audio'

/** HUD + fight scene for a KUMITE match. */
export function Arena({ P }: { P: PublicState }) {
  const k = P.kumite
  const soundOn = useStore((s) => s.sound && s.music)
  const live = P.phase !== 'lobby' && P.phase !== 'end'
  useEffect(() => { music(live && soundOn); return () => music(false) }, [live, soundOn])
  if (!k) return <p className="small muted">El combate necesita 2 jugadores.</p>
  const f = k.fighters.map((pid) => P.players.find((p) => p.pid === pid)?.fighter) as [string | undefined, string | undefined]
  const ready = k.fighters.map((pid) => P.phase === 'q' && !!P.ans[pid]) as [boolean, boolean]
  return (
    <section className="karena" aria-label="CERT KUMITE">
      <KumiteHud k={k} players={P.players} />
      <Stage k={k} fighters={f} ready={ready} over={P.phase === 'end'} />
    </section>
  )
}
