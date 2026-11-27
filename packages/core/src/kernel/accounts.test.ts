import { describe, expect, it } from 'vitest'
import { boot } from '../testkit'
import {
  authenticate,
  checkHash,
  makeHash,
  parseGroup,
  parsePasswd,
  parseShadow,
  sha256Hex,
  verifyPassword,
} from './accounts'

describe('accounts', () => {
  it('parses the three files login reads', () => {
    const accounts = parsePasswd('root:x:0:0:root:/root:/bin/sh\n# note\nada:x:1001:1001:Ada:/home/ada:/bin/sh\n')
    expect(accounts.map((account) => account.name)).toEqual(['root', 'ada'])
    expect(accounts[1]?.home).toBe('/home/ada')
    const groups = parseGroup('staff:x:1000:owner,root\n')
    expect(groups[0]?.members).toEqual(['owner', 'root'])
    const shadow = parseShadow('root:$sha256$a$b:1:0:::::\n')
    expect(shadow[0]?.name).toBe('root')
  })

  it('hashes and checks a password without a crypto import', () => {
    // The vector is the well-known SHA-256 of "abc".
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const stored = makeHash('secret', 'salt')
    expect(checkHash(stored, 'secret')).toBe(true)
    expect(checkHash(stored, 'wrong')).toBe(false)
  })

  it('accepts the shipped root password and only that one', () => {
    const { fs } = boot()
    expect(verifyPassword(fs, 'root', 'qwerty~')).toBe(true)
    expect(verifyPassword(fs, 'root', 'nope')).toBe(false)
  })

  it('creates an unknown name in this browser only', () => {
    const { fs } = boot()
    const first = authenticate(fs, 'bob', 'anything')
    expect(first?.created).toBe(true)
    expect(first?.user.name).toBe('bob')
    expect(first?.user.uid).toBeGreaterThan(1001)
    expect(first?.user.home).toBe('/home/bob')
    expect(fs.exists(first!.user, '/home/bob')).toBe(true)

    const again = authenticate(fs, 'bob', 'another password')
    expect(again?.created).toBe(false)
    expect(fs.read(first!.user, '/etc/passwd').content).toContain('bob:x:')

    // The account and its home are session-only, so a refresh forgets them.
    const paths = fs.exportLayer().map(([path]) => path)
    expect(paths).not.toContain('/home/bob')
    expect(paths).not.toContain('/etc/passwd')
  })

  it('refuses an illegal name and a wrong root password', () => {
    const { fs } = boot()
    expect(authenticate(fs, 'a/b', 'x')).toBeNull()
    expect(authenticate(fs, 'root', 'wrong')).toBeNull()
    expect(authenticate(fs, 'root', 'qwerty~')?.user.uid).toBe(0)
  })
})
