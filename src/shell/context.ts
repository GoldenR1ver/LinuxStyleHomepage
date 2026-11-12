import type { User } from '../kernel/types'
import type { Runtime } from '../app/runtime'
import type { Host } from './host'

export interface ShellCtx {
  user: User
  cwd: string
  env: Record<string, string>
  aliases: Record<string, string>
  /** Bodies defined with name() { ... }. Kept in this pane only. */
  functions: Record<string, string>
  /** Positional arguments of the running function: $1, $2, ... */
  args: string[]
  history: string[]
  rt: Runtime
  host: Host
  columns: number
  closing: boolean
  line: string
  /** Marked only after rollback commits. A failed transaction must not leave these set. */
  revertIds?: string[]
}
