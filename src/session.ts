// Session controller: runs the host side (authoritative match + transport) or the guest side,
// and pushes what the UI needs into the store. No React here.
import * as E from './core/engine'
import type { Match } from './core/engine'
import type { Pack, PublicState } from './core/types'
import { AVATARS, cleanNick, dict } from './core/sanitize'
import { GuestMsg, HostMsg, MAX_MSG_BYTES, MAX_STATE_BYTES, RateLimiter, randomCode, randomPin, sizeOf } from './net/protocol'
import { hostRoom, joinRoom, type GuestHandle, type HostHandle } from './net/transport'
import { newSecret } from './net/relay'
import { S, blankLocal, storage, useStore, type Result } from './store'
import { z } from 'zod'

const HOST_LABEL = 'host'
let M: Match | null = null
let hostNet: HostHandle | null = null
let guestNet: GuestHandle | null = null
let labelToPid = dict<string>()
let limiters = dict<RateLimiter>()
let rtt = dict<number>()
let banned = new Set<string>()
let lastReact = dict<number>()
let used: string[] = []
let lastCast = 0
let reactSeq = 0

export function deviceToken(): string {
  let t = storage.get('token', z.string().regex(/^[a-z0-9]{8,40}$/), '')
  if (!t) {
    const b = new Uint32Array(4)
    crypto.getRandomValues(b)
    t = [...b].map((x) => x.toString(36)).join('').slice(0, 32)
    storage.set('token', t)
  }
  return t
}

const packOf = (id: string): Pack | undefined => S().packs.find((p) => p.id === id)
const hostPack = () => packOf(M!.s.packId)!

const hashFor = (code: string, pin: string | null, secret: string | null) => '#j=' + code + (pin ? '&p=' + pin : '') + (secret ? '&k=' + secret : '')
export function joinUrl(code: string, pin: string | null, secret: string | null): string {
  return location.origin + location.pathname + hashFor(code, pin, secret)
}

// ---------- host
export async function createRoom(solo: boolean) {
  const s = S()
  const nick = cleanNick(s.nick)
  if (!nick) return s.say('Escribe un alias de al menos 2 caracteres.')
  storage.set('nick', nick); storage.set('avatar', s.avatar)
  const pack = packOf(s.settings.packId)
  if (!pack || !pack.questions.length) return s.say('Elige un pack con preguntas.')
  reset()
  const code = solo ? 'solo' : randomCode()
  const pin = !solo && s.usePin ? randomPin() : null
  const secret = solo ? null : newSecret()
  M = E.newMatch(code, { ...s.settings, packName: pack.name })
  const me = E.addPlayer(M, nick, s.avatar, HOST_LABEL, null)!
  labelToPid[HOST_LABEL] = me.pid
  useStore.setState({ role: solo ? 'solo' : 'host', code, pin, secret, net: null, joinError: null, myPid: me.pid, view: 'room', msg: null, myLog: {}, P: null })
  if (solo) return startMatch()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      hostNet = await hostRoom(M.code, secret, { message: onGuestMessage, left: onGuestLeft, joined: () => publish(), status: (net) => useStore.setState({ net }) })
      break
    } catch (e) {
      const err = e as { code: string; message: string }
      if (err.code === 'taken') { M.code = randomCode(); useStore.setState({ code: M.code }); continue }
      leave()
      return S().say(err.message + ' Puedes practicar solo mientras tanto.')
    }
  }
  if (!hostNet) { leave(); return S().say('No se pudo abrir la sala.') }
  useStore.setState({ net: hostNet.status() })
  publish()
}

