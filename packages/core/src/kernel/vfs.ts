import { applyAccounts } from './accounts'
import { hasCap } from './caps'
import { basename, dirname, normalize, parentChain } from './path'
import { buildMetadata } from './perm'
import { createdMode, modePermits, shippedMode } from './policy'
import type { Synthetic } from './proc'
import {
  MAX_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  type DirNode,
  type Entry,
  type FileNode,
  type Node,
  type Stat,
  type User,
} from './types'

const encoder = new TextEncoder()

function byteLength(text: string): number {
  return encoder.encode(text).length
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class FsError extends Error {
  constructor(
    readonly code:
      | 'ENOENT'
      | 'EACCES'
      | 'EEXIST'
      | 'ENOTDIR'
      | 'EISDIR'
      | 'ENOTEMPTY'
      | 'EINVAL'
      | 'EIO'
      | 'EROFS',
    message: string,
  ) {
    super(message)
    this.name = 'FsError'
  }
}

export interface OverlaySnap {
  local: Map<string, Entry>
}

/**
 * Three kinds of path:
 *   image      public files shipped with this build, read only
 *   local      the writable overlay that lives in this browser
 *   synthetic  files that do not exist until someone reads them (`/proc`)
 * A tombstone in `local` hides the same path in `image`. A synthetic tree is
 * checked first and refuses every write, the way procfs does.
 *
 * A fourth, optional layer sits on top of `local` for the session only: paths
 * marked ephemeral (a guest account made at login) never leave this page load.
 */
export class VirtualFS {
  private local = new Map<string, Entry>()
  private image: Map<string, Node>
  private synthetic: Synthetic | null = null
  /** The process umask for new files and directories. Default 022. */
  private umask = 0o022
  private ephemeral: string[] = []
  private stack: OverlaySnap[] = []
  private writes: string[] = []

  constructor(image: Map<string, Node>) {
    this.image = image
    if (!this.image.has('/')) this.image.set('/', emptyDir())
  }

  /**
   * Build an image from text files, the way a test or the CLI starts. The paths
   * in the map describe the tree; every implied parent becomes a directory.
   * Ownership and modes come from the same build-time rules the site uses, so a
   * scene in a test has the permissions the published site would have.
   */
  static fromFiles(files: Record<string, string>): VirtualFS {
    const shape = new Map<string, { kind: 'file' | 'dir'; content?: string }>()
    shape.set('/', { kind: 'dir' })
    for (const [raw, content] of Object.entries(files)) {
      const path = normalize(raw)
      ensureShapeParents(shape, path)
      shape.set(path, { kind: 'file', content })
    }
    const meta = buildMetadata(
      [...shape].map(([path, node]) => ({ path, kind: node.kind })),
      (path) => shape.get(path)?.content ?? null,
    )

    const image = new Map<string, Node>()
    for (const [path, node] of shape) {
      const found = meta.get(path) ?? { mode: node.kind === 'dir' ? 0o755 : 0o644, uid: 'root', gid: 'root' }
      image.set(
        path,
        node.kind === 'dir'
          ? { type: 'dir', mtime: 0, mode: found.mode, uid: found.uid, gid: found.gid }
          : textFile(node.content ?? '', found.uid, 0, found.mode, found.gid),
      )
    }
    // Directories a fixture does not spell out but the machine is expected to
    // have. An existing path keeps the metadata the build rules gave it.
    installSystemDirs(image)
    // An account whose home is not in the fixture still gets one at boot.
    applyAccounts(image)
    return new VirtualFS(image)
  }

  loadOverlay(local: [string, Entry][]) {
    this.local = new Map(local.filter((pair) => isEntry(pair[1])).map(([path, entry]) => [path, hydrate(entry)]))
  }

  /** Install the read-only filesystem that generates its own content. */
  setSynthetic(synthetic: Synthetic | null) {
    this.synthetic = synthetic
  }

  /** The umask used for newly created nodes. */
  mask(): number {
    return this.umask
  }

  setUmask(mask: number) {
    this.umask = mask & 0o777
  }

  /**
   * A path inside the synthetic tree, or under it, is read only. procfs answers
   * writes with EROFS and this does the same, so a stray redirect cannot shadow
   * `/proc` with an overlay file.
   */
  private refuseSynthetic(path: string) {
    const root = this.synthetic?.root
    if (!root) return
    if (path === root || path.startsWith(`${root}/`)) {
      throw new FsError('EROFS', 'Read-only file system')
    }
  }

  /** The writable layer, minus the session-only paths. This is what gets persisted. */
  exportLayer(): [string, Entry][] {
    return [...this.local.entries()]
      .filter(([path]) => !this.isEphemeral(path))
      .map(([path, entry]) => [path, clone(entry)])
  }

  /** A path and everything under it stays in this page load only. */
  markEphemeral(prefix: string) {
    const path = normalize(prefix)
    if (!this.ephemeral.includes(path)) this.ephemeral.push(path)
  }

  isEphemeral(path: string): boolean {
    const value = normalize(path)
    return this.ephemeral.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))
  }

  usage(): { files: number; bytes: number } {
    let files = 0
    let bytes = 0
    for (const [path, entry] of this.local) {
      if (this.isEphemeral(path)) continue
      if (entry.type === 'file') {
        files += 1
        bytes += entry.size
      }
    }
    return { files, bytes }
  }

  /**
   * Transactions nest. Each `begin` takes a snapshot and each `abort` restores it,
   * so a command that calls the shell again (sudo) cannot overflow a global lock.
   */
  begin() {
    this.stack.push(this.snapshot())
  }

  inTx(): boolean {
    return this.stack.length > 0
  }

  abort() {
    const snap = this.stack.pop()
    if (snap) this.restore(snap)
    if (!this.stack.length) this.writes = []
  }

  finish() {
    this.stack.pop()
    // `touched()` is read by seal before finish; the list belongs to one command.
    if (!this.stack.length) this.writes = []
  }

  touched(): string[] {
    return [...this.writes]
  }

  snapshot(): OverlaySnap {
    return { local: cloneMap(this.local) }
  }

  restore(snap: OverlaySnap) {
    this.local = cloneMap(snap.local)
  }

  stat(user: User, raw: string): Stat {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visibleFor(user, path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    return {
      path,
      type: node.type,
      size:
        node.type === 'file'
          ? node.size
          : modePermits(user, cred(node), 4)
            ? this.childNames(path, user).length
            : 0,
      mtime: node.mtime,
      mode: node.mode,
      uid: node.uid,
      gid: node.gid || node.uid,
      encoding: node.type === 'file' ? node.encoding : undefined,
    }
  }

  /** True when the node itself grants this bit. Ancestors are not checked. */
  allows(user: User, raw: string, bit: 1 | 2 | 4): boolean {
    const node = this.visibleFor(user, normalize(raw))
    if (!node) return false
    return modePermits(user, cred(node), bit)
  }

  read(user: User, raw: string): FileNode {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visibleFor(user, path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'file') throw new FsError('EISDIR', 'Is a directory')
    if (!this.mayRead(user, node)) throw new FsError('EACCES', 'Permission denied')
    return clone(node)
  }

  readdir(user: User, raw: string): string[] {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visibleFor(user, path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    if (!this.mayRead(user, node) || !this.maySearch(user, node)) {
      throw new FsError('EACCES', 'Permission denied')
    }
    return this.childNames(path, user).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  /**
   * CAP_DAC_READ_SEARCH is "read anything, change nothing": it bypasses the read
   * bit and the directory search bit, but never the write bit. A backup account
   * wants exactly this, which is why it exists as its own capability.
   */
  private mayRead(user: User, node: Node): boolean {
    return modePermits(user, cred(node), 4) || hasCap(user, 'CAP_DAC_READ_SEARCH')
  }

  private maySearch(user: User, node: Node): boolean {
    return modePermits(user, cred(node), 1) || hasCap(user, 'CAP_DAC_READ_SEARCH')
  }

  exists(user: User, raw: string): boolean {
    try {
      this.stat(user, raw)
      return true
    } catch (err) {
      if (err instanceof FsError && err.code === 'ENOENT') return false
      throw err
    }
  }

  write(user: User, raw: string, content: string) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    if (path === '/') throw new FsError('EISDIR', 'Is a directory')
    if (byteLength(content) > MAX_FILE_BYTES) throw new FsError('EINVAL', 'File too large')
    this.prepareFile(user, path)
    const existing = this.lookup(path)
    if (existing.node?.type === 'file' && existing.node.encoding === 'binary') {
      throw new FsError('EINVAL', 'cannot modify binary file')
    }
    const prior = existing.node?.type === 'file' ? existing.node : null
    // A write by anyone without CAP_FSETID clears setuid and setgid, the way the
    // kernel does: a modified binary must not keep its privilege.
    const inherited = prior
      ? hasCap(user, 'CAP_FSETID')
        ? prior.mode
        : prior.mode & ~0o6000
      : createdMode('file', this.umask)
    const node = textFile(
      content,
      prior?.uid ?? user.name,
      Date.now(),
      inherited,
      prior?.gid || prior?.uid || user.name,
    )
    this.local.set(path, node)
    this.writes.push(path)
  }

  /**
   * Store an uploaded binary in the browser layer.
   * A data URL keeps the bytes in the overlay, and wget downloads them again.
   */
  writeBinary(user: User, raw: string, url: string, size: number) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    if (path === '/') throw new FsError('EISDIR', 'Is a directory')
    if (!url.startsWith('data:')) throw new FsError('EINVAL', 'invalid binary data')
    if (size > MAX_UPLOAD_BYTES) throw new FsError('EINVAL', 'File too large')
    this.prepareFile(user, path)
    const existing = this.lookup(path)
    const prior = existing.node?.type === 'file' ? existing.node : null
    const node: FileNode = {
      type: 'file',
      content: '',
      encoding: 'binary',
      url,
      size,
      mtime: Date.now(),
      mode: prior?.mode ?? createdMode('file', this.umask),
      uid: prior?.uid ?? user.name,
      gid: prior?.gid || prior?.uid || user.name,
    }
    this.local.set(path, node)
    this.writes.push(path)
  }

  touch(user: User, raw: string) {
    const path = normalize(raw)
    this.refuseSynthetic(path)
    if (!this.visible(path)) {
      this.write(user, path, '')
      return
    }
    this.assertTx()
    const existing = this.lookup(path)
    if (existing.node?.type !== 'file') throw new FsError('EISDIR', 'Is a directory')
    this.prepareFile(user, path)
    if (existing.node.encoding !== 'utf8') throw new FsError('EINVAL', 'cannot modify binary file')
    const node = textFile(
      existing.node.content,
      existing.node.uid,
      Date.now(),
      existing.node.mode,
      existing.node.gid || existing.node.uid,
    )
    this.local.set(path, node)
  }

  cloneFile(user: User, fromRaw: string, toRaw: string) {
    const source = this.read(user, fromRaw)
    const path = normalize(toRaw)
    if (source.encoding === 'utf8') {
      this.write(user, path, source.content)
      return
    }
    this.assertTx()
    this.prepareFile(user, path)
    this.local.set(path, { ...clone(source), uid: user.name, gid: user.name, mtime: Date.now() })
    this.writes.push(path)
  }

  chmod(user: User, raw: string, mode: number) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    this.assertSearch(user, path)
    const found = this.lookup(path)
    if (!found.node) throw new FsError('ENOENT', 'No such file or directory')
    // The owner may change the mode; a process with CAP_FOWNER may change any.
    if (found.node.uid !== user.name && !hasCap(user, 'CAP_FOWNER')) {
      throw new FsError('EACCES', 'Permission denied')
    }
    const next = clone(found.node)
    next.mode = mode & 0o7777
    this.local.set(path, next)
  }

  chown(user: User, raw: string, owner: string, group: string | null) {
    this.assertTx()
    this.refuseSynthetic(normalize(raw))
    if (!hasCap(user, 'CAP_CHOWN')) throw new FsError('EACCES', 'Permission denied')
    const path = normalize(raw)
    this.assertSearch(user, path)
    const found = this.lookup(path)
    if (!found.node) throw new FsError('ENOENT', 'No such file or directory')
    const next = clone(found.node)
    if (owner) next.uid = owner
    if (group !== null) next.gid = group
    this.local.set(path, next)
  }

  mkdir(user: User, raw: string, opts?: { parents?: boolean }) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    if (path === '/') return
    if (opts?.parents) {
      let current = ''
      for (const part of path.split('/').filter(Boolean)) {
        current += `/${part}`
        const node = this.visible(current)
        if (node?.type === 'dir') continue
        if (node) throw new FsError('ENOTDIR', 'Not a directory')
        this.mkdirOne(user, current)
      }
      return
    }
    this.mkdirOne(user, path)
  }

  remove(user: User, raw: string, opts?: { recursive?: boolean; force?: boolean; dirOnly?: boolean }) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    if (path === '/') throw new FsError('EINVAL', 'refusing to remove /')
    let node: Node | null
    try {
      this.assertSearch(user, path)
      node = this.visibleFor(user, path)
    } catch (err) {
      if (opts?.force && err instanceof FsError && err.code === 'ENOENT') return
      throw err
    }
    if (!node) {
      if (opts?.force) return
      throw new FsError('ENOENT', 'No such file or directory')
    }
    if (node.type === 'dir') {
      if (opts?.dirOnly) {
        if (this.childNames(path, user).length) throw new FsError('ENOTEMPTY', 'Directory not empty')
      } else if (!opts?.recursive) {
        throw new FsError('EISDIR', 'Is a directory')
      }
      const paths = this.subtree(path, user).sort((a, b) => b.length - a.length)
      for (const child of paths) this.removeOne(user, child)
      return
    }
    if (opts?.dirOnly) throw new FsError('ENOTDIR', 'Not a directory')
    this.removeOne(user, path)
  }

  /**
   * Drop this browser's copy of a path so the shipped file shows through again.
   * This is the overlayfs "remove the whiteout" operation, and the only way back
   * from a local delete of a published file.
   */
  restorePath(user: User, raw: string) {
    this.assertTx()
    const path = normalize(raw)
    this.refuseSynthetic(path)
    this.assertSearch(user, path)
    if (!this.local.has(path)) throw new FsError('ENOENT', `${path}: nothing in this browser to restore`)
    this.assertUnlink(user, path)
    this.local.delete(path)
    this.writes.push(path)
  }

  private mkdirOne(user: User, path: string) {
    this.assertCreate(user, path)
    if (this.visible(path)) throw new FsError('EEXIST', 'File exists')
    const parent = this.visible(dirname(path))
    if (!parent) throw new FsError('ENOENT', 'No such file or directory')
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    const node: DirNode = {
      type: 'dir',
      mtime: Date.now(),
      mode: createdMode('dir', this.umask),
      uid: user.name,
      gid: user.gid ? user.groups[0] ?? user.name : user.name,
    }
    this.local.set(path, node)
  }

  private removeOne(user: User, path: string) {
    const existing = this.lookup(path)
    if (!existing.node) return
    this.assertUnlink(user, path)
    this.local.delete(path)
    if (existing.from === 'image') this.local.set(path, { type: 'tomb' })
  }

  private prepareFile(user: User, path: string) {
    this.assertWriteContent(user, path)
    const parent = this.visible(dirname(path))
    if (!parent) throw new FsError('ENOENT', 'No such file or directory')
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    const existing = this.visible(path)
    if (existing?.type === 'dir') throw new FsError('EISDIR', 'Is a directory')
  }

  private assertTx() {
    if (!this.stack.length) throw new FsError('EIO', 'no transaction')
  }

  private assertSearch(user: User, path: string) {
    // CAP_DAC_READ_SEARCH is exactly "read and search without the mode bits".
    if (hasCap(user, 'CAP_DAC_READ_SEARCH') || hasCap(user, 'CAP_DAC_OVERRIDE')) return
    for (const dir of parentChain(path)) {
      if (dir === path) break
      const node = this.visibleFor(user, dir)
      if (!node) throw new FsError('ENOENT', 'No such file or directory')
      if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
      if (!modePermits(user, cred(node), 1)) throw new FsError('EACCES', 'Permission denied')
    }
  }

  private assertCreate(user: User, path: string) {
    if (hasCap(user, 'CAP_DAC_OVERRIDE')) return
    this.assertSearch(user, path)
    const parent = this.visible(dirname(path))
    if (!parent || parent.type !== 'dir') return
    if (!modePermits(user, cred(parent), 2) || !modePermits(user, cred(parent), 1)) {
      throw new FsError('EACCES', 'Permission denied')
    }
  }

  private assertWriteContent(user: User, path: string) {
    if (hasCap(user, 'CAP_DAC_OVERRIDE')) return
    this.assertSearch(user, path)
    const existing = this.visible(path)
    if (!existing) {
      this.assertCreate(user, path)
      return
    }
    if (!modePermits(user, cred(existing), 2)) throw new FsError('EACCES', 'Permission denied')
  }

  private assertUnlink(user: User, path: string) {
    if (hasCap(user, 'CAP_DAC_OVERRIDE')) return
    this.assertSearch(user, path)
    const parent = this.visible(dirname(path))
    if (!parent || parent.type !== 'dir') return
    if (!modePermits(user, cred(parent), 2) || !modePermits(user, cred(parent), 1)) {
      throw new FsError('EACCES', 'Permission denied')
    }
    if ((parent.mode & 0o1000) === 0) return
    const node = this.visible(path)
    if (!node) return
    if (node.uid === user.name || parent.uid === user.name) return
    throw new FsError('EACCES', 'Permission denied')
  }

  private lookup(path: string): { node: Node | null; from: 'local' | 'image' | 'none' } {
    const local = this.local.get(path)
    if (local?.type === 'tomb') return { node: null, from: 'local' }
    if (local) return { node: local, from: 'local' }
    const image = this.image.get(path)
    if (image) return { node: image, from: 'image' }
    return { node: null, from: 'none' }
  }

  private visible(path: string): Node | null {
    return this.lookup(path).node
  }

  /** The node a reader sees, including the synthetic tree that owns no bytes. */
  private visibleFor(user: User, path: string): Node | null {
    const plain = this.visible(path)
    if (plain) return plain
    const synthetic = this.synthetic
    if (!synthetic) return null
    const content = synthetic.file(path, user)
    if (content !== null) {
      return {
        type: 'file',
        content,
        encoding: 'utf8',
        size: byteLength(content),
        mtime: Date.now(),
        mode: 0o444,
        uid: 'root',
        gid: 'root',
      }
    }
    if (synthetic.list(path, user) !== null) {
      return { type: 'dir', mtime: 0, mode: 0o555, uid: 'root', gid: 'root' }
    }
    return null
  }

  private childNames(dir: string, user: User): string[] {
    const names = new Set<string>()
    const consider = (path: string) => {
      if (dirname(path) !== dir) return
      const name = basename(path)
      if (name === '/') return
      if (names.has(name)) return
      if (!this.visibleFor(user, joinPath(dir, name))) return
      names.add(name)
    }
    for (const path of this.image.keys()) consider(path)
    for (const path of this.local.keys()) consider(path)
    for (const name of this.synthetic?.list(dir, user) ?? []) names.add(name)
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  private subtree(path: string, user: User): string[] {
    const prefix = path === '/' ? '/' : `${path}/`
    const found = new Set<string>()
    const add = (candidate: string) => {
      if (candidate === path || candidate.startsWith(prefix)) found.add(candidate)
    }
    for (const candidate of this.image.keys()) add(candidate)
    for (const candidate of this.local.keys()) add(candidate)
    return [...found].filter((candidate) => this.visibleFor(user, candidate))
  }
}

