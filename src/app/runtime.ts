import type { PasswordVault } from '../kernel/auth'
import type { Journal } from '../kernel/journal'
import type { VirtualFS } from '../kernel/vfs'
import type { SiteConfig } from '../config/site'
import type { SessionHost } from '../mux/host'
import type { Mailer } from '../remote/mail'
import type { Outbox } from '../remote/outbox'
import type { RemoteRepo } from '../remote/repo'
import type { TokenStore } from '../remote/token'

export interface Proc {
  pid: number
  user: string
  cwd: string
  win: string
  active: boolean
}

/** Services shared by every pane. Commands reach the filesystem and network only through this. */
export interface Runtime {
  site: SiteConfig
  fs: VirtualFS
  journal: Journal
  remote: RemoteRepo
  mail: Mailer
  outbox: Outbox
  vault: PasswordVault
  tokens: TokenStore
  persist: () => Promise<void>
  procs: () => Proc[]
  mux: SessionHost | null
}
