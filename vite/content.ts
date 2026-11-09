import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const TEXT = new Set(['.md', '.txt', '.log', '.json', '.csv', '.html', '.yml', '.yaml'])
const INLINE_LIMIT = 500_000

/**
 * Treat content/ as the site's root filesystem.
 * Dev reads it from disk. The build emits dist/fs and manifest.json.
 */
export function contentPlugin(dir = 'content'): Plugin {
  const root = path.resolve(dir)
  return {
    name: 'content-fs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === '/fs/manifest.json') {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ files: scan(root).map(publicFile) }))
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
      this.emitFile({
        type: 'asset',
        fileName: 'fs/manifest.json',
        source: JSON.stringify({ files: files.map(publicFile) }),
      })
      for (const file of files) {
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
      if (stat.isDirectory()) {
        visit(abs)
        continue
      }
      if (!stat.isFile()) continue
      const rel = path.relative(root, abs).split(path.sep).join('/')
      const encoding = encodingOf(abs, stat.size)
      const text = encoding === 'utf8' ? fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : undefined
      out.push({
        abs,
        rel,
        path: `/${rel}`,
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

function publicFile(file: Scanned) {
  return {
    path: file.path,
    size: file.size,
    mtime: file.mtime,
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
