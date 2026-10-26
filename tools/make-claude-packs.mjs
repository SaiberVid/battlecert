// Converts the Claude Cert Trainer bank into three Cert Arena packs.
import { readFileSync, writeFileSync } from 'node:fs'
const bank = JSON.parse(readFileSync(new URL('../../duel/bank.json', import.meta.url), 'utf8'))
const NAMES = { 'CCDV-F': 'Claude Certified Developer – Foundations (CCDV-F)', 'CCAR-F': 'Claude Certified Architect – Foundations (CCAR-F)', 'CCAR-P': 'Claude Certified Architect – Professional (CCAR-P)' }
for (const cert of Object.keys(NAMES)) {
  const qs = bank.filter((q) => q.c === cert).map((q) => ({
    id: q.id, domain: q.d, stem: q.s, context: q.x,
    options: q.o.map((o) => o[1]),
    answer: q.k.map((k) => q.o.findIndex((o) => o[0] === k)),
    explanation: q.e,
  }))
  const pack = { format: 'cert-arena/1', id: 'claude-' + cert.toLowerCase(), name: NAMES[cert], lang: 'en', builtIn: true,
    source: 'Claude Cert Trainer (preguntas originales; explicaciones en español) + preporato/claude-certification-guide y Amey-Thakur/CLAUDE-CERTIFICATIONS (MIT)',
    license: 'Originales: uso personal. Bancos comunitarios: MIT.', questions: qs }
  writeFileSync(new URL('../packs/' + pack.id + '.json', import.meta.url), JSON.stringify(pack))
  console.log(pack.id, qs.length)
}
