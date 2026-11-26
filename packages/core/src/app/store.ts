import type { Entry } from '../kernel/types'
import type { MailDraft } from '../remote/outbox'

/**
 * The persistence port. A host supplies one: the browser uses IndexedDB, a Node
 * host uses a file, a test uses memoryStore. Nothing here touches a platform API.
 */
export interface Persisted {
  v: 1
  remote: [string, Entry][]
  local: [string, Entry][]
  /** Draft subject and paths. Absent in saves from before mail. */
  outbox?: MailDraft
}

export interface Store {
  load(): Promise<Persisted | null>
  save(data: Persisted): Promise<void>
}

export function memoryStore(): Store {
  let data: Persisted | null = null
  return {
    async load() {
      return data ? structuredClone(data) : null
    },
    async save(next) {
      data = structuredClone(next)
    },
  }
}
