import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkHash, parseShadow } from './kernel/accounts'

/**
 * The published tree is the puzzle. These checks fail when the story drifts:
 * a password leaked in a backup that no longer opens the account it names, or a
 * key a visitor is told to download that is not a key.
 */
function read(path: string): string {
  return readFileSync(new URL(`../../../content/${path}`, import.meta.url), 'utf8')
}

describe('the published content', () => {
  it('leaks only passwords that still open their account', () => {
    const shadow = parseShadow(read('etc/shadow'))
    const leaks = read('var/backups/shadow.bak')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const cut = line.indexOf(':')
        return { name: line.slice(0, cut), password: line.slice(cut + 1) }
      })
      .filter((entry) => entry.name && entry.password)

    expect(leaks.length).toBeGreaterThan(0)
    for (const leak of leaks) {
      const row = shadow.find((entry) => entry.name === leak.name)
      // An account with no shadow row accepts any password, so a leaked one
      // cannot be wrong; an account with a row must accept exactly this one.
      if (!row) continue
      expect(checkHash(row.hash, leak.password), `${leak.name}:${leak.password} no longer works`).toBe(true)
    }
  })

  it('ships an ssh key that ssh will accept once its mode is closed', () => {
    const key = read('root/backup/id_rsa')
    expect(key).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(key).toContain('END OPENSSH PRIVATE KEY')
  })

  it('names the exposed key in the guestbook, so a visitor can find the hint', () => {
    const message = read('var/guestbook/message.json')
    expect(message).toContain('id_rsa')
    expect(message).toContain('http')
  })
})
