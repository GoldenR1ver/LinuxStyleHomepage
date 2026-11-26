import { memoryStore, type Persisted, type Store } from '@home/core/app/store'

/** The IndexedDB adapter for the core Store port. Browser only. */
export function createIdbStore(): Store {
  return {
    async load() {
      const value = await request<Persisted | undefined>('readonly', (store) => store.get('state'))
      return value ?? null
    },
    async save(data) {
      await request('readwrite', (store) => store.put(data, 'state'))
    },
  }
}

export async function openStore(): Promise<{ store: Store; warning: string }> {
  try {
    const store = createIdbStore()
    await store.load()
    return { store, warning: '' }
  } catch {
    return { store: memoryStore(), warning: 'local storage is unavailable. Drafts and the log disappear on refresh.\n' }
  }
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction('kv', mode)
        const req = run(tx.objectStore('kv'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('homepage', 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