function onGuestMessage(label: string, data: unknown) {
  if (!M || !hostNet) return
  const lim = limiters[label] || (limiters[label] = new RateLimiter(10, 20))
  if (!lim.take() || sizeOf(data) > MAX_MSG_BYTES) {
    if (lim.strikes > 40) hostNet.drop(label) // flooding: disconnect
    return
  }
  const parsed = GuestMsg.safeParse(data)
  if (!parsed.success) { lim.strikes += 5; return }
  const m = parsed.data
  const now = Date.now()
  if (m.t === 'pong') { const r = now - m.ts; if (r >= 0 && r < 10000) rtt[label] = rtt[label] ? rtt[label] * 0.7 + r * 0.3 : r; return }
  if (m.t === 'hello') {
    if (banned.has(m.token)) return hostNet.send(label, { t: 'reject', reason: 'El anfitrión te ha expulsado de esta sala.' })
    if (S().pin && m.pin !== S().pin) return hostNet.send(label, { t: 'reject', reason: 'PIN incorrecto. Usa el enlace o el QR del anfitrión.' })
    const nick = cleanNick(m.nick)
    if (!nick) return hostNet.send(label, { t: 'reject', reason: 'Alias no válido (2–20 caracteres).' })
    if (banned.has('nick:' + nick.toLowerCase())) return hostNet.send(label, { t: 'reject', reason: 'El anfitrión te ha expulsado de esta sala.' })
    const avatar = AVATARS.includes(m.avatar) ? m.avatar : AVATARS[0]
    const p = E.addPlayer(M, nick, avatar, label, m.token)
    if (!p) return hostNet.send(label, { t: 'reject', reason: M.players.length >= 8 ? 'La sala está llena (máximo 8).' : 'Ese alias ya está jugando. Elige otro.' })
    labelToPid[label] = p.pid
    hostNet.send(label, { t: 'welcome', pid: p.pid })
    hostNet.send(label, { t: 'ping', ts: now })
    return publish()
  }
  const pid = labelToPid[label]
  if (!pid) return
  if (m.t === 'answer') {
    if (m.i !== M.i || m.ph !== M.phase) return
    // The guest reports its own time; never trust it below what the host itself measured minus the round trip.
    const opened = M.phase === 'steal' ? M.deadline - E.STEAL_MS : M.qStart
    const hostMs = now - opened - (rtt[label] ?? 150)
    const ms = Math.max(m.ms, hostMs)
    if (E.answer(M, hostPack(), pid, m.c, ms, now, m.bet)) { E.tick(M, hostPack(), now); afterChange() }
  } else if (m.t === 'react') {
    if ((lastReact[pid] ?? 0) > now - 800) return
    lastReact[pid] = now
    hostNet.broadcast({ t: 'react', pid, e: m.e })
    addReaction(pid, m.e)
  }
}

function onGuestLeft(label: string) {
  const pid = labelToPid[label]
  delete labelToPid[label]; delete limiters[label]; delete rtt[label]
  if (!M || !pid) return
  const p = M.players.find((x) => x.pid === pid)
  if (!p || p.label !== label) return
  if (M.phase === 'lobby') M.players = M.players.filter((x) => x.pid !== pid)
  else p.online = false
  publish()
}

export function kick(pid: string) {
  if (!M || !hostNet) return
  const p = M.players.find((x) => x.pid === pid)
  if (!p || p.label === HOST_LABEL) return
  if (p.token) banned.add(p.token)
  banned.add('nick:' + p.nick.toLowerCase())
  hostNet.send(p.label, { t: 'kicked' })
  setTimeout(() => hostNet?.drop(p.label), 200)
  M.players = M.players.filter((x) => x.pid !== pid)
  publish()
}

export function startMatch() {
  if (!M) return
  const pack = hostPack()
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  E.start(M, pack, b[0], Date.now(), used)
  used.push(...M.qids)
  useStore.setState({ myLog: {} })
  publish()
}

export function rematch() {
  if (!M) return
  const old = M
  M = E.newMatch(old.code, old.s, old)
  M.players = old.players.filter((p) => p.online)
  startMatch()
}

/** Host can change settings while in the lobby. */
export function applySettings() {
  if (!M || M.phase !== 'lobby') return
  const s = S().settings
  const pack = packOf(s.packId)
  if (!pack) return
  M.s = { ...s, packName: pack.name, domains: s.domains.filter((d) => pack.questions.some((q) => q.domain === d)) }
  publish()
}

export function skip() { if (M) { E.skipReveal(M); tickHost() } }

function afterChange() {
  if (M && M.phase === 'end') { E.finish(M); saveResult(E.publicState(M, hostPack(), Date.now())) }
  publish()
}

function publish() {
  if (!M) return
  const P = E.publicState(M, hostPack(), Date.now())
  if (hostNet) {
    const msg = { t: 'state', s: P }
    if (sizeOf(msg) <= MAX_STATE_BYTES) hostNet.broadcast(msg)
    lastCast = Date.now()
  }
  applyState(P)
}

