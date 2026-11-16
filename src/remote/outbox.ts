export const MAIL_SUBJECT_MAX = 120
export const MAIL_BODY_MAX = 8000
export const MAIL_LETTER_MAX = 32_000
export const MAIL_ITEM_MAX = 10
export const MAIL_SEND_MAX = 8
export const MAIL_ADDRESS_MAX = 254

const ADDRESS =
  /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/

export interface DraftNote {
  about: string
  body: string
}

/** Letter waiting for mail push. Paths are read again at send time. */
export interface MailDraft {
  subject: string
  /** The guest's reply address. mail push refuses to send without one. */
  from: string
  files: string[]
  notes: DraftNote[]
}

export interface Outbox {
  draft: MailDraft
  /** Successful sends during this page load. Not stored. */
  sent: number
}

export function emptyDraft(): MailDraft {
  return { subject: '', from: '', files: [], notes: [] }
}

export function createOutbox(draft: MailDraft = emptyDraft()): Outbox {
  return { draft, sent: 0 }
}

/**
 * Clear the letter, not the identity. A guest types the reply address once,
 * and `mail reset` or a successful push must not make them type it again.
 */
export function clearDraft(draft: MailDraft) {
  draft.subject = ''
  draft.files.length = 0
  draft.notes.length = 0
}

/**
 * A reply address the relay can use. Rejects anything that is not one plain
 * address, so a header cannot be split over two lines.
 */
export function mailAddress(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > MAIL_ADDRESS_MAX) return null
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return null
  return ADDRESS.test(text) ? text : null
}

export function clipText(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return chars.slice(0, max).join('')
}

/** Drop anything a tampered local save should not be able to smuggle into a letter. */
export function restoreDraft(value: unknown): MailDraft {
  const draft = emptyDraft()
  if (!value || typeof value !== 'object') return draft
  const raw = value as { subject?: unknown; from?: unknown; files?: unknown; notes?: unknown }
  if (typeof raw.from === 'string') {
    const address = mailAddress(raw.from)
    if (address) draft.from = address
  }
  if (typeof raw.subject === 'string' && !/[\r\n\0]/.test(raw.subject)) {
    const subject = raw.subject.trim()
    if (subject && [...subject].length <= MAIL_SUBJECT_MAX) draft.subject = subject
  }
  if (Array.isArray(raw.files)) {
    for (const file of raw.files) {
      if (draft.files.length >= MAIL_ITEM_MAX) break
      if (typeof file !== 'string' || !file.startsWith('/') || file.length > 200 || /[\r\n\0]/.test(file)) continue
      if (!draft.files.includes(file)) draft.files.push(file)
    }
  }
  if (Array.isArray(raw.notes)) {
    for (const note of raw.notes) {
      if (draft.files.length + draft.notes.length >= MAIL_ITEM_MAX) break
      if (!note || typeof note !== 'object') continue
      const about = (note as { about?: unknown }).about
      const body = (note as { body?: unknown }).body
      if (typeof about !== 'string' || typeof body !== 'string') continue
      if (about.length > 200 || /[\r\n\0]/.test(about)) continue
      const text = clipText(body.replace(/\0/g, ''), MAIL_BODY_MAX).trim()
      if (!text) continue
      draft.notes.push({ about, body: text })
    }
  }
  return draft
}
