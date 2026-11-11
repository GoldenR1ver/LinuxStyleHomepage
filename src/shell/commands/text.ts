import { FsError } from '../../kernel/vfs'
import type { ShellCtx } from '../context'
import type { CommandResult } from '../result'
import type { CommandSpec } from './types'
import { flags, resolvePath, splitLines } from './helpers'

export const textCommands: CommandSpec[] = [
  {
    name: 'echo',
    group: 'text',
    summary: 'print arguments',
    usage: 'echo [-n] [-e] [arg...]',
    manual: '-n omits the newline. -e interprets \\n \\t \\\\ \\e.',
    run(_ctx, args) {
      let newline = true
      let escape = false
      const words: string[] = []
      for (const arg of args) {
        if (!words.length && /^-([ne]+)$/.test(arg)) {
          if (arg.includes('n')) newline = false
          if (arg.includes('e')) escape = true
          continue
        }
        words.push(arg)
      }
      const text = escape ? interpret(words.join(' ')) : words.join(' ')
      return { code: 0, stdout: newline ? `${text}\n` : text }
    },
  },
  {
    name: 'printf',
    group: 'text',
    summary: 'formatted print',
    usage: 'printf format [arg...]',
    manual: 'Supports %s %d %%, and \\n in the format.',
    run(_ctx, args) {
      const format = args[0]
      if (format === undefined) throw new FsError('EINVAL', 'missing format')
      return { code: 0, stdout: formatText(interpret(format), args.slice(1)) }
    },
  },
  {
    name: 'head',
    group: 'text',
    summary: 'print the first lines',
    usage: 'head [-n N] [file...]',
    manual: 'Default is 10 lines. With no file, read stdin.',
    readsStdin: (args) => countArgs(args).files.length === 0,
    run: (ctx, args, stdin) => sliceFiles(ctx, args, stdin, 'head'),
  },
  {
    name: 'tail',
    group: 'text',
    summary: 'print the last lines',
    usage: 'tail [-n N] [file...]',
    manual: 'Default is 10 lines. With no file, read stdin.',
    readsStdin: (args) => countArgs(args).files.length === 0,
    run: (ctx, args, stdin) => sliceFiles(ctx, args, stdin, 'tail'),
  },
  {
    name: 'wc',
    group: 'text',
    summary: 'count lines, words, bytes',
    usage: 'wc [-lwc] [file...]',
    manual: 'Prints all three counts unless a flag selects some. Several files end with a total.',
    readsStdin: (args) => flags(args, 'lwc').rest.length === 0,
    run(ctx, args, stdin) {
      const { set, rest } = flags(args, 'lwc')
      const fields = !set.size || set.size === 3 ? (['l', 'w', 'c'] as const) : (['l', 'w', 'c'] as const).filter((item) => set.has(item))
      const rows: { label: string; counts: Counts }[] = []
      if (!rest.length) rows.push({ label: '', counts: countText(stdin) })
      for (const file of rest) {
        const node = ctx.rt.fs.read(ctx.user, resolvePath(ctx, file))
        if (node.encoding !== 'utf8') throw new FsError('EINVAL', `${file}: binary file`)
        rows.push({ label: file, counts: countText(node.content) })
      }
      if (rest.length > 1) {
        rows.push({
          label: 'total',
          counts: rows.reduce(
            (sum, row) => ({
              lines: sum.lines + row.counts.lines,
              words: sum.words + row.counts.words,
              bytes: sum.bytes + row.counts.bytes,
            }),
            { lines: 0, words: 0, bytes: 0 },
          ),
        })
      }
      const stdout = rows
        .map((row) => `${fields.map((field) => String(row.counts[field === 'l' ? 'lines' : field === 'w' ? 'words' : 'bytes']).padStart(7, ' ')).join(' ')}${row.label ? ` ${row.label}` : ''}`)
        .join('\n')
      return { code: 0, stdout: `${stdout}\n` }
    },
  },
  {
    name: 'grep',
    group: 'text',
    summary: 'search text',
    usage: 'grep [-nirF] pattern [file...]',
    manual: 'The pattern is a regular expression. -F is a fixed string, -i ignores case, -n numbers lines, -r walks directories. Quote globs. With no file, read stdin.',
    readsStdin(args) {
      try {
        return grepArgs(args).files.length === 0
      } catch {
        return false
      }
    },
    run(ctx, args, stdin) {
      const parsed = grepArgs(args)
      if (parsed.pattern.length > 200) throw new FsError('EINVAL', 'pattern too long')
      const matcher = compile(parsed.pattern, parsed.fixed, parsed.insensitive)
      const hits: string[] = []
      const files = parsed.files.length ? collect(ctx, parsed.files, parsed.recursive) : [{ name: '', text: stdin }]
      const showName = files.length > 1 || parsed.recursive
      for (const file of files) {
        splitLines(file.text).forEach((line, index) => {
          if (hits.length >= 500 || !matcher(line)) return
          const prefix = `${showName && file.name ? `${file.name}:` : ''}${parsed.number ? `${index + 1}:` : ''}`
          hits.push(prefix + line)
        })
      }
      const suffix = hits.length >= 500 ? '\n...(truncated)\n' : hits.length ? '\n' : ''
      return { code: hits.length ? 0 : 1, stdout: `${hits.join('\n')}${suffix}` }
    },
  },
  {
    name: 'sort',
    group: 'text',
    summary: 'sort lines',
    usage: 'sort [-nr] [file]',
    manual: '-n sorts numerically. -r reverses.',
    readsStdin: (args) => flags(args, 'nr').rest.length === 0,
    run(ctx, args, stdin) {
      const { set, rest } = flags(args, 'nr')
      if (rest.length > 1) throw new FsError('EINVAL', 'too many files')
      const text = rest.length ? readText(ctx, rest[0] ?? '') : stdin
      const lines = splitLines(text)
      lines.sort((a, b) => {
        if (set.has('n')) return Number(a) - Number(b) || a.localeCompare(b)
        return a.localeCompare(b)
      })
      if (set.has('r')) lines.reverse()
      return { code: 0, stdout: lines.length ? `${lines.join('\n')}\n` : '' }
    },
  },
  {
    name: 'uniq',
    group: 'text',
    summary: 'omit adjacent duplicate lines',
    usage: 'uniq [-c] [file]',
    manual: 'Only adjacent duplicates are merged. Sort first.',
    readsStdin: (args) => flags(args, 'c').rest.length === 0,
    run(ctx, args, stdin) {
      const { set, rest } = flags(args, 'c')
      if (rest.length > 1) throw new FsError('EINVAL', 'too many files')
      const lines = splitLines(rest.length ? readText(ctx, rest[0] ?? '') : stdin)
      const out: string[] = []
      let previous = ''
      let count = 0
      const flush = () => {
        if (!count) return
        out.push(set.has('c') ? `${String(count).padStart(7, ' ')} ${previous}` : previous)
      }
      for (const line of lines) {
        if (line === previous && count) count += 1
        else {
          flush()
          previous = line
          count = 1
        }
      }
      flush()
      return { code: 0, stdout: out.length ? `${out.join('\n')}\n` : '' }
    },
  },
  {
    name: 'cut',
    group: 'text',
    summary: 'cut fields or characters',
    usage: 'cut (-f list -d delim | -c list) [file]',
    manual: 'For example cut -d, -f1,3 or cut -c1-4.',
    readsStdin(args) {
      try {
        return cutArgs(args).file === null
      } catch {
        return false
      }
    },
    run(ctx, args, stdin) {
      const parsed = cutArgs(args)
      const text = parsed.file === null ? stdin : readText(ctx, parsed.file)
      const lines = splitLines(text).map((line) => (parsed.chars ? cutChars(line, parsed.list) : cutFields(line, parsed.delim, parsed.list)))
      return { code: 0, stdout: lines.length ? `${lines.join('\n')}\n` : '' }
    },
  },
  {
    name: 'tr',
    group: 'text',
    summary: 'translate characters',
    usage: 'tr set1 set2',
    manual: 'Read stdin. Ranges such as a-z are supported.',
    readsStdin: () => true,
    run(_ctx, args, stdin) {
      if (args.length !== 2) throw new FsError('EINVAL', 'usage: tr set1 set2')
      const from = expandSet(args[0] ?? '')
      const to = expandSet(args[1] ?? '')
      if (!from.length || !to.length) throw new FsError('EINVAL', 'empty set')
      const map = new Map<string, string>()
      from.forEach((ch, index) => map.set(ch, to[Math.min(index, to.length - 1)] ?? ch))
      let out = ''
      for (const ch of stdin) out += map.get(ch) ?? ch
      return { code: 0, stdout: out }
    },
  },
]

