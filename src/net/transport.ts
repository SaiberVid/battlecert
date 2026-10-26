// Peer-to-peer transport on PeerJS (WebRTC + the free public PeerJS broker for matchmaking).
// Star topology: the host's browser is the room; each guest opens one data channel to it.
// Kept behind a small interface so other transports (Trystero, a relay) can be added later.
import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'

const PREFIX = 'battlecert-v1-'

type PeerCtor = typeof Peer
// PeerJS is loaded on demand, so the first screen does not wait for it.
async function PeerImpl(): Promise<PeerCtor> {
  // End-to-end tests inject a fake peer; this hook only exists in the e2e build.
  if (import.meta.env.VITE_E2E === '1' && (window as unknown as { __FakePeer?: PeerCtor }).__FakePeer) return (window as unknown as { __FakePeer: PeerCtor }).__FakePeer
  return (await import('peerjs')).default
}

export interface NetError { code: string; message: string }

function friendly(e: unknown): NetError {
  const t = (e as { type?: string })?.type
  if (t === 'peer-unavailable') return { code: 'not_found', message: 'No hay ninguna sala abierta con ese código.' }
  if (t === 'unavailable-id') return { code: 'taken', message: 'Ese código ya está en uso.' }
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return { code: 'network', message: 'No se pudo contactar con el servicio de conexión. Revisa tu conexión a internet.' }
  if (t === 'browser-incompatible' || t === 'webrtc') return { code: 'webrtc', message: 'Este navegador no permite conexiones directas. Prueba con Chrome, Edge, Firefox o Safari actualizados.' }
  return { code: t || 'error', message: 'Error de conexión (' + (t || 'desconocido') + ').' }
}

export interface HostHandle {
  send(label: string, msg: unknown): void
  broadcast(msg: unknown): void
  drop(label: string): void
  close(): void
}

export async function hostRoom(code: string, on: { message(label: string, data: unknown): void; left(label: string): void; joined(label: string): void }): Promise<HostHandle> {
  let P: PeerCtor
  try { P = await PeerImpl() } catch { throw { code: 'network', message: 'No se pudo cargar el módulo de conexión.' } }
  return new Promise((resolve, reject) => {
    const peer = new P(PREFIX + code)
    const conns = new Map<string, DataConnection>()
    let ready = false
    const timer = setTimeout(() => { if (!ready) { try { peer.destroy() } catch { /* ignore */ } reject({ code: 'timeout', message: 'Tiempo de espera agotado al abrir la sala.' }) } }, 15000)
    const gone = (label: string) => { if (conns.delete(label)) on.left(label) }
    peer.on('open', () => {
      ready = true
      clearTimeout(timer)
      resolve({
        send(label, msg) { const c = conns.get(label); if (c?.open) try { c.send(msg) } catch { /* ignore */ } },
        broadcast(msg) { for (const c of conns.values()) if (c.open) try { c.send(msg) } catch { /* ignore */ } },
        drop(label) { const c = conns.get(label); conns.delete(label); try { c?.close() } catch { /* ignore */ } },
        close() { try { peer.destroy() } catch { /* ignore */ } },
      })
    })
    peer.on('connection', (conn) => {
      if (conns.size >= 16) { try { conn.close() } catch { /* ignore */ } return }
      const label = conn.connectionId || conn.peer + ':' + Math.random().toString(36).slice(2)
      conns.set(label, conn)
      conn.on('open', () => on.joined(label))
      conn.on('data', (d) => on.message(label, d))
      conn.on('close', () => gone(label))
      conn.on('error', () => gone(label))
      conn.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed' || s === 'closed') gone(label) })
    })
    peer.on('disconnected', () => { try { peer.reconnect() } catch { /* destroyed */ } })
    peer.on('error', (e) => { if (!ready) { clearTimeout(timer); reject(friendly(e)) } })
  })
}

export interface GuestHandle { send(msg: unknown): void; close(): void }

export async function joinRoom(code: string, on: { message(data: unknown): void; closed(): void }): Promise<GuestHandle> {
  let P: PeerCtor
  try { P = await PeerImpl() } catch { throw { code: 'network', message: 'No se pudo cargar el módulo de conexión.' } }
  return new Promise((resolve, reject) => {
    const peer = new P()
    let done = false
    let closedOnce = false
    const fail = (e: NetError) => { if (!done) { done = true; clearTimeout(timer); try { peer.destroy() } catch { /* ignore */ } reject(e) } }
    const timer = setTimeout(() => fail({ code: 'timeout', message: 'No se pudo conectar con la sala. Comprueba el código y que el anfitrión siga con la página abierta.' }), 15000)
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
      const closed = () => { if (done && !closedOnce) { closedOnce = true; on.closed() } }
      conn.on('open', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ send(msg) { if (conn.open) try { conn.send(msg) } catch { /* ignore */ } }, close() { closedOnce = true; try { peer.destroy() } catch { /* ignore */ } } })
      })
      conn.on('data', (d) => on.message(d))
      conn.on('close', closed)
      conn.on('error', closed)
      conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') closed() })
    })
    peer.on('error', (e) => fail(friendly(e)))
  })
}
