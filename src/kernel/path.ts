/** POSIX paths only. This module does not touch the disk. */
export function normalize(input: string): string {
  if (input.includes('\0')) throw new Error('invalid path')
  const parts: string[] = []
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return '/' + parts.join('/')
}

export function resolve(cwd: string, input: string): string {
  if (!input) return normalize(cwd)
  if (input.startsWith('/')) return normalize(input)
  return normalize(`${cwd.replace(/\/$/, '')}/${input}`)
}

export function dirname(path: string): string {
  const n = normalize(path)
  if (n === '/') return '/'
  const i = n.lastIndexOf('/')
  return i <= 0 ? '/' : n.slice(0, i)
}

export function basename(path: string): string {
  const n = normalize(path)
  if (n === '/') return '/'
  return n.slice(n.lastIndexOf('/') + 1)
}

export function isInside(parent: string, child: string): boolean {
  const p = normalize(parent)
  const c = normalize(child)
  if (p === '/') return c !== '/'
  return c === p || c.startsWith(`${p}/`)
}

export function parentChain(path: string): string[] {
  const n = normalize(path)
  if (n === '/') return ['/']
  const out = ['/']
  const parts = n.slice(1).split('/')
  let cur = ''
  for (const part of parts) {
    cur += `/${part}`
    out.push(cur)
  }
  return out
}
