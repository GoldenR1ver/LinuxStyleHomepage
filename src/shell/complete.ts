import { commandNames } from './commands'
import type { ShellCtx } from './context'
import { resolve } from '../kernel/path'

/** Complete command names and paths. Quoted text is left alone. */
export function completeLine(line: string, ctx: ShellCtx): { line: string; matches: string[] } {
  if (/['"\\]/.test(line)) return { line, matches: [] }
  if (!line.trim()) return { line, matches: [] }
  const trailing = /\s$/.test(line)
  const parts = line.trim().split(/\s+/)
  if (!trailing && parts.length === 1) {
    const token = parts[0] ?? ''
    const matches = commandNames().filter((name) => name.startsWith(token))
    return apply('', token, matches, true)
  }
  const token = trailing ? '' : (parts[parts.length - 1] ?? '')
  const prefix = trailing ? line : line.slice(0, line.length - token.length)
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
