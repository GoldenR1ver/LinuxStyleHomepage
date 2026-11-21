import { motionMark, MOTION_MS_MAX, TYPE_CHARS_MAX, TYPE_CPS_MAX, TYPE_CPS_MIN, type Anim } from './ansi'

/**
 * Wrap short text in a typing region. A region longer than TYPE_CHARS_MAX
 * degrades to a fade: at a readable cadence it would hold the prompt for too long.
 */
export function typewrite(text: string, cps = 90): string {
  if (!text) return text
  if ([...text].length > TYPE_CHARS_MAX) return fade(text, 3)
  return `${motionMark({ mode: 'type', rate: cps })}${text}${motionMark(null)}`
}

/**
 * Type a whole block in one region. `typewrite` turns a long region into a fade
 * so the prompt is not held; the login intro is read once and any key ends it,
 * so it is the one block allowed to type in full.
 */
export function typeBlock(text: string, cps = 240): string {
  if (!text) return text
  return `${motionMark({ mode: 'type', rate: cps })}${text}${motionMark(null)}`
}

/** Wrap lines so they arrive one after another. */
export function fade(text: string, step = 60): string {
  if (!text) return text
  return `${motionMark({ mode: 'fade', rate: step })}${text}${motionMark(null)}`
}

/**
 * Animate the first line of a block and leave the rest alone.
 * A line longer than HEADLINE_MAX is a paragraph, not a headline: typing it would
 * either mislead (a forced jump at the deadline) or hold the prompt, so it is left
 * as it is.
 */
export function headline(text: string, cps = 60): string {
  const cut = text.indexOf('\n')
  const first = cut < 0 ? text : text.slice(0, cut)
  if ([...first].length > HEADLINE_MAX) return text
  if (cut < 0) return typewrite(text, cps)
  return `${typewrite(first, cps)}${text.slice(cut)}`
}

export type { Anim }

/** Longer than this, the first line is a paragraph and is not typed. */
export const HEADLINE_MAX = 100

/** The motd may finish typing instead of snapping; a key press still skips it. */
export const INTRO_MS_MAX = 10_000

/** Characters revealed after `elapsed` ms. Never runs past the region, never goes backwards. */
export function typedCount(elapsed: number, cps: number, total: number): number {
  const rate = Math.min(TYPE_CPS_MAX, Math.max(TYPE_CPS_MIN, cps))
  const shown = Math.floor((Math.max(0, elapsed) / 1000) * rate)
  return Math.min(total, Math.max(0, shown))
}

/** How long a region of `chars` needs, bounded so no reveal holds the prompt. */
export function typeDuration(chars: number, cps: number, maxMs = MOTION_MS_MAX): number {
  const rate = Math.min(TYPE_CPS_MAX, Math.max(TYPE_CPS_MIN, cps))
  return Math.min(maxMs, (Math.max(0, chars) / rate) * 1000)
}
