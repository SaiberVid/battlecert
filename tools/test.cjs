require('../src/packs.js'); require('../src/engine.js')
const { Packs, Engine: E } = globalThis
const assert = require('node:assert/strict')
const fs = require('fs')
const pack = JSON.parse(fs.readFileSync(__dirname + '/../packs/claude-ccdv-f.json', 'utf8'))

// importers
let r = Packs.importText(JSON.stringify(pack))
assert.equal(r.pack.questions.length, pack.questions.length); assert.equal(r.errors.length, 0)
r = Packs.importText(Packs.TEMPLATE_CSV, { name: 'CSV' })
assert.equal(r.pack.questions.length, 2); assert.deepEqual(r.pack.questions[1].answer, [0, 2]); assert.equal(r.pack.questions[0].domain, 'Redes')
r = Packs.importText('question;a;b;answer\n"Q uno";x;y;2\n', { name: 'semi' })
assert.deepEqual(r.pack.questions[0].answer, [1])
r = Packs.importText('## ¿Capital de Francia?\ndomain: Geo\n- [ ] Roma\n- [x] París\n> París.\n\n## Elige dos primos\n- [x] 2\n- [x] 3\n- [ ] 4\n', { name: 'md' })
assert.equal(r.pack.questions.length, 2); assert.deepEqual(r.pack.questions[0].answer, [1]); assert.equal(r.pack.questions[0].domain, 'Geo'); assert.deepEqual(r.pack.questions[1].answer, [0, 1])
// third-party formats (preporato-style with {a} placeholders, Amey-style multi-exam bank)
r = Packs.importText(JSON.stringify({ code: 'X', domains: [{ id: 'd1', name: 'Applications' }], questions: [{ domain: 'd1', stem: 'S?', options: { a: 'one', b: 'two' }, answer: ['b'], explanation: '{b} is right, {a} is not' }] }))
assert.equal(r.pack.questions[0].domain, 'Applications'); assert.deepEqual(r.pack.questions[0].answer, [1]); assert.ok(!/\{[a-e]\}/.test(r.pack.questions[0].explanation))
r = Packs.importText(JSON.stringify({ exams: { e1: { title: 'Exam One' } }, questions: [{ exam: 'e1', domain: 'Nets', question: 'Q?', options: { A: 'x', B: 'y' }, answer: 'B', rationale: 'because' }] }), { name: 'Amey' })
assert.equal(r.pack.questions[0].domain, 'Exam One · Nets'); assert.deepEqual(r.pack.questions[0].answer, [1])
r = Packs.importText(JSON.stringify([{ question: 'dup', options: ['a', 'b'], answer: 'a' }, { question: 'DUP', options: ['a', 'b'], answer: 'a' }, { question: 'bad', options: ['a'], answer: 'a' }]), { name: 'x' })
assert.equal(r.pack.questions.length, 1); assert.equal(r.dups, 1); assert.equal(r.errors.length, 1)
assert.ok(Packs.importText('hola').error)
assert.ok(Packs.aiPrompt('AWS SAA-C03', 20, 'en').includes('cert-arena/1'))

// engine: 3 players simultaneous with streaks, rejoin
let m = E.newMatch({ code: 'abcd', n: 4, secs: 30, packId: pack.id })
const A = E.addPlayer(m, 'David', 'L1'), B = E.addPlayer(m, 'Juanjo', 'L2'), C = E.addPlayer(m, 'Ana', 'L3')
assert.equal(E.addPlayer(m, 'david', 'L9'), null, 'online seat cannot be stolen')
E.start(m, pack, 7, 0)
assert.equal(new Set(m.qids).size, 4)
const cur = () => pack.questions.find((q) => q.id === m.qids[m.i])
let t = 0
for (let i = 0; i < 4; i++) {
  E.answer(m, pack, A.pid, cur().answer, 1000, t)
  E.answer(m, pack, B.pid, [99], 1000, t)
  if (i === 1) { C.online = false; const back = E.addPlayer(m, 'ana', 'L7'); assert.equal(back.pid, C.pid); assert.equal(back.label, 'L7') }
  E.answer(m, pack, C.pid, cur().answer, 29000, t)
  // public state hides answers and current points
  const ps = E.publicState(m, pack, t)
  assert.equal(ps.q.answer, undefined); assert.ok(ps.ans[A.pid].done)
  assert.ok(E.tick(m, pack, t + 1)); assert.equal(m.phase, 'reveal')
  assert.ok(E.publicState(m, pack, t + 1).q.answer)
  E.tick(m, pack, t + 1 + E.REVEAL_MS); t += 20000
}
assert.equal(m.phase, 'end')
const st = E.standings(m)
assert.equal(st[0].nick, 'David'); assert.equal(st[0].best, 4)
assert.equal(st[0].pts, 148 * 4 + 10 + 20 + 30) // 100 + 48 speed (1 s of 30) + streak bonus
console.log('engine/packs OK', st.map((p) => p.nick + ':' + p.pts).join(' '))
