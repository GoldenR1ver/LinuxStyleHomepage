import type { MailNote, Mailer } from './mail'
import type { RemoteChange } from '../kernel/types'
import type { RemoteRepo } from './repo'

export class MemoryRemote implements RemoteRepo {
  commits: { message: string; changes: RemoteChange[] }[] = []

  constructor(
    public configured = true,
    public authenticated = false,
  ) {}

  async commit(changes: RemoteChange[], message: string) {
    this.commits.push({ message, changes: changes.map((change) => ({ ...change })) })
  }
}

export class MemoryMail implements Mailer {
  notes: MailNote[] = []

  constructor(public configured = false) {}

  async send(note: MailNote): Promise<'sent' | 'skipped' | 'failed'> {
    this.notes.push(note)
    return this.configured ? 'sent' : 'skipped'
  }
}
