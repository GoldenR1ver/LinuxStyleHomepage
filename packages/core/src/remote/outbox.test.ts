import { describe, expect, it } from 'vitest'
import { clearDraft, createOutbox, mailAddress, restoreDraft } from './outbox'

describe('outbox', () => {
  it('accepts one plain address and nothing else', () => {
    expect(mailAddress('ada@example.com')).toBe('ada@example.com')
    expect(mailAddress('  ada@example.com  ')).toBe('ada@example.com')
    expect(mailAddress('ada.lovelace+home@mail.example.co.uk')).toBe('ada.lovelace+home@mail.example.co.uk')

    expect(mailAddress('')).toBeNull()
    expect(mailAddress('ada')).toBeNull()
    expect(mailAddress('ada@')).toBeNull()
    expect(mailAddress('ada@example')).toBeNull()
    expect(mailAddress('@example.com')).toBeNull()
    expect(mailAddress('ada@@example.com')).toBeNull()
    expect(mailAddress('ada@example.com Bcc: x')).toBeNull()
    expect(mailAddress('ada@example.com\r\nBcc: x')).toBeNull()
    expect(mailAddress('ada@example.com\0')).toBeNull()
    expect(mailAddress(`${'a'.repeat(65)}@example.com`)).toBeNull()
    expect(mailAddress(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })

  it('clears the letter but keeps the address', () => {
    const mail = createOutbox()
    mail.draft.from = 'ada@example.com'
    mail.draft.subject = 'hi'
    mail.draft.files.push('/var/guestbook/ada.txt')
    clearDraft(mail.draft)
    expect(mail.draft.subject).toBe('')
    expect(mail.draft.files).toHaveLength(0)
    expect(mail.draft.from).toBe('ada@example.com')
  })

  it('restores only an address that still parses', () => {
    expect(restoreDraft({ from: 'ada@example.com' }).from).toBe('ada@example.com')
    expect(restoreDraft({ from: '  ada@example.com ' }).from).toBe('ada@example.com')
    expect(restoreDraft({ from: 'ada@example.com\r\nBcc: x' }).from).toBe('')
    expect(restoreDraft({ from: 'not-an-address' }).from).toBe('')
    expect(restoreDraft({ from: 42 }).from).toBe('')
    expect(restoreDraft({}).from).toBe('')
    expect(restoreDraft(null).from).toBe('')
    expect(restoreDraft({ from: 'ada@example.com', subject: 'hi', files: ['/var/guestbook/ada.txt'] })).toEqual({
      subject: 'hi',
      from: 'ada@example.com',
      files: ['/var/guestbook/ada.txt'],
      notes: [],
    })
  })
})
