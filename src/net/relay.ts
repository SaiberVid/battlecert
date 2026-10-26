// Fallback transport for networks where a direct WebRTC connection cannot be opened
// (mobile data, strict NATs, corporate Wi-Fi) and no TURN server is available for free.
// Messages go through a free public MQTT broker over WebSocket, end-to-end encrypted with
// AES-GCM. The key and the topic come from a random room secret that only travels in the
// invite link/QR fragment (#…&k=…), which browsers never send to any server. The broker only
// sees random-looking topics and ciphertext.

const PUBLIC_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt']
/** e2e builds can point the relay at a local test broker. */
const brokers = (): string[] => (import.meta.env.VITE_E2E === '1' && (window as unknown as { __RelayBrokers?: string[] }).__RelayBrokers) || PUBLIC_BROKERS
const MAX_PAYLOAD = 300 * 1024

// ---------------------------------------------------------------- minimal MQTT 3.1.1 client (QoS 0)
const te = new TextEncoder()
const td = new TextDecoder()

function remLen(n: number): number[] {
  const out: number[] = []
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b) } while (n > 0)
  return out
}
function str(s: string): number[] { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b] }
function packet(type: number, body: number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  const head = [type, ...remLen(body.length)]
  const out = new Uint8Array(head.length + body.length)
  out.set(head, 0); out.set(body, head.length)
  return out
}

export class Mqtt {
  private ws: WebSocket | null = null
  private buf = new Uint8Array(0)
  private pid = 1
  private ping: ReturnType<typeof setInterval> | null = null
  onMessage: (topic: string, payload: Uint8Array) => void = () => {}
  onClose: () => void = () => {}
  closed = false
  readonly url: string
  constructor(url: string) { this.url = url }

  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (err?: string) => { if (settled) return; settled = true; clearTimeout(t); if (err) { this.close(); reject(new Error(err)) } else resolve() }
      const t = setTimeout(() => done('timeout'), timeoutMs)
      let ws: WebSocket
      try { ws = new WebSocket(this.url, 'mqtt') } catch { return done('blocked') }
      this.ws = ws
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        const id = new Uint8Array(10)
        crypto.getRandomValues(id)
        const clientId = 'bc' + [...id].map((x) => x.toString(16).padStart(2, '0')).join('')
        ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 60, ...str(clientId)]))
      }
      ws.onmessage = (e) => this.feed(new Uint8Array(e.data as ArrayBuffer), (type, body) => {
        if (type === 0x20) { if (body[1] === 0) { done(); this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 25_000) } else done('refused') }
      })
      ws.onerror = () => done('error')
      ws.onclose = () => { done('closed'); this.shutdown() }
    })
  }

  private feed(chunk: Uint8Array, onPacket: (type: number, body: Uint8Array) => void) {
    const b = new Uint8Array(this.buf.length + chunk.length)
    b.set(this.buf); b.set(chunk, this.buf.length)
    this.buf = b
    for (;;) {
      if (this.buf.length < 2) return
      let mult = 1, len = 0, i = 1, byte = 0
      do {
        if (i >= this.buf.length) return
        byte = this.buf[i++]; len += (byte & 127) * mult; mult *= 128
        if (i > 5) { this.close(); return } // malformed
      } while (byte & 128)
      if (len > MAX_PAYLOAD * 2) { this.close(); return }
      if (this.buf.length < i + len) return
      const first = this.buf[0]
      const type = first & 0xf0
      const body = this.buf.slice(i, i + len)
      this.buf = this.buf.slice(i + len)
      if (type === 0x30) {
        const tl = (body[0] << 8) | body[1]
        const qos = (first >> 1) & 3
        const off = 2 + tl + (qos ? 2 : 0)
        this.onMessage(td.decode(body.slice(2, 2 + tl)), body.slice(off))
      } else onPacket(type, body)
    }
  }

  private raw(p: Uint8Array<ArrayBuffer>) { try { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(p) } catch { /* ignore */ } }
  subscribe(topic: string) { const id = this.pid++ & 0xffff || 1; this.raw(packet(0x82, [id >> 8, id & 255, ...str(topic), 0])) }
  publish(topic: string, payload: Uint8Array) {
    const t = str(topic)
    const body = new Uint8Array(t.length + payload.length)
    body.set(t); body.set(payload, t.length)
    this.raw(packet(0x30, body))
  }
  get open() { return !this.closed && this.ws?.readyState === WebSocket.OPEN }
  private shutdown() {
    if (this.closed) return
    this.closed = true
    if (this.ping) clearInterval(this.ping)
    this.onClose()
  }
  close() {
    try { this.raw(new Uint8Array([0xe0, 0])); this.ws?.close() } catch { /* ignore */ }
    this.shutdown()
  }
}

// ---------------------------------------------------------------- crypto
export function newSecret(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const isSecret = (s: string) => /^[A-Za-z0-9_-]{22}$/.test(s)

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export interface RoomCrypto { topic: string; key: CryptoKey }
export async function roomCrypto(secret: string): Promise<RoomCrypto> {
  const topic = 'battlecert/v1/' + hex(await crypto.subtle.digest('SHA-256', te.encode('battlecert-topic:' + secret))).slice(0, 32)
  const raw = await crypto.subtle.digest('SHA-256', te.encode('battlecert-key:' + secret))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { topic, key }
}
export async function seal(rc: RoomCrypto, obj: unknown): Promise<Uint8Array> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, rc.key, te.encode(JSON.stringify(obj))))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv); out.set(ct, 12)
  return out
}
export async function unseal(rc: RoomCrypto, data: Uint8Array): Promise<unknown> {
  if (data.length < 29 || data.length > MAX_PAYLOAD) return undefined
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, rc.key, data.slice(12))
    return JSON.parse(td.decode(pt))
  } catch { return undefined } // wrong key or tampered: ignore
}

