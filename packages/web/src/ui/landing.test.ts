import { describe, expect, it } from 'vitest'
import { boot } from '@home/core/testkit'
import { readLanding } from './landing'

const root = { name: 'root', role: 'root' as const }

function write(rt: ReturnType<typeof boot>['rt'], path: string, text: string) {
  rt.fs.begin()
  rt.fs.write(root, path, text)
  rt.fs.finish()
}

describe('landing', () => {
  it('uses the first non-empty line as the hero and the rest as the body', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', '\nWelcome\n\nHello there.\n')
    expect(readLanding(rt)).toEqual({ hero: 'Welcome', body: 'Hello there.', portrait: null })
  })

  it('normalises CRLF line endings', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', 'Welcome\r\n\r\nBody\r\n')
    expect(readLanding(rt)).toEqual({ hero: 'Welcome', body: 'Body', portrait: null })
  })

  it('keeps a landing when /etc/landing is missing', () => {
    const { rt } = boot()
    const landing = readLanding(rt)
    expect(landing.hero).toBe('Welcome')
    expect(landing.body.length).toBeGreaterThan(0)
    expect(landing.portrait).toBeNull()
  })

  it('reads the portrait path and its alt text', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/portrait', '/home/owner/notes/me.jpg\nYujiang Adam Li\n')
    expect(readLanding(rt).portrait).toEqual({
      path: '/home/owner/notes/me.jpg',
      alt: 'Yujiang Adam Li',
    })
  })

  it('falls back to a plain alt and ignores an empty portrait file', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/portrait', '/home/owner/me.jpg\n')
    expect(readLanding(rt).portrait?.alt).toBe('Portrait')
    write(rt, '/etc/portrait', '\n')
    expect(readLanding(rt).portrait).toBeNull()
  })

  it('hides the portrait on an empty file, or when the path line says none', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/portrait', '')
    expect(readLanding(rt).portrait).toBeNull()
    write(rt, '/etc/portrait', 'none\n')
    expect(readLanding(rt).portrait).toBeNull()
    write(rt, '/etc/portrait', '  OFF  \nYujiang\n')
    expect(readLanding(rt).portrait).toBeNull()
  })

  it('skips comment lines, so the file can carry its own instructions', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/portrait', '# a path in content/, or none\n\n/home/owner/me.jpg\nYujiang\n')
    expect(readLanding(rt).portrait).toEqual({ path: '/home/owner/me.jpg', alt: 'Yujiang' })
    write(rt, '/etc/portrait', '# only comments\n')
    expect(readLanding(rt).portrait).toBeNull()
  })
})
