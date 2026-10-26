import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FAKE = readFileSync(fileURLToPath(new URL('./fakepeer.js', import.meta.url)), 'utf8')

async function open(ctx: BrowserContext, path = '/') {
  const p = await ctx.newPage()
  p.on('dialog', (d) => void d.accept())
  await p.goto(path)
  return p
}
async function profile(p: Page, nick: string) {
  await p.getByPlaceholder('Cómo te verán los demás').fill(nick)
}
async function host(p: Page, nick: string, opts: { mode?: string; n?: string; pin?: boolean } = {}) {
  await profile(p, nick)
  if (opts.mode) await p.locator('.mode', { hasText: opts.mode }).first().click()
  await p.getByRole('group', { name: 'Número de preguntas' }).getByRole('button', { name: opts.n ?? '5', exact: true }).click()
  if (opts.pin) await p.getByLabel(/Proteger la sala con PIN/).check()
  await p.getByRole('button', { name: 'Crear sala' }).click()
  const code = (await p.locator('.code').first().textContent())!.trim()
  expect(code).toMatch(/^[a-z0-9]{6}$/)
  return code
}
async function joinByCode(p: Page, nick: string, code: string) {
  await profile(p, nick)
  await p.locator('#code').fill(code)
  await p.getByRole('button', { name: 'Entrar' }).click()
}
async function answerAll(pages: Page[], pick = 0) {
  for (const p of pages) {
    const btn = p.locator('.opt:not([disabled])').nth(pick)
    if (await btn.count()) await btn.click().catch(() => {})
  }
}

test.beforeEach(async ({ context }) => { await context.addInitScript(FAKE) })

test('three players play a full classic match', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Hostia', { n: '5' })
  const a = await open(context, '/#j=' + code)
  await expect(a.getByText('Te han invitado a la sala')).toBeVisible()
  await profile(a, 'Ana')
  await a.getByRole('button', { name: 'Entrar' }).click()
  const b = await open(context)
  await joinByCode(b, 'Beto', code)
  await expect(h.locator('.pl')).toHaveCount(3)
  await expect(b.locator('.pl')).toHaveCount(3)
  await h.getByRole('button', { name: /Empezar con 3/ }).click()

  for (let i = 0; i < 5; i++) {
    await expect(h.locator('.opt').first()).toBeEnabled({ timeout: 10_000 })
    await expect(a.locator('.opt').first()).toBeEnabled()
    await expect(b.locator('.opt').first()).toBeEnabled()
    // before the reveal nobody can see the answer
    await expect(a.locator('.opt.right')).toHaveCount(0)
    await answerAll([h, a, b], i % 2)
    await expect(h.locator('.result')).toBeVisible()
    await expect(a.locator('.result')).toBeVisible()
    await expect(a.locator('.opt.right').first()).toBeVisible()
    await h.getByRole('button', { name: 'Siguiente →' }).click()
  }
  for (const p of [h, a, b]) await expect(p.getByRole('heading', { name: 'Clasificación' })).toBeVisible()
  await expect(a.locator('.table tbody tr')).toHaveCount(3)
  await expect(a.locator('.review details')).toHaveCount(5)
  // rematch keeps everyone in the room
  await h.getByRole('button', { name: 'Revancha' }).click()
  await expect(a.locator('.opt').first()).toBeEnabled({ timeout: 10_000 })
  // the result went to everyone's history
  const hist = await a.evaluate(() => JSON.parse(localStorage.getItem('battlecert.history') || '[]').length)
  expect(hist).toBeGreaterThan(0)
})

test('PIN protects the room; the invite link carries it', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Host', { pin: true })
  const pin = (await h.locator('.chip', { hasText: 'PIN' }).locator('b').textContent())!.trim()
  const intruder = await open(context)
  await joinByCode(intruder, 'Intruso', code)
  await expect(intruder.getByRole('alert')).toContainText('PIN incorrecto')
  await expect(h.locator('.pl')).toHaveCount(1)
  const friend = await open(context, `/#j=${code}&p=${pin}`)
  await profile(friend, 'Amiga')
  await friend.getByRole('button', { name: 'Entrar' }).click()
  await expect(h.locator('.pl')).toHaveCount(2)
})

test('host can kick, and the kicked player cannot come back', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Host')
  const g = await open(context)
  await joinByCode(g, 'Pesado', code)
  await expect(h.locator('.pl')).toHaveCount(2)
  await h.getByRole('button', { name: 'Expulsar a Pesado' }).click()
  await expect(g.getByRole('alert')).toContainText('expulsado')
  await expect(h.locator('.pl')).toHaveCount(1)
  await joinByCode(g, 'Pesado', code)
  await expect(g.getByRole('alert')).toContainText('expulsado')
})

