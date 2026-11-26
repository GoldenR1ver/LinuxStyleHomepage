import type { ShellCtx } from '../context'
import type { CommandResult } from '../context'

export type CommandGroup = 'file' | 'text' | 'system' | 'site'

export interface CommandSpec {
  name: string
  group: CommandGroup
  summary: string
  usage: string
  manual: string
  readsStdin?: (args: string[]) => boolean
  run: (ctx: ShellCtx, args: string[], stdin: string) => CommandResult | Promise<CommandResult>
}
