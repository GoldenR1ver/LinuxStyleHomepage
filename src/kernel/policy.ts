import type { User } from './types'
import { normalize } from './path'

/**
 * Permissions ignore the mode bits. Those bits are only for ls -l.
 * Change where guests may write in this file.
 */
export function canRead(user: User, path: string): boolean {
  if (user.role === 'root') return true
  const p = normalize(path)
  if (p === '/root' || p.startsWith('/root/')) return false
  if (p.startsWith('/tmp/')) {
    const owner = p.slice('/tmp/'.length).split('/')[0]
    if (owner && owner !== user.name) return false
  }
  return true
}

export function canWrite(user: User, path: string): boolean {
  if (user.role === 'root') return true
  const p = normalize(path)
  const scratch = `/tmp/${user.name}`
  if (p === scratch || p.startsWith(`${scratch}/`)) return true
  if (p.startsWith('/var/guestbook/')) return true
  return false
}

/** Root edits under /tmp stay in the browser. Every other root write is published. */
export function publishes(user: User, path: string): boolean {
  if (user.role !== 'root') return false
  const p = normalize(path)
  return p !== '/tmp' && !p.startsWith('/tmp/')
}

export function isGuestbook(path: string): boolean {
  return normalize(path).startsWith('/var/guestbook/')
}