interface Counts {
  lines: number
  words: number
  bytes: number
}

function sliceFiles(ctx: ShellCtx, args: string[], stdin: string, which: 'head' | 'tail'): CommandResult {
  const { count, files } = countArgs(args)
  const texts = files.length ? files.map((file) => ({ file, text: readText(ctx, file) })) : [{ file: '', text: stdin }]
  const chunks = texts.map(({ file, text }) => {
    const lines = splitLines(text)
    const chosen = which === 'head' ? lines.slice(0, count) : lines.slice(Math.max(0, lines.length - count))
    const body = chosen.length ? `${chosen.join('\n')}\n` : ''
    if (texts.length < 2) return body
    return `==> ${file} <==\n${body}`
  })
  return { code: 0, stdout: chunks.join(texts.length > 1 ? '\n' : '') }
}

function countArgs(args: string[]): { count: number; files: string[] } {
  let count = 10
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-n') count = positive(args[++i])
    else if (/^-n\d+$/.test(arg)) count = positive(arg.slice(2))
    else if (/^-\d+$/.test(arg)) count = positive(arg.slice(1))
    else if (arg.startsWith('-')) throw new FsError('EINVAL', `invalid option -- ${arg}`)
    else files.push(arg)
  }
  return { count, files }
}

function positive(value: string | undefined): number {
  const number = Number(value)
  if (!value || !Number.isInteger(number) || number < 0) throw new FsError('EINVAL', 'invalid line count')
  return number
}

