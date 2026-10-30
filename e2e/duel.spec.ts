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
/** Answers on every page; multiple-response questions ("Elige 2") get as many picks as needed. */
async function answerAll(pages: Page[], pick = 0) {
  for (const p of pages) {
    const needText = (await p.locator('.need').count()) ? await p.locator('.need').textContent() : ''
    const need = Number(/\d+/.exec(needText || '')?.[0] || 1)
    for (let k = 0; k < need; k++) {
      const btn = p.locator('.opt:not([disabled])').nth((pick + k) % 4)
      if (await btn.count()) await btn.click().catch(() => {})
    }
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

test.describe('encrypted relay fallback', () => {
  let broker: { close(): Promise<void> }
  test.beforeAll(async () => { const { startBroker } = await import('./mqtt-broker'); broker = startBroker(4181) })
  test.afterAll(async () => { await broker.close() })

  test('a guest whose network blocks the direct connection plays through the relay', async ({ context }) => {
    await context.addInitScript(() => { Object.assign(window, { __RelayOn: true, __RelayBrokers: ['ws://127.0.0.1:4181'] }) })
    const h = await open(context)
    const code = await host(h, 'Host', { n: '5' })
    await expect(h.locator('.dot.on')).toHaveCount(2, { timeout: 10_000 }) // direct + relay ready
    const link = await h.locator('a', { hasText: 'WhatsApp' }).getAttribute('href')
    const url = decodeURIComponent(link!.split('text=')[1]).split('aquí: ')[1]
    expect(url).toContain('&k=')
    const g = await context.newPage()
    await g.addInitScript(() => { Object.assign(window, { __FakePeerIceFail: true }) })
    await g.goto(url.replace(/^https?:\/\/[^/]+/, ''))
    await profile(g, 'Movil')
    await g.getByRole('button', { name: 'Entrar' }).click()
    await expect(g.getByText('Conectado por la vía alternativa cifrada')).toBeVisible({ timeout: 20_000 })
    await expect(h.locator('.pl')).toHaveCount(2)
    await h.getByRole('button', { name: /Empezar con 2/ }).click()
    await expect(g.locator('.opt').first()).toBeEnabled({ timeout: 10_000 })
    await answerAll([h, g])
    await expect(g.locator('.result')).toBeVisible()
    await expect(g.locator('.opt.right').first()).toBeVisible()
    void code
  })

  test('with only the code and a blocked network, the guest gets a clear, lasting explanation', async ({ context }) => {
    await context.addInitScript(() => { Object.assign(window, { __RelayOn: true, __RelayBrokers: ['ws://127.0.0.1:4181'], __FakePeerIceFail: true }) })
    const h = await open(context)
    const code = await host(h, 'Host')
    const g = await open(context)
    await joinByCode(g, 'Movil', code)
    const alert = g.getByRole('alert').filter({ hasText: 'No se pudo entrar' })
    await expect(alert).toContainText('enlace o el QR', { timeout: 30_000 })
    await g.waitForTimeout(8000)
    await expect(alert).toBeVisible() // does not vanish like a toast
  })

  test('a room code nobody is hosting says so', async ({ context }) => {
    const g = await open(context)
    await joinByCode(g, 'Solo', 'zzzzzz')
    await expect(g.getByRole('alert').filter({ hasText: 'No se pudo entrar' })).toContainText('No hay ninguna sala abierta', { timeout: 30_000 })
  })
})

/** Fake Gemini API: enough behaviour to drive the whole pipeline. */
function mockGemini(opts: { dayLimit?: (model: string, prompt: string) => boolean } = {}) {
  const st = { calls: 0, k: 0, sawKeyInUrl: false, read: 0, yt: false, urlTool: false, extractPages: 0, models: [] as string[] }
  const handler = async (route: import('@playwright/test').Route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (/[?&]key=/.test(req.url())) st.sawKeyInUrl = true
    expect(req.headers()['x-goog-api-key']).toBe('AIzaTEST')
    if (req.url().includes('/models?')) return route.fulfill({ headers: cors, body: JSON.stringify({ models: ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-2.5-flash-image-preview'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }) })
    const model = /models\/([^:]+):/.exec(req.url())![1]
    st.models.push(model)
    st.calls++
    const body = JSON.parse(req.postData() || '{}')
    const parts = body.contents[0].parts as { text?: string; inline_data?: unknown; file_data?: { file_uri: string } }[]
    const prompt = parts.map((p) => p.text ?? '').join('\n')
    if (st.calls === 1) return route.fulfill({ status: 429, headers: cors, body: JSON.stringify({ error: { code: 429, message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } }) })
    if (opts.dayLimit?.(model, prompt)) return route.fulfill({ status: 429, headers: cors, body: JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }) })
    const reply = (obj: unknown) => route.fulfill({ headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(obj) + '\n```' }] } }] }) })
    if (prompt.includes('"notes"')) {
      st.read++
      if (parts.some((p) => p.file_data?.file_uri.includes('youtube.com'))) { st.yt = true; return reply({ questions: [], notes: [{ src: 0, title: 'Vídeo repaso', text: 'Autopilot registra dispositivos con el hash de hardware.' }], more: false }) }
      if (body.tools?.[0]?.url_context) st.urlTool = true
      expect(body.generationConfig.responseMimeType).toBeUndefined() // JSON mode is off when tools are used
      expect(prompt).toContain('[0] https://example.com/md-102-questions')
      expect(prompt).toContain('[1] https://example.org/otra')
      return reply({ questions: [
        { src: 0, stem: '¿Qué registra un dispositivo en Autopilot?', options: ['Hash de hardware', 'MDM', 'GPO'], sourceAnswer: [1], answer: [0], explanation: 'Autopilot usa el hash de hardware.', domain: 'Gestionar dispositivos', concept: 'Autopilot', difficulty: 1 },
        { src: 1, stem: 'Contoso necesita bloquear equipos sin BitLocker. ¿Qué configuras?', options: ['Directiva de cumplimiento', 'Perfil Wi-Fi', 'Script'], sourceAnswer: [0], answer: [0], explanation: 'Cumplimiento + acceso condicional.', domain: 'Identidad y cumplimiento', difficulty: 2 },
      ], notes: [{ src: 0, title: 'Preguntas web', text: 'Autopilot y cumplimiento.' }, { src: 1, text: 'NO DISPONIBLE' }], skipped: 1, more: false })
    }
    if (prompt.includes('"blueprint"')) {
      expect(parts.some((p) => p.inline_data)).toBe(true)
      expect(prompt).toContain('Autopilot registra') // notes read from the video reach later steps
      return reply({ blueprint: [{ domain: 'Identidad y cumplimiento', weight: '15-20%' }, { domain: 'Gestionar dispositivos', weight: 40 }, { domain: 'Aplicaciones', weight: 20 }], concepts: [
        { name: 'Autopilot', domain: 'Gestionar dispositivos', weight: 5, summary: 'Aprovisionamiento', facts: ['Hash de hardware'], traps: ['Confundir con MDM'] },
        { name: 'Compliance', domain: 'Identidad y cumplimiento', weight: 3, summary: 'Directivas de cumplimiento', facts: ['Acceso condicional'] },
        { name: 'Win32 apps', domain: 'Aplicaciones', weight: 2, summary: 'Empaquetado intunewin', facts: ['IntuneWinAppUtil'] },
      ], style: 'Escenarios Contoso.', questionsInSources: 1 })
    }
    if (prompt.includes('Extrae las preguntas tipo test')) {
      st.extractPages++
      expect(prompt).not.toContain('Autopilot registra') // only local files/text, not notes
      return reply({ questions: [{ stem: '¿Qué herramienta empaqueta apps Win32?', options: ['IntuneWinAppUtil', 'MSIX'], sourceAnswer: null, answer: [0], explanation: 'Crea el .intunewin.', domain: 'Aplicaciones', difficulty: 1 }], more: false })
    }
    if (prompt.includes('preguntas tipo test NUEVAS')) {
      expect(prompt).toContain('Preguntas reales de las fuentes')
      const quotas = [...prompt.matchAll(/- (\d+) × dificultad (\d) sobre "([^"]+)"/g)]
      const questions = quotas.flatMap((m) => Array.from({ length: Number(m[1]) }, () => {
        st.k++
        return { concept: m[3], domain: m[3] === 'Autopilot' ? 'Gestionar dispositivos' : m[3] === 'Win32 apps' ? 'Aplicaciones' : 'Identidad y cumplimiento', difficulty: Number(m[2]), stem: `Nueva ${m[3]} ${m[2]}-${st.k}${st.k === 2 ? ' TRAMPA' : ''}?`, options: ['Correcta', 'B', 'C', 'D'], answer: [0], explanation: 'Porque sí.' }
      }))
      return reply({ questions })
    }
    if (prompt.includes('Responde estas preguntas')) {
      const qs = JSON.parse(prompt.split('\n').find((l) => l.startsWith('[{'))!) as { i: number; stem: string }[]
      return reply({ answers: qs.map((q) => ({ i: q.i, answer: q.stem.includes('TRAMPA') ? [1] : [0], ok: true })) })
    }
    return route.fulfill({ status: 500, headers: cors, body: '{}' })
  }
  return { st, handler }
}

