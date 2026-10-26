// Builds dist/index.html: one self-contained page (built-in packs + all scripts inlined).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
const r = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const packs = readdirSync(new URL('../packs/', import.meta.url)).filter((f) => f.endsWith('.json')).sort((x, y) => (x.includes('ccdv') ? -1 : y.includes('ccdv') ? 1 : x.localeCompare(y))).map((f) => JSON.parse(r('packs/' + f)))
const safe = (s) => s.replace(/<\/script/gi, '<\\/script')
let html = r('src/index.html')
html = html.replace('__PACKS__', () => JSON.stringify(packs).replace(/</g, '\\u003c'))
for (const [k, f] of [['PACKS_JS', 'src/packs.js'], ['ENGINE_JS', 'src/engine.js'], ['NET_JS', 'src/net.js'], ['APP_JS', 'src/app.js']]) html = html.replace('/*' + k + '*/', () => safe(r(f)))
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
writeFileSync(new URL('../dist/index.html', import.meta.url), html)
console.log('dist/index.html', Math.round(html.length / 1024), 'KB,', packs.length, 'packs,', packs.reduce((s, p) => s + p.questions.length, 0), 'questions')
