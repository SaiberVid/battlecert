import { create } from 'zustand'
import { z } from 'zod'
import type { MatchSettings, Pack, PublicState } from './core/types'
import { PackSchema } from './core/packs'
import { AVATARS } from './core/sanitize'
import ccdv from './data/claude-ccdv-f.json'
import ccarf from './data/claude-ccar-f.json'
import ccarp from './data/claude-ccar-p.json'

export const BUILTIN: Pack[] = [ccdv, ccarf, ccarp].map((p) => ({ ...(p as unknown as Pack), format: 'battlecert/1', builtIn: true }))

// ---------- storage (best effort: private windows can refuse it)
export const storage = {
  get<T>(k: string, schema: z.ZodType<T>, d: T): T {
    try { const v = localStorage.getItem('battlecert.' + k); if (v == null) return d; const r = schema.safeParse(JSON.parse(v)); return r.success ? r.data : d } catch { return d }
  },
  set(k: string, v: unknown): boolean { try { localStorage.setItem('battlecert.' + k, JSON.stringify(v)); return true } catch { return false } },
}

const ResultSchema = z.object({
  at: z.number(), pack: z.string(), mode: z.string(), n: z.number(), solo: z.boolean(), me: z.string(), winner: z.string().nullable(),
  players: z.array(z.object({ nick: z.string(), avatar: z.string().optional(), pts: z.number(), ok: z.number(), n: z.number(), ms: z.number(), best: z.number() })),
})
export type Result = z.infer<typeof ResultSchema>
const SettingsSchema = z.object({ mode: z.enum(['classic', 'turns', 'blitz', 'survival', 'wager']), n: z.number(), secs: z.number(), domains: z.array(z.string()), packId: z.string(), packName: z.string() })

export interface Local { key: string; start: number; deadline: number; chosen: number[]; sent: { i: number; ph: string; c: number[]; ms: number; bet?: number } | null; bet: number }
export interface Reaction { id: number; pid: string; e: string }

export type Role = null | 'host' | 'guest' | 'solo'
export type View = 'home' | 'packs' | 'room'

interface State {
  view: View
  nick: string
  avatar: string
  sound: boolean
  packs: Pack[]
  settings: MatchSettings
  history: Result[]
  // session
  role: Role
  code: string | null
  pin: string | null
  usePin: boolean
  P: PublicState | null
  myPid: string | null
  local: Local
  msg: { text: string; tone: 'warn' | 'ok' } | null
  reactions: Reaction[]
  myLog: Record<string, { ok: boolean; pts: number }>
  set: (p: Partial<State>) => void
  say: (text: string, tone?: 'warn' | 'ok') => void
}

const custom = storage.get('packs', z.array(PackSchema), []) as Pack[]
const savedSettings = storage.get('settings', SettingsSchema, { mode: 'classic', n: 10, secs: 30, domains: [], packId: BUILTIN[0].id, packName: BUILTIN[0].name })

export const blankLocal = (): Local => ({ key: '', start: 0, deadline: 0, chosen: [], sent: null, bet: 1 })

export const useStore = create<State>((set) => ({
  view: 'home',
  nick: storage.get('nick', z.string().max(20), ''),
  avatar: storage.get('avatar', z.string().refine((a) => AVATARS.includes(a)), AVATARS[Math.floor(Math.random() * AVATARS.length)]),
  sound: storage.get('sound', z.boolean(), true),
  packs: [...BUILTIN, ...custom.map((p) => ({ ...p, builtIn: false }))],
  settings: savedSettings,
  history: storage.get('history', z.array(ResultSchema), []),
  role: null, code: null, pin: null, usePin: storage.get('usePin', z.boolean(), false), P: null, myPid: null, local: blankLocal(), msg: null, reactions: [], myLog: {},
  set: (p) => set(p),
  say: (text, tone = 'warn') => set({ msg: { text, tone } }),
}))

export const S = () => useStore.getState()

export function saveCustomPacks() {
  if (!storage.set('packs', S().packs.filter((p) => !p.builtIn).map(({ builtIn: _b, ...p }) => p))) S().say('No queda espacio en el navegador para guardar más packs. Borra alguno.')
}
export function updateSettings(p: Partial<MatchSettings>) {
  const settings = { ...S().settings, ...p }
  useStore.setState({ settings })
  storage.set('settings', settings)
}
