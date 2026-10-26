// Cert Arena game engine. Pure state machine run by the host; guests only render what
// the host broadcasts (the host sends each question, so guests never need the pack).
;(function (root) {
  'use strict'

  const STEAL_MS = 10000
  const REVEAL_MS = 9000
  const BASE = 100
  const SPEED_MAX = 50
  const STREAK_STEP = 10
  const STREAK_MAX = 30
  const STEAL_PTS = 50

  function rng(seed) {
    let a = seed >>> 0
    return function () {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function shuffle(arr, rand) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t }
    return a
  }
  const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.every((x) => a.includes(x))

  /** Picks n question ids, round-robin across domains, avoiding ids used earlier in the series. */
  function pick(pack, n, seed, opts) {
    opts = opts || {}
    const rand = rng(seed)
    const used = new Set(opts.exclude || [])
    const doms = opts.domains && opts.domains.length ? new Set(opts.domains) : null
    let pool = pack.questions.filter((q) => (!doms || doms.has(q.domain)) && !used.has(q.id))
    if (pool.length < n) pool = pack.questions.filter((q) => !doms || doms.has(q.domain))
    const by = {}
    for (const q of shuffle(pool, rand)) (by[q.domain] = by[q.domain] || []).push(q)
    const keys = shuffle(Object.keys(by), rand)
    const out = []
    while (out.length < n && keys.some((k) => by[k].length)) for (const k of keys) if (out.length < n && by[k].length) out.push(by[k].shift().id)
    return out
  }

  /** Points for an answer. Streak bonus rewards consecutive correct answers (not steals). */
  function points(ok, ms, limitMs, steal, streak) {
    if (!ok) return 0
    if (steal) return STEAL_PTS
    const left = Math.max(0, Math.min(1, 1 - ms / limitMs))
    const bonus = Math.min(STREAK_MAX, Math.max(0, (streak - 1) * STREAK_STEP))
    return BASE + Math.round(SPEED_MAX * left) + bonus
  }

  function newMatch(o) {
    return {
      code: o.code, mode: o.mode || 'sim', secs: o.secs || 30, n: o.n || 10,
      packId: o.packId || '', packName: o.packName || '', domains: o.domains || [],
      players: [], // {pid, nick, label, online}
      qids: [], i: -1, phase: 'lobby', active: null, stealFrom: null,
      ans: {}, // pid -> {c, ms, ok, pts, st}
      sc: {}, // pid -> {pts, ok, n, ms, streak, best, stl, dom:{domain:[ok,n]}}
      round: o.round || 0, series: o.series || {},
      deadline: 0, order: {}, // qid -> shuffled option indexes
    }
  }

  /** `token` is a per-device secret: it lets the same person take their seat back after a
   *  reload even before the host notices the old connection dropped. */
  function addPlayer(m, nick, label, token) {
    const key = String(nick).trim().slice(0, 20)
    if (!key) return null
    const existing = m.players.find((p) => p.nick.toLowerCase() === key.toLowerCase())
    if (existing) {
      // same alias coming back (reload, new device): take over the seat if it is free
      if (existing.online && existing.label !== label && !(token && existing.token === token)) return null
      existing.label = label; existing.online = true
      if (token) existing.token = token
      return existing
    }
    if (m.players.length >= 8) return null
    const p = { pid: 'p' + (m.players.length + 1) + Math.random().toString(36).slice(2, 5), nick: key, label, online: true, token: token || null }
    m.players.push(p)
    if (m.phase !== 'lobby') m.sc[p.pid] = blankScore()
    return p
  }
  const blankScore = () => ({ pts: 0, ok: 0, n: 0, ms: 0, streak: 0, best: 0, stl: 0, dom: {} })

  function start(m, pack, seed, now, exclude) {
    m.qids = pick(pack, m.n, seed, { domains: m.domains, exclude })
    const rand = rng(seed ^ 0x9e3779b9)
    m.order = {}
    for (const id of m.qids) { const q = pack.questions.find((x) => x.id === id); m.order[id] = shuffle(q.options.map((_, k) => k), rand) }
    m.sc = {}
    for (const p of m.players) m.sc[p.pid] = blankScore()
    m.round += 1
    m.i = -1
    return next(m, now)
  }

  function next(m, now) {
    m.i += 1
    m.ans = {}
    m.stealFrom = null
    if (m.i >= m.qids.length) { m.phase = 'end'; m.deadline = 0; m.active = null; return m }
    m.phase = 'q'
    m.deadline = now + m.secs * 1000
    const seated = m.players.filter((p) => p.online !== false)
    m.active = m.mode === 'turn' && seated.length ? seated[m.i % seated.length].pid : null
    return m
  }

  function eligible(m) {
    if (m.phase === 'q') return m.mode === 'turn' && m.active ? [m.active] : m.players.filter((p) => p.online !== false).map((p) => p.pid)
    if (m.phase === 'steal') return [m.active]
    return []
  }

  function record(s, domain, ok, ms) {
    s.n += 1; s.ms += ms
    const d = s.dom[domain] || (s.dom[domain] = [0, 0])
    d[1] += 1
    if (ok) { s.ok += 1; d[0] += 1; s.streak += 1; s.best = Math.max(s.best, s.streak) } else s.streak = 0
  }

  /** Applies an answer (choice = displayed option indexes mapped back to pack indexes). */
  function answer(m, pack, pid, choice, ms, now) {
    if (!eligible(m).includes(pid)) return false
    const steal = m.phase === 'steal'
    if (m.ans[pid] && m.ans[pid].st === steal) return false
    if (now > m.deadline + 1500) return false
    const q = pack.questions.find((x) => x.id === m.qids[m.i])
    const limit = steal ? STEAL_MS : m.secs * 1000
    const msC = Math.max(0, Math.min(limit, Number(ms) || limit))
    const c = (Array.isArray(choice) ? choice : []).map(Number).filter((k) => Number.isInteger(k) && k >= 0 && k < q.options.length).slice(0, q.options.length)
    const ok = sameSet(c, q.answer)
    const s = m.sc[pid] || (m.sc[pid] = blankScore())
    if (!steal) record(s, q.domain, ok, msC)
    else if (ok) s.stl += 1
    const pts = points(ok, msC, limit, steal, s.streak)
    s.pts += pts
    m.ans[pid] = { c, ms: msC, ok, pts, st: steal }
    return true
  }

  /** Time-driven transitions; returns true when the state changed. */
  function tick(m, pack, now) {
    if (m.phase === 'reveal') { if (now >= m.deadline) { next(m, now); return true } return false }
    if (m.phase !== 'q' && m.phase !== 'steal') return false
    const need = eligible(m)
    const done = need.every((p) => m.ans[p] && m.ans[p].st === (m.phase === 'steal'))
    if (!done && now < m.deadline) return false
    const q = pack.questions.find((x) => x.id === m.qids[m.i])
    if (m.phase === 'q') for (const pid of need) if (!m.ans[pid]) record(m.sc[pid] || (m.sc[pid] = blankScore()), q.domain, false, m.secs * 1000)
    const seated = m.players.filter((p) => p.online !== false)
    if (m.mode === 'turn' && m.phase === 'q' && seated.length > 1) {
      const a = m.ans[m.active]
      if (!a || !a.ok) {
        const idx = seated.findIndex((p) => p.pid === m.active)
        m.stealFrom = m.active
        m.active = seated[(idx + 1) % seated.length].pid
        m.phase = 'steal'
        m.deadline = now + STEAL_MS
        return true
      }
    }
    m.phase = 'reveal'
    m.deadline = now + REVEAL_MS
    return true
  }

  function standings(m) {
    return m.players.map((p) => ({ ...p, ...(m.sc[p.pid] || blankScore()) })).sort((a, b) => b.pts - a.pts || b.ok - a.ok || a.ms - b.ms)
  }

  /** What every screen needs, without leaking the answer before the reveal. */
  function publicState(m, pack, now) {
    const q = m.i >= 0 && m.i < m.qids.length ? pack.questions.find((x) => x.id === m.qids[m.i]) : null
    const reveal = m.phase === 'reveal' || m.phase === 'end'
    const playing = m.phase === 'q' || m.phase === 'steal'
    const ans = {}
    for (const [pid, a] of Object.entries(m.ans)) ans[pid] = reveal ? a : { done: 1, st: a.st }
    // during a question, scores are shown as they were before it
    const sc = {}
    for (const [pid, s] of Object.entries(m.sc)) {
      const a = m.ans[pid]
      sc[pid] = playing && a ? { ...s, pts: s.pts - a.pts, ok: s.ok - (a.ok && !a.st ? 1 : 0), n: s.n - (a.st ? 0 : 1), streak: undefined, dom: undefined } : { ...s, dom: m.phase === 'end' ? s.dom : undefined }
    }
    const out = {
      code: m.code, mode: m.mode, secs: m.secs, n: m.n, packName: m.packName, domains: m.domains,
      players: m.players.map((p) => ({ pid: p.pid, nick: p.nick, online: p.online })), i: m.i, total: m.qids.length, phase: m.phase, active: m.active, stealFrom: m.stealFrom,
      ans, sc, round: m.round, series: m.series, rem: m.deadline ? Math.max(0, m.deadline - now) : 0,
    }
    if (q) {
      const order = m.order[q.id] || q.options.map((_, k) => k)
      out.q = {
        id: q.id, domain: q.domain, stem: q.stem, context: q.context,
        options: order.map((k) => ({ k, t: q.options[k] })), need: q.answer.length,
      }
      if (reveal) { out.q.answer = q.answer; out.q.explanation = q.explanation }
    }
    if (m.phase === 'end') {
      out.review = m.qids.map((id) => { const x = pack.questions.find((y) => y.id === id); return { id, domain: x.domain, stem: x.stem, correct: x.answer.map((k) => x.options[k]) } })
    }
    return out
  }

  root.Engine = { pick, points, newMatch, addPlayer, start, next, eligible, answer, tick, standings, publicState, sameSet, rng, shuffle, STEAL_MS, REVEAL_MS }
})(typeof globalThis !== 'undefined' ? globalThis : this)
