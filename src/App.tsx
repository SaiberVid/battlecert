import { useEffect, useState } from 'react'
import { useStore, storage } from './store'
import { leave } from './session'
import { unlockAudio } from './sound'
import { Home } from './ui/Home'
import { Packs } from './ui/Packs'
import { Room } from './ui/Room'
import { Floaters, Icon, Mark, Toast } from './ui/common'
import { z } from 'zod'

type Theme = 'auto' | 'light' | 'dark'
const THEME_NAME: Record<Theme, string> = { auto: 'automático', light: 'claro', dark: 'oscuro' }
const NEXT: Record<Theme, Theme> = { auto: 'dark', dark: 'light', light: 'auto' }

export default function App() {
  const view = useStore((s) => s.view)
  const role = useStore((s) => s.role)
  const sound = useStore((s) => s.sound)
  const set = useStore((s) => s.set)
  const [theme, setTheme] = useState<Theme>(() => storage.get('theme', z.enum(['auto', 'light', 'dark']), 'auto'))

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    storage.set('theme', theme)
  }, [theme])

  const home = () => {
    if (role && !confirm(role === 'host' ? '¿Cerrar la sala? Los demás se desconectarán.' : '¿Salir de la partida?')) return
    if (role) leave(); else set({ view: 'home' })
  }

  return (
    <div className="app" onPointerDown={unlockAudio}>
      <header className="top">
        <button className="brand" onClick={home} aria-label="BattleCert, inicio"><Mark /> BattleCert</button>
        <div className="tools">
          <button className="btn icon ghost" onClick={() => { set({ sound: !sound }); storage.set('sound', !sound) }} aria-label={sound ? 'Silenciar sonido' : 'Activar sonido'} aria-pressed={sound} title="Sonido y vibración"><Icon name={sound ? 'sound' : 'mute'} /></button>
          <button className="btn icon ghost" onClick={() => setTheme(NEXT[theme])} aria-label={'Tema: ' + THEME_NAME[theme]} title={'Tema: ' + THEME_NAME[theme]}><Icon name={theme} /></button>
        </div>
      </header>
      <main className="main">
        {view === 'room' ? <Room /> : view === 'packs' ? <Packs /> : <Home />}
      </main>
      <footer className="foot">
        Código abierto · sin cuentas ni rastreo · <a href="https://github.com/SaiberVid/battlecert" target="_blank" rel="noopener noreferrer">GitHub</a>
      </footer>
      <Floaters />
      <Toast />
    </div>
  )
}
