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
/**
 * SGR 38 and 39 name two more inks here instead of the terminal's extended colour
 * and default-foreground codes. `\x1b[0m` is the reset; `\x1b[39m` is brown.
 */
const EXTRA_FG: Record<number, string> = { 38: 'fg-purple', 39: 'fg-brown' }
/** SGR 40-47 and 100-107: the ground under a run. An explicit fg still wins in CSS. */
const BG = ['bg-black', 'bg-red', 'bg-green', 'bg-yellow', 'bg-blue', 'bg-magenta', 'bg-cyan', 'bg-white']

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
  ground: string
  href: string | undefined
  anim: Anim | undefined
}

function fresh(): State {
  return { className: '', bold: false, dim: false, color: '', ground: '', href: undefined, anim: undefined }
}

function paint(state: State) {
  state.className = [state.bold ? 'bold' : '', state.dim ? 'dim' : '', state.color, state.ground]
    .filter(Boolean)
    .join(' ')
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
            state.ground = ''
          } else if (code === 1) state.bold = true
          else if (code === 2) state.dim = true
          else if (code === 22) {
            state.bold = false
            state.dim = false
          } else if (code >= 30 && code <= 37) state.color = FG[code - 30] ?? ''
          else if (EXTRA_FG[code]) state.color = EXTRA_FG[code] ?? ''
          else if (code >= 90 && code <= 97) state.color = FG[code - 90] ?? ''
          else if (code >= 40 && code <= 47) state.ground = BG[code - 40] ?? ''
          else if (code >= 100 && code <= 107) state.ground = BG[code - 100] ?? ''
          else if (code === 49) state.ground = ''
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

/* ---------- cadence: a typed reveal is not evenly spaced ---------- */

/**
 * Nominal pauses at PAUSE_REF_CPS. A slower reveal stretches them and a faster
 * one shortens them, so a comma always reads as a comma and never as a stall.
 */
export const PAUSE_COMMA_MS = 50
export const PAUSE_STOP_MS = 150
export const PAUSE_PARA_MS = 300
export const PAUSE_STYLE_MS = 50
/** The cadence the pause constants are written for: the default of `typewrite`. */
export const PAUSE_REF_CPS = 90
export const PAUSE_SCALE_MIN = 0.5
export const PAUSE_SCALE_MAX = 1.8

const COMMA = new Set([',', ';', ':', '，', '、', '；', '：', '—'])
const STOP = new Set(['.', '!', '?', '。', '！', '？', '…'])

/**
 * How far to stretch a nominal pause at this rate. 1 at PAUSE_REF_CPS.
 * A square-root-ish curve rather than 1/cps: at 240 cps a linear scale would
 * shrink a full stop to 56 ms, which reads as no pause at all.
 */
export function pauseScale(cps: number): number {
  const rate = Math.min(TYPE_CPS_MAX, Math.max(TYPE_CPS_MIN, cps))
  const ratio = Math.pow(PAUSE_REF_CPS / rate, 0.6)
  return Math.min(PAUSE_SCALE_MAX, Math.max(PAUSE_SCALE_MIN, ratio))
}

/** The pause after one revealed character, before the next one starts. */
export function charPause(char: string, next: string | undefined, cps: number): number {
  const scale = pauseScale(cps)
  if (char === '\n' && next === '\n') return PAUSE_PARA_MS * scale
  if (STOP.has(char)) return PAUSE_STOP_MS * scale
  if (COMMA.has(char)) return PAUSE_COMMA_MS * scale
  return 0
}

export interface TypedRun {
  text: string
  /** A change of class is a change of color or weight: it earns a short beat. */
  className?: string
}

/**
 * When every character of one typed block appears, in ms. A run boundary with a
 * new class is a color change, so it pauses; a blank line is a paragraph break.
 */
export function revealTimes(runs: TypedRun[], cps: number): number[] {
  const rate = Math.min(TYPE_CPS_MAX, Math.max(TYPE_CPS_MIN, cps))
  const step = 1000 / rate
  const style = PAUSE_STYLE_MS * pauseScale(rate)
  const times: number[] = []
  let clock = 0
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]
    if (!run) continue
    if (r > 0 && runs[r - 1]?.className !== run.className) clock += style
    const chars = [...run.text]
    const after = runs[r + 1]?.text.charAt(0)
    for (let i = 0; i < chars.length; i++) {
      clock += step
      times.push(clock)
      const char = chars[i] ?? ''
      const next = i + 1 < chars.length ? chars[i + 1] : after
      clock += charPause(char, next, rate)
    }
  }
  return times
}

/** Characters visible at `elapsed`, by binary search over `revealTimes`. */
export function typedIndex(times: number[], elapsed: number): number {
  let low = 0
  let high = times.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((times[mid] ?? 0) <= elapsed) low = mid + 1
    else high = mid
  }
  return low
}

/** Natural duration of a typed block, bounded so no reveal holds the prompt. */
export function revealDuration(runs: TypedRun[], cps: number, maxMs = MOTION_MS_MAX): number {
  const times = revealTimes(runs, cps)
  return Math.min(maxMs, times.length ? (times[times.length - 1] ?? 0) : 0)
}

export interface Schedule {
  /** When each character appears, in ms. */
  times: number[]
  /** When the last one appears: the natural length, or `maxMs` after compression. */
  duration: number
}

/**
 * A schedule that fits in `maxMs`. Too slow to finish in time is not a reason to
 * jump: the whole schedule is scaled, so the block types a little faster and
 * still reads in order instead of snapping at the deadline.
 */
export function revealSchedule(runs: TypedRun[], cps: number, maxMs = MOTION_MS_MAX): Schedule {
  const times = revealTimes(runs, cps)
  const natural = times.length ? (times[times.length - 1] ?? 0) : 0
  if (natural <= maxMs) return { times, duration: natural }
  const factor = maxMs / natural
  return { times: times.map((time) => time * factor), duration: maxMs }
}


/** The motd may finish typing instead of snapping; a key press still skips it. */
export const INTRO_MS_MAX = 15_000

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
