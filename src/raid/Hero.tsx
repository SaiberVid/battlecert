import { useState } from 'react'
import { motion } from 'motion/react'
import { MODES } from '../core/engine'
import { createRoom } from '../session'
import { S, updateSettings } from '../store'
import { unlockAudio } from '../sound'
import { ksfx } from '../kumite/audio'
import { rasset } from './assets'

/** CERT RAID entry on the home screen. */
export function RaidHero() {
  const [busy, setBusy] = useState(false)
  const go = async (solo: boolean) => {
    unlockAudio(); ksfx.select()
    if (S().settings.mode !== 'raid') updateSettings({ mode: 'raid', secs: MODES.raid.defaultSecs })
    setBusy(true)
    await createRoom(solo)
    setBusy(false)
  }
  return (
    <motion.section className="khero rhero-card" aria-labelledby="rh-h" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .18 }}>
      <img className="khero-art" src={rasset('banner.jpg')} alt="" />
      <div className="khero-body">
        <h2 id="rh-h" className="klogo"><span>CERT</span> RAID <small>CO-OP</small></h2>
        <p>Cooperativo contra jefes de recreativa. Por turnos: tu acierto es un disparo; tu fallo, un golpe del jefe.</p>
        <div className="row khero-actions">
          <button className="kbtn" disabled={busy} onClick={() => void go(true)}>🎯 Raid en solitario</button>
          <button className="kbtn alt" disabled={busy} onClick={() => void go(false)}>🤝 Con un amigo</button>
        </div>
      </div>
    </motion.section>
  )
}
