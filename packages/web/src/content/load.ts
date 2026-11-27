import { applyAccounts } from '@home/core/kernel/accounts'
import { installSystemDirs } from '@home/core/kernel/vfs'
import type { DirNode, FileNode, Node } from '@home/core/kernel/types'

/**
 * One row of the built manifest. The build resolved the mode, owner and group
 * for every path, so this file does not re-derive ownership: it copies the
 * metadata into the in-memory inode, the way unpacking an archive does.
 */
interface ManifestEntry {
  path: string
  type: 'file' | 'dir'
  size: number
  mtime: number
  mode: number
  uid: string
  gid: string
  encoding: 'utf8' | 'binary'
  text?: string
  url: string
}

interface Manifest {
  files: ManifestEntry[]
}

/** Turn the built content/ tree into the in-memory root filesystem. */
export async function loadImage(): Promise<Map<string, Node>> {
  const base = import.meta.env.BASE_URL
  // A new build must not be served a manifest cached from the previous one:
  // the file name never changes, and Pages answers it with max-age=600.
  const stamp = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''
  const version = stamp ? `?v=${stamp}` : ''
  const response = await fetch(`${base}fs/manifest.json${version}`)
  if (!response.ok) throw new Error(`cannot read the filesystem manifest (${response.status})`)
  const manifest = (await response.json()) as Manifest
  const image = new Map<string, Node>()
  image.set('/', dir(0o755, 'root', 'root'))
  for (const file of manifest.files ?? []) {
    ensureParents(image, file.path)
    if (file.type === 'dir') {
      image.set(file.path, dir(file.mode, file.uid, file.gid))
      continue
    }
    const node: FileNode = {
      type: 'file',
      content: file.text ?? '',
      encoding: file.encoding,
      // The same id keeps a replaced picture from showing the cached original.
      url: `${base}${file.url}${version}`,
      size: file.size,
      mtime: file.mtime,
      mode: file.mode,
      uid: file.uid,
      gid: file.gid,
    }
    image.set(file.path, node)
  }
  // Directories the manifest does not list, if any. An existing path keeps the
  // metadata the build published.
  installSystemDirs(image)
  // Accounts whose home is not in the tree, the way pam_mkhomedir fills them in.
  applyAccounts(image)
  return image
}

function ensureParents(image: Map<string, Node>, path: string) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`
    if (!image.has(current)) image.set(current, dir(0o755, 'root', 'root'))
  }
}

function dir(mode: number, uid: string, gid: string): DirNode {
  return { type: 'dir', mtime: 0, mode, uid, gid }
}
