import type { MailNote, MailResult, Mailer } from './mail'

/** The offline mailer. Tests and the CLI use it, so nothing leaves the machine. */
export class MemoryMail implements Mailer {
  notes: MailNote[] = []

  constructor(public configured = false) {}

  async send(note: MailNote): Promise<MailResult> {
    this.notes.push(note)
    return { status: this.configured ? 'sent' : 'skipped' }
  }
}
