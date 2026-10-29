export interface Question {
  id: string
  domain: string
  stem: string
  context?: string
  options: string[]
  /** 0-based option indexes; more than one = multiple response */
  answer: number[]
  explanation: string
  /** 1 easy · 2 medium · 3 hard (missing = medium) */
  difficulty?: 1 | 2 | 3
  /** The key concept this question checks (links to Pack.concepts) */
  concept?: string
}

/** A key concept of the syllabus: the study sheet shown before playing. */
export interface Concept {
  name: string
  domain?: string
  /** 1–5: how much it weighs for passing */
  weight: number
  summary: string
  traps?: string[]
}

export type DiffMode = 'mix' | 'ladder' | 'easy' | 'medium' | 'hard'

export interface Pack {
  format: 'cert-arena/1' | 'battlecert/1'
  id: string
  name: string
  lang: string
  source: string
  license: string
  builtIn?: boolean
  concepts?: Concept[]
  questions: Question[]
}

export type Mode = 'classic' | 'turns' | 'blitz' | 'survival' | 'wager'

export interface MatchSettings {
  mode: Mode
  n: number
  secs: number
  domains: string[]
  diff?: DiffMode
  packId: string
  packName: string
}

export interface Player {
  pid: string
  nick: string
  avatar: string
  online: boolean
}

export interface Answer {
  c: number[]
  ms: number
  ok: boolean
  pts: number
  st: boolean // steal
  bet?: number
}

export interface Score {
  pts: number
  ok: number
  n: number
  ms: number
  streak: number
  best: number
  stl: number
  lives: number
  out: boolean
  dom: Record<string, [number, number]>
}

export type Phase = 'lobby' | 'countdown' | 'q' | 'steal' | 'reveal' | 'end'

/** What the host broadcasts. Never contains the answer before the reveal. */
export interface PublicState {
  code: string
  settings: MatchSettings
  players: Player[]
  i: number
  total: number
  phase: Phase
  active: string | null
  ans: Record<string, Answer | { done: 1; st: boolean }>
  sc: Record<string, Score>
  round: number
  series: Record<string, number>
  rem: number
  q?: {
    id: string
    domain: string
    stem: string
    context?: string
    options: { k: number; t: string }[]
    need: number
    difficulty?: 1 | 2 | 3
    answer?: number[]
    explanation?: string
  }
  review?: { id: string; domain: string; stem: string; correct: string[] }[]
}