async function fillNotebook(p: Page) {
  await profile(p, 'Estudiante')
  await p.getByRole('button', { name: 'Gestionar packs →' }).click()
  await p.getByRole('tab', { name: '✨ Crear con IA' }).click()
  await p.getByPlaceholder(/MD-102, Bases de datos/).fill('MD-102')
  await p.locator('input[type=file]').first().setInputFiles({ name: 'guia-md102.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') })
  for (const u of ['https://example.com/md-102-questions', 'https://example.org/otra', 'https://www.youtube.com/watch?v=abcdefghijk']) {
    await p.getByPlaceholder(/Enlace a una web/).fill(u)
    await p.getByRole('button', { name: 'Añadir', exact: true }).click()
  }
  await p.getByPlaceholder(/o pega texto/).fill('## ¿Qué es Intune?\n- [x] MDM en la nube\n- [ ] Un antivirus')
  await p.getByRole('button', { name: 'Añadir texto' }).click()
  await expect(p.getByRole('list', { name: 'Fuentes' }).locator('li')).toHaveCount(5)
  await p.getByRole('group', { name: 'Preguntas nuevas' }).getByRole('button', { name: '20', exact: true }).click()
  await p.getByLabel('Estilo del examen').selectOption('microsoft')
  await p.getByPlaceholder('AIza…').fill('AIzaTEST')
}

