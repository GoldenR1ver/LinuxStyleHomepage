/**
 * One logged-in identity. This is the POSIX credential set, not a role:
 * the uid decides root (0) and the group names decide the group class.
 * `login(1)` builds it once from `/etc/passwd` and `/etc/group`.
 */
export interface User {
  name: string
  uid: number
  gid: number
  /** Primary group first, then every supplementary group, by name. */
  groups: string[]
  home: string
  shell: string
  /**
   * Capabilities beyond the ones every account holds (none). uid 0 holds all of
   * them and ignores this list. See `kernel/caps.ts`.
   */
  caps?: string[]
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
