import { describe, expect, it } from 'vitest'
import { mailRelay, mailRelayProblem } from '../config/site'
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
    expect(mailRelay('https://formspree.io/f/abcdwxyz')).toBe('https://formspree.io/f/abcdwxyz')
  })

  it('names the reason a configured relay is refused', () => {
    expect(mailRelayProblem('')).toBe('webhookUrl is empty')
    expect(mailRelayProblem('  ')).toBe('webhookUrl is empty')
    expect(mailRelayProblem('abcdwxyz')).toContain('https://')
    expect(mailRelayProblem('formspree.io/f/abcdwxyz')).toContain('https://')
    expect(mailRelayProblem('http://formspree.io/f/abcdwxyz')).toBe('webhookUrl must use https')
    expect(mailRelayProblem('https://u:p@formspree.io/f/abcdwxyz')).toContain('user name')
    expect(mailRelayProblem('https://github.com/a/b')).toBe('webhookUrl must not point at GitHub')
    expect(mailRelayProblem('https://formspree.io/f/ghp_x')).toContain('token')
    expect(mailRelayProblem('https://formspree.io/f/abcdwxyz?token=x')).toContain('token in the query string')
    expect(mailRelayProblem('https://formspree.io/f/abcdwxyz')).toBe('')
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
      from: 'ada@example.com',
      subject: 'hello\nBcc: evil@example.com',
      path: '/var/guestbook/ada.txt',
      body: 'note',
    })
    expect(status.status).toBe('sent')
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
    expect(payload.email).toBe('ada@example.com')
    expect(payload.user).toBe('ada')
    expect(payload.type).toBe('letter')
    expect(payload.message).toContain('to: owner@example.com')
    expect(payload.message).toContain('note')
    expect(payload._gotcha).toBe('')
  })

  it('falls back to a local address for a visit digest and refuses a bad reply address', async () => {
    const bodies: Record<string, string>[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, string>)
      return new Response('{}', { status: 200 })
    }
    const mailer = createMailer('https://form.example/f/abc', 'owner@example.com', fetchImpl)
    await mailer.send({ kind: 'visit', user: 'guest', body: 'digest' })
    expect(bodies[0]?.email).toBe('guest@homepage.local')

    await mailer.send({ kind: 'letter', user: 'ada', from: 'ada@example.com\r\nBcc: x', body: 'note' })
    expect(bodies[1]?.email).toBe('ada@homepage.local')
  })

  it('does not call fetch when the relay is refused', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const mailer = createMailer('https://api.github.com/repos/a/b', 'owner@example.com', fetchImpl)
    expect(mailer.configured).toBe(false)
    expect((await mailer.send({ kind: 'letter', user: 'ada', body: 'note', subject: 'hi' })).status).toBe('skipped')
    expect(called).toBe(false)
  })

  it('reports why a relay refused the letter', async () => {
    const rejected: typeof fetch = async () =>
      new Response(JSON.stringify({ errors: [{ field: 'message', message: "can't be blank" }] }), { status: 422 })
    const unconfirmed = await createMailer('https://form.example/f/abc', 'o@example.com', rejected).send({
      kind: 'letter',
      user: 'ada',
      subject: 'hi',
      body: 'note',
    })
    expect(unconfirmed.status).toBe('failed')
    expect(unconfirmed.detail).toBe('422: message can\'t be blank')

    const forbidden: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'form needs confirmation' }), { status: 403 })
    const blocked = await createMailer('https://form.example/f/abc', 'o@example.com', forbidden).send({
      kind: 'letter',
      user: 'ada',
      subject: 'hi',
      body: 'note',
    })
    expect(blocked.detail).toBe('403: form needs confirmation')

    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const dropped = await createMailer('https://form.example/f/abc', 'o@example.com', offline).send({
      kind: 'letter',
      user: 'ada',
      subject: 'hi',
      body: 'note',
    })
    expect(dropped.status).toBe('failed')
    expect(dropped.detail).toBe('Failed to fetch')
  })
})