function readText(ctx: ShellCtx, file: string): string {
  const node = ctx.rt.fs.read(ctx.user, resolvePath(ctx, file))
  if (node.encoding !== 'utf8') throw new FsError('EINVAL', `${file}: binary file`)
  return node.content
}

function countText(text: string): Counts {
  const encoder = new TextEncoder()
  return {
    lines: text.match(/\n/g)?.length ?? 0,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    bytes: encoder.encode(text).length,
  }
}

function grepArgs(args: string[]) {
  let fixed = false
  let number = false
  let insensitive = false
  let recursive = false
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--') {
      rest.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('-') && arg !== '-') {
      if (/[^FinrR]/.test(arg.slice(1))) throw new FsError('EINVAL', `invalid option -- ${arg}`)
      if (arg.includes('F')) fixed = true
      if (arg.includes('n')) number = true
      if (arg.includes('i')) insensitive = true
      if (arg.includes('r') || arg.includes('R')) recursive = true
      continue
    }
    rest.push(arg)
  }
  if (!rest.length) throw new FsError('EINVAL', 'missing pattern')
  return { fixed, number, insensitive, recursive, pattern: rest[0] ?? '', files: rest.slice(1) }
}

function compile(pattern: string, fixed: boolean, insensitive: boolean): (line: string) => boolean {
  if (fixed) {
    const needle = insensitive ? pattern.toLowerCase() : pattern
    return (line) => (insensitive ? line.toLowerCase() : line).includes(needle)
  }
  const re = new RegExp(pattern, insensitive ? 'i' : '')
  return (line) => re.test(line)
}

function collect(ctx: ShellCtx, files: string[], recursive: boolean): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  const visit = (file: string) => {
    const path = resolvePath(ctx, file)
    let stat
    try {
      stat = ctx.rt.fs.stat(ctx.user, path)
    } catch (err) {
      if (err instanceof FsError && (err.code === 'EACCES' || err.code === 'ENOENT')) return
      throw err
    }
    if (stat.type === 'dir') {
      if (!recursive) throw new FsError('EISDIR', `${file}: Is a directory`)
      let names: string[]
      try {
        names = ctx.rt.fs.readdir(ctx.user, path)
      } catch (err) {
        if (err instanceof FsError && err.code === 'EACCES') return
        throw err
      }
      for (const name of names) visit(join(file, name))
      return
    }
    let node
    try {
      node = ctx.rt.fs.read(ctx.user, path)
    } catch (err) {
      if (err instanceof FsError && err.code === 'EACCES') return
      throw err
    }
    if (node.encoding !== 'utf8') return
    out.push({ name: file, text: node.content })
  }
  for (const file of files) visit(file)
  return out
}