test('a guest who reloads mid-game gets their seat back', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Host', { n: '5' })
  const g = await open(context)
  await joinByCode(g, 'Vuelvo', code)
  await expect(h.locator('.pl')).toHaveCount(2)
  await h.getByRole('button', { name: /Empezar con 2/ }).click()
  await expect(g.locator('.opt').first()).toBeEnabled({ timeout: 10_000 })
  await answerAll([h, g])
  await expect(g.locator('.result')).toBeVisible()
  await g.reload()
  await g.getByRole('button', { name: 'Entrar' }).click()
  await expect(g.locator('.score')).toHaveCount(2, { timeout: 10_000 })
  await expect(h.locator('.score', { hasText: 'Vuelvo' })).toHaveCount(1)
})

test('wager mode: bet ×3 wins or loses 300', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Host', { mode: 'Apuesta', n: '5' })
  const g = await open(context)
  await joinByCode(g, 'Jugona', code)
  await expect(h.locator('.pl')).toHaveCount(2)
  await expect(g.locator('.chip', { hasText: 'Apuesta' })).toBeVisible()
  await h.getByRole('button', { name: /Empezar con 2/ }).click()
  await expect(g.getByRole('group', { name: 'Apuesta' })).toBeVisible({ timeout: 10_000 })
  await g.getByRole('button', { name: '×3' }).click()
  await answerAll([h, g])
  const pts = (await g.locator('.result .pts').textContent())!.trim()
  expect(['+3', '-300'].some((x) => pts.startsWith(x))).toBe(true)
})

test('hostile guest messages are dropped and text is never rendered as HTML', async ({ context }) => {
  const h = await open(context)
  const code = await host(h, 'Host')
  const evil = await open(context)
  await evil.evaluate(async (code) => {
    const P = (window as unknown as { __FakePeer: new () => { on: Function; connect: Function } }).__FakePeer
    const peer = new P()
    await new Promise((r) => peer.on('open', r))
    const c = peer.connect('battlecert-v1-' + code)
    await new Promise((r) => c.on('open', r))
    // junk, oversized, prototype tricks, flood
    c.send({ t: 'eval', code: 'alert(1)' })
    c.send({ t: 'hello', nick: 'x'.repeat(10_000), avatar: '🦊', token: 'abcdefgh' })
    c.send(JSON.parse('{"t":"hello","__proto__":{"polluted":1},"nick":"Proto","avatar":"🦊","token":"abcdefgh"}'))
    c.send({ t: 'hello', nick: '<img src=x onerror="window.pwned=1">', avatar: '<script>', token: 'evilevil1' })
    for (let i = 0; i < 300; i++) c.send({ t: 'answer', i: 0, ph: 'q', c: [0], ms: 0 })
  }, code)
  await expect(h.locator('.pl', { hasText: '<img' })).toHaveCount(1, { timeout: 5000 })
  const state = await h.evaluate(() => ({ pwned: (window as unknown as { pwned?: number }).pwned, polluted: ({} as Record<string, unknown>).polluted, imgs: document.querySelectorAll('.pl img').length }))
  expect(state).toEqual({ pwned: undefined, polluted: undefined, imgs: 0 })
  // the avatar was not on the whitelist, so the host replaced it
  await expect(h.locator('.pl', { hasText: '<img' }).locator('.em')).not.toHaveText('<script>')
  // the room still works for a real player
  const g = await open(context)
  await joinByCode(g, 'Normal', code)
  await expect(h.locator('.pl')).toHaveCount(3)
})

test('solo practice and pack import', async ({ context }) => {
  const p = await open(context)
  await profile(p, 'Sola')
  await p.getByRole('button', { name: 'Gestionar packs →' }).click()
  await p.getByRole('tab', { name: 'Importar' }).click()
  await p.getByPlaceholder('{"format":"battlecert/1", "questions":[…]}').fill(JSON.stringify([
    { question: '¿Capital de Francia?', options: ['Roma', 'París'], answer: 'b', explanation: 'París.', domain: 'Geo' },
    { question: '¿2+2?', options: ['4', '5'], answer: 'a', explanation: 'Suma.', domain: 'Mates' },
    { question: 'roto', options: [], answer: 'a' },
  ]))
  await p.getByLabel('Nombre del pack (opcional)').fill('Mi pack')
  await p.getByRole('button', { name: 'Validar' }).click()
  await expect(p.getByText('2 preguntas válidas')).toBeVisible()
  await expect(p.getByText('1 preguntas con errores')).toBeVisible()
  await p.getByRole('button', { name: 'Guardar pack' }).click()
  await p.getByRole('button', { name: '← Volver' }).click()
  await expect(p.locator('.packrow[aria-pressed="true"]')).toContainText('Mi pack')
  await p.getByRole('button', { name: 'Practicar solo' }).click()
  for (let i = 0; i < 2; i++) {
    await expect(p.locator('.opt').first()).toBeEnabled({ timeout: 10_000 })
    await p.locator('.opt').first().click()
    await p.getByRole('button', { name: 'Siguiente →' }).click()
  }
  await expect(p.getByRole('heading', { name: 'Clasificación' })).toBeVisible()
})
