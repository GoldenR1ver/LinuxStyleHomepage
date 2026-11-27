import type { Runtime } from '@home/core/app/runtime'
import type { User } from '@home/core/kernel/types'

const ROOT: User = { name: 'root', role: 'root' }

const FALLBACK_HERO = 'Welcome'
const FALLBACK_BODY =
  'I am Yujiang Adam Li. This page is a terminal running locally in your browser.'

export interface Portrait {
  /** A path in this filesystem; the binary at that path supplies the URL. */
  path: string
  alt: string
}

export interface Landing {
  hero: string
  body: string
  portrait: Portrait | null
}

/** A path with an image extension. A headline never looks like one, so the two cannot be confused. */
const IMAGE = /^\/.*\.(?:jpe?g|png|gif|webp)$/i
/** Saying one of these on the picture line leaves the picture out. */
const PORTRAIT_OFF = new Set(['none', 'off', '-'])

/**
 * The page shown before login, read from `/etc/landing`:
 *
 *     /home/owner/notes/me.jpg   ← optional: a picture in this filesystem, or none
 *     Welcome                    ← the line in the serif face
 *     I am Yujiang Adam Li…      ← the message below it
 *
 * Blank lines and lines starting with `#` are ignored, so the file can carry its
 * own instructions. A first line that does not look like an image path is the
 * headline, which keeps the file valid when someone deletes the picture.
 */
export function readLanding(rt: Runtime): Landing {
  let text = ''
  try {
    const file = rt.fs.read(ROOT, '/etc/landing')
    if (file.encoding === 'utf8') text = file.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  } catch {
    /* a missing file still has a landing */
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  const split = splitPortrait(lines)
  const rest = split.lines
  if (!rest.length) return { hero: FALLBACK_HERO, body: FALLBACK_BODY, portrait: split.portrait }
  return {
    hero: rest[0] || FALLBACK_HERO,
    body: rest.slice(1).join('\n').trim() || FALLBACK_BODY,
    portrait: split.portrait,
  }
}

/** Take the leading picture line when it is one, and keep the rest as the page. */
function splitPortrait(lines: string[]): { portrait: Portrait | null; lines: string[] } {
  const head = lines[0] ?? ''
  if (!head) return { portrait: null, lines }
  if (PORTRAIT_OFF.has(head.toLowerCase())) return { portrait: null, lines: lines.slice(1) }
  if (!IMAGE.test(head)) return { portrait: null, lines }
  return { portrait: { path: head, alt: 'Portrait' }, lines: lines.slice(1) }
}
