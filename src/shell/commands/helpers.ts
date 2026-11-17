import { FsError } from '../../kernel/vfs'
import { resolve } from '../../kernel/path'
import type { User } from '../../kernel/types'
import type { VirtualFS } from '../../kernel/vfs'
import type { ShellCtx } from '../context'

export function flags(args: string[], allowed: string): { set: Set<string>; rest: string[] } {
  const set = new Set<string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--') {
      rest.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('-') && arg !== '-' && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) {
        if (!allowed.includes(ch)) throw new FsError('EINVAL', `invalid option -- ${ch}`)
        set.add(ch)
      }
      continue
    }
    rest.push(arg)
  }
  return { set, rest }
}

export function resolvePath(ctx: ShellCtx, input: string): string {
  return resolve(ctx.cwd, input)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function writeFile(fs: VirtualFS, user: User, path: string, content: string, append: boolean) {
  let next = content
  if (append) {
    try {
      const node = fs.read(user, path)
      if (node.encoding !== 'utf8') throw new FsError('EINVAL', 'binary file')
      next = node.content + content
    } catch (err) {
      if (!(err instanceof FsError) || err.code !== 'ENOENT') throw annotate(path, err)
    }
  }
  try {
    fs.write(user, path, next)
  } catch (err) {
    throw annotate(path, err)
  }
}

function annotate(path: string, err: unknown): Error {
  if (err instanceof FsError) return new FsError(err.code, `${path}: ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

export function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/$/, '')}/${name}`
}

/**
 * Wrap text in an OSC 8 hyperlink. Nothing is drawn; the target rides along.
 * A `cmd:` target is typed at the prompt when the reader clicks it.
 */
export function link(text: string, command: string): string {
  return `\x1b]8;;cmd:${encodeURIComponent(command)}\x1b\\${text}\x1b]8;;\x1b\\`
}

/** Single-quote an argument, or return null when this shell cannot quote it safely. */
export function quoteArg(value: string): string | null {
  if (!value || /[\r\n\0]/.test(value)) return null
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  if (!value.includes("'")) return `'${value}'`
  if (!/["$\\`]/.test(value)) return `"${value}"`
  return null
}

/** The command a reader expects when a path is opened. */
export function openCommand(path: string, type: 'dir' | 'file', binary: boolean): string | null {
  const arg = quoteArg(path)
  if (!arg) return null
  if (type === 'dir') return `ls ${arg}`
  if (/\.md$/i.test(path) || /\.markdown$/i.test(path)) return `md ${arg}`
  if (/\.pdf$/i.test(path)) return `pdf ${arg}`
  if (binary) return `wget ${arg}`
  return `cat ${arg}`
}

/** Resolve what a click on this path should run. A missing path still yields an attempt. */
export function openPath(ctx: ShellCtx, path: string): string | null {
  try {
    const stat = ctx.rt.fs.stat(ctx.user, path)
    return openCommand(path, stat.type === 'dir' ? 'dir' : 'file', stat.encoding === 'binary')
  } catch {
    return openCommand(path, 'file', false)
  }
}

/** Wrap a name in a link when the target is a path a click can act on. A missing path stays plain text. */
export function linkPath(ctx: ShellCtx, path: string, text: string): string {
  const command = exists(ctx, path) ? openPath(ctx, path) : null
  return command ? link(text, command) : text
}

function exists(ctx: ShellCtx, path: string): boolean {
  try {
    ctx.rt.fs.stat(ctx.user, path)
    return true
  } catch {
    return false
  }
}

/**
 * Turn a link found in a rendered document into a command.
 * Returns null for anything a browser should open itself: off-site URLs and in-page anchors.
 */
export function hrefCommand(ctx: ShellCtx, base: string, href: string): string | null {
  if (!href || href.startsWith('#') || /^(?:https?|mailto|ftp):/i.test(href)) return null
  const cut = href.search(/[?#]/)
  let path = cut >= 0 ? href.slice(0, cut) : href
  if (!path) return null
  try {
    path = decodeURI(path)
  } catch {
    /* a broken percent escape is still a path */
  }
  return openPath(ctx, path.startsWith('/') ? path : resolve(base, path))
}


