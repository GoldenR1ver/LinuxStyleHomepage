import { describe, expect, it } from 'vitest'
import { mailRelay } from '../config/site'
import { createMailer } from './mail'

describe('mail relay', () => {
  it('accepts only an https relay that is not GitHub and contains no token', () => {
    expect(mailRelay('')).toBeNull()
    expect(mailRelay('http://form.example/f/abc')).toBeNull()
    expect(mailRelay('https://user:pass@form.example/f/abc')).toBeNull()
    expect(mailRelay('https://api.github.com/repos/a/b')).toBeNull()
    expect(mailRelay('https://gist.github.com/a/b')).toBeNull()
    expect(mailRelay('https://form.example/f/abc?access_token=secret')).toBeNull()
    expect(mailRelay('https://form.example/f/ghp_exampletoken')).toBeNull()
    expect(mailRelay('https://form.example/f/abc')).toBe('https://form.example/f/abc')
  })

  it('posts a fixed payload and does not attach credentials', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return new Response('{}', { status: 200 })
    }
    const mailer = createMailer('https://form.example/f/abc', 'owner@example.com', fetchImpl)
    const status = await mailer.send({
      kind: 'letter',
      user: 'ada\n',
      subject: 'hello\nBcc: evil@example.com',
      path: '/var/guestbook/ada.txt',
      body: 'note',
    })
    expect(status).toBe('sent')
    expect(calls[0]?.url).toBe('https://form.example/f/abc')
    const init = calls[0]?.init
    expect(init?.credentials).toBe('omit')
    expect(init?.redirect).toBe('error')
    const headers = init?.headers as Record<string, string>
    expect(Object.keys(headers).sort()).toEqual(['accept', 'content-type'])
    expect(JSON.stringify(headers).toLowerCase()).not.toContain('token')
    expect(JSON.stringify(headers).toLowerCase()).not.toContain('authorization')
    const payload = JSON.parse(String(init?.body)) as Record<string, string>
    expect(Object.keys(payload).sort()).toEqual(['_gotcha', '_subject', 'email', 'message', 'path', 'type', 'user'])
    expect(payload._subject).toBe('[home] hello Bcc: evil@example.com')
    expect(payload._subject).not.toMatch(/[\r\n]/)
    expect(payload.email).toBe('ada@homepage.local')
    expect(payload.user).toBe('ada')
    expect(payload.type).toBe('letter')
    expect(payload.message).toContain('to: owner@example.com')
    expect(payload.message).toContain('note')
    expect(payload._gotcha).toBe('')
  })

  it('does not call fetch when the relay is refused', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const mailer = createMailer('https://api.github.com/repos/a/b', 'owner@example.com', fetchImpl)
    expect(mailer.configured).toBe(false)
    expect(await mailer.send({ kind: 'letter', user: 'ada', body: 'note', subject: 'hi' })).toBe('skipped')
    expect(called).toBe(false)
  })
})
