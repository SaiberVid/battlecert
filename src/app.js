// Cert Arena UI. Vanilla JS; renders from state S. Text from packs and other players is
// always set with textContent (never innerHTML).
;(function () {
  'use strict'
  const { Engine: E, Packs, Net } = window
  const BUILTIN = JSON.parse(document.getElementById('builtin-packs').textContent)
  const COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)']
  const LET = 'ABCDEFGH'
  const HOST_LABEL = 'host'

  // ---------- storage (best effort: private windows may refuse it)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('arena.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
    set(k, v) { try { localStorage.setItem('arena.' + k, JSON.stringify(v)); return true } catch { return false } },
  }

  // ---------- state
  const S = {
    view: 'home', // home | packs | lobby | play
    nick: store.get('nick', ''),
    packs: [], // all packs (built-in + custom)
    settings: Object.assign({ packId: BUILTIN[0].id, mode: 'sim', n: 10, secs: 30, domains: [] }, store.get('settings', {})),
    role: null, // 'host' | 'guest' | 'solo'
    code: null,
    room: null, // Net host or guest handle
    M: null, // host: authoritative match
    P: null, // public state as last rendered (host builds it, guests receive it)
    myPid: null,
    local: { key: null, start: 0, deadline: 0, chosen: [], sent: null },
    labelToPid: {},
    myLog: {}, // qid -> {ok, pts, ms}
    used: [],
    history: store.get('history', []),
    msg: '', msgTone: 'warn',
    joinCode: '',
    netOk: null,
    rejoining: false,
  }
  function loadPacks() {
    const custom = store.get('packs', [])
    S.packs = [...BUILTIN, ...custom.filter((p) => p && Array.isArray(p.questions))]
    if (!S.packs.some((p) => p.id === S.settings.packId)) S.settings.packId = S.packs[0].id
  }
  loadPacks()
  const packById = (id) => S.packs.find((p) => p.id === id)
  const currentPack = () => packById(S.role === 'host' || S.role === 'solo' ? S.M?.packId : S.settings.packId) || packById(S.settings.packId)

  // ---------- helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
    return el
  }
  function rich(text) {
    const frag = document.createDocumentFragment()
    String(text || '').replace(/```[a-z]*\n?/g, '').split(/(`[^`\n]+`)/).forEach((s) => {
      if (s.length > 2 && s[0] === '`' && s.endsWith('`')) frag.append(h('code', {}, s.slice(1, -1)))
      else frag.append(document.createTextNode(s))
    })
    return frag
  }
  /** Explanations cite options as "(B)" by their original position; rewrite to the letter on screen. */
  function remap(text, options) {
    return String(text || '').replace(/\(([A-Ha-h])\)/g, (m, l) => {
      const k = 'abcdefgh'.indexOf(l.toLowerCase())
      const pos = options.findIndex((o) => o.k === k)
      return pos < 0 ? m : '(' + LET[pos] + ')'
    })
  }
  const seg = (vals, cur, pick, fmt) => h('div', { class: 'seg', role: 'group' }, vals.map((v) => h('button', { type: 'button', 'aria-pressed': String(v === cur), onclick: () => pick(v) }, fmt ? fmt(v) : String(v))))
  const say = (msg, tone) => { S.msg = msg; S.msgTone = tone || 'warn'; render() }
  const joinUrl = (code) => location.origin + location.pathname + '#join=' + code
  function randomCode() {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789'
    let s = ''
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]
    return s
  }
  function colorOf(pid) {
    const i = (S.P?.players || []).findIndex((p) => p.pid === pid)
    return COLORS[(i < 0 ? 0 : i) % COLORS.length]
  }
  const nickOf = (pid) => (S.P?.players || []).find((p) => p.pid === pid)?.nick || '¿?'

  // ---------- hosting
  async function createRoom(solo) {
    if (!S.nick.trim()) return say('Escribe tu alias.')
    store.set('nick', S.nick.trim())
    const pack = packById(S.settings.packId)
    if (!pack || !pack.questions.length) return say('Elige un pack con preguntas.')
    S.role = solo ? 'solo' : 'host'
    S.code = solo ? 'solo' : randomCode()
    S.M = E.newMatch({ code: S.code, mode: S.settings.mode, secs: S.settings.secs, n: S.settings.n, packId: pack.id, packName: pack.name, domains: S.settings.domains })
    const me = E.addPlayer(S.M, S.nick.trim(), HOST_LABEL)
    S.myPid = me.pid
    S.labelToPid = { [HOST_LABEL]: me.pid }
    S.used = []
    S.msg = ''
    if (!solo) {
      S.view = 'lobby'; render()
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          S.room = await Net.host(S.code, { onGuestMessage, onGuestLeft })
          break
        } catch (e) {
          if (e.code === 'taken') { S.code = randomCode(); S.M.code = S.code; continue }
          S.role = null; S.M = null; S.view = 'home'
          return say((e.message || 'No se pudo crear la sala.') + ' Puedes practicar solo mientras tanto.')
        }
      }
      publish()
    } else {
      startMatch()
    }
  }
  function onGuestMessage(label, m) {
    if (!S.M || !m || typeof m !== 'object') return
    if (m.t === 'hello') {
      const nick = String(m.nick || '').trim().slice(0, 20)
      if (!nick) return
      const p = E.addPlayer(S.M, nick, label, typeof m.token === 'string' ? m.token.slice(0, 40) : null)
      if (!p) { S.room.send(label, { t: 'reject', reason: S.M.players.length >= 8 ? 'La sala está llena (máximo 8).' : 'Ese alias ya está jugando. Elige otro.' }); return }
      S.labelToPid[label] = p.pid
      S.room.send(label, { t: 'welcome', pid: p.pid })
      publish()
    } else if (m.t === 'answer') {
      const pid = S.labelToPid[label]
      if (!pid || m.i !== S.M.i || m.ph !== S.M.phase || !Array.isArray(m.c)) return
      if (E.answer(S.M, currentPack(), pid, m.c.slice(0, 8), m.ms, Date.now())) { E.tick(S.M, currentPack(), Date.now()); afterChange() }
    }
  }
  function onGuestLeft(label) {
    const pid = S.labelToPid[label]
    delete S.labelToPid[label]
    if (!S.M || !pid) return
    const p = S.M.players.find((x) => x.pid === pid)
    if (!p || p.label !== label) return // already took the seat back from another connection
    if (S.M.phase === 'lobby') S.M.players = S.M.players.filter((x) => x.pid !== pid)
    else p.online = false
    publish()
  }
  function startMatch() {
    const pack = currentPack()
    E.start(S.M, pack, (Date.now() ^ (Math.random() * 1e9)) >>> 0, Date.now(), S.used)
    S.used.push(...S.M.qids)
    S.myLog = {}
    S.view = 'play'
    publish()
  }
  function rematch() {
    const old = S.M
    S.M = E.newMatch({ code: old.code, mode: old.mode, secs: old.secs, n: old.n, packId: old.packId, packName: old.packName, domains: old.domains, round: old.round, series: old.series })
    S.M.players = old.players.filter((p) => p.online !== false)
    startMatch()
  }
  function applyLobbySettings() {
    if (!S.M || S.M.phase !== 'lobby') return
    const pack = packById(S.settings.packId)
    Object.assign(S.M, { mode: S.settings.mode, secs: S.settings.secs, n: S.settings.n, packId: pack.id, packName: pack.name, domains: S.settings.domains.filter((d) => pack.questions.some((q) => q.domain === d)) })
    store.set('settings', S.settings)
    publish()
  }
  let lastCast = 0
  function publish() {
    if (!S.M) return
    const pack = currentPack()
    S.P = E.publicState(S.M, pack, Date.now())
    if (S.room && S.role === 'host') { S.room.broadcast({ t: 'state', s: S.P }); lastCast = Date.now() }
    onState()
  }
  function afterChange() {
    if (S.M.phase === 'end') saveResult(true)
    publish()
  }
  setInterval(() => {
    if ((S.role !== 'host' && S.role !== 'solo') || !S.M) return
    if (E.tick(S.M, currentPack(), Date.now())) afterChange()
    else if (S.role === 'host' && S.room && Date.now() - lastCast > 1500) publish()
    else if (S.view === 'play') tickTimer()
  }, 200)
  function hostSkip() { if (S.M && S.M.phase === 'reveal') { S.M.deadline = 0 } }

  // ---------- joining
  async function joinRoom(code) {
    code = String(code || '').trim().toLowerCase()
    if (!/^[a-z0-9]{4}$/.test(code)) return say('El código tiene 4 letras o números.')
    if (!S.nick.trim()) return say('Escribe tu alias para unirte.')
    store.set('nick', S.nick.trim())
    S.msg = ''
    S.view = 'lobby'; S.role = 'guest'; S.code = code; S.P = null; S.myPid = null
    render()
    try {
      S.room = await Net.join(code, { onHostMessage, onClosed })
    } catch (e) {
      S.role = null; S.view = 'home'
      return say(e.message || 'No se pudo entrar en la sala.')
    }
    S.room.send({ t: 'hello', nick: S.nick.trim(), token: deviceToken() })
    S.rejoining = false
    history.replaceState(null, '', location.pathname + '#join=' + code)
  }
  function onHostMessage(m) {
    if (!m || typeof m !== 'object') return
    if (m.t === 'welcome') { S.myPid = m.pid; render(); return }
    if (m.t === 'reject') { leave(); say(m.reason || 'No se pudo entrar.'); return }
    if (m.t === 'state' && m.s) { S.P = m.s; onState() }
  }
  let closedOnce = false
  function onClosed() {
    if (closedOnce || S.role !== 'guest') return
    closedOnce = true
    const code = S.code
    S.rejoining = true
    say('Conexión perdida. Reintentando…')
    let tries = 0
    const retry = async () => {
      if (S.role !== 'guest' || S.code !== code) return
      tries++
      try {
        S.room = await Net.join(code, { onHostMessage, onClosed })
        closedOnce = false
        S.room.send({ t: 'hello', nick: S.nick.trim(), token: deviceToken() })
        S.rejoining = false
        say('Reconectado.', 'ok')
      } catch { if (tries < 10) setTimeout(retry, 3000); else { S.rejoining = false; say('No se pudo reconectar. El anfitrión puede haber cerrado la sala.') } }
    }
    setTimeout(retry, 1500)
  }
  // resend until the host shows our answer
  setInterval(() => {
    if (S.role !== 'guest' || !S.room || !S.local.sent || !S.P) return
    const a = S.P.ans && S.P.ans[S.myPid]
    if ((a && a.st === (S.P.phase === 'steal')) || S.P.phase === 'reveal' || S.local.sent.i !== S.P.i || S.local.sent.ph !== S.P.phase) { S.local.sent = null; return }
    S.room.send(S.local.sent)
  }, 900)

  function deviceToken() {
    let t = store.get('token', null)
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('token', t) }
    return t
  }

  function leave() {
    try { S.room && S.room.close() } catch {}
    S.room = null; S.M = null; S.P = null; S.role = null; S.myPid = null; S.code = null; S.view = 'home'; S.rejoining = false
    if (location.hash) history.replaceState(null, '', location.pathname)
    render()
  }

  // ---------- shared: state arrival, answering, timer
  function onState() {
    const P = S.P
    const key = P.i + ':' + P.phase
    if ((P.phase === 'q' || P.phase === 'steal') && key !== S.local.key) {
      S.local = { key, start: Date.now(), deadline: Date.now() + P.rem, chosen: [], sent: null }
    }
    if (P.phase === 'reveal' && P.q && !S.myLog[P.q.id]) {
      const a = P.ans[S.myPid]
      S.myLog[P.q.id] = { ok: !!(a && a.ok), pts: a ? a.pts : 0, ms: a ? a.ms : null, domain: P.q.domain, mine: !!a }
    }
    if (P.phase === 'end' && S.role === 'guest') saveResult(false)
    const view = P.phase === 'lobby' ? 'lobby' : 'play'
    // heartbeats repeat the same state; re-render only when something visible changed
    const sig = JSON.stringify({ ...P, rem: 0 }) + S.myPid + view
    if (sig === lastSig && S.view === view) return
    lastSig = sig
    S.view = view
    render()
  }
  let lastSig = ''
  function myTurn() {
    const P = S.P
    if (!P || (P.phase !== 'q' && P.phase !== 'steal')) return false
    const steal = P.phase === 'steal'
    const elig = steal ? [P.active] : P.mode === 'turn' && P.active ? [P.active] : P.players.filter((p) => p.online !== false).map((p) => p.pid)
    if (!elig.includes(S.myPid)) return false
    const a = P.ans[S.myPid]
    return !(a && a.st === steal) && !S.local.sent
  }
  function choose(pos) {
    if (!myTurn()) return
    const opt = S.P.q.options[pos]
    if (!opt) return
    const need = S.P.q.need
    const ch = S.local.chosen
    S.local.chosen = need === 1 ? [opt.k] : ch.includes(opt.k) ? ch.filter((x) => x !== opt.k) : ch.concat(opt.k)
    if (S.local.chosen.length === need) submit()
    else render()
  }
  function submit() {
    const P = S.P
    const msg = { t: 'answer', i: P.i, ph: P.phase, c: S.local.chosen.slice(), ms: Date.now() - S.local.start }
    if (S.role === 'guest') { S.local.sent = msg; S.room && S.room.send(msg); lastSig = ''; render() }
    else {
      S.local.sent = msg
      if (E.answer(S.M, currentPack(), S.myPid, msg.c, msg.ms, Date.now())) { E.tick(S.M, currentPack(), Date.now()); afterChange() }
    }
  }
  let timerEl = null
  function ring(totalMs, leftMs) {
    const r = 27, c = 2 * Math.PI * r, frac = Math.max(0, Math.min(1, leftMs / totalMs))
    const el = h('div', { class: 'ring' + (leftMs < 5000 ? ' low' : ''), role: 'timer', 'aria-label': 'Tiempo restante' })
    el.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="' + r + '"></circle><circle class="fg" cx="32" cy="32" r="' + r + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - frac)).toFixed(2) + '"></circle></svg>'
    el.append(h('span', { class: 't mono' }, String(Math.ceil(leftMs / 1000))))
    return el
  }
  function tickTimer() {
    if (!timerEl || !S.P || (S.P.phase !== 'q' && S.P.phase !== 'steal')) return
    const total = S.P.phase === 'steal' ? E.STEAL_MS : S.P.secs * 1000
    const next = ring(total, Math.max(0, S.local.deadline - Date.now()))
    timerEl.replaceWith(next)
    timerEl = next
  }
  setInterval(() => { if (S.role === 'guest') tickTimer() }, 250)

  document.addEventListener('keydown', (e) => {
    const t = e.target
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    if (e.metaKey || e.ctrlKey || e.altKey || !S.P) return
    if (/^[1-8]$/.test(e.key)) choose(Number(e.key) - 1)
    else if ((e.key === 'Enter' || e.key === 'n' || e.key === 'N') && S.P.phase === 'reveal' && S.role !== 'guest') hostSkip()
  })

  // ---------- results (stored on every device that played)
  const savedRounds = new Set()
  function saveResult() {
    const P = S.role === 'guest' ? S.P : E.publicState(S.M, currentPack(), Date.now())
    const key = S.code + ':' + P.round
    if (savedRounds.has(key)) return
    savedRounds.add(key)
    const st = P.players.map((p) => ({ nick: p.nick, ...(P.sc[p.pid] || {}) })).sort((a, b) => (b.pts || 0) - (a.pts || 0))
    const tie = st.length > 1 && st[0].pts === st[1].pts
    if (S.role !== 'guest' && !tie && st.length > 1) { const k = st[0].nick.toLowerCase(); S.M.series[k] = (S.M.series[k] || 0) + 1 }
    S.history.unshift({
      at: Date.now(), pack: P.packName, mode: P.mode, n: P.total, solo: st.length < 2, me: S.nick.trim(),
      winner: tie || st.length < 2 ? null : st[0].nick,
      players: st.map((p) => ({ nick: p.nick, pts: p.pts || 0, ok: p.ok || 0, n: p.n || 0, ms: p.ms || 0, best: p.best || 0 })),
    })
    S.history = S.history.slice(0, 300)
    store.set('history', S.history)
  }

  // ---------- packs
  function saveCustomPacks() {
    const custom = S.packs.filter((p) => !p.builtIn)
    if (!store.set('packs', custom)) say('No hay espacio en el almacenamiento del navegador para guardar más packs.')
  }
  function addPack(pack) {
    pack.builtIn = false
    S.packs = S.packs.filter((p) => p.id !== pack.id || p.builtIn)
    if (S.packs.some((p) => p.id === pack.id)) pack.id = pack.id + '-' + Packs.hash(pack.name + Date.now())
    S.packs.push(pack)
    saveCustomPacks()
  }
  function download(name, text, type) {
    try {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type }))
      a.download = name
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch { say('Tu navegador no permite descargas aquí.') }
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); if (btn) btn.textContent = 'Copiado' } catch { if (btn) btn.textContent = 'Copia manualmente' }
  }

  // ---------- views
  const app = document.getElementById('app')
  function render() {
    const views = { home: viewHome, packs: viewPacks, lobby: viewLobby, play: viewPlay }
    app.replaceChildren(...(views[S.view] || viewHome)().filter(Boolean))
  }
  function topbar(sub) {
    return h('header', { class: 'top' },
      h('button', { class: 'brand', type: 'button', onclick: () => { if (!S.role) { S.view = 'home'; render() } }, 'aria-label': 'Inicio' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, 'CA'), h('span', {}, 'Cert Arena')),
      sub ? h('span', { class: 'label' }, sub) : null,
      S.netOk === false ? h('span', { class: 'chip' }, h('span', { class: 'dot' }), 'Solo local') : null)
  }
  function banner() { return S.msg ? h('p', { class: S.msgTone === 'ok' ? 'note okmsg' : 'warn', role: 'status' }, S.msg) : null }
  function packSelect(id) {
    return h('select', { id, onchange: (e) => { S.settings.packId = e.target.value; S.settings.domains = []; store.set('settings', S.settings); applyLobbySettings(); render() } },
      S.packs.map((p) => h('option', { value: p.id, selected: p.id === S.settings.packId }, p.name + ' · ' + p.questions.length)))
  }
  function settingsPanel(editable) {
    const pack = packById(S.settings.packId)
    const doms = pack ? Packs.domains(pack) : []
    const upd = (k, v) => { S.settings[k] = v; store.set('settings', S.settings); applyLobbySettings(); render() }
    if (!editable) {
      const P = S.P
      return h('div', { class: 'panel' },
        h('p', { class: 'label' }, 'Partida'),
        h('p', {}, h('strong', {}, P.packName)),
        h('p', { class: 'muted' }, (P.mode === 'turn' ? 'Por turnos con robo' : 'Simultáneo') + ' · ' + P.n + ' preguntas · ' + P.secs + ' s' + (P.domains.length ? ' · ' + P.domains.length + ' dominios' : '')))
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('label', { for: 'pack', class: 'label' }, 'Pack de preguntas'), packSelect('pack')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Modo'), seg(['sim', 'turn'], S.settings.mode, (v) => upd('mode', v), (v) => (v === 'sim' ? 'Simultáneo' : 'Por turnos + robo'))),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Preguntas'), seg([5, 10, 15, 20, 30], S.settings.n, (v) => upd('n', v))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Segundos'), seg([15, 20, 30, 45, 60, 90], S.settings.secs, (v) => upd('secs', v)))),
      doms.length > 1 ? h('details', { class: 'doms' },
        h('summary', {}, S.settings.domains.length ? 'Dominios: ' + S.settings.domains.length + ' seleccionados' : 'Dominios: todos'),
        h('div', { class: 'chips' }, doms.map((d) => {
          const on = S.settings.domains.includes(d.name)
          return h('button', { type: 'button', class: 'tag' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => upd('domains', on ? S.settings.domains.filter((x) => x !== d.name) : S.settings.domains.concat(d.name)) }, d.name + ' · ' + d.count)
        }))) : null)
  }

  function viewHome() {
    const nick = h('input', { type: 'text', id: 'nick', maxlength: '20', placeholder: 'Tu alias', value: S.nick, autocomplete: 'nickname', oninput: (e) => { S.nick = e.target.value } })
    const code = h('input', { type: 'text', id: 'joincode', maxlength: '4', placeholder: 'abcd', value: S.joinCode, autocomplete: 'off', inputmode: 'text', class: 'codein', oninput: (e) => { S.joinCode = e.target.value } })
    const hashJoin = (location.hash.match(/join=([a-z0-9]{4})/i) || [])[1]
    return [
      topbar(),
      h('section', { class: 'hero' },
        h('h1', {}, 'Entrena tu certificación jugando'),
        h('p', { class: 'muted lead' }, 'Rondas rápidas contra tus amigos con cualquier banco de preguntas. Misma pregunta, mismo reloj; puntúan el acierto, la rapidez y la racha.')),
      banner(),
      h('div', { class: 'panel' }, h('div', { class: 'field' }, h('label', { for: 'nick', class: 'label' }, 'Tu alias'), nick)),
      hashJoin ? h('div', { class: 'panel accentpanel' },
        h('h2', {}, 'Te han invitado a la sala ' + hashJoin.toUpperCase()),
        h('button', { class: 'btn accent big', type: 'button', onclick: () => joinRoom(hashJoin) }, 'Entrar en la sala')) : null,
      h('div', { class: 'grid2' },
        h('div', { class: 'panel' },
          h('h2', {}, 'Crear sala'),
          h('p', { class: 'muted' }, 'Elige el pack y los ajustes en la sala; tus amigos entran con QR, enlace o código.'),
          h('div', { class: 'field' }, h('label', { for: 'pack0', class: 'label' }, 'Pack'), packSelect('pack0')),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', type: 'button', disabled: S.netOk === false, onclick: () => createRoom(false) }, 'Crear sala'),
            h('button', { class: 'btn', type: 'button', onclick: () => createRoom(true) }, 'Practicar solo'))),
        h('div', { class: 'panel' },
          h('h2', {}, 'Unirse'),
          h('p', { class: 'muted' }, 'Escanea el QR del anfitrión, abre su enlace o escribe el código.'),
          h('div', { class: 'row' }, code, h('button', { class: 'btn accent', type: 'button', disabled: S.netOk === false, onclick: () => joinRoom(S.joinCode) }, 'Entrar')))),
      S.netOk === false ? h('p', { class: 'warn' }, 'No se pudo cargar la conexión en directo (sin internet o bloqueada por la red). Puedes practicar solo.') : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { S.view = 'packs'; S.msg = ''; render() } }, 'Packs de preguntas (' + S.packs.length + ')')),
      viewBoard(),
      h('p', { class: 'note' }, 'Gratis y sin cuentas: la partida va directa entre navegadores y los resultados se guardan en cada dispositivo. Los packs incluidos son de práctica, no preguntas reales de examen.'),
    ]
  }

  function viewBoard() {
    const games = S.history.filter((g) => !g.solo)
    const agg = {}
    for (const g of games) for (const p of g.players) {
      const k = p.nick.toLowerCase()
      const a = agg[k] || (agg[k] = { nick: p.nick, games: 0, wins: 0, ok: 0, n: 0, ms: 0, pts: 0, best: 0 })
      a.games++; a.ok += p.ok; a.n += p.n; a.ms += p.ms; a.pts += p.pts; a.best = Math.max(a.best, p.best || 0)
      if (g.winner && g.winner.toLowerCase() === k) a.wins++
    }
    const rows = Object.values(agg).sort((a, b) => b.wins - a.wins || b.ok / Math.max(1, b.n) - a.ok / Math.max(1, a.n))
    const solo = S.history.filter((g) => g.solo)
    const panel = h('div', { class: 'panel' }, h('h2', {}, 'Clasificación de este dispositivo'))
    if (!rows.length && !solo.length) { panel.append(h('p', { class: 'note' }, 'Juega una partida y aparecerán aquí victorias, acierto, rapidez y mejor racha.')); return panel }
    if (rows.length) panel.append(h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Jugador', 'Partidas', 'Victorias', 'Acierto', 'Tiempo medio', 'Mejor racha'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((a) => h('tr', {}, h('td', {}, a.nick), h('td', { class: 'mono' }, a.games), h('td', { class: 'mono' }, a.wins), h('td', { class: 'mono' }, a.n ? Math.round((a.ok / a.n) * 100) + ' %' : '—'), h('td', { class: 'mono' }, a.n ? (a.ms / a.n / 1000).toFixed(1) + ' s' : '—'), h('td', { class: 'mono' }, a.best)))))))
    panel.append(h('p', { class: 'label' }, 'Últimas partidas'))
    panel.append(h('div', { class: 'list' }, S.history.slice(0, 8).map((g) => h('div', { class: 'item' },
      h('span', { class: 'grow' }, g.players.map((p) => p.nick + ' ' + p.pts).join(' · ')),
      h('span', { class: 'muted mono small' }, (g.pack || '').slice(0, 28) + ' · ' + new Date(g.at).toLocaleDateString())))))
    panel.append(h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => download('cert-arena-resultados.json', JSON.stringify(S.history, null, 1), 'application/json') }, 'Exportar resultados')))
    return panel
  }

  function viewPacks() {
    const meta = { name: '', license: '' }
    const nameIn = h('input', { type: 'text', id: 'pname', placeholder: 'Nombre (p. ej. AWS SAA-C03)', oninput: (e) => { meta.name = e.target.value } })
    const area = h('textarea', { id: 'ptext', rows: '6', placeholder: 'Pega aquí JSON, CSV o Markdown…' })
    const urlIn = h('input', { type: 'url', id: 'purl', placeholder: 'https://… (JSON/CSV/Markdown público)' })
    const certIn = h('input', { type: 'text', id: 'aicert', placeholder: 'Nombre de la certificación, p. ej. AWS SAA-C03' })
    const result = h('div', {})
    const doImport = (text) => {
      const r = Packs.importText(text, { name: meta.name.trim() })
      result.replaceChildren()
      if (r.error) { result.append(h('p', { class: 'warn' }, r.error)); return }
      if (!r.pack.questions.length) { result.append(h('p', { class: 'warn' }, 'No se encontró ninguna pregunta válida.' + (r.errors.length ? ' Primer error: ' + r.errors[0] : ''))); return }
      addPack(r.pack)
      S.settings.packId = r.pack.id; store.set('settings', S.settings)
      S.msg = `Pack "${r.pack.name}" añadido: ${r.pack.questions.length} preguntas` + (r.dups ? `, ${r.dups} duplicadas descartadas` : '') + (r.errors.length ? `, ${r.errors.length} con errores ignoradas (${r.errors.slice(0, 2).join('; ')})` : '') + '.'
      S.msgTone = 'ok'
      render()
    }
    return [
      topbar('Packs'),
      h('div', { class: 'row between' }, h('h1', { class: 'h1s' }, 'Packs de preguntas'), h('button', { class: 'btn', type: 'button', onclick: () => { S.view = 'home'; S.msg = ''; render() } }, '← Volver')),
      banner(),
      h('div', { class: 'list' }, S.packs.map((p) => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('strong', {}, p.name), h('p', { class: 'muted small' }, p.questions.length + ' preguntas · ' + Packs.domains(p).length + ' dominios' + (p.builtIn ? ' · incluido' : '') + (p.license ? ' · ' + p.license : ''))),
        h('button', { class: 'btn small', type: 'button', onclick: () => download(p.id + '.json', JSON.stringify(p, null, 1), 'application/json') }, 'Descargar'),
        p.builtIn ? null : h('button', { class: 'btn small danger', type: 'button', onclick: (e) => {
          if (e.currentTarget.dataset.sure) { S.packs = S.packs.filter((x) => x !== p); saveCustomPacks(); if (S.settings.packId === p.id) S.settings.packId = S.packs[0].id; render() } else { e.currentTarget.dataset.sure = '1'; e.currentTarget.textContent = '¿Borrar?' }
        } }, 'Borrar')))),
      h('div', { class: 'panel' },
        h('h2', {}, 'Añadir un pack'),
        h('div', { class: 'field' }, h('label', { for: 'pname', class: 'label' }, 'Nombre'), nameIn),
        h('div', { class: 'field' }, h('label', { for: 'pfile', class: 'label' }, 'Desde un archivo'),
          h('input', { type: 'file', id: 'pfile', accept: '.json,.csv,.md,.txt', onchange: async (e) => { const f = e.target.files[0]; if (f) { if (!meta.name) meta.name = f.name.replace(/\.[^.]+$/, ''); doImport(await f.text()) } } })),
        h('div', { class: 'field' }, h('label', { for: 'ptext', class: 'label' }, 'O pegando el contenido'), area, h('button', { class: 'btn', type: 'button', onclick: () => doImport(area.value) }, 'Importar texto')),
        h('div', { class: 'field' }, h('label', { for: 'purl', class: 'label' }, 'O desde una URL'), h('div', { class: 'row' }, urlIn, h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { const r = await fetch(urlIn.value.trim()); if (!r.ok) throw new Error('HTTP ' + r.status); doImport(await r.text()) } catch (e) { result.replaceChildren(h('p', { class: 'warn' }, 'No se pudo descargar: ' + e.message + '. La URL debe ser pública y permitir CORS (p. ej. raw.githubusercontent.com).')) }
        } }, 'Descargar e importar'))),
        result,
        h('p', { class: 'note' }, 'Formatos: JSON de Cert Arena, listas JSON con question/options/answer, CSV con cabecera (question,a,b,c,d,answer,explanation,domain) o Markdown (## pregunta, - [x] correcta, - [ ] incorrecta, > explicación). Importa solo material que tengas derecho a usar.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => download('plantilla-cert-arena.json', JSON.stringify(Packs.TEMPLATE_JSON, null, 1), 'application/json') }, 'Plantilla JSON'),
          h('button', { class: 'btn small', type: 'button', onclick: () => download('plantilla-cert-arena.csv', Packs.TEMPLATE_CSV, 'text/csv') }, 'Plantilla CSV'))),
      h('div', { class: 'panel' },
        h('h2', {}, 'Crear un pack con IA'),
        h('p', { class: 'muted' }, 'Para cualquier certificación: copia este prompt, pégalo en Claude junto a la guía oficial del examen y pega aquí el JSON que te devuelva. Revisa las respuestas antes de jugar.'),
        h('div', { class: 'field' }, h('label', { for: 'aicert', class: 'label' }, 'Certificación'), certIn),
        h('div', { class: 'row' }, h('button', { class: 'btn accent', type: 'button', onclick: (e) => copy(Packs.aiPrompt(certIn.value.trim() || 'mi certificación', 40, 'en'), e.currentTarget) }, 'Copiar prompt (inglés, 40 preguntas)'),
          h('button', { class: 'btn', type: 'button', onclick: (e) => copy(Packs.aiPrompt(certIn.value.trim() || 'mi certificación', 40, 'es'), e.currentTarget) }, 'Copiar prompt (español)'))),
    ]
  }

  function qrBox(url) {
    const box = h('div', { class: 'qr', role: 'img', 'aria-label': 'Código QR para unirse' })
    if (typeof window.qrcode === 'function') {
      try {
        const q = window.qrcode(0, 'M'); q.addData(url); q.make()
        box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
      } catch { box.append(h('p', { class: 'note' }, 'No se pudo generar el QR.')) }
    } else box.append(h('p', { class: 'note' }, 'QR no disponible sin conexión.'))
    return box
  }

  function viewLobby() {
    const P = S.P
    const out = [topbar(S.role === 'guest' ? 'Sala ' + (S.code || '').toUpperCase() : 'Tu sala')]
    out.push(banner())
    if (!P) {
      out.push(h('div', { class: 'panel' }, h('p', {}, S.role === 'guest' ? 'Conectando con la sala ' + (S.code || '').toUpperCase() + '…' : 'Abriendo la sala…'), h('button', { class: 'btn', type: 'button', onclick: leave }, 'Cancelar')))
      return out
    }
    if (S.role === 'host') {
      const url = joinUrl(S.code)
      out.push(h('div', { class: 'panel invite' },
        qrBox(url),
        h('div', { class: 'invitext' },
          h('p', { class: 'label' }, 'Código de sala'),
          h('p', { class: 'code mono', id: 'roomcode' }, S.code.toUpperCase()),
          h('p', { class: 'muted small' }, 'Escanead el QR con la cámara del móvil o compartid el enlace.'),
          h('div', { class: 'row' },
            navigator.share ? h('button', { class: 'btn accent', type: 'button', onclick: () => navigator.share({ title: 'Cert Arena', text: 'Únete a mi sala ' + S.code.toUpperCase() + ' en Cert Arena', url }).catch(() => {}) }, 'Compartir') : null,
            h('button', { class: 'btn', type: 'button', onclick: (e) => copy(url, e.currentTarget) }, 'Copiar enlace'),
            h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent('Únete a mi sala de Cert Arena: ' + url), target: '_blank', rel: 'noopener' }, 'WhatsApp')))))
    }
    out.push(h('div', { class: 'panel' },
      h('p', { class: 'label' }, 'Jugadores (' + P.players.length + '/8)'),
      h('div', { class: 'players' }, P.players.map((p, i) => h('div', { class: 'pl', style: '--c:' + COLORS[i % 8] }, p.nick, p.pid === S.myPid ? h('small', {}, 'tú') : null, i === 0 ? h('small', {}, 'anfitrión') : null))),
      S.role === 'host' && P.players.length < 2 ? h('p', { class: 'note' }, 'Esperando a que entre alguien… También puedes empezar solo.') : null,
      S.role === 'guest' ? h('p', { class: 'muted' }, 'Esperando a que el anfitrión empiece.') : null))
    out.push(settingsPanel(S.role === 'host'))
    out.push(h('div', { class: 'row' },
      S.role === 'host' ? h('button', { class: 'btn accent big', type: 'button', onclick: startMatch }, 'Empezar') : null,
      h('button', { class: 'btn', type: 'button', onclick: leave }, S.role === 'host' ? 'Cerrar sala' : 'Salir')))
    out.push(rules(P.mode))
    return out
  }
  function rules(mode) {
    return h('div', { class: 'panel' }, h('p', { class: 'label' }, 'Puntuación'),
      h('p', {}, (mode === 'turn' ? 'Cada pregunta es de un jugador por turnos; si falla, el siguiente tiene 10 s para robarla por 50. ' : 'Todos responden la misma pregunta a la vez. ') + 'Acierto: 100 + hasta 50 por rapidez + 10 por cada acierto seguido (máx. +30). Fallo: 0.'),
      h('p', { class: 'note' }, 'Atajos: 1–8 responder · Enter pasar (anfitrión). En respuesta múltiple se envía al marcar el número pedido.'))
  }

  function scoreboard(P) {
    const turn = (P.phase === 'q' || P.phase === 'steal') && (P.mode === 'turn' || P.phase === 'steal') ? P.active : null
    return h('div', { class: 'board' }, P.players.map((p, i) => {
      const s = P.sc[p.pid] || { pts: 0, ok: 0, n: 0 }
      const a = P.ans[p.pid]
      const answered = a && (P.phase === 'reveal' || a.st === (P.phase === 'steal'))
      return h('div', { class: 'score' + (turn === p.pid ? ' turn' : '') + (p.online === false ? ' off' : ''), style: '--c:' + COLORS[i % 8] },
        h('span', { class: 'who' }, p.nick + (p.pid === S.myPid ? ' (tú)' : '')),
        h('span', { class: 'n' }, String(s.pts)),
        h('span', { class: 'mono muted small' }, s.ok + '/' + s.n + (p.online === false ? ' · desconectado' : '')),
        (P.phase === 'q' || P.phase === 'steal') && answered ? h('span', { class: 'flag' }, '✓') : null)
    }))
  }

  function viewPlay() {
    const P = S.P
    if (!P) return viewLobby()
    if (P.phase === 'end') return viewEnd()
    const q = P.q
    const out = [banner(), scoreboard(P)]
    const playing = P.phase === 'q' || P.phase === 'steal'
    const total = P.phase === 'steal' ? E.STEAL_MS : P.secs * 1000
    timerEl = playing ? ring(total, Math.max(0, S.local.deadline - Date.now())) : null
    out.push(h('div', { class: 'qhead' }, timerEl,
      h('div', { class: 'grow' }, h('p', { class: 'label' }, 'Pregunta ' + (P.i + 1) + ' de ' + P.total), h('p', { class: 'dom' }, q.domain))))
    if (playing && (P.mode === 'turn' || P.phase === 'steal') && P.players.length > 1) {
      const mine = P.active === S.myPid
      out.push(h('div', { class: 'banner', style: '--c:' + colorOf(P.active) }, P.phase === 'steal' ? (mine ? '¡Rebote! Puedes robarla por 50' : '¡Rebote! ' + nickOf(P.active) + ' puede robar') : mine ? 'Tu turno' : 'Turno de ' + nickOf(P.active)))
    }
    if (q.context) out.push(h('div', { class: 'ctx' }, rich(q.context)))
    out.push(h('p', { class: 'stem' }, rich(q.stem)))
    if (q.need > 1) out.push(h('p', { class: 'need' }, 'Elige ' + q.need + ' · se envía al marcar la última'))
    const reveal = P.phase === 'reveal'
    const can = myTurn()
    out.push(h('div', { class: 'opts', role: q.need > 1 ? 'group' : 'radiogroup' }, q.options.map((o, pos) => {
      const sel = S.local.chosen.includes(o.k) || (S.local.sent && S.local.sent.c.includes(o.k))
      let cls = 'opt' + (sel ? ' sel' : '')
      const pickers = reveal ? P.players.filter((p) => P.ans[p.pid] && (P.ans[p.pid].c || []).includes(o.k)) : []
      if (reveal) cls = 'opt' + (q.answer.includes(o.k) ? ' right' : pickers.length ? ' wrong' : '')
      return h('button', { class: cls, type: 'button', role: q.need > 1 ? 'checkbox' : 'radio', 'aria-checked': String(!!sel), disabled: !can, onclick: () => choose(pos) },
        h('span', { class: 'k mono' }, LET[pos]), h('span', { class: 'txt' }, rich(o.t)),
        pickers.length ? h('span', { class: 'picks' }, pickers.map((p) => h('span', { class: 'pick', style: '--c:' + colorOf(p.pid) }, p.nick.slice(0, 10) + (P.ans[p.pid].st ? ' (robo)' : '')))) : null)
    })))
    if (playing) {
      const a = P.ans[S.myPid]
      if (S.local.sent || (a && a.st === (P.phase === 'steal'))) out.push(h('p', { class: 'muted' }, 'Respuesta enviada. Esperando al resto…'))
      else if (!can) out.push(h('p', { class: 'muted' }, 'Piensa qué responderías.'))
    }
    if (reveal) {
      out.push(h('div', { class: 'row' }, P.players.map((p) => {
        const a = P.ans[p.pid]
        return h('span', { class: 'chip', style: 'border-color:' + colorOf(p.pid) }, h('strong', {}, p.nick),
          h('span', { class: 'gain ' + (a && a.ok ? 'ok' : 'bad') }, a ? (a.ok ? '+' + a.pts : '0') : '—'),
          a && !a.st && a.ms != null ? h('span', { class: 'mono muted small' }, (a.ms / 1000).toFixed(1) + ' s') : null)
      })))
      if (q.explanation) out.push(h('div', { class: 'panel' }, h('p', { class: 'label' }, 'Por qué'), h('p', { class: 'expl' }, rich(remap(q.explanation, q.options)))))
      out.push(h('div', { class: 'sticky row between' }, h('span', { class: 'note' }, 'Siguiente en unos segundos'),
        S.role !== 'guest' ? h('button', { class: 'btn primary', type: 'button', onclick: hostSkip }, 'Siguiente ya') : null))
    }
    return out
  }

  function viewEnd() {
    const P = S.P
    const st = P.players.map((p, i) => ({ ...p, i, ...(P.sc[p.pid] || {}) })).sort((a, b) => (b.pts || 0) - (a.pts || 0) || (b.ok || 0) - (a.ok || 0))
    const tie = st.length > 1 && st[0].pts === st[1].pts
    const me = P.sc[S.myPid] || {}
    const dom = Object.entries(me.dom || {}).map(([d, [ok, n]]) => ({ d, ok, n, acc: ok / n })).sort((a, b) => a.acc - b.acc || b.n - a.n)
    const missed = (P.review || []).filter((r) => S.myLog[r.id] && !S.myLog[r.id].ok)
    const out = [topbar('Ronda ' + P.round), banner(),
      h('h1', { class: 'h1s pop' }, st.length < 2 ? 'Ronda terminada' : tie ? 'Empate' : '¡Gana ' + st[0].nick + '!'),
      h('div', { class: 'podium' }, st.map((p, k) => h('div', { class: 'place', style: '--c:' + COLORS[p.i % 8] },
        h('span', { class: 'pos' }, String(k + 1)),
        h('div', { class: 'grow' }, h('strong', {}, p.nick + (p.pid === S.myPid ? ' (tú)' : '')),
          h('p', { class: 'stats mono' }, (p.n ? Math.round((p.ok / p.n) * 100) : 0) + ' % · ' + (p.n ? (p.ms / p.n / 1000).toFixed(1) : '—') + ' s/preg · racha ' + (p.best || 0) + (p.stl ? ' · ' + p.stl + ' robos' : ''))),
        h('span', { class: 'pts' }, String(p.pts || 0)))))]
    const series = P.series || {}
    if (Object.keys(series).length) out.push(h('p', { class: 'muted' }, 'Serie: ' + P.players.map((p) => p.nick + ' ' + (series[p.nick.toLowerCase()] || 0)).join(' – ')))
    if (dom.length) out.push(h('div', { class: 'panel' }, h('p', { class: 'label' }, 'Tus dominios en esta ronda'),
      h('div', { class: 'list' }, dom.map((d) => h('div', { class: 'item' }, h('span', { class: 'grow' }, d.d), h('span', { class: 'mono ' + (d.acc >= 0.75 ? 'okc' : d.acc >= 0.5 ? '' : 'badc') }, d.ok + '/' + d.n))))))
    out.push(h('div', { class: 'panel' }, h('p', { class: 'label' }, 'Tus fallos (' + missed.length + ')'),
      missed.length ? h('div', { class: 'list' }, missed.map((r) => h('div', { class: 'item col' }, h('span', { class: 'label' }, r.domain), h('span', {}, rich(r.stem.length > 240 ? r.stem.slice(0, 240) + '…' : r.stem)), h('span', { class: 'okc' }, '✓ ', rich(r.correct.join(' · ')))))) : h('p', {}, 'Ninguno. Ronda perfecta.')))
    const shareText = 'Cert Arena · ' + P.packName + '\n' + st.map((p, k) => (k + 1) + '. ' + p.nick + ' ' + (p.pts || 0) + ' pts (' + (p.n ? Math.round((p.ok / p.n) * 100) : 0) + ' %)').join('\n')
    out.push(h('div', { class: 'row' },
      S.role !== 'guest' ? h('button', { class: 'btn accent big', type: 'button', onclick: rematch }, 'Revancha') : h('p', { class: 'muted' }, 'El anfitrión puede lanzar la revancha.'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => (navigator.share ? navigator.share({ title: 'Cert Arena', text: shareText }).catch(() => {}) : copy(shareText, e.currentTarget)) }, 'Compartir resultado'),
      h('button', { class: 'btn', type: 'button', onclick: leave }, 'Salir')))
    return out
  }

  // ---------- boot
  function boot() {
    const m = location.hash.match(/join=([a-z0-9]{4})/i)
    if (m) S.joinCode = m[1].toLowerCase()
    S.netOk = Net.available()
    render()
    if (!S.netOk) setTimeout(() => { S.netOk = Net.available(); render() }, 2500)
  }
  window.addEventListener('beforeunload', (e) => { if (S.role === 'host' && S.M && S.M.phase !== 'lobby' && S.M.phase !== 'end') { e.preventDefault(); e.returnValue = '' } })
  boot()
})()
