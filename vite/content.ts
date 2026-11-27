import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { buildMetadata } from '../packages/core/src/kernel/perm'

const TEXT = new Set(['.md', '.txt', '.log', '.json', '.csv', '.html', '.yml', '.yaml', '.sh'])
const INLINE_LIMIT = 500_000

/**
 * Treat content/ as the site's root filesystem.
 * Dev reads it from disk. The build emits dist/fs and manifest.json.
 *
 * The manifest carries the mode, owner and group of every path, computed once
 * here from `/etc/passwd`, `/etc/group` and `/etc/perm`. A static build stores
 * bytes, not inode metadata; resolving it at build time is what makes the image
 * self-describing, the way a tar archive or a squashfs image is. The browser
 * then loads the tree without re-deriving ownership.
 */
export function contentPlugin(dir = 'content'): Plugin {
  const root = path.resolve(dir)
  const manifest = () => {
    const files = scan(root)
    const text = new Map<string, string>()
    for (const file of files) if (file.text !== undefined) text.set(file.path, file.text)
    const meta = buildMetadata(
      files.map((file) => ({ path: file.path, kind: file.kind })),
      (target) => text.get(target) ?? null,
    )
    return JSON.stringify({ files: files.map((file) => publicFile(file, meta)) })
  }

  return {
    name: 'content-fs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === '/fs/manifest.json') {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(manifest())
          return
        }
        if (!url.startsWith('/fs/')) return next()
        const rel = safeRel(url.slice('/fs/'.length))
        const abs = rel ? safeJoin(root, rel) : null
        if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return next()
        res.setHeader('content-type', contentType(abs))
        fs.createReadStream(abs).pipe(res)
      })
    },
    generateBundle() {
      const files = scan(root)
      this.emitFile({ type: 'asset', fileName: 'fs/manifest.json', source: manifest() })
      for (const file of files) {
        if (file.kind !== 'file') continue
        this.emitFile({
          type: 'asset',
          fileName: `fs/${file.rel}`,
          source: file.encoding === 'utf8' ? (file.text ?? '') : fs.readFileSync(file.abs),
        })
      }
    },
  }
}

interface Scanned {
  abs: string
  rel: string
  path: string
  kind: 'file' | 'dir'
  size: number
  mtime: number
  encoding: 'utf8' | 'binary'
  text?: string
  url: string
}

function scan(root: string): Scanned[] {
  if (!fs.existsSync(root)) return []
  const out: Scanned[] = []
  const visit = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.DS_Store') continue
      const abs = path.join(dir, name)
      const stat = fs.statSync(abs)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (stat.isDirectory()) {
        out.push({
          abs,
          rel,
          path: `/${rel}`,
          kind: 'dir',
          size: 0,
          mtime: stat.mtimeMs,
          encoding: 'utf8',
          url: '',
        })
        visit(abs)
        continue
      }
      if (!stat.isFile()) continue
      const encoding = encodingOf(abs, stat.size)
      const text = encoding === 'utf8' ? fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : undefined
      out.push({
        abs,
        rel,
        path: `/${rel}`,
        kind: 'file',
        size: stat.size,
        mtime: stat.mtimeMs,
        encoding,
        text,
        url: `fs/${rel}`,
      })
    }
  }
  visit(root)
  return out
}

function publicFile(file: Scanned, meta: ReturnType<typeof buildMetadata>) {
  const found = meta.get(file.path) ?? { mode: file.kind === 'dir' ? 0o755 : 0o644, uid: 'root', gid: 'root' }
  return {
    path: file.path,
    type: file.kind,
    size: file.size,
    mtime: file.mtime,
    mode: found.mode,
    uid: found.uid,
    gid: found.gid,
    encoding: file.encoding,
    text: file.text,
    url: file.url,
  }
}

function encodingOf(file: string, size: number): 'utf8' | 'binary' {
  const ext = path.extname(file).toLowerCase()
  if (['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.gz'].includes(ext)) return 'binary'
  if (ext && !TEXT.has(ext)) return 'binary'
  if (size > INLINE_LIMIT) return 'binary'
  return 'utf8'
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.md') return 'text/markdown; charset=utf-8'
  if (ext === '.txt' || ext === '') return 'text/plain; charset=utf-8'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.json') return 'application/json'
  return 'application/octet-stream'
}

function safeRel(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).replace(/^\/+/, '')
    if (!decoded || decoded.includes('\\') || decoded.includes('\0')) return null
    if (decoded.split('/').includes('..')) return null
    return decoded
  } catch {
    return null
  }
}

function safeJoin(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel)
  const relative = path.relative(root, abs)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return abs
}
