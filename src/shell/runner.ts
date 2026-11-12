import { FsError } from '../kernel/vfs'
import { resolve } from '../kernel/path'
import { lookup } from './commands'
import type { ShellCtx } from './context'
import { expandAlias, expandWord } from './expand'
import { checkBody, MAX_FUNCTION_DEPTH, MAX_FUNCTIONS, readDefinition, RESERVED } from './function'
import { writeFile } from './commands/helpers'
import type { ListItem, Redirect, Segment, Word } from './parser'
import { parse } from './parser'
import type { CommandResult } from './result'
import { seal } from './seal'

/**
 * Every segment a single input line may run, counting function bodies.
 * A body with two calls and a depth of 6 must not fan out without bound.
 */
const MAX_SEGMENTS = 200

interface Budget {
  left: number
  /** A fan-out would otherwise print the same two errors a hundred times. */
  depthReported: boolean
  limitReported: boolean
}

export async function runLine(line: string, ctx: ShellCtx): Promise<CommandResult> {
  const definition = readDefinition(line)
  if (definition) {
    if ('error' in definition) return { code: 2, stderr: `sh: ${definition.error}\n` }
    return define(ctx, definition.name, definition.body)
  }
  ctx.line = line
  let parsed
  try {
    parsed = parse(expandAlias(line, ctx.aliases))
  } catch (err) {
    return { code: 2, stderr: `sh: ${message(err)}\n` }
  }
  if (!parsed.items.length) return { code: 0 }
  return runList(parsed.items, ctx, 0, { left: MAX_SEGMENTS, depthReported: false, limitReported: false })
}

/**
 * A function body runs like a line, but ctx.line stays the visible command so a
 * commit and a journal entry still name what the user typed.
 */
async function runList(items: ListItem[], ctx: ShellCtx, depth: number, budget: Budget, feed = ''): Promise<CommandResult> {
  let code = 0
  let stdout = ''
  let stderr = ''
  let clear = false
  let logout = false
  let exitPane = false
  let pager: string | undefined
  let stage: CommandResult['stage']
  const downloads: NonNullable<CommandResult['downloads']> = []
  let first = true

  for (const item of items) {
    if (item.op === '&&' && code !== 0) continue
    if (item.op === '||' && code === 0) continue
    const incoming = first ? feed : ''
    const result = await runPipeline(item.pipeline.segments, ctx, depth, budget, incoming)
    first = false
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

async function runPipeline(
  segments: Segment[],
  ctx: ShellCtx,
  depth: number,
  budget: Budget,
  feed = '',
): Promise<CommandResult> {
  let incoming = feed
  let result: CommandResult = { code: 0, stdout: '' }
  let stderr = ''
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue
    const piped = index > 0 || (index === 0 && feed !== '')
    result = await runSegment(segment, ctx, incoming, piped, depth, budget)
    stderr += result.stderr ?? ''
    incoming = result.pager !== undefined ? '' : result.stdout ?? ''
    if (result.logout || result.exitPane) break
  }
  return { ...result, stderr }
}

async function runSegment(
  segment: Segment,
  ctx: ShellCtx,
  incoming: string,
  piped: boolean,
  depth: number,
  budget: Budget,
): Promise<CommandResult> {
  budget.left -= 1
  if (budget.left < 0) {
    if (budget.limitReported) return { code: 1 }
    budget.limitReported = true
    return { code: 1, stderr: `sh: this line ran more than ${MAX_SEGMENTS} commands and was stopped.\n` }
  }
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
      const body = ctx.functions[name]
      if (body !== undefined) {
        // Nothing is written before dispatch, so the outer transaction is safe to drop.
        const input = segment.redirects.find((redirect) => redirect.op === '<')
        const feed = input ? readInput(ctx, input) : piped ? incoming : ''
        ctx.rt.fs.abort()
        const output = await runFunction(ctx, name, body, args.slice(1), depth, budget, feed)
        const writes = segment.mergeStderr || segment.redirects.some((redirect) => redirect.op !== '<')
        if (!writes) return output
        // A redirect on the call writes after the body has already committed.
        ctx.rt.fs.begin()
        const redirected = applyRedirects(ctx, segment, output)
        const note = await seal(ctx)
        return { ...redirected, stderr: `${redirected.stderr ?? ''}${note}` }
      }
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

/** Run a stored body with $1..$9, $# and $@ bound to the call's arguments. */
async function runFunction(
  ctx: ShellCtx,
  name: string,
  body: string,
  argv: string[],
  depth: number,
  budget: Budget,
  feed: string,
): Promise<CommandResult> {
  if (depth >= MAX_FUNCTION_DEPTH) {
    if (budget.depthReported) return { code: 1 }
    budget.depthReported = true
    return {
      code: 1,
      stderr: `sh: ${name}: too many levels of function calls (${MAX_FUNCTION_DEPTH} allowed)\n`,
    }
  }
  let parsed
  try {
    parsed = parse(expandAlias(body, ctx.aliases))
  } catch (err) {
    return { code: 1, stderr: `sh: ${name}: ${message(err)}\n` }
  }
  if (!parsed.items.length) return { code: 0 }
  const previous = ctx.args
  ctx.args = argv
  try {
    return await runList(parsed.items, ctx, depth + 1, budget, feed)
  } finally {
    ctx.args = previous
  }
}

function define(ctx: ShellCtx, name: string, body: string): CommandResult {
  if (RESERVED.has(name)) return { code: 1, stderr: `sh: ${name}: is a reserved word\n` }
  if (lookup(name)) {
    return { code: 1, stderr: `sh: ${name}: is a builtin command; choose another name\n` }
  }
  if (ctx.aliases[name]) {
    return { code: 1, stderr: `sh: ${name}: an alias has that name; run unalias ${name} first\n` }
  }
  const known = name in ctx.functions
  if (!known && Object.keys(ctx.functions).length >= MAX_FUNCTIONS) {
    return { code: 1, stderr: `sh: too many functions (${MAX_FUNCTIONS} allowed); run unfunction first\n` }
  }
  const problem = checkBody(body)
  if (problem) return { code: 1, stderr: `sh: ${name}: ${problem}\n` }
  ctx.functions[name] = body
  return { code: 0 }
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
