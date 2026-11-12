export interface User {
  name: string
  role: 'root' | 'guest'
}

export interface FileNode {
  type: 'file'
  content: string
  encoding: 'utf8' | 'binary'
  /** URL in the build output. Binary files download from here and stay out of memory. */
  url?: string
  size: number
  mtime: number
  mode: number
  uid: string
  gid: string
}

export interface DirNode {
  type: 'dir'
  mtime: number
  mode: number
  uid: string
  gid: string
}

/** Hides the same path in a lower layer. */
export interface Tombstone {
  type: 'tomb'
}

export type Node = FileNode | DirNode
export type Entry = Node | Tombstone

export interface RemoteChange {
  /** Absolute virtual filesystem path. */
  path: string
  /** null deletes the path from the repository. */
  content: string | null
  encoding: 'utf-8' | 'base64'
}

/** Overlay state before one write. null means the key was absent. */
export interface MutationStep {
  path: string
  beforeLocal: Entry | null
  beforeRemote: Entry | null
  inverseRemote: RemoteChange | null
}

export interface Stat {
  path: string
  type: 'file' | 'dir'
  size: number
  mtime: number
  mode: number
  uid: string
  gid: string
  encoding?: 'utf8' | 'binary'
}

export const MAX_FILE_BYTES = 256 * 1024
/** Uploaded binary files are kept in this browser and downloaded with wget. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
