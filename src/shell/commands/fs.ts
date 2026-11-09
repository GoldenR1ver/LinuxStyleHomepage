import { basename, isInside } from '../../kernel/path'
import { displayWidth, padEndDisplay } from '../../kernel/width'
import { FsError } from '../../kernel/vfs'
import type { ShellCtx } from '../context'
import { matchGlob } from '../glob'
import type { CommandSpec } from './types'
import { errorMessage, flags, joinPath, resolvePath, splitLines, writeFile } from './helpers'

const RESET = '\x1b[0m'
const BLUE = '\x1b[34m'

export const fileCommands: CommandSpec[] = [
  {
    name: 'pwd',
    group: 'file',
    summary: 'print working directory',
    usage: 'pwd',
    manual: 'Print the current directory.',
    run: (ctx) => ({ code: 0, stdout: `${ctx.cwd}\n` }),
  },
  {
    name: 'cd',
    group: 'file',
    summary: 'change directory',
    usage: 'cd [dir|-]',
    manual: 'With no argument, enter $HOME. cd - returns to the previous directory.',
    run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const spec = args[0]
      const next = !spec ? ctx.env.HOME || '/' : spec === '-' ? ctx.env.OLDPWD || ctx.cwd : resolvePath(ctx, spec)
      const stat = ctx.rt.fs.stat(ctx.user, next)
      if (stat.type !== 'dir') throw new FsError('ENOTDIR', `${spec || next}: Not a directory`)
      ctx.env.OLDPWD = ctx.cwd
      ctx.cwd = stat.path
      ctx.env.PWD = stat.path
      return { code: 0 }
    },
  },
  {
    name: 'ls',
    group: 'file',
    summary: 'list directory',
    usage: 'ls [-la] [path...]',
    manual: 'List files. -l is long format, -a shows dotfiles. .gitkeep stays hidden.',
    run(ctx, args) {
      const { set, rest } = flags(args, 'la')
      const targets = rest.length ? rest : ['.']
      const blocks: string[] = []
      for (const target of targets) {
        const path = resolvePath(ctx, target)
        const stat = ctx.rt.fs.stat(ctx.user, path)
        if (stat.type === 'file') {
          blocks.push(set.has('l') ? longEntry(ctx, path, basename(path)) : basename(path))
          continue
        }
        const names = ctx.rt.fs
          .readdir(ctx.user, path)
          .filter((name) => set.has('a') || !name.startsWith('.'))
        if (targets.length > 1) blocks.push(`${target}:`)
        if (set.has('l')) blocks.push(names.map((name) => longEntry(ctx, joinPath(path, name), name)).join('\n'))
        else blocks.push(columnize(names.map((name) => paint(ctx, joinPath(path, name), name)), ctx.columns))
      }
      const text = blocks.filter((block) => block !== '').join('\n')
      return { code: 0, stdout: text ? `${text}\n` : '' }
    },
  },
  {
    name: 'tree',
    group: 'file',
    summary: 'list as a tree',
    usage: 'tree [-a] [-L n] [path]',
    manual: 'Default depth is 3.',
    run(ctx, args) {
      let depth = 3
      let all = false
      const rest: string[] = []
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? ''
        if (arg === '-a') all = true
        else if (arg === '-L') depth = numberArg(args[++i], 'depth')
        else if (arg.startsWith('-L')) depth = numberArg(arg.slice(2), 'depth')
        else if (arg.startsWith('-')) throw new FsError('EINVAL', `invalid option -- ${arg}`)
        else rest.push(arg)
      }
      if (rest.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const root = rest[0] || '.'
      const lines: string[] = [root]
      drawTree(ctx, root, '', depth, all, lines)
      const limited = lines.slice(0, 400)
      const suffix = lines.length > 400 ? '\n...(truncated)\n' : '\n'
      return { code: 0, stdout: `${limited.join('\n')}${suffix}` }
    },
  },
  {
    name: 'find',
    group: 'file',
    summary: 'find by name',
    usage: 'find [path] [-name pattern] [-type f|d]',
    manual: 'The pattern matches the file name only. Quote globs, for example -name \'*.md\'.',
    run(ctx, args) {
      let start = '.'
      const expr = [...args]
      if (expr[0] && !expr[0].startsWith('-')) start = expr.shift() || '.'
      let name: string | null = null
      let type: 'f' | 'd' | null = null
      for (let i = 0; i < expr.length; i++) {
        const token = expr[i]
        if (token === '-name') name = expr[++i] ?? ''
        else if (token === '-type') {
          const value = expr[++i]
          if (value !== 'f' && value !== 'd') throw new FsError('EINVAL', 'invalid type')
          type = value
        } else throw new FsError('EINVAL', `unknown predicate ${token ?? ''}`)
      }
      const found: string[] = []
      walk(ctx, start, (item) => {
        if (found.length >= 1000) return
        const base = item === '.' ? '.' : item.slice(item.lastIndexOf('/') + 1)
        if (name && !matchGlob(name, base === '.' ? item : base)) return
        const stat = ctx.rt.fs.stat(ctx.user, resolvePath(ctx, item))
        if (type === 'f' && stat.type !== 'file') return
        if (type === 'd' && stat.type !== 'dir') return
        found.push(item)
      })
      const suffix = found.length >= 1000 ? '\n...(truncated)\n' : found.length ? '\n' : ''
      return { code: 0, stdout: `${found.join('\n')}${suffix}` }
    },
  },
  {
    name: 'stat',
    group: 'file',
    summary: 'file status',
    usage: 'stat path...',
    manual: 'The mode bits are display only. Write rules live in src/kernel/policy.ts.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      const blocks = args.map((arg) => {
        const stat = ctx.rt.fs.stat(ctx.user, resolvePath(ctx, arg))
        return [
          `  File: ${stat.path}`,
          `  Size: ${stat.size}`,
          `  Type: ${stat.type === 'dir' ? 'directory' : stat.encoding === 'binary' ? 'binary' : 'regular file'}`,
          `  Mode: ${stat.mode.toString(8).padStart(4, '0')}`,
          `   Uid: ${stat.uid}`,
          `Modify: ${formatTime(stat.mtime)}`,
        ].join('\n')
      })
      return { code: 0, stdout: `${blocks.join('\n\n')}\n` }
    },
  },
  {
    name: 'cat',
    group: 'file',
    summary: 'print files',
    usage: 'cat [-n] [file...]',
    manual: 'With no files, read stdin. Binary files should be downloaded with wget.',
    readsStdin: (args) => flags(args, 'n').rest.length === 0,
    run(ctx, args, stdin) {
      const { set, rest } = flags(args, 'n')
      if (!rest.length) return { code: 0, stdout: stdin }
      let stdout = ''
      let stderr = ''
      let code = 0
      for (const file of rest) {
        try {
          const node = ctx.rt.fs.read(ctx.user, resolvePath(ctx, file))
          if (node.encoding !== 'utf8') {
            stderr += `cat: ${file}: binary file, use wget\n`
            code = 1
            continue
          }
          stdout += set.has('n') ? numbered(node.content) : node.content
        } catch (err) {
          stderr += `cat: ${file}: ${errorMessage(err)}\n`
          code = 1
        }
      }
      return { code, stdout, stderr }
    },
  },
  {
    name: 'touch',
    group: 'file',
    summary: 'create or touch a file',
    usage: 'touch file...',
    manual: 'Create an empty file, or update the time if it exists.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      for (const file of args) ctx.rt.fs.touch(ctx.user, resolvePath(ctx, file))
      return { code: 0 }
    },
  },
  {
    name: 'mkdir',
    group: 'file',
    summary: 'make directories',
    usage: 'mkdir [-p] dir...',
    manual: '-p creates missing parents and succeeds if the directory exists.',
    run(ctx, args) {
      const { set, rest } = flags(args, 'p')
      if (!rest.length) throw new FsError('EINVAL', 'missing operand')
      for (const dir of rest) ctx.rt.fs.mkdir(ctx.user, resolvePath(ctx, dir), { parents: set.has('p') })
      return { code: 0 }
    },
  },
  {
    name: 'rmdir',
    group: 'file',
    summary: 'remove empty directories',
    usage: 'rmdir dir...',
    manual: 'Fails when the directory is not empty.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      for (const dir of args) ctx.rt.fs.remove(ctx.user, resolvePath(ctx, dir), { dirOnly: true })
      return { code: 0 }
    },
  },
  {
    name: 'rm',
    group: 'file',
    summary: 'remove files',
    usage: 'rm [-rf] file...',
    manual: 'Guests can remove only files they created. -r is recursive. -f ignores missing files.',
    run(ctx, args) {
      const { set, rest } = flags(args, 'rf')
      if (!rest.length) {
        if (set.has('f')) return { code: 0 }
        throw new FsError('EINVAL', 'missing operand')
      }
      for (const file of rest) {
        ctx.rt.fs.remove(ctx.user, resolvePath(ctx, file), { recursive: set.has('r'), force: set.has('f') })
      }
      return { code: 0 }
    },
  },
  {
    name: 'cp',
    group: 'file',
    summary: 'copy files',
    usage: 'cp [-r] source... dest',
    manual: 'Copying a directory requires -r. Binary files can be copied only into /tmp.',
    run(ctx, args) {
      const { set, rest } = flags(args, 'rR')
      if (rest.length < 2) throw new FsError('EINVAL', 'missing operand')
      const destArg = rest[rest.length - 1] ?? ''
      const dest = resolvePath(ctx, destArg)
      const sources = rest.slice(0, -1)
      const destIsDir = existsDir(ctx, dest)
      if (sources.length > 1 && !destIsDir) throw new FsError('EINVAL', 'target is not a directory')
      for (const source of sources) {
        const from = resolvePath(ctx, source)
        const to = destIsDir ? joinPath(dest, basename(from)) : dest
        copyPath(ctx, from, to, set.has('r') || set.has('R'))
      }
      return { code: 0 }
    },
  },
  {
    name: 'mv',
    group: 'file',
    summary: 'move or rename',
    usage: 'mv source... dest',
    manual: 'If the destination is a directory, the source is moved into it.',
    run(ctx, args) {
      if (args.length < 2) throw new FsError('EINVAL', 'missing operand')
      const destArg = args[args.length - 1] ?? ''
      const dest = resolvePath(ctx, destArg)
      const sources = args.slice(0, -1)
      const destIsDir = existsDir(ctx, dest)
      if (sources.length > 1 && !destIsDir) throw new FsError('EINVAL', 'target is not a directory')
      for (const source of sources) {
        const from = resolvePath(ctx, source)
        const to = destIsDir ? joinPath(dest, basename(from)) : dest
        copyPath(ctx, from, to, true)
        ctx.rt.fs.remove(ctx.user, from, { recursive: true })
      }
      return { code: 0 }
    },
  },
  {
    name: 'tee',
    group: 'file',
    summary: 'copy stdin to a file and stdout',
    usage: 'tee [-a] file...',
    manual: 'Read stdin. -a appends.',
    readsStdin: () => true,
    run(ctx, args, stdin) {
      const { set, rest } = flags(args, 'a')
      for (const file of rest) writeFile(ctx.rt.fs, ctx.user, resolvePath(ctx, file), stdin, set.has('a'))
      return { code: 0, stdout: stdin }
    },
  },
]

