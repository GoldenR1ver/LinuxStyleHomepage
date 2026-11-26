import type { User } from '../kernel/types'
import type { VirtualFS } from '../kernel/vfs'
import { normalize, resolve } from '../kernel/path'

export function hasMeta(text: string): boolean {
  return /[*?\[]/.test(text)
}

export function matchGlob(pattern: string, name: string): boolean {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '.'
    else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end < 0) source += '\\['
      else {
        source += `[${pattern.slice(i + 1, end)}]`
        i = end
      }
    } else source += ch.replace(/[\\^$+?.()|{}/]/g, '\\$&')
  }
  source += '$'
  try {
    return new RegExp(source).test(name)
  } catch {
    return false
  }
}

/** `*` does not cross `/` and skips dotfiles unless the pattern starts with a dot. No match returns the pattern unchanged. */
export function expandGlob(fs: VirtualFS, user: User, cwd: string, pattern: string): string[] {
  if (!hasMeta(pattern)) return [pattern]
  const absolute = pattern.startsWith('/')
  const parts = pattern.split('/')
  if (absolute) parts.shift()
  let dirs = [absolute ? '/' : normalize(cwd)]
  for (const part of parts) {
    if (!part || part === '.') continue
    const next: string[] = []
    for (const dir of dirs) {
      if (part === '..') {
        next.push(resolve(dir, '..'))
        continue
      }
      if (!hasMeta(part)) {
        next.push(join(dir, part))
        continue
      }
      let names: string[] = []
      try {
        names = fs.readdir(user, dir)
      } catch {
        names = []
      }
      for (const name of names) {
        if (!part.startsWith('.') && name.startsWith('.')) continue
        if (matchGlob(part, name)) next.push(join(dir, name))
      }
    }
    dirs = next
    if (!dirs.length) return [pattern]
  }
  const base = normalize(cwd)
  return dirs
    .map((dir) => {
      if (absolute) return dir
      if (dir === base) return '.'
      if (dir.startsWith(`${base}/`)) return dir.slice(base.length + 1)
      return dir
    })
    .sort()
}

function join(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}
