import { applyMode, formatMode } from '../../kernel/policy'
import { basename, isInside } from '../../kernel/path'
import { displayWidth, padEndDisplay } from '../../kernel/width'
import { FsError } from '../../kernel/vfs'
import type { Stat } from '../../kernel/types'
import type { ShellCtx } from '../context'
import { matchGlob } from '../glob'
import type { CommandSpec } from './types'
import { errorMessage, flags, joinPath, resolvePath, splitLines, writeFile } from './helpers'

const RESET = '\x1b[0m'
const BLUE = '\x1b[34m'
const GREEN = '\x1b[32m'

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
      if (!ctx.rt.fs.allows(ctx.user, stat.path, 1)) throw new FsError('EACCES', 'Permission denied')
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
    usage: 'tree [-aACdDfFgilnNpqst] [-L n] [-P pat] [path]',
    manual: [
      'List directories as a tree. The default depth is 3. The default drawing is ASCII.',
      '-a  include names that start with a dot. .gitkeep stays hidden.',
      '-A  draw with ANSI line characters instead of ASCII.',
      '-C  color directories and executable files. -n turns color off. The later flag wins.',
      '-d  list directories only.',
      '-D  print the modification time.',
      '-f  print the path from the argument, not only the name.',
      '-F  append / to directories and * to executable files.',
      '-g  print the group name stored on the file.',
      '-i  print names without the tree branches.',
      '-L n  limit the depth. -L 1 lists one level below the start.',
      '-l  accepted. This filesystem has no symbolic links, so nothing is followed.',
      '-N  print control characters as they are. The default writes them as octal escapes.',
      '-p  print the permission bits.',
      '-P pat  only names matching pat. * ? and [] work. Quote the pattern.',
      '-q  print control characters as ?.',
      '-s  print the size in bytes.',
      '-t  sort by modification time, newest first.',
    ].join('\n'),
    run(ctx, args) {
      const { opts, path } = parseTree(args)
      const lines = renderTree(ctx, opts, path)
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
    manual:
      'Root ignores the mode bits. Anyone else needs the owner, group, or other bits, and search permission on each parent. A guest can still write only under /tmp/<name> and /var/guestbook/.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      const blocks = args.map((arg) => {
        const stat = ctx.rt.fs.stat(ctx.user, resolvePath(ctx, arg))
        return [
          `  File: ${stat.path}`,
          `  Size: ${stat.size}`,
          `  Type: ${stat.type === 'dir' ? 'directory' : stat.encoding === 'binary' ? 'binary' : 'regular file'}`,
          `  Mode: ${formatMode(stat.type, stat.mode)} (${(stat.mode & 0o7777).toString(8).padStart(4, '0')})`,
          `   Uid: ${stat.uid}`,
          `   Gid: ${stat.gid}`,
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
  {
    name: 'chmod',
    group: 'file',
    summary: 'change mode bits',
    usage: 'chmod mode path...',
    manual:
      'mode is octal, such as 644 or 0755, or symbolic, such as u+x or go-w. An omitted who means everyone. The owner and root may change the mode. Root is not limited by the bits when reading or writing. A guest can still write only under /tmp/<name> and /var/guestbook/.',
    run(ctx, args) {
      if (args.length < 2) throw new FsError('EINVAL', 'missing operand')
      const spec = args[0] ?? ''
      for (const file of args.slice(1)) {
        const path = resolvePath(ctx, file)
        const stat = ctx.rt.fs.stat(ctx.user, path)
        ctx.rt.fs.chmod(ctx.user, path, parseMode(stat.mode, spec))
      }
      return { code: 0 }
    },
  },
  {
    name: 'chown',
    group: 'file',
    summary: 'change owner and group',
    usage: 'chown user[:group] path...',
    manual: 'Root only. The group is a name, the same string ls -l and tree -g print. There is no separate group account.',
    run(ctx, args) {
      if (args.length < 2) throw new FsError('EINVAL', 'missing operand')
      const spec = args[0] ?? ''
      const owner = parseOwner(spec)
      for (const file of args.slice(1)) ctx.rt.fs.chown(ctx.user, resolvePath(ctx, file), owner.user, owner.group)
      return { code: 0 }
    },
  },
]

function longEntry(ctx: ShellCtx, path: string, name: string): string {
  const stat = ctx.rt.fs.stat(ctx.user, path)
  const mode = formatMode(stat.type, stat.mode)
  const size = String(stat.size).padStart(6, ' ')
  return `${mode} 1 ${stat.uid} ${stat.gid} ${size} ${formatTime(stat.mtime)} ${paint(ctx, path, name)}`
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

interface TreeOpts {
  all: boolean
  ansi: boolean
  color: boolean
  dirs: boolean
  times: boolean
  full: boolean
  classify: boolean
  group: boolean
  flat: boolean
  depth: number
  names: 'octal' | 'question' | 'raw'
  perms: boolean
  pattern: string | null
  size: boolean
  byTime: boolean
}

function treeDefaults(): TreeOpts {
  return {
    all: false,
    ansi: false,
    color: false,
    dirs: false,
    times: false,
    full: false,
    classify: false,
    group: false,
    flat: false,
    depth: 3,
    names: 'octal',
    perms: false,
    pattern: null,
    size: false,
    byTime: false,
  }
}

function parseTree(args: string[]): { opts: TreeOpts; path: string } {
  const opts = treeDefaults()
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--') {
      rest.push(...args.slice(i + 1))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      rest.push(arg)
      continue
    }
    const body = arg.slice(1)
    for (let c = 0; c < body.length; c++) {
      const ch = body[c] ?? ''
      if (ch === 'L' || ch === 'P') {
        const inline = body.slice(c + 1)
        const value = inline || args[++i]
        if (ch === 'L') opts.depth = numberArg(value, 'level')
        else {
          if (!value) throw new FsError('EINVAL', 'missing pattern')
          opts.pattern = value
        }
        break
      }
      if (ch === 'a') opts.all = true
      else if (ch === 'A') opts.ansi = true
      else if (ch === 'C') opts.color = true
      else if (ch === 'd') opts.dirs = true
      else if (ch === 'D') opts.times = true
      else if (ch === 'f') opts.full = true
      else if (ch === 'F') opts.classify = true
      else if (ch === 'g') opts.group = true
      else if (ch === 'i') opts.flat = true
      else if (ch === 'l') continue
      else if (ch === 'n') opts.color = false
      else if (ch === 'N') opts.names = 'raw'
      else if (ch === 'p') opts.perms = true
      else if (ch === 'q') opts.names = 'question'
      else if (ch === 's') opts.size = true
      else if (ch === 't') opts.byTime = true
      else throw new FsError('EINVAL', `invalid option -- ${ch}`)
    }
  }
  if (rest.length > 1) throw new FsError('EINVAL', 'too many arguments')
  return { opts, path: rest[0] || '.' }
}

