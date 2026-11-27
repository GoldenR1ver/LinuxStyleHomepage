import { isGuestbook } from '../kernel/policy'
import type { ShellCtx } from './context'
import { pruneMissingDraft, stageSavedGuestbook } from './mailbox'

/**
 * Close a command. There is no remote any more: the overlay is the truth.
 * The only work left is keeping the mail draft in step with a saved guestbook
 * note, and writing the overlay to the browser store.
 */
export async function seal(ctx: ShellCtx): Promise<string> {
  const fs = ctx.rt.fs
  const touched = [...new Set(fs.touched())]
  fs.finish()

  let note = ''
  note += pruneMissingDraft(ctx)
  for (const path of touched.filter((item) => isGuestbook(item))) {
    note += stageSavedGuestbook(ctx, path)
  }
  try {
    await ctx.rt.persist()
  } catch {
    note += 'could not save local storage. This change may disappear on refresh.\n'
  }
  return note
}