function longEntry(ctx: ShellCtx, path: string, name: string): string {
  const stat = ctx.rt.fs.stat(ctx.user, path)
  const kind = stat.type === 'dir' ? 'd' : '-'
  const mode = kind + modeBits(stat.mode)
  const size = String(stat.size).padStart(6, ' ')
  return `${mode} 1 ${stat.uid} ${stat.uid} ${size} ${formatTime(stat.mtime)} ${paint(ctx, path, name)}`
}

function modeBits(mode: number): string {
  const bit = (value: number) => `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`
  return bit(mode >> 6) + bit(mode >> 3) + bit(mode)
}

function paint(ctx: ShellCtx, path: string, name: string): string {
  try {
    if (ctx.rt.fs.stat(ctx.user, path).type === 'dir') return `${BLUE}${name}${RESET}`
  } catch {
    return name
  }
  return name
}

function columnize(names: string[], width: number): string {
  if (!names.length) return ''
  const widest = Math.max(...names.map((name) => displayWidth(name)))
  const colWidth = widest + 2
  const cols = Math.max(1, Math.floor(width / colWidth))
  if (cols <= 1) return names.join('\n')
  const rows = Math.ceil(names.length / cols)
  const lines: string[] = []
  for (let row = 0; row < rows; row++) {
    let line = ''
    for (let col = 0; col < cols; col++) {
      const name = names[row + col * rows]
      if (name === undefined) continue
      line += col === cols - 1 ? name : padEndDisplay(name, colWidth)
    }
    lines.push(line.trimEnd())
  }
  return lines.join('\n')
}

