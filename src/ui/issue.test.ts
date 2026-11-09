import { describe, expect, it } from 'vitest'
import { boot } from '../testkit'
import { expandIssue, readIssue, type IssueFacts } from './issue'

const when = new Date(2026, 10, 9, 14, 5, 6)

function facts(partial: Partial<IssueFacts> = {}): IssueFacts {
  return {
    hostname: 'home',
    sysname: 'Linux',
    release: '6.1-home',
    version: '#1 SMP Home',
    machine: 'web',
    tty: 'tty1',
    osRelease: { PRETTY_NAME: 'Home Linux', NAME: 'Home Linux', VERSION: '6.1' },
    date: when,
    users: 0,
    ...partial,
  }
}

describe('issue', () => {
  it('expands the pre-login banner codes', () => {
    expect(expandIssue('\\n Linux \\l\n\n', facts())).toBe('home Linux tty1\n\n')
    expect(expandIssue('\\S', facts())).toBe('Home Linux')
    expect(expandIssue('\\S{VERSION}', facts())).toBe('6.1')
    expect(expandIssue('\\S{NOPE}', facts())).toBe('')
    expect(expandIssue('\\S', facts({ osRelease: {} }))).toBe('Linux')
  })

  it('turns \\\\e and octal 033 into the escape character', () => {
    expect(expandIssue('\\033[36mhi\\e[0m', facts())).toBe('\x1b[36mhi\x1b[0m')
  })

  it('prints the date, time, and user count', () => {
    expect(expandIssue('\\d \\t', facts())).toBe('Mon Nov  9 2026 14:05:06')
    expect(expandIssue('\\U', facts())).toBe('0 users')
    expect(expandIssue('\\u \\U', facts({ users: 1 }))).toBe('1 1 user')
  })

  it('keeps a real backslash and drops an unknown code', () => {
    expect(expandIssue('\\\\n', facts())).toBe('\\n')
    expect(expandIssue('\\q', facts())).toBe('q')
    expect(expandIssue('\\4{eth0}x', facts())).toBe('x')
  })

  it('uses the previous banner when /etc/issue is missing', () => {
    const { rt } = boot()
    expect(readIssue(rt, 'home', when)).toBe('home Linux tty1\n\n')
  })

  it('reads /etc/issue and /etc/os-release before login', () => {
    const { rt } = boot({ user: { name: 'root', role: 'root' } })
    const root = { name: 'root', role: 'root' as const }
    rt.fs.begin()
    rt.fs.write(root, '/etc/issue', '\\S \\n \\l\n')
    rt.fs.write(root, '/etc/os-release', 'PRETTY_NAME="Home Linux"\n')
    rt.fs.finish()
    expect(readIssue(rt, 'home', when)).toBe('Home Linux home tty1\n')
  })
})