// ---------------------------------------------------------------- host / guest over the relay
const GUEST_ID = /^[a-f0-9]{20}$/
const SILENCE_MS = 20_000

export interface RelayHost { send(label: string, msg: unknown): void; broadcast(msg: unknown): void; drop(label: string): void; close(): void; brokers(): number }

export async function relayHost(secret: string, on: { message(label: string, data: unknown): void; left(label: string): void; joined(label: string): void }): Promise<RelayHost> {
  const rc = await roomCrypto(secret)
  const clients = new Map<string, Mqtt>() // broker url → client
  const guests = new Map<string, { via: string; seen: number }>() // label → route
  let closed = false

  const route = async (url: string, payload: Uint8Array) => {
    const env = (await unseal(rc, payload)) as { f?: unknown; k?: unknown; d?: unknown } | undefined
    if (!env || typeof env.f !== 'string' || !GUEST_ID.test(env.f)) return
    const label = 'r:' + env.f
    let g = guests.get(label)
    if (env.k === 'knock') {
      if (!g && guests.size >= 16) return
      const fresh = !g
      g = { via: url, seen: Date.now() }
      guests.set(label, g)
      void sendTo(label, { k: 'ack' })
      if (fresh) on.joined(label)
      return
    }
    if (!g) return
    g.seen = Date.now()
    g.via = url
    if (env.k === 'bye') { guests.delete(label); on.left(label); return }
    if ('d' in env) on.message(label, env.d)
  }
  const sendTo = async (label: string, env: unknown) => {
    const g = guests.get(label)
    const c = g && clients.get(g.via)
    if (!c?.open) return
    c.publish(rc.topic + '/g/' + label.slice(2), await seal(rc, env))
  }
  const connect = async (url: string) => {
    if (closed) return
    const c = new Mqtt(url)
    c.onMessage = (topic, payload) => { if (topic === rc.topic + '/h') void route(url, payload) }
    c.onClose = () => { clients.delete(url); if (!closed) setTimeout(() => void connect(url).catch(() => {}), 3000) }
    await c.connect()
    c.subscribe(rc.topic + '/h')
    clients.set(url, c)
  }
  await Promise.allSettled(brokers().map((u) => connect(u)))
  if (!clients.size) {
    // keep trying in the background; the direct connection may still work
    for (const u of brokers()) setTimeout(() => void connect(u).catch(() => {}), 5000)
  }
  const watchdog = setInterval(() => {
    const now = Date.now()
    for (const [label, g] of guests) if (now - g.seen > SILENCE_MS) { guests.delete(label); on.left(label) }
  }, 4000)
  return {
    send(label, msg) { void sendTo(label, { d: msg }) },
    broadcast(msg) { for (const label of guests.keys()) void sendTo(label, { d: msg }) },
    drop(label) { if (guests.delete(label)) on.left(label) },
    close() { closed = true; clearInterval(watchdog); for (const c of clients.values()) c.close(); clients.clear() },
    brokers: () => clients.size,
  }
}

export interface RelayGuest { send(msg: unknown): void; close(): void }

/** Tries each broker in turn; resolves once the host acknowledges us. */
export async function relayJoin(secret: string, on: { message(data: unknown): void; closed(): void }, ackTimeoutMs = 5000): Promise<RelayGuest> {
  const rc = await roomCrypto(secret)
  const idb = new Uint8Array(10)
  crypto.getRandomValues(idb)
  const id = [...idb].map((x) => x.toString(16).padStart(2, '0')).join('')
  const me = rc.topic + '/g/' + id
  for (const url of brokers()) {
    const c = new Mqtt(url)
    try { await c.connect() } catch { continue }
    let acked = false
    let ended = false
    let seen = Date.now()
    let resolveAck: () => void = () => {}
    const ack = new Promise<void>((r) => { resolveAck = r })
    c.onMessage = (topic, payload) => {
      if (topic !== me) return
      void unseal(rc, payload).then((env) => {
        const e = env as { k?: unknown; d?: unknown } | undefined
        if (!e) return
        seen = Date.now()
        if (e.k === 'ack') { acked = true; resolveAck() } else if ('d' in e && acked) on.message(e.d)
      })
    }
    const end = () => { if (ended) return; ended = true; clearInterval(watch); if (acked) on.closed() }
    c.onClose = end
    const watch = setInterval(() => { if (acked && Date.now() - seen > SILENCE_MS) { c.close() } }, 4000)
    c.subscribe(me)
    const knock = async () => c.publish(rc.topic + '/h', await seal(rc, { f: id, k: 'knock' }))
    await knock()
    const retry = setInterval(() => void knock(), 1500) // the subscription may land after the first knock
    await Promise.race([ack, new Promise((r) => setTimeout(r, ackTimeoutMs))])
    clearInterval(retry)
    if (!acked) { ended = true; clearInterval(watch); c.close(); continue }
    return {
      send(msg) { if (c.open) void seal(rc, { f: id, d: msg }).then((p) => c.publish(rc.topic + '/h', p)) },
      close() { if (c.open) void seal(rc, { f: id, k: 'bye' }).then((p) => { c.publish(rc.topic + '/h', p); setTimeout(() => c.close(), 100) }); else c.close(); ended = true; clearInterval(watch) },
    }
  }
  throw new Error('relay-unavailable')
}
