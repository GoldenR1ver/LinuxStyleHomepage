import { mailRelay } from '../config/site'
import { clipText, MAIL_LETTER_MAX, MAIL_SUBJECT_MAX } from './outbox'

export interface MailNote {
  kind: 'letter' | 'visit'
  user: string
  path?: string
  subject?: string
  body: string
}

export interface Mailer {
  readonly configured: boolean
  send(note: MailNote): Promise<'sent' | 'skipped' | 'failed'>
}

/**
 * Posts one letter to the relay chosen in site.ts.
 * The request URL is that relay. Callers cannot supply another.
 * The GitHub token is not read, and no Authorization header is set.
 */
export function createMailer(webhookUrl: string, email: string, fetchImpl: typeof fetch = fetch): Mailer {
  const target = mailRelay(webhookUrl)
  const configured = target !== null
  return {
    configured,
    async send(note) {
      if (!target) return 'skipped'
      const payload = {
        email: senderAddress(note.user),
        message: letterBody(email, note.body),
        _subject: headerSubject(note.subject, note.kind),
        _gotcha: '',
        type: note.kind,
        path: oneLine(note.path ?? '', 200),
        user: senderName(note.user),
      }
      try {
        const response = await fetchImpl(target, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        return response.ok ? 'sent' : 'failed'
      } catch {
        return 'failed'
      }
    },
  }
}

function letterBody(email: string, body: string): string {
  const to = oneLine(email, 200)
  const text = clipText(body.replace(/\0/g, ''), MAIL_LETTER_MAX)
  return to ? `to: ${to}\n${text}` : text
}

function headerSubject(subject: string | undefined, kind: MailNote['kind']): string {
  const fallback = kind === 'visit' ? 'visit' : 'letter'
  const text = oneLine(subject ?? '', MAIL_SUBJECT_MAX) || fallback
  if (text.startsWith('[home]')) return clipText(text, 140)
  return `[home] ${text}`
}

function senderName(user: string): string {
  return user.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'guest'
}

function senderAddress(user: string): string {
  return `${senderName(user)}@homepage.local`
}

function oneLine(value: string, max: number): string {
  return clipText(value.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim(), max)
}
