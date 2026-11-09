export const MAIL_SUBJECT_MAX = 120
export const MAIL_BODY_MAX = 8000
export const MAIL_LETTER_MAX = 32_000
export const MAIL_ITEM_MAX = 10
export const MAIL_SEND_MAX = 8

export interface DraftNote {
  about: string
  body: string
}

/** Letter waiting for mail push. Paths are read again at send time. */
export interface MailDraft {
  subject: string
  files: string[]
  notes: DraftNote[]
}

export interface Outbox {
  draft: MailDraft
  /** Successful sends during this page load. Not stored. */
  sent: number
}

export function emptyDraft(): MailDraft {
  return { subject: '', files: [], notes: [] }
}

export function createOutbox(draft: MailDraft = emptyDraft()): Outbox {
  return { draft, sent: 0 }
}

export function clearDraft(draft: MailDraft) {
  draft.subject = ''
  draft.files.length = 0
  draft.notes.length = 0
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
  const raw = value as { subject?: unknown; files?: unknown; notes?: unknown }
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
