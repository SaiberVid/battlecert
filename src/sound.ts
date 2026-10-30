// Synthesised sounds (Web Audio, no files to download) and haptics.
// Every call is a no-op when sound is off or the browser refuses audio.
import { S } from './store'

let ctx: AudioContext | null = null
export function ac(): AudioContext | null {
  if (!S().sound) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

/** Browsers only allow audio after a user gesture; call this from the first click. */
export function unlockAudio() { ac() }

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, slideTo?: number) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

const buzz = (pattern: number | number[]) => { try { if (S().sound) navigator.vibrate?.(pattern) } catch { /* unsupported */ } }

export const sfx = {
  tap() { tone(660, 0, 0.05, 'triangle', 0.08) },
  tick(urgent = false) { tone(urgent ? 1180 : 880, 0, 0.045, 'square', urgent ? 0.06 : 0.03) },
  count(n: number) { tone(n === 0 ? 1046 : 523, 0, n === 0 ? 0.28 : 0.12, 'triangle', 0.16); buzz(n === 0 ? 40 : 15) },
  /** Rising pitch with the streak: each right answer in a row sounds a little brighter. */
  correct(streak = 1) {
    const base = 523 * Math.pow(2, Math.min(streak - 1, 7) / 12)
    tone(base, 0, 0.12, 'triangle', 0.2)
    tone(base * 1.25, 0.08, 0.12, 'triangle', 0.18)
    tone(base * 1.5, 0.16, 0.22, 'triangle', 0.18)
    if (streak >= 3) tone(base * 2, 0.26, 0.25, 'sine', 0.12)
    buzz([30, 40, 30])
  },
  wrong() { tone(220, 0, 0.32, 'sawtooth', 0.09, 150); buzz(120) },
  steal() { tone(392, 0, 0.09, 'square', 0.08); tone(587, 0.09, 0.16, 'square', 0.08); buzz([20, 30, 20]) },
  join() { tone(784, 0, 0.08, 'sine', 0.12); tone(1175, 0.07, 0.14, 'sine', 0.12) },
  lock() { tone(440, 0, 0.06, 'triangle', 0.1, 660) },
  fanfare() {
    const n = [523, 659, 784, 1046]
    n.forEach((f, i) => tone(f, i * 0.11, 0.2, 'triangle', 0.18))
    tone(1318, 0.46, 0.5, 'triangle', 0.16)
    buzz([40, 60, 40, 60, 80])
  },
  lose() { tone(392, 0, 0.2, 'triangle', 0.12); tone(330, 0.18, 0.2, 'triangle', 0.12); tone(262, 0.36, 0.4, 'triangle', 0.12) },
}

export const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
