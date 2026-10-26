// Network layer. Star topology: the host's browser is the room.
//  1. Direct: PeerJS (WebRTC data channels; the free public PeerJS broker only introduces peers).
//  2. Fallback: an end-to-end encrypted relay over a free public MQTT broker (see relay.ts), used
//     when a direct connection cannot be opened (mobile data, strict NATs) and there is no TURN.
// The host listens on both at once; a guest tries direct first and switches to the relay if it
// has not connected after a few seconds or as soon as it fails.
import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import { relayHost, relayJoin, type RelayHost } from './relay'

const PREFIX = 'battlecert-v1-'
const DIRECT_GRACE_MS = 6000
const JOIN_TIMEOUT_MS = 25000
const SILENCE_MS = 20000

type PeerCtor = typeof Peer
// PeerJS is loaded on demand, so the first screen does not wait for it.
async function PeerImpl(): Promise<PeerCtor> {
  // End-to-end tests inject a fake peer; this hook only exists in the e2e build.
  if (import.meta.env.VITE_E2E === '1' && (window as unknown as { __FakePeer?: PeerCtor }).__FakePeer) return (window as unknown as { __FakePeer: PeerCtor }).__FakePeer
  return (await import('peerjs')).default
}
/** The relay is skipped in the e2e build unless a test enables it. */
const relayEnabled = () => import.meta.env.VITE_E2E !== '1' || !!(window as unknown as { __RelayOn?: boolean }).__RelayOn

export interface NetError { code: string; message: string }
const NET = (message: string, code = 'network'): NetError => ({ code, message })

export type Stage = 'loading' | 'broker' | 'direct' | 'relay' | 'connected'
export interface HostStatus { direct: boolean; relay: number }

export interface HostHandle {
  send(label: string, msg: unknown): void
  broadcast(msg: unknown): void
  drop(label: string): void
  close(): void
  status(): HostStatus
}

type HostEvents = { message(label: string, data: unknown): void; left(label: string): void; joined(label: string): void; status?(s: HostStatus): void }

