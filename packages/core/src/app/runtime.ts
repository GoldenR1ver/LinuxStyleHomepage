import type { VirtualFS } from '../kernel/vfs'
import type { SiteConfig } from '../config/site'
import type { SessionHost } from '../mux/mux'
import type { Mailer } from '../remote/mail'
import type { Outbox } from '../remote/outbox'

export interface Proc {
  pid: number
  user: string
  cwd: string
  win: string
  active: boolean
}

/**
 * Services shared by every pane. Commands reach the filesystem and the network
 * only through this. There is no remote repository and no token: the overlay in
 * this browser is the whole state, and the only outbound call is a letter.
 */
export interface Runtime {
  site: SiteConfig
  fs: VirtualFS
  mail: Mailer
  outbox: Outbox
  persist: () => Promise<void>
  procs: () => Proc[]
  mux: SessionHost | null
}