function join(dir: string, name: string): string {
  if (dir === '.' || dir === './') return name
  return `${dir.replace(/\/$/, '')}/${name}`
}

function cutArgs(args: string[]): { chars: boolean; delim: string; list: string; file: string | null } {
  let chars = false
  let delim = '\t'
  let list = ''
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-d') delim = args[++i] ?? ''
    else if (arg.startsWith('-d') && arg.length > 2) delim = arg.slice(2)
    else if (arg === '-f') list = args[++i] ?? ''
    else if (arg.startsWith('-f') && arg.length > 2) list = arg.slice(2)
    else if (arg === '-c') {
      chars = true
      list = args[++i] ?? ''
    } else if (arg.startsWith('-c') && arg.length > 2) {
      chars = true
      list = arg.slice(2)
    } else if (arg.startsWith('-')) throw new FsError('EINVAL', `invalid option -- ${arg}`)
    else rest.push(arg)
  }
  if (!list) throw new FsError('EINVAL', 'missing list')
  if (delim.length !== 1) throw new FsError('EINVAL', 'delimiter must be one character')
  if (rest.length > 1) throw new FsError('EINVAL', 'too many files')
  return { chars, delim, list, file: rest[0] ?? null }
}

function cutFields(line: string, delim: string, list: string): string {
  const fields = line.split(delim)
  return ranges(list)
    .map((index) => fields[index - 1] ?? '')
    .filter((_value, index, all) => all[index] !== '' || fields.length >= index)
    .join(delim)
}

function cutChars(line: string, list: string): string {
  const chars = [...line]
  return ranges(list)
    .map((index) => chars[index - 1] ?? '')
    .join('')
}

function ranges(list: string): number[] {
  const out: number[] = []
  for (const part of list.split(',')) {
    if (!part) continue
    if (/^\d+$/.test(part)) out.push(Number(part))
    else if (/^(\d+)-(\d+)$/.test(part)) {
      const match = /^(\d+)-(\d+)$/.exec(part)
      const start = Number(match?.[1])
      const end = Number(match?.[2])
      for (let i = start; i <= end && out.length < 1000; i++) out.push(i)
    } else if (/^(\d+)-$/.test(part)) {
      const start = Number(/^(\d+)-$/.exec(part)?.[1])
      for (let i = start; i < start + 200 && out.length < 1000; i++) out.push(i)
    } else throw new FsError('EINVAL', `invalid list ${part}`)
  }
  return out.filter((index) => index > 0)
}

function expandSet(source: string): string[] {
  const chars = [...source]
  const out: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    if (chars[i + 1] === '-' && chars[i + 2]) {
      const start = ch.codePointAt(0) ?? 0
      const end = chars[i + 2]?.codePointAt(0) ?? start
      const step = start <= end ? 1 : -1
      for (let code = start; code !== end + step; code += step) out.push(String.fromCodePoint(code))
      i += 2
    } else out.push(ch)
  }
  return out
}

function interpret(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      out += text[i]
      continue
    }
    const next = text[++i]
    if (next === 'n') out += '\n'
    else if (next === 't') out += '\t'
    else if (next === 'r') out += '\r'
    else if (next === 'e') out += '\x1b'
    else if (next === '\\') out += '\\'
    else if (next === '0' && text[i + 1] === '3' && text[i + 2] === '3') {
      out += '\x1b'
      i += 2
    } else if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out += String.fromCharCode(Number.parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else out += next ?? ''
  }
  return out
}

function formatText(format: string, args: string[]): string {
  let index = 0
  let out = ''
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '%' && format[i + 1] === '%') {
      out += '%'
      i += 1
      continue
    }
    if (format[i] === '%' && (format[i + 1] === 's' || format[i + 1] === 'd')) {
      const value = args[index++] ?? ''
      out += format[i + 1] === 'd' ? String(Number(value)) : value
      i += 1
      continue
    }
    out += format[i]
  }
  return out
}
