import type { ShellCtx } from '../shell/context'
import { completeLine } from '../shell/complete'
import { runLine } from '../shell/runner'
import type { CommandResult } from '../shell/result'
import { saveDownload } from './download'
import { presentStage } from './present'
import { promptParts } from './prompt'
import { TermView } from './term'

/** A click can open another document, which can open another. Keep the chain finite. */
const MAX_FOLLOW = 12

type End = 'logout' | 'exit' | 'closed' | undefined

export async function shellLoop(
  view: TermView,
  ctx: ShellCtx,
  opts: { intro?: string; boot?: string; onPrompt?: () => void; onCommand?: (line: string, code: number) => void },
): Promise<'logout' | 'exit' | 'closed'> {
  ctx.host = view
  view.onTab = (line) => {
    const result = completeLine(line, ctx)
    view.setInput(result.line)
    if (result.matches.length > 1 && result.line === line) {
      view.print(`${result.matches.slice(0, 80).join('  ')}\n`, 'dim')
    }
  }
  if (opts.intro) view.print(opts.intro)
  if (opts.boot) {
    const end = await execute(view, ctx, opts.boot, false, opts)
    if (end) return end
  }
  while (!ctx.closing) {
    opts.onPrompt?.()
    view.setHistory(ctx.history)
    const read = await view.readLine(promptParts(ctx))
    if (read.type === 'closed' || ctx.closing) return 'closed'
    if (read.type === 'interrupt') continue
    if (read.type === 'eof') return 'exit'
    const line = read.value
    if (!line.trim()) continue
    ctx.history.push(line)
    if (ctx.history.length > 200) ctx.history.splice(0, ctx.history.length - 200)
    const end = await execute(view, ctx, line, true, opts)
    if (end) return end
  }
  return 'closed'
}

/**
 * Run one line, then follow any link the reader clicks in what it opened.
 * A followed command is not pushed to history: it was not typed.
 */
async function execute(
  view: TermView,
  ctx: ShellCtx,
  line: string,
  typed: boolean,
  opts: { onCommand?: (line: string, code: number) => void },
): Promise<End> {
  let current = line
  for (let step = 0; step <= MAX_FOLLOW; step++) {
    if (step === MAX_FOLLOW) {
      view.print('sh: stopped following links; too many in a row.\n', 'err')
      return undefined
    }
    const result = await run(view, ctx, current)
    if (typed) opts.onCommand?.(current, result.code)
    if (ctx.closing) return 'closed'
    if (result.logout) return 'logout'
    if (result.exitPane) return 'exit'
    const next = result.stage ? await presentStage(view, ctx, result.stage) : undefined
    if (!next) return undefined
    current = next
    typed = false
  }
  return undefined
}

async function run(view: TermView, ctx: ShellCtx, line: string): Promise<CommandResult> {
  ctx.columns = view.columns()
  ctx.line = line
  const result = await runLine(line, ctx)
  ctx.rt.journal.recordEvent({
    user: ctx.user.name,
    role: ctx.user.role,
    action: 'exec',
    detail: line,
    code: result.code,
  })
  try {
    await ctx.rt.persist()
  } catch {
    /* the command already reported a failed write */
  }
  if (result.clear) view.clear()
  if (result.stdout) view.print(result.stdout)
  if (result.stderr) view.print(result.stderr, 'err')
  if (result.pager !== undefined) await view.pager(result.pager)
  for (const file of result.downloads ?? []) saveDownload(file)
  return result
}
