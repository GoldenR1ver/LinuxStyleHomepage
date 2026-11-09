import { isGuestbook } from '../kernel/policy'
import type { ShellCtx } from './context'
import { stageSavedGuestbook } from './mailbox'

/** Commit writes collected by one command. The caller aborts on failure. */
export async function seal(ctx: ShellCtx): Promise<string> {
  const fs = ctx.rt.fs
  const changes = fs.pendingChanges()
  const touched = [...new Set(fs.touched())]
  if (changes.length) {
    if (!ctx.rt.remote.configured) {
      fs.abort()
      throw new Error('github owner/repo is not set. Fill in src/config/site.ts and rebuild.')
    }
    if (!ctx.rt.remote.authenticated) {
      fs.abort()
      throw new Error('no token in this browser, so server files were not changed. Run github auth.')
    }
    try {
      await ctx.rt.remote.commit(changes, commitMessage(ctx.line))
    } catch (err) {
      fs.abort()
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(detail)
    }
  }
  const steps = fs.finish()
  if (ctx.user.role === 'root' && steps.length) {
    ctx.rt.journal.recordMutation({ user: ctx.user.name, command: ctx.line, steps })
  }
  const revertIds = ctx.revertIds ?? []
  ctx.revertIds = undefined
  for (const id of revertIds) ctx.rt.journal.markReverted(id)

  let note = ''
  if (ctx.user.role !== 'root') {
    for (const path of touched.filter((item) => isGuestbook(item))) {
      note += stageSavedGuestbook(ctx, path)
    }
  }
  try {
    await ctx.rt.persist()
  } catch {
    note += 'could not save local storage. This change may disappear on refresh.\n'
  }
  return note
}

function commitMessage(line: string): string {
  const text = line.replace(/\s+/g, ' ').trim()
  return `homepage: ${text}`.slice(0, 200)
}
