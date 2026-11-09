import { homeDir } from '../kernel/auth'
import type { ShellCtx } from '../shell/context'
import type { Prompt } from './term'

export function promptParts(ctx: ShellCtx): Prompt {
  const home = ctx.env.HOME || homeDir(ctx.user)
  let cwd = ctx.cwd
  if (cwd === home) cwd = '~'
  else if (home !== '/' && cwd.startsWith(`${home}/`)) cwd = `~${cwd.slice(home.length)}`
  return {
    user: ctx.user.name,
    host: ctx.env.HOSTNAME || 'home',
    cwd,
    sig: ctx.user.role === 'root' ? '#' : '$',
    root: ctx.user.role === 'root',
  }
}
