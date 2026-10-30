// 16-bit style sound effects for CERT KUMITE, synthesised live (square/triangle/noise channels,
// like the sound chips of 90s consoles). No audio files: nothing to download and no licences to check.
import { ac } from '../sound'

let noiseBuf: AudioBuffer | null = null
function noise(a: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf
  const b = a.createBuffer(1, a.sampleRate, a.sampleRate)
  const d = b.getChannelData(0)
  // 15-bit LFSR noise, the classic chip "hiss"
  let r = 1
  for (let i = 0; i < d.length; i++) { const bit = (r ^ (r >> 1)) & 1; r = (r >> 1) | (bit << 14); d[i] = (r & 1) ? 0.9 : -0.9 }
  noiseBuf = b
  return b
}

type Wave = OscillatorType
function tone(a: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, wave: Wave, vol: number) {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = wave
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(out)
  o.start(t); o.stop(t + dur + 0.02)
}
function hiss(a: AudioContext, out: AudioNode, t: number, dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, rate = 1) {
  const s = a.createBufferSource()
  s.buffer = noise(a)
  s.playbackRate.value = rate
  const bq = a.createBiquadFilter()
  bq.type = filter
  bq.frequency.setValueAtTime(f0, t)
  bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(bq).connect(g).connect(out)
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02)
}

// a little bitcrush-ish grit: everything goes through a soft waveshaper and a master gain
let master: GainNode | null = null
function bus(a: AudioContext): AudioNode {
  if (master && master.context === a) return master
  master = a.createGain()
  master.gain.value = 0.55
  const shaper = a.createWaveShaper()
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.round(Math.tanh(x * 1.6) * 24) / 24 }
  shaper.curve = curve
  master.connect(shaper).connect(a.destination)
  return master
}

function play(fn: (a: AudioContext, out: AudioNode, t: number) => void) {
  const a = ac()
  if (!a) return
  fn(a, bus(a), a.currentTime + 0.01)
}

export const ksfx = {
  select: () => play((a, o, t) => { tone(a, o, t, 880, 880, 0.05, 'square', 0.12); tone(a, o, t + 0.05, 1320, 1320, 0.08, 'square', 0.12) }),
  ready: () => play((a, o, t) => tone(a, o, t, 660, 990, 0.09, 'square', 0.08)),
  count: (n: number) => play((a, o, t) => n > 0 ? tone(a, o, t, 523, 523, 0.14, 'square', 0.14) : (tone(a, o, t, 523, 523, 0.5, 'square', 0.12), tone(a, o, t, 659, 659, 0.5, 'square', 0.1), tone(a, o, t, 784, 784, 0.5, 'square', 0.1), hiss(a, o, t, 0.3, 0.2, 'highpass', 3000))),
  quick: () => play((a, o, t) => { hiss(a, o, t, 0.07, 0.5, 'lowpass', 4000, 800); tone(a, o, t, 220, 90, 0.09, 'square', 0.25) }),
  strong: () => play((a, o, t) => { hiss(a, o, t, 0.16, 0.6, 'lowpass', 3000, 300); tone(a, o, t, 180, 50, 0.2, 'square', 0.32); tone(a, o, t, 90, 40, 0.25, 'triangle', 0.5) }),
  special: () => play((a, o, t) => {
    [392, 523, 659, 784].forEach((f, i) => tone(a, o, t + i * 0.035, f, f * 1.02, 0.06, 'square', 0.1))
    hiss(a, o, t + 0.14, 0.3, 0.7, 'lowpass', 5000, 200); tone(a, o, t + 0.14, 200, 40, 0.35, 'square', 0.35); tone(a, o, t + 0.14, 80, 30, 0.4, 'triangle', 0.6)
  }),
  // both right: two blows meet and are blocked — a metallic "clang" with a ringing tail
  clash: () => play((a, o, t) => {
    hiss(a, o, t, 0.06, 0.7, 'lowpass', 3000, 600)
    tone(a, o, t, 160, 70, 0.14, 'square', 0.3)
    ;[[1046, 0.5], [1568, 0.45], [2217, 0.35], [2960, 0.3]].forEach(([f, d]) => tone(a, o, t + 0.01, f, f * 0.985, d, 'square', 0.07))
    hiss(a, o, t + 0.01, 0.18, 0.4, 'bandpass', 4200, 2500)
    tone(a, o, t + 0.09, 1568, 1555, 0.35, 'triangle', 0.12)
  }),
  whoosh: () => play((a, o, t) => hiss(a, o, t, 0.25, 0.35, 'bandpass', 600, 2400, 0.5)),
  stumble: () => play((a, o, t) => { tone(a, o, t, 300, 180, 0.12, 'triangle', 0.25); tone(a, o, t + 0.12, 260, 150, 0.16, 'triangle', 0.25) }),
  slide: () => play((a, o, t) => hiss(a, o, t, 0.3, 0.25, 'lowpass', 1200, 200, 0.6)),
  guard: () => play((a, o, t) => { tone(a, o, t, 196, 196, 0.08, 'square', 0.15); tone(a, o, t + 0.08, 247, 247, 0.1, 'square', 0.15) }),
  combo: (n: number) => play((a, o, t) => { const base = 440 * Math.pow(2, Math.min(n, 8) / 12); [1, 1.26, 1.5, 2].forEach((m, i) => tone(a, o, t + i * 0.045, base * m, base * m, 0.07, 'square', 0.09)) }),
  fall: () => play((a, o, t) => { tone(a, o, t, 900, 70, 1.1, 'square', 0.16); hiss(a, o, t, 0.9, 0.2, 'bandpass', 2000, 300, 0.4) }),
  ko: () => play((a, o, t) => { tone(a, o, t, 110, 30, 0.9, 'triangle', 0.7); hiss(a, o, t, 0.6, 0.6, 'lowpass', 2500, 80); [659, 523, 392, 262].forEach((f, i) => tone(a, o, t + 0.25 + i * 0.13, f, f, 0.16, 'square', 0.12)) }),
  win: () => play((a, o, t) => {
    const n = [523, 523, 523, 659, 784, 659, 784, 1047]
    const d = [0.1, 0.1, 0.1, 0.2, 0.2, 0.12, 0.12, 0.5]
    let x = t
    n.forEach((f, i) => { tone(a, o, x, f, f, d[i] * 0.95, 'square', 0.12); tone(a, o, x, f / 2, f / 2, d[i] * 0.95, 'triangle', 0.2); x += d[i] })
  }),
  lose: () => play((a, o, t) => { [392, 370, 349, 330].forEach((f, i) => tone(a, o, t + i * 0.28, f, f * 0.97, 0.26, 'square', 0.1)); tone(a, o, t + 1.12, 262, 196, 0.7, 'triangle', 0.25) }),
}