function tickHost() {
  if (!M) return
  if (E.tick(M, hostPack(), Date.now())) afterChange()
  else if (hostNet && Date.now() - lastCast > 1500) publish()
}
setInterval(() => { if (S().role === 'host' || S().role === 'solo') tickHost() }, 150)
setInterval(() => { if (hostNet) hostNet.broadcast({ t: 'ping', ts: Date.now() }) }, 3000)

// ---------- guest
let reconnecting = false
export async function join(code: string, pin: string | null, secret: string | null = null, forceRelay = false) {
  const s = S()
  const nick = cleanNick(s.nick)
  if (!nick) return s.say('Escribe un alias de al menos 2 caracteres.')
  storage.set('nick', nick); storage.set('avatar', s.avatar)
  reset()
  useStore.setState({ role: 'guest', code, pin, secret, view: 'room', P: null, myPid: null, msg: null, joinError: null, stage: null, via: null, myLog: {} })
  try {
    guestNet = await joinRoom(code, secret, { message: onHostMessage, closed: onClosed }, { stage: (stage) => useStore.setState({ stage }), forceRelay })
  } catch (e) {
    if (S().role !== 'guest' || S().code !== code) return // cancelled meanwhile
    useStore.setState({ role: null, view: 'home', code: null, stage: null, joinError: (e as { message: string }).message })
    return
  }
  if (S().role !== 'guest' || S().code !== code) { guestNet.close(); guestNet = null; return }
  useStore.setState({ via: guestNet.via })
  guestNet.send({ t: 'hello', nick, avatar: s.avatar, token: deviceToken(), pin: pin ?? undefined })
  history.replaceState(null, '', location.pathname + hashFor(code, pin, secret))
}

function onHostMessage(data: unknown) {
  if (sizeOf(data) > MAX_STATE_BYTES) return
  const r = HostMsg.safeParse(data)
  if (!r.success) return
  const m = r.data
  if (m.t === 'state') applyState(m.s as PublicState)
  else if (m.t === 'welcome') useStore.setState({ myPid: m.pid })
  else if (m.t === 'ping') guestNet?.send({ t: 'pong', ts: m.ts })
  else if (m.t === 'react') addReaction(m.pid, m.e)
  else if (m.t === 'reject' || m.t === 'kicked') { const why = m.t === 'kicked' ? 'El anfitrión te ha expulsado de la sala.' : m.reason; leave(); S().say(why) }
}

function onClosed() {
  if (S().role !== 'guest' || reconnecting) return
  reconnecting = true
  const { code, pin, secret } = S()
  S().say('Conexión perdida. Reintentando…')
  let tries = 0
  const retry = async () => {
    if (S().role !== 'guest' || S().code !== code || !code) { reconnecting = false; return }
    tries++
    try {
      guestNet = await joinRoom(code, secret, { message: onHostMessage, closed: () => { reconnecting = false; onClosed() } })
      useStore.setState({ via: guestNet.via })
      guestNet.send({ t: 'hello', nick: cleanNick(S().nick), avatar: S().avatar, token: deviceToken(), pin: pin ?? undefined })
      reconnecting = false
      S().say('Reconectado.', 'ok')
    } catch {
      if (tries < 10) setTimeout(retry, 3000)
      else { reconnecting = false; S().say('No se pudo reconectar. El anfitrión puede haber cerrado la sala.') }
    }
  }
  setTimeout(retry, 1500)
}

// resend an answer until the host's state shows it
setInterval(() => {
  const { role, local, P, myPid } = S()
  if (role !== 'guest' || !guestNet || !local.sent || !P) return
  const a = myPid ? P.ans[myPid] : undefined
  if ((a && a.st === (P.phase === 'steal')) || P.phase === 'reveal' || local.sent.i !== P.i || local.sent.ph !== P.phase) { useStore.setState({ local: { ...local, sent: null } }); return }
  guestNet.send({ t: 'answer', ...local.sent })
}, 900)

