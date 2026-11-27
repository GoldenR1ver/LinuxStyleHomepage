import { describe, expect, it } from 'vitest'
import { guest, rootUser } from '../testkit'
import { applyMode, formatMode, modePermits, shippedMode } from './policy'

const staff = guest('staff', 1002, ['staff', 'readers'])
const bob = guest('bob', 1003, ['bob'])

describe('policy', () => {
  it('checks owner, then a supplementary group, then other', () => {
    const node = { mode: 0o640, uid: 'staff', gid: 'readers' }
    expect(modePermits(staff, node, 4)).toBe(true)
    expect(modePermits(staff, node, 2)).toBe(true)
    expect(modePermits(bob, node, 4)).toBe(false)
    expect(modePermits(rootUser, node, 2)).toBe(true)
  })

  it('treats a uid 0 user as root whatever the bits say', () => {
    expect(modePermits(rootUser, { mode: 0, uid: 'root', gid: 'root' }, 4)).toBe(true)
    expect(modePermits(rootUser, { mode: 0, uid: 'root', gid: 'root' }, 2)).toBe(true)
  })

  it('ships the modes the filesystem depends on', () => {
    expect(shippedMode('/tmp', 'dir')).toBe(0o1777)
    expect(shippedMode('/var/guestbook', 'dir')).toBe(0o1777)
    expect(shippedMode('/root', 'dir')).toBe(0o700)
    expect(shippedMode('/etc/shadow', 'file')).toBe(0o600)
    expect(shippedMode('/etc/passwd', 'file')).toBe(0o644)
  })

  it('formats mode bits and applies octal or symbolic changes', () => {
    expect(formatMode('dir', 0o755)).toBe('drwxr-xr-x')
    expect(formatMode('file', 0o644)).toBe('-rw-r--r--')
    expect(formatMode('dir', 0o1777)).toBe('drwxrwxrwt')
    expect(applyMode(0o644, '600')).toBe(0o600)
    expect(applyMode(0o644, 'u+x')).toBe(0o744)
    expect(applyMode(0o777, 'go-w')).toBe(0o755)
    expect(applyMode(0o755, 'u=rwx,g=rx,o=')).toBe(0o750)
  })
})
