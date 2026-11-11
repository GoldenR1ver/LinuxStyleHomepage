import { installSystemDirs } from '../kernel/vfs'
import type { DirNode, FileNode, Node } from '../kernel/types'

interface ManifestFile {
  path: string
  size: number
  mtime: number
  encoding: 'utf8' | 'binary'
  text?: string
  url: string
}

interface Manifest {
  files: ManifestFile[]
}

/** Turn the built content/ tree into the in-memory root filesystem. */
export async function loadImage(): Promise<Map<string, Node>> {
  const base = import.meta.env.BASE_URL
  const response = await fetch(`${base}fs/manifest.json`)
  if (!response.ok) throw new Error(`cannot read the filesystem manifest (${response.status})`)
  const manifest = (await response.json()) as Manifest
  const image = new Map<string, Node>()
  image.set('/', dir())
  for (const file of manifest.files ?? []) {
    ensureParents(image, file.path)
    const node: FileNode = {
      type: 'file',
      content: file.text ?? '',
      encoding: file.encoding,
      url: `${base}${file.url}`,
      size: file.size,
      mtime: file.mtime,
      mode: 0o644,
      uid: 'root',
      gid: 'root',
    }
    image.set(file.path, node)
  }
  installSystemDirs(image)
  return image
}

function ensureParents(image: Map<string, Node>, path: string) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`
    if (!image.has(current)) image.set(current, dir())
  }
}

function dir(): DirNode {
  return { type: 'dir', mtime: 0, mode: 0o755, uid: 'root', gid: 'root' }
}
