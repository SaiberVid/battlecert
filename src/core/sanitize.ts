/** Removes control and invisible formatting characters (bidi overrides, zero-width…),
 *  normalises Unicode and trims. Used for every piece of text typed by another person. */
export function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .normalize('NFKC')
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** A nickname is 2–20 visible characters. Returns '' if it is not acceptable. */
export function cleanNick(s: unknown): string {
  const n = cleanText(s, 20)
  return [...n].length >= 2 ? n : ''
}

/** Object without prototype, so keys like "__proto__" from the network are plain keys. */
export function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const AVATARS = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦁', '🐯', '🐨', '🐵', '🦄', '🐲', '🐧', '🦈', '🐝', '🦖', '🐢', '👾', '🤖', '🧙', '🥷', '🧠', '🔥', '⚡', '🎯']
export const REACTIONS = ['👏', '🔥', '😮', '😂', '💀', '🧠']