function drawTree(ctx: ShellCtx, path: string, prefix: string, depth: number, all: boolean, lines: string[]) {
  if (depth < 1 || lines.length > 400) return
  const absolute = resolvePath(ctx, path)
  let names: string[] = []
  try {
    if (ctx.rt.fs.stat(ctx.user, absolute).type !== 'dir') return
    names = ctx.rt.fs.readdir(ctx.user, absolute).filter((name) => all || !name.startsWith('.'))
  } catch {
    return
  }
  names.forEach((name, index) => {
    if (lines.length > 400) return
    const last = index === names.length - 1
    lines.push(`${prefix}${last ? '└── ' : '├── '}${name}`)
    drawTree(ctx, joinPath(path, name), `${prefix}${last ? '    ' : '│   '}`, depth - 1, all, lines)
  })
}

function walk(ctx: ShellCtx, path: string, visit: (path: string) => void) {
  visit(path)
  let stat
  try {
    stat = ctx.rt.fs.stat(ctx.user, resolvePath(ctx, path))
  } catch {
    return
  }
  if (stat.type !== 'dir') return
  for (const name of ctx.rt.fs.readdir(ctx.user, stat.path)) walk(ctx, joinPath(path, name), visit)
}

function copyPath(ctx: ShellCtx, from: string, to: string, recursive: boolean) {
  if (from === to) return
  if (isInside(from, to)) throw new FsError('EINVAL', 'cannot copy a directory into itself')
  const stat = ctx.rt.fs.stat(ctx.user, from)
  if (stat.type === 'dir') {
    if (!recursive) throw new FsError('EISDIR', `${from}: Is a directory`)
    try {
      ctx.rt.fs.mkdir(ctx.user, to)
    } catch (err) {
      if (!(err instanceof FsError) || err.code !== 'EEXIST') throw err
      if (ctx.rt.fs.stat(ctx.user, to).type !== 'dir') throw err
    }
    for (const name of ctx.rt.fs.readdir(ctx.user, from)) copyPath(ctx, joinPath(from, name), joinPath(to, name), true)
    return
  }
  ctx.rt.fs.cloneFile(ctx.user, from, to)
}

function existsDir(ctx: ShellCtx, path: string): boolean {
  try {
    return ctx.rt.fs.stat(ctx.user, path).type === 'dir'
  } catch (err) {
    if (err instanceof FsError && err.code === 'ENOENT') return false
    throw err
  }
}

function numbered(text: string): string {
  const lines = splitLines(text)
  const body = lines.map((line, index) => `${String(index + 1).padStart(6)}\t${line}`).join('\n')
  if (!body) return text
  return text.endsWith('\n') || text === '' ? `${body}\n` : body
}

function numberArg(value: string | undefined, label: string): number {
  const number = Number(value)
  if (!value || !Number.isFinite(number) || number < 0) throw new FsError('EINVAL', `invalid ${label}`)
  return number
}

function formatTime(ms: number): string {
  if (!ms) return '------------'
  const date = new Date(ms)
  const p = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}
