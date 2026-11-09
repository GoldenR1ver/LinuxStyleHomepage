import { describe, expect, it } from 'vitest'
import { canRead, canWrite, publishes } from './policy'

const guest = { name: 'ada', role: 'guest' as const }
const root = { name: 'root', role: 'root' as const }

describe('policy', () => {
  it('lets guests read the public tree and their own scratch', () => {
    expect(canRead(guest, '/home/owner/about.md')).toBe(true)
    expect(canRead(guest, '/tmp/ada/note')).toBe(true)
    expect(canRead(guest, '/root/README.md')).toBe(false)
    expect(canRead(guest, '/tmp/bob/note')).toBe(false)
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
})
