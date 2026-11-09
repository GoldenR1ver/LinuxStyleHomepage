import type { ShellCtx } from '../shell/context'
import { completeLine } from '../shell/complete'
import { runLine } from '../shell/runner'
import { saveDownload } from './download'
import { presentStage } from './present'
import { promptParts } from './prompt'
import { TermView } from './term'

export async function shellLoop(
  view: TermView,
  ctx: ShellCtx,
  opts: { intro?: string; onPrompt?: () => void; onCommand?: (line: string, code: number) => void },
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
    opts.onCommand?.(line, result.code)
    if (ctx.closing) return 'closed'
    if (result.clear) view.clear()
    if (result.stdout) view.print(result.stdout)
    if (result.stderr) view.print(result.stderr, 'err')
    if (result.pager !== undefined) await view.pager(result.pager)
    if (result.stage) await presentStage(view, ctx, result.stage)
    for (const file of result.downloads ?? []) saveDownload(file)
    if (result.logout) return 'logout'
    if (result.exitPane) return 'exit'
  }
  return 'closed'
}
