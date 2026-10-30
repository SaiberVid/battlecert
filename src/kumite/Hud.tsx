import type { KumiteState } from '../core/kumite'
import { GUARD_ZONE } from '../core/kumite'
import type { Player } from '../core/types'
import { FIGHTERS, KM, asset, fighterById, portraitIndex, type Fighter } from './roster'
import { ksfx } from './audio'

export function Portrait({ f, size = 56, flip = false, className = '' }: { f: Fighter; size?: number; flip?: boolean; className?: string }) {
  const p = KM.portrait
  const s = size / p
  return (
    <span className={'kport ' + className} aria-hidden="true" style={{
      width: size, height: size, backgroundImage: `url(${asset('portraits.jpg')})`,
      backgroundSize: `${p * 10 * s}px ${size}px`, backgroundPosition: `-${portraitIndex(f) * size}px 0`,
      transform: flip ? 'scaleX(-1)' : undefined, ['--c' as string]: f.color,
    }} />
  )
}

export function FighterPicker({ value, onPick, taken = [] }: { value: string; onPick(id: string): void; taken?: string[] }) {
  return (
    <div className="kpick" role="radiogroup" aria-label="Luchador">
      {FIGHTERS.map((f) => (
        <button key={f.id} role="radio" aria-checked={f.id === value} aria-pressed={f.id === value} className="kpick-b" style={{ ['--c' as string]: f.color }}
          onClick={() => { ksfx.select(); onPick(f.id) }} title={f.name}>
          <Portrait f={f} size={64} />
          <span>{f.name}</span>
          {taken.includes(f.id) && f.id !== value && <i aria-label="elegido por otro jugador">●</i>}
        </button>
      ))}
    </div>
  )
}

/** Top bar: both fighters with their combo pips, and the platform meter in the middle. */
export function KumiteHud({ k, players }: { k: KumiteState & { fighters: [string, string] }; players: Player[] }) {
  const p = k.fighters.map((pid) => players.find((x) => x.pid === pid)) as [Player | undefined, Player | undefined]
  const f = p.map((x) => fighterById(x?.fighter)) as [Fighter, Fighter]
  const span = k.edge * 2
  const pct = ((k.c + k.edge) / span) * 100
  const guardPct = (GUARD_ZONE / span) * 100
  const side = (i: 0 | 1) => (
    <div className={'khud-side' + (i === 1 ? ' r' : '')} style={{ ['--c' as string]: f[i].color }}>
      <Portrait f={f[i]} size={52} flip={i === 1} />
      <div className="khud-name">
        <b>{p[i]?.nick ?? '—'}{p[i]?.cpu ? ' · CPU' : ''}</b>
        <span className="pips" aria-label={`Racha ${k.combo[i]}`}>{[0, 1, 2, 3, 4].map((n) => <i key={n} className={n < k.combo[i] ? 'on' : ''} />)}</span>
      </div>
    </div>
  )
  return (
    <div className="khud">
      {side(0)}
      <div className="kmeter" role="meter" aria-label="Posición en la plataforma" aria-valuemin={-k.edge} aria-valuemax={k.edge} aria-valuenow={k.c}>
        <span className="edge l" style={{ width: guardPct + '%' }} />
        <span className="edge r" style={{ width: guardPct + '%' }} />
        <span className="mark" style={{ left: pct + '%', ['--a' as string]: f[0].color, ['--b' as string]: f[1].color }} />
      </div>
      {side(1)}
    </div>
  )
}
