// Tiny MQTT 3.1.1 broker over WebSocket (QoS 0, exact-topic subscriptions) for e2e tests of
// the encrypted relay, so tests never touch the public brokers.
import { WebSocketServer, type WebSocket } from 'ws'

export function startBroker(port: number) {
  const wss = new WebSocketServer({ port, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) })
  const subs = new Map<WebSocket, Set<string>>()
  wss.on('connection', (ws) => {
    subs.set(ws, new Set())
    let buf = Buffer.alloc(0)
    ws.on('message', (data: Buffer) => {
      buf = Buffer.concat([buf, data])
      for (;;) {
        if (buf.length < 2) return
        let mult = 1, len = 0, i = 1, byte = 0
        do { if (i >= buf.length) return; byte = buf[i++]; len += (byte & 127) * mult; mult *= 128 } while (byte & 128)
        if (buf.length < i + len) return
        const pkt = buf.subarray(0, i + len)
        const body = buf.subarray(i, i + len)
        buf = buf.subarray(i + len)
        const type = pkt[0] & 0xf0
        if (type === 0x10) ws.send(Buffer.from([0x20, 2, 0, 0]))
        else if (type === 0x80) {
          const tl = body.readUInt16BE(2)
          subs.get(ws)!.add(body.subarray(4, 4 + tl).toString())
          ws.send(Buffer.from([0x90, 3, body[0], body[1], 0]))
        } else if (type === 0x30) {
          const topic = body.subarray(2, 2 + body.readUInt16BE(0)).toString()
          for (const [c, t] of subs) if (t.has(topic) && c.readyState === c.OPEN) c.send(Buffer.from(pkt))
        } else if (type === 0xc0) ws.send(Buffer.from([0xd0, 0]))
        else if (type === 0xe0) ws.close()
      }
    })
    ws.on('close', () => subs.delete(ws))
  })
  return { close: () => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()) }) }
}
