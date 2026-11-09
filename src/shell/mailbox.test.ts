import { describe, expect, it } from 'vitest'
import { isWorktreePath } from './mailbox'

const ada = { name: 'ada', role: 'guest' as const }
const root = { name: 'root', role: 'root' as const }

describe('mail work tree', () => {
  it('includes this guest guestbook and scratch only', () => {
    expect(isWorktreePath(ada, '/var/guestbook/ada.txt')).toBe(true)
    expect(isWorktreePath(ada, '/tmp/ada/n.txt')).toBe(true)
    expect(isWorktreePath(ada, '/tmp/ada')).toBe(false)
    expect(isWorktreePath(ada, '/tmp/bob/n.txt')).toBe(false)
    expect(isWorktreePath(ada, '/home/owner/about.md')).toBe(false)
    expect(isWorktreePath(ada, '/root/README.md')).toBe(false)
    expect(isWorktreePath(ada, '/var/guestbook/../root/README.md')).toBe(false)
  })

  it('does not treat root home as a mail attachment', () => {
    expect(isWorktreePath(root, '/root/README.md')).toBe(false)
    expect(isWorktreePath(root, '/tmp/root/n.txt')).toBe(true)
    expect(isWorktreePath(root, '/tmp/ada/n.txt')).toBe(false)
  })
})