/**
 * Add the directories a bare image is expected to have. Modes come from
 * `shippedMode`; a path that already exists is left alone, because the build
 * metadata knows better than this fallback does.
 */
export function installSystemDirs(image: Map<string, Node>) {
  if (!image.has('/')) image.set('/', emptyDir())
  for (const dir of ['/tmp', '/root', '/var', '/var/guestbook', '/var/log', '/var/backups', '/srv', '/home', '/etc']) {
    if (!image.has(dir)) image.set(dir, emptyDir(shippedMode(dir, 'dir')))
  }
}

function emptyDir(mode = 0o755): DirNode {
  return { type: 'dir', mtime: 0, mode, uid: 'root', gid: 'root' }
}

function textFile(content: string, uid: string, mtime = Date.now(), mode = 0o644, gid = uid): FileNode {
  return {
    type: 'file',
    content,
    encoding: 'utf8',
    size: byteLength(content),
    mtime,
    mode,
    uid,
    gid,
  }
}

function cred(node: Node): { mode: number; uid: string; gid: string } {
  return { mode: node.mode, uid: node.uid, gid: node.gid || node.uid }
}

function hydrate(entry: Entry): Entry {
  if (entry.type === 'tomb') return entry
  return { ...entry, uid: entry.uid || 'root', gid: entry.gid || entry.uid || 'root' }
}

function ensureShapeParents(
  shape: Map<string, { kind: 'file' | 'dir'; content?: string }>,
  path: string,
) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`
    if (!shape.has(current)) shape.set(current, { kind: 'dir' })
  }
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function cloneMap(map: Map<string, Entry>): Map<string, Entry> {
  return new Map([...map.entries()].map(([path, entry]) => [path, clone(entry)]))
}

function isEntry(value: Entry): boolean {
  return value?.type === 'file' || value?.type === 'dir' || value?.type === 'tomb'
}