test('source notebook: extract, correct and generate questions; switches model when one runs out', async ({ context }) => {
  // the best model has no daily quota left: the run must continue with the next one
  const { st, handler } = mockGemini({ dayLimit: (m) => m === 'gemini-3.8-flash' })
  await context.route('https://generativelanguage.googleapis.com/**', handler)
  const p = await open(context)
  await fillNotebook(p)
  await p.getByRole('button', { name: 'Crear pack' }).click()
  await expect(p.getByRole('heading', { name: /guardado/ })).toBeVisible({ timeout: 60_000 })
  await expect(p.getByText('📥 3 de tus fuentes')).toBeVisible()
  await expect(p.getByText('✨ 19 nuevas')).toBeVisible() // 20 − 1 dropped by the blind check
  await expect(p.getByText('⚠️ 1 respuestas corregidas')).toBeVisible()
  await expect(p.getByText('📊 3 dominios con peso')).toBeVisible()
  await expect(p.getByText('🖼 1 con imagen omitidas')).toBeVisible()
  expect({ read: st.read, yt: st.yt, urlTool: st.urlTool, extractPages: st.extractPages }).toEqual({ read: 2, yt: true, urlTool: true, extractPages: 1 }) // 2 links in ONE request + 1 video
  expect(st.models).not.toContain('gemini-2.5-flash-image-preview')
  expect(st.models.filter((m) => m === 'gemini-3.8-flash').length).toBeLessThanOrEqual(2) // abandoned at once
  expect(st.models.at(-1)).toBe('gemini-2.5-flash')
  expect(st.calls).toBeLessThan(14)
  expect(st.sawKeyInUrl).toBe(false)
  expect(await p.evaluate(() => localStorage.getItem('battlecert.geminiKey'))).toBe('""')
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('battlecert.packs')!).find((x: { name: string }) => x.name === 'MD-102'))
  expect(saved.blueprint[0]).toEqual({ domain: 'Identidad y cumplimiento', weight: 17.5 }) // '15-20%' → midpoint
  const fixed = saved.questions.find((q: { stem: string }) => q.stem.startsWith('¿Qué registra'))
  expect(fixed.answer).toEqual([0])
  expect(fixed.explanation).toContain('La fuente marcaba «MDM»')

  await p.getByRole('button', { name: 'Jugar con este pack' }).click()
  await p.getByRole('group', { name: 'Dificultad' }).getByRole('button', { name: /Difíciles/ }).click()
  await p.getByRole('button', { name: 'Practicar solo' }).click()
  await expect(p.locator('.diff')).toHaveText('Difícil', { timeout: 10_000 })
})

