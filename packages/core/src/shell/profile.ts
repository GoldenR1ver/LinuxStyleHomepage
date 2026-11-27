import type { ShellCtx } from './context'
import { homeDir } from '../kernel/accounts'
import { runLine } from './runner'

/**
 * Login scripts, the way `/bin/sh` reads them: `/etc/profile` for every user,
 * then `~/.profile` for that user. One command per line, because this shell has
 * no multi-line constructs. A failing line prints its error and the rest still
 * runs, so a typo in a profile cannot lock anyone out.
 */
export const PROFILE_FILES = ['/etc/profile'] as const

export function profilePaths(ctx: ShellCtx): string[] {
  return [...PROFILE_FILES, `${homeDir(ctx.user)}/.profile`]
}

export async function loadProfiles(ctx: ShellCtx): Promise<string> {
  let output = ''
  for (const path of profilePaths(ctx)) {
    let text: string
    try {
      const node = ctx.rt.fs.read(ctx.user, path)
      if (node.encoding !== 'utf8') continue
      text = node.content
    } catch {
      continue
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const result = await runLine(line, ctx)
      if (result.stdout) output += result.stdout
      if (result.stderr) output += result.stderr
      if (result.logout || result.exitPane) return output
    }
  }
  return output
}
