// Test double for PeerJS: pages in the same browser context talk over BroadcastChannel,
// so end-to-end tests run offline and deterministic. Only used by the VITE_E2E=1 build.
(function () {
  const bus = new BroadcastChannel('fakepeer-bus')
  const listeners = new Set()
  bus.onmessage = (e) => listeners.forEach((f) => f(e.data))
  class Em { constructor() { this.h = {} } on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); return this } emit(ev, ...a) { (this.h[ev] || []).slice().forEach((f) => f(...a)) } }
  class Conn extends Em {
    constructor(cid, me, other) {
      super(); this.connectionId = cid; this.me = me; this.peer = other; this.open = false
      this.ch = new BroadcastChannel('fakeconn-' + cid)
      this.ch.onmessage = (e) => {
        const m = e.data
        if (m.to !== this.me) return
        if (m.k === 'open') { if (!this.open) { this.open = true; this.emit('open') } }
        else if (m.k === 'data' && this.open) this.emit('data', m.d)
        else if (m.k === 'close' && this.open) { this.open = false; this.emit('close') }
      }
    }
    send(d) { if (this.open) this.ch.postMessage({ to: this.peer, k: 'data', d: JSON.parse(JSON.stringify(d)) }) }
    close() { if (!this.open) return; this.open = false; this.ch.postMessage({ to: this.peer, k: 'close' }); this.emit('close') }
  }
  class Peer extends Em {
    constructor(id) {
      super(); this.id = id || 'rnd' + Math.random().toString(36).slice(2, 8); this.conns = []; this.dead = false
      const nonce = Math.random()
      let taken = false
      this.onBus = (m) => {
        if (this.dead) return
        if (m.k === 'connect' && m.to === this.id) {
          const c = new Conn(m.cid, this.id, m.from); this.conns.push(c); this.emit('connection', c)
          setTimeout(() => { c.ch.postMessage({ to: m.from, k: 'open' }); c.open = true; c.emit('open') }, 20)
        }
        if (m.k === 'who' && m.id === this.id && m.nonce !== nonce) bus.postMessage({ k: 'here', id: this.id, nonce: m.nonce })
        if (m.k === 'here' && m.nonce === nonce) taken = true
      }
      listeners.add(this.onBus)
      if (id) bus.postMessage({ k: 'who', id, nonce })
      setTimeout(() => { if (taken) this.emit('error', { type: 'unavailable-id' }); else this.emit('open', this.id) }, 80)
    }
    connect(id) {
      const cid = Math.random().toString(36).slice(2), c = new Conn(cid, this.id, id)
      this.conns.push(c)
      const nonce = Math.random()
      let found = false
      const f = (m) => { if (m.k === 'here' && m.nonce === nonce) found = true }
      listeners.add(f); bus.postMessage({ k: 'who', id, nonce })
      setTimeout(() => { listeners.delete(f); if (!found) this.emit('error', { type: 'peer-unavailable' }); else bus.postMessage({ k: 'connect', to: id, from: this.id, cid }) }, 150)
      return c
    }
    reconnect() {}
    destroy() { this.dead = true; listeners.delete(this.onBus); this.conns.forEach((c) => c.close()) }
  }
  window.__FakePeer = Peer
})()
