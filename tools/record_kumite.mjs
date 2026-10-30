// Records the README GIF and the social preview image of CERT KUMITE from a local preview build.
// usage: npx vite build --outDir dist-e2e --mode e2e && npx vite preview --outDir dist-e2e --port 4185 &
//        PW_CHROMIUM=/path/to/chrome node tools/record_kumite.mjs <frames-dir> <og.jpg>
// then:  ffmpeg -framerate 12 -i <frames-dir>/f%04d.jpg -vf "crop=…,scale=600:-1,…palettegen/paletteuse" docs/kumite.gif
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const [OUT, OG] = process.argv.slice(2)
const URL = 'http://127.0.0.1:4185/'
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const setup = () => {
  const qs = Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, domain: 'Demo', stem: 'Pregunta de demo ' + (i + 1), options: ['Correcta', 'Mal A', 'Mal B'], answer: [0], explanation: 'Demo' }))
  localStorage.setItem('battlecert.packs', JSON.stringify([{ format: 'battlecert/1', id: 'demo', name: 'Demo', lang: 'es', source: '', license: '', questions: qs }]))
  localStorage.setItem('battlecert.settings', JSON.stringify({ mode: 'kumite', n: 10, secs: 5, domains: [], packId: 'demo', packName: 'Demo', kLen: 'short' }))
  localStorage.setItem('battlecert.fighter', '"cyber"')
  localStorage.setItem('battlecert.nick', '"David"')
  localStorage.setItem('battlecert.sound', 'false')
  window.__r = 0
  Math.random = () => window.__r
}
// social preview: the home hero
{
  const ctx = await b.newContext({ viewport: { width: 1240, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(setup)
  const p = await ctx.newPage()
  await p.goto(URL)
  await p.waitForTimeout(800)
  await p.locator('.khero').screenshot({ path: OG, type: 'jpeg', quality: 85 })
  await ctx.close()
}
const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, colorScheme: 'dark' })
await ctx.addInitScript(setup)
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
const frames = []
let rec = false
cdp.on('Page.screencastFrame', async (f) => {
  if (rec) frames.push({ t: f.metadata.timestamp, d: f.data })
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
await p.goto(URL)
await p.getByRole('button', { name: /Torneo vs CPU/ }).first().click()
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 })
// [me right, cpu right]: clash, hit, both wrong, then hits until the K.O.
const plan = [[true, true], [true, false], [false, false], [true, false], [true, false], [true, false], [true, false], [true, false]]
const segs = []
let box
for (const [i, [me]] of plan.entries()) {
  await p.locator('.opt:not([disabled])').first().waitFor({ timeout: 15000 })
  await p.getByRole('button', { name: me ? 'Correcta' : 'Mal A', exact: true }).click()
  await p.locator('.result').waitFor({ timeout: 15000 })
  await p.evaluate((v) => { window.__r = v }, plan[i + 1]?.[1] ? 0 : 0.99)
  box = await p.locator('.karena').boundingBox()
  const start = frames.length
  rec = true; await p.waitForTimeout(2300); rec = false
  segs.push([start, frames.length])
  const mark = await p.locator('.kmeter .mark').getAttribute('style')
  if (/left: (0|100)%/.test(mark || '')) { rec = true; await p.waitForTimeout(2800); rec = false; segs[segs.length - 1][1] = frames.length; break }
  const next = p.getByRole('button', { name: 'Siguiente →' })
  if (await next.count()) await next.click().catch(() => {})
}
await cdp.send('Page.stopScreencast')
let k = 0
for (const [a, z] of segs) {
  const seg = frames.slice(a, z)
  if (!seg.length) continue
  let j = 0
  for (let t = seg[0].t; t <= seg[seg.length - 1].t; t += 1 / 12) {
    while (j + 1 < seg.length && seg[j + 1].t <= t) j++
    writeFileSync(`${OUT}/f${String(k++).padStart(4, '0')}.jpg`, Buffer.from(seg[j].d, 'base64'))
  }
}
console.log(JSON.stringify({ frames: k, box }))
await b.close()
