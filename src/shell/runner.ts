import { FsError } from '../kernel/vfs'
import { resolve } from '../kernel/path'
import { lookup } from './commands'
import type { ShellCtx } from './context'
import { expandAlias, expandWord } from './expand'
import { writeFile } from './commands/helpers'
import type { Redirect, Segment, Word } from './parser'
import { parse } from './parser'
import type { CommandResult } from './result'
import { seal } from './seal'

export async function runLine(line: string, ctx: ShellCtx): Promise<CommandResult> {
  ctx.line = line
  let parsed
  try {
    parsed = parse(expandAlias(line, ctx.aliases))
  } catch (err) {
    return { code: 2, stderr: `sh: ${message(err)}\n` }
  }
  if (!parsed.items.length) return { code: 0 }

  let code = 0
  let stdout = ''
  let stderr = ''
  let clear = false
  let logout = false
  let exitPane = false
  let pager: string | undefined
  let stage: CommandResult['stage']
  const downloads: NonNullable<CommandResult['downloads']> = []

  for (const item of parsed.items) {
    if (item.op === '&&' && code !== 0) continue
    if (item.op === '||' && code === 0) continue
    const result = await runPipeline(item.pipeline.segments, ctx)
    code = result.code
    stdout = result.stdout ?? ''
    stderr += result.stderr ?? ''
    clear = clear || Boolean(result.clear)
    logout = logout || Boolean(result.logout)
    exitPane = exitPane || Boolean(result.exitPane)
    if (result.pager !== undefined) pager = result.pager
    if (result.stage) stage = result.stage
    if (result.downloads) downloads.push(...result.downloads)
    if (logout || exitPane) break
  }

  return {
    code,
    stdout,
    stderr,
    clear,
    logout,
    exitPane,
    pager,
    stage,
    downloads: downloads.length ? downloads : undefined,
  }
}

async function runPipeline(segments: Segment[], ctx: ShellCtx): Promise<CommandResult> {
  let incoming = ''
  let result: CommandResult = { code: 0, stdout: '' }
  let stderr = ''
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue
    result = await runSegment(segment, ctx, incoming, index > 0)
    stderr += result.stderr ?? ''
    incoming = result.pager !== undefined ? '' : result.stdout ?? ''
    if (result.logout || result.exitPane) break
  }
  return { ...result, stderr }
}

async function runSegment(segment: Segment, ctx: ShellCtx, incoming: string, piped: boolean): Promise<CommandResult> {
  ctx.revertIds = undefined
  ctx.rt.fs.begin()
  try {
    const args = segment.argv.flatMap((word) => expandWord(word, ctx))
    if (!args.length) {
      ctx.rt.fs.abort()
      return { code: 0 }
    }
    const name = args[0] ?? ''
    const spec = lookup(name)
    if (!spec) {
      ctx.rt.fs.abort()
      return { code: 127, stderr: `sh: ${name}: command not found\n` }
    }
    let stdin = piped ? incoming : ''
    const input = segment.redirects.find((redirect) => redirect.op === '<')
    if (input) stdin = readInput(ctx, input)
    else if (!piped && wantsStdin(spec, args.slice(1))) {
      const text = await ctx.host.readStdin()
      if (text === null) {
        ctx.rt.fs.abort()
        return { code: 130 }
      }
      stdin = text
    }
    const result = await spec.run(ctx, args.slice(1), stdin)
    if ((result.code ?? 0) !== 0) {
      ctx.revertIds = undefined
      ctx.rt.fs.abort()
      return result
    }
    const redirected = applyRedirects(ctx, segment, result)
    const note = await seal(ctx)
    return { ...redirected, stderr: `${redirected.stderr ?? ''}${note}` }
  } catch (err) {
    ctx.revertIds = undefined
    if (ctx.rt.fs.inTx()) ctx.rt.fs.abort()
    const text = message(err)
    return { code: err instanceof FsError ? 1 : 1, stderr: text.startsWith('sh:') ? ensureNl(text) : `sh: ${ensureNl(text)}` }
  }
}

function wantsStdin(spec: NonNullable<ReturnType<typeof lookup>>, args: string[]): boolean {
  try {
    return spec.readsStdin?.(args) ?? false
  } catch {
    return false
  }
}

function readInput(ctx: ShellCtx, redirect: Redirect): string {
  const path = onePath(ctx, redirect.target)
  const node = ctx.rt.fs.read(ctx.user, path)
  if (node.encoding !== 'utf8') throw new FsError('EINVAL', `${path}: binary file`)
  return node.content
}

function applyRedirects(ctx: ShellCtx, segment: Segment, result: CommandResult): CommandResult {
  let stdout = result.stdout ?? ''
  let stderr = result.stderr ?? ''
  if (segment.mergeStderr) {
    stdout += stderr
    stderr = ''
  }
  const output = segment.redirects.filter((redirect) => redirect.fd === 1 && redirect.op !== '<')
  const errors = segment.redirects.filter((redirect) => redirect.fd === 2 && redirect.op !== '<')
  const errorTarget = errors[errors.length - 1]
  if (errorTarget) {
    writeFile(ctx.rt.fs, ctx.user, onePath(ctx, errorTarget.target), stderr, errorTarget.op === '>>')
    stderr = ''
  }
  const outputTarget = output[output.length - 1]
  if (outputTarget) {
    writeFile(ctx.rt.fs, ctx.user, onePath(ctx, outputTarget.target), stdout, outputTarget.op === '>>')
    stdout = ''
  }
  return { ...result, stdout, stderr }
}

function onePath(ctx: ShellCtx, word: Word): string {
  const paths = expandWord(word, ctx)
  if (paths.length !== 1 || !paths[0]) throw new Error('ambiguous redirect')
  return resolve(ctx.cwd, paths[0])
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function ensureNl(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}
