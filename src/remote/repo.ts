import type { RemoteChange } from '../kernel/types'

export interface RemoteRepo {
  readonly configured: boolean
  readonly authenticated: boolean
  commit(changes: RemoteChange[], message: string): Promise<void>
}
