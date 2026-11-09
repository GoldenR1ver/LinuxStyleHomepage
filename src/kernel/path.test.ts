import { describe, expect, it } from 'vitest'
import { basename, dirname, isInside, normalize, resolve } from './path'

describe('path', () => {
  it('normalizes parents and duplicate slashes', () => {
    expect(normalize('/a/b/../c//d')).toBe('/a/c/d')
    expect(normalize('/../..')).toBe('/')
    expect(normalize('a/./b')).toBe('/a/b')
  })

  it('resolves against the working directory', () => {
    expect(resolve('/home/owner', '..')).toBe('/home')
    expect(resolve('/home/owner', 'notes/a.md')).toBe('/home/owner/notes/a.md')
    expect(resolve('/home/owner', '/etc/hostname')).toBe('/etc/hostname')
  })

  it('splits names', () => {
    expect(dirname('/home/owner/about.md')).toBe('/home/owner')
    expect(dirname('/')).toBe('/')
    expect(basename('/home/owner/about.md')).toBe('about.md')
  })

  it('checks containment without prefix collisions', () => {
    expect(isInside('/tmp/a', '/tmp/a/b')).toBe(true)
    expect(isInside('/tmp/a', '/tmp/ab')).toBe(false)
    expect(isInside('/tmp/a', '/tmp/a')).toBe(true)
  })
})
