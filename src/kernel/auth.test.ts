import { describe, expect, it } from 'vitest'
import { authenticate, homeDir } from './auth'

describe('auth', () => {
  it('accepts root only with the configured password', () => {
    expect(authenticate('root', '123456', '123456')).toEqual({ name: 'root', role: 'root' })
    expect(authenticate('ROOT', 'nope', '123456')).toBeNull()
    expect(authenticate('root', '', '123456')).toBeNull()
  })

  it('lets any other legal name in as a guest', () => {
    expect(authenticate('café', 'whatever', '123456')).toEqual({ name: 'café', role: 'guest' })
    expect(authenticate('  ada  ', '', '123456')).toEqual({ name: 'ada', role: 'guest' })
    expect(authenticate('a/b', 'x', '123456')).toBeNull()
    expect(authenticate('.', 'x', '123456')).toBeNull()
  })

  it('gives guests a scratch directory and root /root', () => {
    expect(homeDir({ name: 'ada', role: 'guest' })).toBe('/tmp/ada')
    expect(homeDir({ name: 'root', role: 'root' })).toBe('/root')
  })
})