function renderTree(ctx: ShellCtx, opts: TreeOpts, rootArg: string): string[] {
  const lines: string[] = []
  const abs = resolvePath(ctx, rootArg)
  const stat = ctx.rt.fs.stat(ctx.user, abs)
  lines.push(treeLabel(opts, stat, rootArg))
  if (stat.type === 'dir') fillTree(ctx, opts, abs, rootArg, '', opts.depth, lines)
  return lines
}

function fillTree(
  ctx: ShellCtx,
  opts: TreeOpts,
  abs: string,
  display: string,
  prefix: string,
  depth: number,
  lines: string[],
) {
  if (depth < 1 || lines.length > 400) return
  let names: string[]
  try {
    names = ctx.rt.fs.readdir(ctx.user, abs)
  } catch (err) {
    if (err instanceof FsError && err.code === 'EACCES') {
      lines.push(`${prefix}[Permission denied]`)
      return
    }
    throw err
  }
  names = names.filter((name) => opts.all || !name.startsWith('.'))
  names = names.filter((name) => keepTree(ctx, opts, abs, name, depth))
  names = orderTree(ctx, opts, abs, names)
  const graphics = opts.flat ? FLAT : opts.ansi ? ANSI : ASCII
  names.forEach((name, index) => {
    if (lines.length > 400) return
    const last = index === names.length - 1
    const childAbs = joinPath(abs, name)
    const childDisplay = opts.full ? joinPath(display, name) : name
    let stat: Stat
    try {
      stat = ctx.rt.fs.stat(ctx.user, childAbs)
    } catch {
      lines.push(`${prefix}${graphics.branch(last)}${renderControls(childDisplay, opts.names)}`)
      return
    }
    lines.push(`${prefix}${graphics.branch(last)}${treeLabel(opts, stat, childDisplay)}`)
    if (stat.type === 'dir') {
      fillTree(ctx, opts, childAbs, childDisplay, `${prefix}${graphics.pad(last)}`, depth - 1, lines)
    }
  })
}

