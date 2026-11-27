import { describe, expect, it } from 'vitest'
import { boot, rootUser } from '@home/core/testkit'
import { readLanding } from './landing'

const root = rootUser

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

  it('reads a picture from the first line and the headline from the second', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', '/home/owner/notes/me.jpg\nWelcome\n\nHello there.\n')
    expect(readLanding(rt)).toEqual({
      hero: 'Welcome',
      body: 'Hello there.',
      portrait: { path: '/home/owner/notes/me.jpg', alt: 'Portrait' },
    })
  })

  it('keeps a headline that is not an image path as the headline', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', 'Welcome\n\nHello there.\n')
    expect(readLanding(rt).portrait).toBeNull()
    expect(readLanding(rt).hero).toBe('Welcome')
  })

  it('hides the picture when the first line says none', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', 'none\nWelcome\n\nBody\n')
    expect(readLanding(rt)).toEqual({ hero: 'Welcome', body: 'Body', portrait: null })
  })

  it('skips comment lines, so the file can carry its own instructions', () => {
    const { rt } = boot({ user: root })
    write(rt, '/etc/landing', '# line 1 is a picture\n\n/home/owner/me.png\nWelcome\nBody\n')
    expect(readLanding(rt)).toEqual({
      hero: 'Welcome',
      body: 'Body',
      portrait: { path: '/home/owner/me.png', alt: 'Portrait' },
    })
    write(rt, '/etc/landing', '# only comments\n')
    expect(readLanding(rt)).toEqual({
      hero: 'Welcome',
      body: 'I am Yujiang Adam Li. This page is a terminal running locally in your browser.',
      portrait: null,
    })
  })
})
