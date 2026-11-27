import { describe, expect, it } from 'vitest'
import { guest, rootUser } from '../testkit'
import { isWorktreePath } from './mailbox'

const ada = guest('ada')
const root = rootUser

describe('mail work tree', () => {
  it('includes this guest home, guestbook and scratch only', () => {
    expect(isWorktreePath(ada, '/home/ada/note.txt')).toBe(true)
    expect(isWorktreePath(ada, '/var/guestbook/ada.txt')).toBe(true)
    expect(isWorktreePath(ada, '/tmp/ada/n.txt')).toBe(true)
    expect(isWorktreePath(ada, '/home/ada')).toBe(false)
    expect(isWorktreePath(ada, '/tmp/ada')).toBe(false)
    expect(isWorktreePath(ada, '/tmp/bob/n.txt')).toBe(false)
    expect(isWorktreePath(ada, '/home/owner/about.md')).toBe(false)
    expect(isWorktreePath(ada, '/root/README.md')).toBe(false)
    expect(isWorktreePath(ada, '/var/guestbook/../root/README.md')).toBe(false)
  })

  it('gives root its own home and no one else scratch', () => {
    expect(isWorktreePath(root, '/root/notes.txt')).toBe(true)
    expect(isWorktreePath(root, '/tmp/root/n.txt')).toBe(true)
    expect(isWorktreePath(root, '/tmp/ada/n.txt')).toBe(false)
  })
})