function keepTree(ctx: ShellCtx, opts: TreeOpts, dir: string, name: string, depth: number): boolean {
  const abs = joinPath(dir, name)
  let stat: Stat
  try {
    stat = ctx.rt.fs.stat(ctx.user, abs)
  } catch {
    return true
  }
  if (opts.dirs && stat.type !== 'dir') return false
  if (!opts.pattern) return true
  if (matchGlob(opts.pattern, name)) return true
  if (stat.type !== 'dir') return false
  return containsMatch(ctx, opts, abs, depth - 1)
}

function containsMatch(ctx: ShellCtx, opts: TreeOpts, abs: string, depth: number): boolean {
  if (depth < 1 || !opts.pattern) return false
  let names: string[]
  try {
    names = ctx.rt.fs.readdir(ctx.user, abs)
  } catch {
    return false
  }
  for (const name of names) {
    if (!opts.all && name.startsWith('.')) continue
    if (matchGlob(opts.pattern, name)) return true
    if (depth <= 1) continue
    try {
      if (ctx.rt.fs.stat(ctx.user, joinPath(abs, name)).type !== 'dir') continue
    } catch {
      continue
    }
    if (containsMatch(ctx, opts, joinPath(abs, name), depth - 1)) return true
  }
  return false
}

function orderTree(ctx: ShellCtx, opts: TreeOpts, dir: string, names: string[]): string[] {
  if (!opts.byTime) return names
  const stamp = (name: string) => {
    try {
      return ctx.rt.fs.stat(ctx.user, joinPath(dir, name)).mtime
    } catch {
      return 0
    }
  }
  return [...names].sort((a, b) => stamp(b) - stamp(a) || a.localeCompare(b, 'zh-CN'))
}

function treeLabel(opts: TreeOpts, stat: Stat, display: string): string {
  const parts: string[] = []
  if (opts.perms) parts.push(`[${formatMode(stat.type, stat.mode)}]`)
  if (opts.size) parts.push(`[${stat.size}]`)
  if (opts.group) parts.push(`[${stat.gid}]`)
  if (opts.times) parts.push(`[${formatTime(stat.mtime)}]`)
  let name = renderControls(display, opts.names)
  if (opts.color) {
    const color = stat.type === 'dir' ? BLUE : executable(stat.mode) ? GREEN : ''
    if (color) name = `${color}${name}${RESET}`
  }
  if (opts.classify) name += stat.type === 'dir' ? '/' : executable(stat.mode) ? '*' : ''
  parts.push(name)
  return parts.join(' ')
}

function executable(mode: number): boolean {
  return (mode & 0o111) !== 0
}

function renderControls(text: string, style: TreeOpts['names']): string {
  if (style === 'raw') return text
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 32 && code !== 127) out += ch
    else if (style === 'question') out += '?'
    else out += `\\${code.toString(8).padStart(3, '0')}`
  }
  return out
}

const ASCII = {
  branch: (last: boolean) => (last ? '`-- ' : '|-- '),
  pad: (last: boolean) => (last ? '    ' : '|   '),
}
const ANSI = {
  branch: (last: boolean) => (last ? '└── ' : '├── '),
  pad: (last: boolean) => (last ? '    ' : '│   '),
}
const FLAT = {
  branch: (_last: boolean) => '',
  pad: (_last: boolean) => '',
}

function walk(ctx: ShellCtx, path: string, visit: (path: string) => void) {
  visit(path)
  let stat: Stat
  try {
    stat = ctx.rt.fs.stat(ctx.user, resolvePath(ctx, path))
  } catch (err) {
    if (err instanceof FsError && (err.code === 'EACCES' || err.code === 'ENOENT')) return
    throw err
  }
  if (stat.type !== 'dir') return
  let names: string[]
  try {
    names = ctx.rt.fs.readdir(ctx.user, stat.path)
  } catch (err) {
    if (err instanceof FsError && err.code === 'EACCES') return
    throw err
  }
  for (const name of names) walk(ctx, joinPath(path, name), visit)
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

function parseMode(current: number, spec: string): number {
  try {
    return applyMode(current, spec)
  } catch {
    throw new FsError('EINVAL', `invalid mode ${spec}`)
  }
}

function parseOwner(spec: string): { user: string; group: string | null } {
  const colon = spec.indexOf(':')
  const user = colon < 0 ? spec : spec.slice(0, colon)
  const group = colon < 0 ? null : spec.slice(colon + 1)
  const legal = /^[^\s/\\:\u0000]{1,32}$/
  if ((!user && group === null) || (user && !legal.test(user)) || (group !== null && !legal.test(group))) {
    throw new FsError('EINVAL', 'invalid owner')
  }
  return { user, group }
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
