import type { Entry } from '../kernel/types'
import type { MailDraft } from '../remote/outbox'

/**
 * The persistence port. A host supplies one: the browser uses IndexedDB, a Node
 * host uses a file, a test uses memoryStore. Nothing here touches a platform API.
 *
 * v2 dropped the `remote` layer. v1 saves are read by the browser host, which
 * folds their remote entries into the local overlay before loading it here.
 */
export interface Persisted {
  v: 2
  local: [string, Entry][]
  /** Draft subject and paths. */
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
