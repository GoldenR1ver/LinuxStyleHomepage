import { describe, expect, it } from 'vitest'
import { applyMode, canWrite, formatMode, modePermits, publishes } from './policy'

const guest = { name: 'ada', role: 'guest' as const }
const root = { name: 'root', role: 'root' as const }

describe('policy', () => {
  it('lets root ignore mode bits and checks owner, group, then other', () => {
    const locked = { mode: 0, uid: 'ada', gid: 'ada' }
    expect(modePermits(root, locked, 4)).toBe(true)
    expect(modePermits(guest, locked, 4)).toBe(false)
    const node = { mode: 0o640, uid: 'ada', gid: 'staff' }
    expect(modePermits(guest, node, 2)).toBe(true)
    expect(modePermits({ name: 'staff', role: 'guest' }, node, 4)).toBe(true)
    expect(modePermits({ name: 'staff', role: 'guest' }, node, 2)).toBe(false)
    expect(modePermits({ name: 'bob', role: 'guest' }, node, 4)).toBe(false)
  })

  it('limits guest writes to scratch and guestbook files', () => {
    expect(canWrite(guest, '/tmp/ada/a.txt')).toBe(true)
    expect(canWrite(guest, '/var/guestbook/hi.txt')).toBe(true)
    expect(canWrite(guest, '/var/guestbook')).toBe(false)
    expect(canWrite(guest, '/home/owner/about.md')).toBe(false)
  })

  it('publishes root writes except /tmp', () => {
    expect(publishes(root, '/home/owner/about.md')).toBe(true)
    expect(publishes(root, '/tmp/root/a')).toBe(false)
    expect(publishes(guest, '/var/guestbook/a')).toBe(false)
  })

  it('formats mode bits and applies octal or symbolic changes', () => {
    expect(formatMode('file', 0o644)).toBe('-rw-r--r--')
    expect(formatMode('dir', 0o755)).toBe('drwxr-xr-x')
    expect(formatMode('dir', 0o1777)).toBe('drwxrwxrwt')
    expect(formatMode('file', 0o4755)).toBe('-rwsr-xr-x')
    expect(formatMode('file', 0o4644)).toBe('-rwSr--r--')
    expect(applyMode(0o644, '755')).toBe(0o755)
    expect(applyMode(0o644, '+x')).toBe(0o755)
    expect(applyMode(0o777, 'go-w')).toBe(0o755)
    expect(applyMode(0o644, 'u+x,g+x')).toBe(0o754)
    expect(applyMode(0o755, '+t')).toBe(0o1755)
    expect(() => applyMode(0o644, '9')).toThrow()
  })
})
