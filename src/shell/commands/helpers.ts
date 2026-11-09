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
