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

/**
 * The words shown before login. The text lives in content/etc/landing so it is
 * edited like any other page; the type, pace, and spacing belong to the view.
 */
export function readLanding(rt: Runtime): Landing {
  let text = ''
  try {
    const file = rt.fs.read(ROOT, '/etc/landing')
    if (file.encoding === 'utf8') text = file.content.replace(/\r\n/g, '\n')
  } catch {
    /* a missing file still has a landing */
  }
  const portrait = readPortrait(rt)
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim().length > 0)
  if (first < 0) return { hero: FALLBACK_HERO, body: FALLBACK_BODY, portrait }
  return {
    hero: lines[first]?.trim() || FALLBACK_HERO,
    body: lines.slice(first + 1).join('\n').trim() || FALLBACK_BODY,
    portrait,
  }
}

/** The picture is off when the path line says so, or when no path line is left. */
const PORTRAIT_OFF = new Set(['none', 'off', '-'])

/**
 * The portrait the landing shows between the headline and the introduction.
 * `/etc/portrait` holds a path in this filesystem on its first line, then the
 * alt text. Lines starting with `#` are comments, and an empty file, a blank
 * path, or `none` hides the picture: the page is edited like any other file.
 */
function readPortrait(rt: Runtime): Portrait | null {
  let text = ''
  try {
    const file = rt.fs.read(ROOT, '/etc/portrait')
    if (file.encoding !== 'utf8') return null
    text = file.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  const path = lines[0] ?? ''
  if (!path || PORTRAIT_OFF.has(path.toLowerCase())) return null
  return { path, alt: lines.slice(1).join(' ') || 'Portrait' }
}