test('daily quota exhausted everywhere: work is saved and continues later', async ({ context }) => {
  let quotaGone = true
  // every model runs out while writing new questions
  const { handler } = mockGemini({ dayLimit: (_m, prompt) => quotaGone && prompt.includes('preguntas tipo test NUEVAS') })
  await context.route('https://generativelanguage.googleapis.com/**', handler)
  const p = await open(context)
  await fillNotebook(p)
  await p.getByRole('button', { name: 'Crear pack' }).click()
  const alert = p.getByRole('alert')
  await expect(alert).toContainText('Se ha agotado la cuota gratuita de hoy', { timeout: 60_000 })
  await expect(alert).toContainText('Ya están guardadas 3 preguntas en “MD-102”')
  await expect(alert).toContainText('Continuar')
  await expect(p.getByRole('heading', { name: /a medias/ })).toBeVisible()
  // reloading keeps the unfinished run (IndexedDB)
  await p.reload()
  await p.getByRole('button', { name: 'Gestionar packs →' }).click()
  await p.getByRole('tab', { name: '✨ Crear con IA' }).click()
  await expect(p.getByRole('heading', { name: 'Tienes “MD-102” a medias' })).toBeVisible()
  await expect(p.getByText('3 preguntas extraídas')).toBeVisible()
  // next day: quota is back
  quotaGone = false
  await p.getByPlaceholder('AIza…').fill('AIzaTEST')
  await p.getByRole('button', { name: 'Continuar' }).click()
  await expect(p.getByRole('heading', { name: /guardado/ })).toBeVisible({ timeout: 60_000 })
  const packs = await p.evaluate(() => JSON.parse(localStorage.getItem('battlecert.packs')!).filter((x: { name: string }) => x.name === 'MD-102'))
  expect(packs).toHaveLength(1) // continued into the same pack, no duplicate
  expect(packs[0].questions.length).toBe(22) // 3 from sources + 19 new
  await expect(p.getByRole('heading', { name: /a medias/ })).toHaveCount(0)
})

test('manual mode: master prompt and pasting several chat answers', async ({ context }) => {
  const p = await open(context)
  await p.getByRole('button', { name: 'Gestionar packs →' }).click()
  await p.getByRole('tab', { name: '✨ Crear con IA' }).click()
  await p.getByPlaceholder(/MD-102, Bases de datos/).fill('MD-102')
  await p.getByRole('group', { name: 'Motor' }).getByRole('button', { name: /Manual/ }).click()
  await expect(p.locator('pre.prompt')).toContainText('Extrae TODAS las preguntas')
  const a1 = { format: 'battlecert/1', name: 'MD-102', blueprint: [{ domain: 'Apps', weight: 20 }], questions: [{ origin: 'source', stem: '¿P1?', options: ['a', 'b'], answer: [0], explanation: 'x', difficulty: 1, domain: 'Apps' }], continue: true }
  const a2 = { questions: [{ origin: 'ai', stem: '¿P2 con {llaves}?', options: ['a', 'b'], answer: [1], explanation: 'y', difficulty: 3, domain: 'Apps' }] }
  await p.getByPlaceholder(/Pega aquí la respuesta/).fill('```json\n' + JSON.stringify(a1) + '\n```\nsigue\n' + JSON.stringify(a2))
  await p.getByRole('button', { name: 'Guardar pack' }).click()
  await expect(p.getByText('📥 1 de tus fuentes')).toBeVisible()
  await expect(p.getByText('✨ 1 nuevas')).toBeVisible()
})

