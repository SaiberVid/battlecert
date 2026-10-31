// CERT RAID sprites, cut from the co-op atlas by tools/raid_assets.py (see src/raid/manifest.json).
import manifest from './manifest.json'

export interface Sheet { w: number; h: number; n: number; poses: string[] }
const M = manifest as unknown as Record<'rex' | 'nova' | 'gatling' | 'voraxia' | 'skyreaper' | 'fx' | 'hearts', Sheet> & { portraits: { w: number; h: number; order: string[] } }
export const RM = M
export const HERO_IDS = ['rex', 'nova'] as const
export const HERO_COLORS = ['#ff4d3d', '#3da5ff'] as const
export const BOSS_IDS = ['gatling', 'voraxia', 'skyreaper'] as const

export const frame = (sheet: Sheet, pose: string) => Math.max(0, sheet.poses.indexOf(pose))

const BASE = import.meta.env.BASE_URL + 'raid/'
export const rasset = (file: string) => BASE + file
const cache = new Map<string, Promise<HTMLImageElement>>()
export function rload(file: string): Promise<HTMLImageElement> {
  let p = cache.get(file)
  if (!p) {
    p = new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = rasset(file) })
    cache.set(file, p)
  }
  return p
}
export const portraitIndex = (id: string) => Math.max(0, M.portraits.order.indexOf(id))
