import { useState } from 'react'
import { motion } from 'motion/react'
import { MODES } from '../core/engine'
import { createRoom, setFighter } from '../session'
import { S, updateSettings, useStore } from '../store'
import { unlockAudio } from '../sound'
import { FighterPicker, Portrait } from './Hud'
import { asset, fighterById } from './roster'
import { ksfx } from './audio'

/** Big CERT KUMITE entry on the home screen. */
export function KumiteHero() {
  const fighter = useStore((s) => s.fighter)
  const [pick, setPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const f = fighterById(fighter)
  const go = async (solo: boolean) => {
    unlockAudio(); ksfx.select()
    const st = S().settings
    if (st.mode !== 'kumite') updateSettings({ mode: 'kumite', secs: MODES.kumite.defaultSecs })
    setBusy(true)
    await createRoom(solo)
    setBusy(false)
  }
  return (
    <motion.section className="khero" aria-labelledby="kh-h" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }}>
      <img className="khero-art" src={asset('banner.jpg')} alt="" />
      <div className="khero-body">
        <h2 id="kh-h" className="klogo"><span>CERT</span> KUMITE <small lang="ja">組手</small></h2>
        <p>Duelo de preguntas 1 contra 1. Cada acierto es un golpe; si aciertan los dos, chocan. Échalo de la plataforma.</p>
        <div className="row khero-actions">
          <button className="kbtn" disabled={busy} onClick={() => void go(true)}>🥋 Torneo vs CPU</button>
          <button className="kbtn alt" disabled={busy} onClick={() => void go(false)}>👊 Retar a un amigo</button>
          <button className="khero-me" onClick={() => setPick(!pick)} aria-expanded={pick}>
            <Portrait f={f} size={44} />
            <span><small>Tu luchador</small><b>{f.name}</b></span>
            <span aria-hidden="true">{pick ? '▲' : '▼'}</span>
          </button>
        </div>
        {pick && <div className="khero-pick"><FighterPicker value={fighter} onPick={(id) => { setFighter(id); setPick(false) }} /></div>}
      </div>
    </motion.section>
  )
}
