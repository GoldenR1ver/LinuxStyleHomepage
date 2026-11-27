import { homeDir } from '../kernel/accounts'
import type { ShellCtx } from '../shell/context'
import { runLine } from '../shell/runner'

/**
 * `/etc/profile` and `~/.profile`, run once per shell, top to bottom.
 *
 * A profile is ordinary shell commands, so it needs no new syntax: `export`,
 * `alias`, a function definition and `umask` all already work. A line that fails
 * prints its error and the rest of the file still runs, the way a real profile
 * does not abort a login because one `export` was misspelled.
 */
export async function runProfile(ctx: ShellCtx): Promise<string> {
  let output = ''
  for (const path of ['/etc/profile', `${homeDir(ctx.user)}/.profile`]) {
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
    }
  }
  return output
}
