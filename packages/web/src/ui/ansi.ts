export interface Anim {
  mode: 'type' | 'fade'
  /** Characters per second for type, frames of stagger for fade. */
  rate: number
}

export interface Span {
  text: string
  className: string
  /** OSC 8 target. A `cmd:` prefix means run it in this shell; anything else opens a page. */
  href?: string
  /** OSC 5522 region. Only the renderer acts on it. */
  anim?: Anim
}

export interface Line {
  spans: Span[]
}

const FG = ['fg-black', 'fg-red', 'fg-green', 'fg-yellow', 'fg-blue', 'fg-magenta', 'fg-cyan', 'fg-white']

const SGR = /^\x1b\[([0-9;]*)m/
const OSC8 = /^\x1b\]8;[^;]*;([^\x1b]*)\x1b\\/
const MOTION = /^\x1b\]5522;?([^\x1b]*)\x1b\\/

export const TYPE_CPS_MIN = 30
export const TYPE_CPS_MAX = 240
export const FADE_STEP_MIN = 20
export const FADE_STEP_MAX = 160
/** A type region longer than this is not read as typing any more. */
export const TYPE_CHARS_MAX = 400
/** No reveal may hold the prompt longer than this, whatever the region says. */
export const MOTION_MS_MAX = 1500

interface State {
  className: string
  bold: boolean
  dim: boolean
  color: string
  href: string | undefined
  anim: Anim | undefined
}

function fresh(): State {
  return { className: '', bold: false, dim: false, color: '', href: undefined, anim: undefined }
}

function paint(state: State) {
  state.className = [state.bold ? 'bold' : '', state.dim ? 'dim' : '', state.color].filter(Boolean).join(' ')
}

function number(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Read one motion parameter pair, or nothing to close the region. */
export function readMotion(params: string): Anim | undefined {
  const trimmed = params.trim()
  if (!trimmed) return undefined
  const [mode, rate] = trimmed.split(';')
  if (mode === 'fade') return { mode: 'fade', rate: clamp(number(rate ?? '', 60), FADE_STEP_MIN, FADE_STEP_MAX) }
  return { mode: 'type', rate: clamp(number(rate ?? '', 90), TYPE_CPS_MIN, TYPE_CPS_MAX) }
}

/** Paint the marker for a motion region. `null` closes it. */
export function motionMark(anim: Anim | null): string {
  if (!anim) return '\x1b]5522\x1b\\'
  const safe = readMotion(`${anim.mode};${anim.rate}`) ?? anim
  return `\x1b]5522;${safe.mode};${safe.rate}\x1b\\`
}

/**
 * Split text into lines of spans, carrying color, links and motion across the
 * newline. A single line is just the first element, so a caller that already
 * split on '\n' still works.
 */
export function parseLines(input: string): Line[] {
  const lines: Line[] = []
  let spans: Span[] = []
  const state = fresh()
  let plain = ''

  const flush = () => {
    if (!plain) return
    const span: Span = { text: plain, className: state.className }
    if (state.href !== undefined) span.href = state.href
    if (state.anim) span.anim = { ...state.anim }
    spans.push(span)
    plain = ''
  }
  const breakLine = () => {
    flush()
    lines.push({ spans })
    spans = []
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (ch === '\n') {
      breakLine()
      i += 1
      continue
    }
    if (ch === '\x1b') {
      const rest = input.slice(i)
      const sgr = SGR.exec(rest)
      if (sgr) {
        flush()
        for (const code of sgr[1] ? sgr[1].split(';').map(Number) : [0]) {
          if (code === 0) {
            state.bold = false
            state.dim = false
            state.color = ''
          } else if (code === 1) state.bold = true
          else if (code === 2) state.dim = true
          else if (code === 22) {
            state.bold = false
            state.dim = false
          } else if (code >= 30 && code <= 37) state.color = FG[code - 30] ?? ''
          else if (code >= 90 && code <= 97) state.color = FG[code - 90] ?? ''
          else if (code === 39) state.color = ''
        }
        paint(state)
        i += sgr[0].length
        continue
      }
      const link = OSC8.exec(rest)
      if (link) {
        flush()
        state.href = link[1] ? link[1] : undefined
        i += link[0].length
        continue
      }
      const motion = MOTION.exec(rest)
      if (motion) {
        flush()
        state.anim = readMotion(motion[1] ?? '')
        i += motion[0].length
        continue
      }
    }
    plain += ch
    i += 1
  }
  flush()
  lines.push({ spans })
  return lines
}

/** One line of spans. Color does not carry over a newline here. */
export function parseAnsi(input: string): Span[] {
  const line = parseLines(input)[0]
  if (!line) return [{ text: input, className: '' }]
  return line.spans.length ? line.spans : [{ text: '', className: '' }]
}

/* ---------- motion: the same grammar, one level up ---------- */

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
