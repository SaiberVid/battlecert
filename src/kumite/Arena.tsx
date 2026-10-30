import type { PublicState } from '../core/types'
import { Stage } from './Stage'
import { KumiteHud } from './Hud'

/** HUD + fight scene for a KUMITE match. */
export function Arena({ P }: { P: PublicState }) {
  const k = P.kumite
  if (!k) return <p className="small muted">El combate necesita 2 jugadores.</p>
  const f = k.fighters.map((pid) => P.players.find((p) => p.pid === pid)?.fighter) as [string | undefined, string | undefined]
  const names = k.fighters.map((pid) => P.players.find((p) => p.pid === pid)?.nick ?? '') as [string, string]
  const ready = k.fighters.map((pid) => P.phase === 'q' && !!P.ans[pid]) as [boolean, boolean]
  return (
    <section className="karena" aria-label="CERT KUMITE">
      <KumiteHud k={k} players={P.players} />
      <Stage k={k} fighters={f} names={names} ready={ready} over={P.phase === 'end'} />
    </section>
  )
}