// ---------- both
function applyState(P: PublicState) {
  const s = S()
  const key = P.i + ':' + P.phase
  let local = s.local
  if (P.phase !== 'lobby' && P.phase !== 'end' && key !== local.key) local = { ...blankLocal(), key, start: Date.now(), deadline: Date.now() + P.rem }
  let myLog = s.myLog
  if (P.phase === 'reveal' && P.q && s.myPid && !myLog[P.q.id]) {
    const a = P.ans[s.myPid]
    myLog = { ...myLog, [P.q.id]: { ok: !!(a && 'ok' in a && a.ok), pts: a && 'pts' in a ? a.pts : 0 } }
  }
  useStore.setState({ P, local, myLog })
  if (P.phase === 'end' && s.role === 'guest') saveResult(P)
}

export function myTurn(): boolean {
  const { P, myPid, local } = S()
  if (!P || !myPid || (P.phase !== 'q' && P.phase !== 'steal')) return false
  const steal = P.phase === 'steal'
  const sc = P.sc[myPid]
  if (P.settings.mode === 'survival' && sc?.out) return false
  const elig = steal || (P.settings.mode === 'turns' && P.active) ? [P.active] : P.players.filter((p) => p.online).map((p) => p.pid)
  if (!elig.includes(myPid)) return false
  const a = P.ans[myPid]
  return !(a && a.st === steal) && !local.sent
}

export function setBet(bet: number) { const l = S().local; useStore.setState({ local: { ...l, bet } }) }

export function choose(k: number) {
  if (!myTurn()) return
  const { P, local } = S()
  const need = P!.q!.need
  const chosen = need === 1 ? [k] : local.chosen.includes(k) ? local.chosen.filter((x) => x !== k) : [...local.chosen, k]
  useStore.setState({ local: { ...local, chosen } })
  if (chosen.length === need) submit()
}

function submit() {
  const { P, local, role, myPid } = S()
  if (!P) return
  const sent = { i: P.i, ph: P.phase, c: local.chosen.slice(), ms: Date.now() - local.start, bet: P.settings.mode === 'wager' ? local.bet : undefined }
  useStore.setState({ local: { ...local, sent } })
  if (role === 'guest') guestNet?.send({ t: 'answer', ...sent })
  else if (M && myPid && E.answer(M, hostPack(), myPid, sent.c, sent.ms, Date.now(), sent.bet)) { E.tick(M, hostPack(), Date.now()); afterChange() }
}

export function react(e: string) {
  const { role, myPid } = S()
  if (role === 'guest') guestNet?.send({ t: 'react', e })
  else if (myPid && hostNet) { hostNet.broadcast({ t: 'react', pid: myPid, e }); addReaction(myPid, e) }
  else if (myPid) addReaction(myPid, e)
}

function addReaction(pid: string, e: string) {
  const id = ++reactSeq
  useStore.setState({ reactions: [...S().reactions.slice(-12), { id, pid, e }] })
  setTimeout(() => useStore.setState({ reactions: S().reactions.filter((r) => r.id !== id) }), 2200)
}

const saved = new Set<string>()
function saveResult(P: PublicState) {
  const key = P.code + ':' + P.round
  if (saved.has(key)) return
  saved.add(key)
  const st = E.standings(P)
  const tie = st.length > 1 && st[0].pts === st[1].pts
  const r: Result = {
    at: Date.now(), pack: P.settings.packName, mode: P.settings.mode, n: P.total, solo: st.length < 2, me: cleanNick(S().nick),
    winner: tie || st.length < 2 ? null : st[0].nick,
    players: st.map((p) => ({ nick: p.nick, avatar: p.avatar, pts: p.pts, ok: p.ok, n: p.n, ms: p.ms, best: p.best })),
  }
  const historyList = [r, ...S().history].slice(0, 300)
  useStore.setState({ history: historyList })
  storage.set('history', historyList)
}

function reset() {
  M = null; labelToPid = dict(); limiters = dict(); rtt = dict(); banned = new Set(); lastReact = dict(); used = []
}

export function leave() {
  try { hostNet?.close() } catch { /* ignore */ }
  try { guestNet?.close() } catch { /* ignore */ }
  hostNet = null; guestNet = null; reconnecting = false
  reset()
  useStore.setState({ role: null, code: null, pin: null, secret: null, net: null, via: null, stage: null, P: null, myPid: null, view: 'home', local: blankLocal(), reactions: [] })
  if (location.hash) history.replaceState(null, '', location.pathname)
}

window.addEventListener('beforeunload', (e) => { if (S().role === 'host' && M && M.phase !== 'lobby' && M.phase !== 'end') e.preventDefault() })