test.describe('CERT KUMITE', () => {
  test('tournament vs CPU: choose a fighter, fight, lose by ring-out and retry', async ({ context }) => {
    // CPU always right and quick: you get pushed off the short platform in a few rounds
    await context.addInitScript(() => { Math.random = () => 0 })
    const p = await open(context)
    await profile(p, 'David')
    await p.locator('.mode', { hasText: 'CERT KUMITE' }).click()
    await p.getByRole('group', { name: 'Plataforma' }).getByRole('button', { name: 'Corto' }).click()
    await p.locator('.kpick-b', { hasText: 'Vexa' }).click()
    await p.getByRole('button', { name: 'Torneo vs CPU' }).click()
    await expect(p.locator('canvas.kstage')).toBeVisible({ timeout: 10_000 })
    await expect(p.locator('.khud')).toContainText('David')
    await expect(p.locator('.khud')).toContainText('CPU')
    for (let i = 0; i < 12; i++) {
      if (await p.getByRole('heading', { name: /gana|Victoria|Empate/ }).count()) break
      const opt = p.locator('.opt:not([disabled])').last()
      await opt.waitFor({ timeout: 15_000 }).catch(() => {})
      await opt.click().catch(() => {})
      await p.locator('.result').waitFor({ timeout: 15_000 }).catch(() => {})
      const next = p.getByRole('button', { name: 'Siguiente →' })
      if (await next.count()) await next.click().catch(() => {})
    }
    await expect(p.getByRole('heading', { name: /gana/ })).toBeVisible({ timeout: 20_000 })
    await expect(p.getByText('K.O.', { exact: false }).first()).toBeVisible()
    await expect(p.locator('.ladder .rung')).toHaveCount(7) // the 7 other fighters
    await p.getByRole('button', { name: 'Reintentar' }).click()
    await expect(p.locator('.opt:not([disabled])').first()).toBeVisible({ timeout: 10_000 })
    await expect(p.locator('.ladder')).toHaveCount(0)
  })

  test('two players online pick fighters and clash when both are right', async ({ context }) => {
    const h = await open(context)
    await profile(h, 'Host')
    await h.locator('.mode', { hasText: 'CERT KUMITE' }).click()
    await h.locator('.kpick-b', { hasText: 'Gonzo' }).click()
    await h.getByRole('button', { name: 'Crear sala' }).click()
    const code = (await h.locator('.code').first().textContent())!.trim()
    const g = await open(context)
    await joinByCode(g, 'Guest', code)
    await expect(h.locator('.kvs')).toContainText('Guest')
    await g.locator('.kpick-b', { hasText: 'Riot' }).click()
    await expect(h.locator('.kvs')).toContainText('Riot')
    await expect(h.locator('.kvs')).toContainText('Gonzo')
    await h.getByRole('button', { name: /Empezar con 2/ }).click()
    for (const p of [h, g]) await expect(p.locator('.opt:not([disabled])').first()).toBeVisible({ timeout: 10_000 })
    await expect(g.locator('.khud')).toContainText('Host')
    // both pick the same option: both right (clash) or both wrong (stumble) — nobody moves either way
    await h.locator('.opt').first().click()
    await g.locator('.opt').first().click()
    await expect(g.locator('.result')).toBeVisible()
    const before = await g.locator('.kmeter .mark').getAttribute('style')
    expect(before).toContain('left: 50%')
  })
})
