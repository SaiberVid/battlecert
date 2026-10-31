import type { PublicState } from '../core/types'
import { BOSSES, HERO_NAMES, RESCUE } from '../core/raid'
import { HERO_COLORS, HERO_IDS, RM, portraitIndex, rasset } from './assets'
import { RaidStage } from './Stage'

function RPortrait({ id, size = 48 }: { id: string; size?: number }) {
  const n = RM.portraits.order.length
  return <span className="rport" aria-hidden="true" style={{ width: size, height: size, backgroundImage: `url(${rasset('portraits.jpg')})`, backgroundSize: `${n * size}px ${size}px`, backgroundPosition: `-${portraitIndex(id) * size}px 0` }} />
}

function Hearts({ n, max, hero }: { n: number; max: number; hero: number }) {
  return (
    <span className="rhearts" aria-label={`${n} de ${max} corazones`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? 'on' : ''} style={{ backgroundImage: `url(${rasset('hearts.png')})`, backgroundPosition: hero === 0 ? '0 0' : '-41px 0' }} />)}
    </span>
  )
}

/** HUD + scene for a CERT RAID match. */
export function RaidArena({ P }: { P: PublicState }) {
  const r = P.raid
  if (!r) return <p className="small muted">El raid necesita al menos un jugador.</p>
  const boss = BOSSES[r.boss] ?? BOSSES[0]
  const heroes = r.party.map((pid) => P.players.find((p) => p.pid === pid))
  const names = heroes.map((p, i) => p?.nick ?? HERO_NAMES[i])
  const ready = r.party.map((pid) => P.phase === 'q' && !!P.ans[pid])
  const maxHearts = r.heroes === 1 ? 5 : 3
  const pct = Math.max(0, (r.hp / r.max) * 100)
  return (
    <section className="karena raid" aria-label="CERT RAID">
      <div className="rhud">
        <div className="rboss">
          <RPortrait id={['gatling', 'voraxia', 'skyreaper'][r.boss]} size={40} />
          <div className="grow">
            <div className="row between"><b style={{ color: boss.color }}>{boss.name}</b>{r.enraged && !r.result && <span className="rfury">FURIA</span>}<span className="mono small">{r.hp}/{r.max}</span></div>
            <div className="rbar" role="meter" aria-label={`Vida de ${boss.name}`} aria-valuemin={0} aria-valuemax={r.max} aria-valuenow={r.hp}><i style={{ width: pct + '%' }} className={r.enraged ? 'fury' : ''} /></div>
          </div>
        </div>
      </div>
      <RaidStage r={r} names={names} ready={ready} phase={P.phase} />
      <div className="rheroes">
        {r.party.map((pid, i) => (
          <div key={pid} className={'rhero' + (r.turn === i && P.phase === 'q' ? ' turn' : '') + (r.hearts[i] === 0 ? ' down' : '')} style={{ ['--c' as string]: HERO_COLORS[i] }}>
            <RPortrait id={HERO_IDS[i]} size={36} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <b className="rname">{names[i]}{heroes[i]?.online === false ? ' · desconectado' : ''}</b>
              <Hearts n={r.hearts[i]} max={maxHearts} hero={i} />
              {r.hearts[i] === 0 && r.heroes === 2 && <span className="small rresc">Rescate {r.rescue[i]}/{RESCUE}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
