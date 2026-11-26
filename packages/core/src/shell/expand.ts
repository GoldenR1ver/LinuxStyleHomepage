import { homeDir } from '../kernel/auth'
import type { ShellCtx } from './context'
import { expandGlob, hasMeta } from './glob'
import type { Word, WordPart } from './parser'

export function expandAlias(line: string, aliases: Record<string, string>): string {
  let current = line
  const seen = new Set<string>()
  for (let i = 0; i < 8; i++) {
    const match = /^\s*([A-Za-z_][\w-]*)/.exec(current)
    const name = match?.[1]
    if (!match || !name) return current
    const value = aliases[name]
    if (!value || seen.has(name)) return current
    seen.add(name)
    const nameStart = match.index + match[0].length - name.length
    current = current.slice(0, nameStart) + value + current.slice(nameStart + name.length)
  }
  return current
}

export function expandWord(word: Word, ctx: ShellCtx): string[] {
  const single = word.parts.length === 1 ? word.parts[0] : undefined
  if (single?.quote === 'none') {
    const text = expandPart(single, ctx)
    if (text === '') return []
    if (hasMeta(text)) return expandGlob(ctx.rt.fs, ctx.user, ctx.cwd, text)
    return [text]
  }
  let text = ''
  for (const part of word.parts) text += expandPart(part, ctx)
  return [text]
}

function expandPart(part: WordPart, ctx: ShellCtx): string {
  if (part.quote === 'single') return part.raw
  let raw = part.raw
  if (part.quote === 'none' && (raw === '~' || raw.startsWith('~/'))) {
    raw = homeDir(ctx.user) + raw.slice(1)
  }
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\') {
      const next = raw[i + 1]
      if (next === undefined) {
        out += '\\'
        break
      }
      if (part.quote === 'double' && !'$`"\\'.includes(next)) {
        out += ch
        continue
      }
      out += next
      i += 1
      continue
    }
    if (ch === '`' || (ch === '$' && raw[i + 1] === '(')) {
      throw new Error('command substitution is disabled')
    }
    if (ch === '$') {
      const ref = readVar(raw, i + 1)
      if (!ref) {
        out += '$'
        continue
      }
      out += value(ctx, ref.name)
      i = ref.end - 1
      continue
    }
    out += ch
  }
  return out
}

/** $1..$9, $#, $@ and $* read the call's arguments. Anything else is an environment name. */
function value(ctx: ShellCtx, name: string): string {
  if (/^\d+$/.test(name)) {
    const index = Number(name)
    if (index === 0) return 'sh'
    return ctx.args[index - 1] ?? ''
  }
  if (name === '#') return String(ctx.args.length)
  if (name === '@' || name === '*') return ctx.args.join(' ')
  return ctx.env[name] ?? ''
}

function readVar(source: string, index: number): { name: string; end: number } | null {
  if (source[index] === '{') {
    const end = source.indexOf('}', index + 1)
    if (end < 0) throw new Error('bad substitution')
    const name = source.slice(index + 1, end)
    if (!/^(?:[A-Za-z_][A-Za-z0-9_]*|\d+|[#@*])$/.test(name)) throw new Error('bad substitution')
    return { name, end: end + 1 }
  }
  const special = source[index]
  if (special && '#@*'.includes(special)) return { name: special, end: index + 1 }
  const digits = /^\d+/.exec(source.slice(index))
  if (digits) return { name: digits[0], end: index + digits[0].length }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index))
  if (!match) return null
  return { name: match[0], end: index + match[0].length }
}
