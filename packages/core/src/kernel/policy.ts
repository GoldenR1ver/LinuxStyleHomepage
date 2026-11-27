import type { User } from './types'
import { hasCap } from './caps'
import { normalize } from './path'

/**
 * The POSIX permission check: owner, then a supplementary group, then other.
 * A process holding CAP_DAC_OVERRIDE skips the bits, which is how root gets its
 * power without a special case here.
 */
export function modePermits(
  user: User,
  node: { mode: number; uid: string; gid: string },
  bit: 1 | 2 | 4,
): boolean {
  if (hasCap(user, 'CAP_DAC_OVERRIDE')) return true
  const owner = node.uid === user.name
  const group = !owner && user.groups.includes(node.gid)
  const klass = owner ? node.mode >> 6 : group ? node.mode >> 3 : node.mode
  return (klass & bit) !== 0
}

export function isGuestbook(path: string): boolean {
  return normalize(path).startsWith('/var/guestbook/')
}

/** Mode of a file shipped in the site image. */
export function shippedMode(path: string, kind: 'file' | 'dir'): number {
  if (path === '/proc' || path.startsWith('/proc/')) return kind === 'dir' ? 0o555 : 0o444
  if (path === '/tmp' || path === '/var/guestbook') return 0o1777
  if (path === '/root' || path.startsWith('/root/')) return kind === 'dir' ? 0o700 : 0o600
  if (path.startsWith('/tmp/')) return kind === 'dir' ? 0o1777 : 0o644
  if (path === '/etc/shadow' || path === '/etc/gshadow') return 0o600
  return kind === 'dir' ? 0o755 : 0o644
}

/**
 * Mode of a new file or directory, from the requested bits and the umask.
 * The default umask is 022, so a directory is 0755 and a file 0644.
 */
export function createdMode(kind: 'file' | 'dir', umask = 0o022): number {
  const wanted = kind === 'dir' ? 0o777 : 0o666
  return wanted & ~umask & 0o777
}

export function formatMode(type: 'file' | 'dir', mode: number): string {
  const kind = type === 'dir' ? 'd' : '-'
  const triplet = (rwx: number, special: boolean, letter: string) => {
    const read = rwx & 4 ? 'r' : '-'
    const write = rwx & 2 ? 'w' : '-'
    const exec = rwx & 1
    const last = special ? (exec ? letter : letter.toUpperCase()) : exec ? 'x' : '-'
    return read + write + last
  }
  return (
    kind +
    triplet((mode >> 6) & 7, (mode & 0o4000) !== 0, 's') +
    triplet((mode >> 3) & 7, (mode & 0o2000) !== 0, 's') +
    triplet(mode & 7, (mode & 0o1000) !== 0, 't')
  )
}

const OCTAL = /^[0-7]{1,4}$/

/** Octal such as 644, or a symbolic change such as u+x,go-w. Omitted who means everyone. */
export function applyMode(current: number, spec: string): number {
  const text = spec.trim()
  if (OCTAL.test(text)) return Number.parseInt(text, 8) & 0o7777
  let mode = current & 0o7777
  if (!text) throw new Error('invalid mode')
  for (const raw of text.split(',')) {
    const match = /^([ugoa]*)([+-=])([rwxst]*)$/.exec(raw.trim())
    if (!match) throw new Error('invalid mode')
    const who = match[1] || 'a'
    const op = match[2]
    const perm = match[3] ?? ''
    if (!perm && op !== '=') throw new Error('invalid mode')
    const classes = new Set<'u' | 'g' | 'o'>()
    if (who.includes('a')) {
      classes.add('u')
      classes.add('g')
      classes.add('o')
    } else {
      if (who.includes('u')) classes.add('u')
      if (who.includes('g')) classes.add('g')
      if (who.includes('o')) classes.add('o')
    }
    if (!classes.size) throw new Error('invalid mode')
    const shift = { u: 6, g: 3, o: 0 } as const
    for (const klass of classes) {
      let bits = 0
      if (perm.includes('r')) bits |= 4
      if (perm.includes('w')) bits |= 2
      if (perm.includes('x')) bits |= 1
      const moved = bits << shift[klass]
      if (op === '+') mode |= moved
      else if (op === '-') mode &= ~moved & 0o7777
      else mode = (mode & ~(7 << shift[klass])) | moved
    }
    const setuid = perm.includes('s') && (who.includes('u') || who.includes('a'))
    const setgid = perm.includes('s') && (who.includes('g') || who.includes('a'))
    const sticky = perm.includes('t')
    if (op === '-') {
      if (setuid) mode &= ~0o4000
      if (setgid) mode &= ~0o2000
      if (sticky) mode &= ~0o1000
    } else {
      if (setuid) mode |= 0o4000
      if (setgid) mode |= 0o2000
      if (sticky) mode |= 0o1000
    }
  }
  return mode & 0o7777
}