export async function hostRoom(code: string, secret: string | null, on: HostEvents): Promise<HostHandle> {
  let P: PeerCtor
  try { P = await PeerImpl() } catch { throw NET('No se pudo cargar el módulo de conexión. Recarga la página.') }
  const conns = new Map<string, DataConnection>()
  let peer: InstanceType<PeerCtor> | null = null
  let direct = false
  let closed = false
  let relay: RelayHost | null = null
  const report = () => on.status?.({ direct, relay: relay?.brokers() ?? 0 })
  const gone = (label: string) => { if (conns.delete(label)) on.left(label) }

  // Start the relay in the background; it must never delay the room.
  if (secret && relayEnabled()) {
    void relayHost(secret, on).then((r) => { if (closed) r.close(); else { relay = r; report() } }).catch(() => {})
  }

  const startPeer = () => new Promise<void>((resolve, reject) => {
    const p = new P(PREFIX + code)
    peer = p
    let ready = false
    const timer = setTimeout(() => { if (!ready) { try { p.destroy() } catch { /* ignore */ } reject(NET('Tiempo de espera agotado al abrir la sala.', 'timeout')) } }, 15000)
    p.on('open', () => { ready = true; direct = true; clearTimeout(timer); report(); resolve() })
    p.on('connection', (conn) => {
      if (conns.size >= 16) { try { conn.close() } catch { /* ignore */ } return }
      const label = conn.connectionId || conn.peer + ':' + Math.random().toString(36).slice(2)
      conns.set(label, conn)
      conn.on('open', () => on.joined(label))
      conn.on('data', (d) => on.message(label, d))
      conn.on('close', () => gone(label))
      conn.on('error', () => gone(label))
      conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') gone(label) })
    })
    // Lost the broker (network change, tab frozen in the background): existing players keep
    // playing over their open channels; we re-register so new players can still join.
    p.on('disconnected', () => { direct = false; report(); setTimeout(() => { if (!closed && p.disconnected && !p.destroyed) try { p.reconnect() } catch { /* ignore */ } }, 1500) })
    p.on('open', () => { direct = true; report() })
    p.on('error', (e) => {
      const t = (e as { type?: string }).type
      if (!ready) {
        clearTimeout(timer)
        reject(t === 'unavailable-id' ? NET('Ese código ya está en uso.', 'taken') : t === 'browser-incompatible' ? NET('Este navegador no permite conexiones directas.', 'webrtc') : NET('No se pudo contactar con el servicio de conexión.'))
      }
    })
  })

  const revive = () => {
    if (closed || !peer) return
    if (peer.destroyed) void startPeer().catch(() => {})
    else if (peer.disconnected) try { peer.reconnect() } catch { /* ignore */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') revive() }
  document.addEventListener('visibilitychange', onVisible)
  addEventListener('online', revive)
  const reviveTimer = setInterval(revive, 10000)

  try {
    await startPeer()
  } catch (e) {
    if ((e as NetError).code === 'taken' || !secret || !relayEnabled()) { cleanup(); throw e }
    // The broker is unreachable but the relay may work: wait a moment for it.
    for (let i = 0; i < 16 && !relay; i++) await new Promise((r) => setTimeout(r, 500))
    if (!relay || !(relay as RelayHost).brokers()) { cleanup(); throw e }
  }

  function cleanup() {
    closed = true
    clearInterval(reviveTimer)
    document.removeEventListener('visibilitychange', onVisible)
    removeEventListener('online', revive)
    try { peer?.destroy() } catch { /* ignore */ }
    relay?.close()
  }

  return {
    send(label, msg) {
      if (label.startsWith('r:')) return relay?.send(label, msg)
      const c = conns.get(label)
      if (c?.open) try { c.send(msg) } catch { /* ignore */ }
    },
    broadcast(msg) {
      for (const c of conns.values()) if (c.open) try { c.send(msg) } catch { /* ignore */ }
      relay?.broadcast(msg)
    },
    drop(label) {
      if (label.startsWith('r:')) return relay?.drop(label)
      const c = conns.get(label)
      conns.delete(label)
      try { c?.close() } catch { /* ignore */ }
    },
    close: cleanup,
    status: () => ({ direct, relay: relay?.brokers() ?? 0 }),
  }
}

export interface GuestHandle { send(msg: unknown): void; close(): void; via: 'direct' | 'relay' }

type Attempt = { send(msg: unknown): void; close(): void }

export async function joinRoom(code: string, secret: string | null, on: { message(data: unknown): void; closed(): void }, opts: { stage?(s: Stage): void; forceRelay?: boolean } = {}): Promise<GuestHandle> {
  const stage = opts.stage ?? (() => {})
  stage('loading')
  let P: PeerCtor | null = null
  if (!opts.forceRelay) { try { P = await PeerImpl() } catch { /* relay may still work */ } }
  const useRelay = !!secret && relayEnabled()

  return new Promise((resolve, reject) => {
    let done = false
    let winner: 'direct' | 'relay' | null = null
    let peer: InstanceType<PeerCtor> | null = null
    let relayH: Attempt | null = null
    let lastMsg = Date.now()
    let watch: ReturnType<typeof setInterval> | null = null
    let closedOnce = false
    const diag = { broker: null as boolean | null, found: null as boolean | null, directFailed: false, relay: 'idle' as 'idle' | 'trying' | 'failed' }

    const closed = (via: 'direct' | 'relay') => {
      if (winner !== via || closedOnce) return
      closedOnce = true
      if (watch) clearInterval(watch)
      on.closed()
    }
    const msg = (via: 'direct' | 'relay', d: unknown) => { if (winner === via) { lastMsg = Date.now(); on.message(d) } }

    const finish = (via: 'direct' | 'relay', h: Attempt) => {
      if (done) { h.close(); return }
      done = true
      winner = via
      clearTimeout(timer); clearTimeout(grace)
      if (via === 'relay') { try { peer?.destroy() } catch { /* ignore */ } } else relayH?.close()
      stage('connected')
      lastMsg = Date.now()
      watch = setInterval(() => { if (Date.now() - lastMsg > SILENCE_MS) { h.close(); closed(via) } }, 4000)
      resolve({ send: h.send, close() { closedOnce = true; if (watch) clearInterval(watch); h.close() }, via })
    }

    const explain = (): NetError => {
      if (diag.found === false && (!useRelay || diag.relay === 'failed')) return NET('No hay ninguna sala abierta con ese código. Si el anfitrión está en el móvil, que vuelva a la pestaña de BattleCert (al cambiar de app la sala se pausa) y probad de nuevo.', 'not_found')
      if (diag.broker === false && (!useRelay || diag.relay === 'failed')) return NET('No se pudo contactar con los servicios de conexión. Revisa tu conexión a internet o prueba con otra red.')
      if (!useRelay) return NET('Vuestras redes no permiten una conexión directa. Entra con el enlace o el QR del anfitrión: incluyen una conexión alternativa que funciona en casi cualquier red.', 'direct_failed')
      return NET('No se pudo conectar ni directamente ni por el servidor alternativo. Comprobad que el anfitrión sigue en la pestaña de la sala, o probad con otra red (por ejemplo, Wi-Fi en lugar de datos).', 'all_failed')
    }
    const fail = () => {
      if (done) return
      done = true
      clearTimeout(timer); clearTimeout(grace)
      try { peer?.destroy() } catch { /* ignore */ }
      relayH?.close()
      reject(explain())
    }
    const maybeFail = () => { if (diag.directFailed && (!useRelay || diag.relay === 'failed')) fail() }

    const startRelay = () => {
      if (!useRelay || diag.relay !== 'idle' || done) return
      diag.relay = 'trying'
      stage('relay')
      relayJoin(secret!, { message: (d) => msg('relay', d), closed: () => closed('relay') })
        .then((h) => { relayH = h; finish('relay', h) })
        .catch(() => { diag.relay = 'failed'; maybeFail() })
    }
    const directFailed = () => { diag.directFailed = true; startRelay(); maybeFail() }

    const timer = setTimeout(fail, JOIN_TIMEOUT_MS)
    const grace = setTimeout(startRelay, DIRECT_GRACE_MS)

    if (!P) { diag.broker = false; directFailed(); return }
    stage('broker')
    const p = new P()
    peer = p
    p.on('open', () => {
      diag.broker = true
      stage('direct')
      const conn = p.connect(PREFIX + code, { reliable: true, serialization: 'json' })
      conn.on('open', () => finish('direct', { send(m) { if (conn.open) try { conn.send(m) } catch { /* ignore */ } }, close() { try { p.destroy() } catch { /* ignore */ } } }))
      conn.on('data', (d) => msg('direct', d))
      conn.on('close', () => closed('direct'))
      conn.on('error', () => { if (!done) directFailed(); else closed('direct') })
      conn.on('iceStateChanged', (s) => {
        if (s === 'failed' || s === 'closed') { if (!done) directFailed(); else closed('direct') }
      })
    })
    p.on('error', (e) => {
      const t = (e as { type?: string }).type
      if (t === 'peer-unavailable') diag.found = false
      else if (diag.broker === null) diag.broker = false
      if (!done) directFailed()
    })
  })
}
