// Peer-to-peer rooms with PeerJS (WebRTC + free public broker). Star topology:
// the host's browser is the room; guests open one data channel to it.
;(function (root) {
  'use strict'
  const PREFIX = 'certarena-v1-'
  const available = () => typeof root.Peer === 'function'

  function friendly(e) {
    const t = e && (e.type || e.code)
    if (t === 'peer-unavailable') return { code: 'not_found', message: 'No hay ninguna sala abierta con ese código.' }
    if (t === 'unavailable-id') return { code: 'taken', message: 'Ese código ya está en uso.' }
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return { code: 'network', message: 'No se pudo contactar con el servicio de conexión. Revisa tu conexión a internet.' }
    if (t === 'browser-incompatible' || t === 'webrtc') return { code: 'webrtc', message: 'Este navegador no permite conexiones directas. Prueba con Chrome, Edge, Firefox o Safari actualizados.' }
    return { code: t || 'error', message: 'Error de conexión (' + (t || 'desconocido') + ').' }
  }

  /** Host a room. Handlers: onGuestMessage(label, msg), onGuestLeft(label). */
  function host(code, handlers) {
    return new Promise((resolve, reject) => {
      if (!available()) { reject({ code: 'nolib', message: 'No se pudo cargar la librería de conexión.' }); return }
      const peer = new root.Peer(PREFIX + code)
      const conns = new Map() // label -> conn
      let ready = false
      const t = setTimeout(() => { if (!ready) { try { peer.destroy() } catch {} reject({ code: 'timeout', message: 'Tiempo de espera agotado al abrir la sala.' }) } }, 15000)
      peer.on('open', () => {
        ready = true; clearTimeout(t)
        resolve({
          code,
          send(label, msg) { const c = conns.get(label); if (c && c.open) try { c.send(msg) } catch {} },
          broadcast(msg) { for (const c of conns.values()) if (c.open) try { c.send(msg) } catch {} },
          count: () => conns.size,
          close() { try { peer.destroy() } catch {} },
        })
      })
      peer.on('connection', (conn) => {
        const label = conn.connectionId || conn.peer + ':' + Math.random().toString(36).slice(2)
        conns.set(label, conn)
        conn.on('data', (m) => handlers.onGuestMessage(label, m))
        const gone = () => { if (conns.delete(label)) handlers.onGuestLeft(label) }
        conn.on('close', gone)
        conn.on('error', gone)
        // ICE failures are not always reported as close
        conn.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed' || s === 'closed') gone() })
      })
      peer.on('disconnected', () => { try { peer.reconnect() } catch {} }) // keeps the code registered at the broker
      peer.on('error', (e) => { if (!ready) { clearTimeout(t); reject(friendly(e)) } })
    })
  }

  /** Join a room. Handlers: onHostMessage(msg), onClosed(). */
  function join(code, handlers) {
    return new Promise((resolve, reject) => {
      if (!available()) { reject({ code: 'nolib', message: 'No se pudo cargar la librería de conexión.' }); return }
      const peer = new root.Peer()
      let done = false
      const fail = (e) => { if (!done) { done = true; clearTimeout(t); try { peer.destroy() } catch {} reject(e) } }
      const t = setTimeout(() => fail({ code: 'timeout', message: 'No se pudo conectar con la sala. Comprueba el código y que el anfitrión siga con la página abierta.' }), 15000)
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true })
        conn.on('open', () => {
          if (done) return
          done = true; clearTimeout(t)
          resolve({
            send(msg) { if (conn.open) try { conn.send(msg) } catch {} },
            close() { try { peer.destroy() } catch {} },
            isOpen: () => conn.open,
          })
        })
        conn.on('data', (m) => handlers.onHostMessage(m))
        const closed = () => { if (done) handlers.onClosed() }
        conn.on('close', closed)
        conn.on('error', closed)
        conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') closed() })
      })
      peer.on('error', (e) => fail(friendly(e)))
    })
  }

  root.Net = { host, join, available }
})(typeof globalThis !== 'undefined' ? globalThis : this)
