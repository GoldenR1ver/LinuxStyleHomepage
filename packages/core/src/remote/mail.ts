import { mailRelay } from '../config/site'
import { clipText, MAIL_LETTER_MAX, MAIL_SUBJECT_MAX, mailAddress } from './outbox'

export interface MailNote {
  kind: 'letter' | 'visit'
  user: string
  /** The guest's reply address. Only a letter needs one. */
  from?: string
  path?: string
  subject?: string
  body: string
}

export interface MailResult {
  status: 'sent' | 'skipped' | 'failed'
  /** HTTP status and relay message, or a network reason. Shown by mail push. */
  detail?: string
}

export interface Mailer {
  readonly configured: boolean
  send(note: MailNote): Promise<MailResult>
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
      if (!target) return { status: 'skipped', detail: 'relay is empty' }
      const payload = {
        email: replyAddress(note),
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
        if (response.ok) return { status: 'sent' }
        return { status: 'failed', detail: `${response.status}${await relayReason(response)}` }
      } catch (err) {
        return { status: 'failed', detail: oneLine(err instanceof Error ? err.message : String(err), 160) || 'network error' }
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

/** Formspree uses `email` as Reply-To, so a real address is what makes a reply work. */
function replyAddress(note: MailNote): string {
  const chosen = note.from ? mailAddress(note.from) : null
  return chosen ?? senderAddress(note.user)
}

function oneLine(value: string, max: number): string {
  return clipText(value.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim(), max)
}

/**
 * One short phrase from a relay rejection, so `mail push` can say why.
 * Formspree answers 403 for an unconfirmed form and 422 with an errors list.
 */
async function relayReason(response: Response): Promise<string> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    return ''
  }
  if (!text) return ''
  try {
    const body = JSON.parse(text) as { error?: unknown; errors?: { field?: unknown; message?: unknown }[] }
    const errors = Array.isArray(body.errors) ? body.errors : []
    const parts = errors
      .map((item) => {
        const message = typeof item?.message === 'string' ? item.message : ''
        const field = typeof item?.field === 'string' ? item.field : ''
        if (!message) return ''
        return field ? `${field} ${message}` : message
      })
      .filter(Boolean)
    if (parts.length) return `: ${oneLine(parts.join('; '), 160)}`
    if (typeof body.error === 'string' && body.error) return `: ${oneLine(body.error, 160)}`
    return ''
  } catch {
    return `: ${oneLine(text, 160)}`
  }
}
