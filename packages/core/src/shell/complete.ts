import { commandNames } from './commands'
import type { ShellCtx } from './context'
import { resolve } from '../kernel/path'

/** First argument of a subcommand-style command. Paths still complete after it. */
const SUBCOMMANDS: Record<string, string[]> = {
  mail: ['status', 'add', 'reset', 'push', '-m', '-A', '--all'],
}

/** Commands whose argument is the name of a function in this pane. */
const FUNCTION_ARGS = new Set(['unfunction', 'functions'])

/** Complete command names and paths. Quoted text is left alone. */
export function completeLine(line: string, ctx: ShellCtx): { line: string; matches: string[] } {
  if (/['"\\]/.test(line)) return { line, matches: [] }
  if (!line.trim()) return { line, matches: [] }
  const trailing = /\s$/.test(line)
  const parts = line.trim().split(/\s+/)
  if (!trailing && parts.length === 1) {
    const token = parts[0] ?? ''
    const names = [...commandNames(), ...Object.keys(ctx.functions).sort()]
    const matches = names.filter((name) => name.startsWith(token))
    return apply('', token, matches, true)
  }
  const token = trailing ? '' : (parts[parts.length - 1] ?? '')
  const prefix = trailing ? line : line.slice(0, line.length - token.length)
  if (!trailing && parts.length === 2) {
    const subcommands = SUBCOMMANDS[parts[0] ?? '']
    if (subcommands) {
      const matches = subcommands.filter((name) => name.startsWith(token))
      if (matches.length) return apply(prefix, token, matches, false)
    }
    if (FUNCTION_ARGS.has(parts[0] ?? '')) {
      const matches = Object.keys(ctx.functions)
        .filter((name) => name.startsWith(token))
        .sort()
      if (matches.length) return apply(prefix, token, matches, false)
    }
  }
  const slash = token.lastIndexOf('/')
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : ''
  const base = slash >= 0 ? token.slice(slash + 1) : token
  let names: string[] = []
  try {
    names = ctx.rt.fs.readdir(ctx.user, resolve(ctx.cwd, dirPart || '.'))
  } catch {
    names = []
  }
  const matches = names
    .filter((name) => name.startsWith(base) && (base.startsWith('.') || !name.startsWith('.')))
    .map((name) => {
      const text = `${dirPart}${name}`
      try {
        if (ctx.rt.fs.stat(ctx.user, resolve(ctx.cwd, text)).type === 'dir') return `${text}/`
      } catch {
        return text
      }
      return text
    })
  return apply(prefix, token, matches, false)
}

function apply(prefix: string, token: string, matches: string[], command: boolean): { line: string; matches: string[] } {
  if (!matches.length) return { line: prefix + token, matches }
  if (matches.length === 1) {
    const only = matches[0] ?? ''
    const suffix = only.endsWith('/') ? '' : ' '
    return { line: prefix + only + (command || suffix ? suffix : ''), matches }
  }
  const common = commonPrefix(matches)
  if (common.length > token.length) return { line: prefix + common, matches }
  return { line: prefix + token, matches }
}

function commonPrefix(values: string[]): string {
  let prefix = values[0] ?? ''
  for (const value of values) {
    while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}
