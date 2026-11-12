import { basename, dirname, normalize, parentChain } from './path'
import { canWrite, createdMode, modePermits, publishes, shippedMode } from './policy'
import {
  MAX_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  type DirNode,
  type Entry,
  type FileNode,
  type MutationStep,
  type Node,
  type RemoteChange,
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
    readonly code: 'ENOENT' | 'EACCES' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL' | 'EIO',
    message: string,
  ) {
    super(message)
    this.name = 'FsError'
  }
}

export interface OverlaySnap {
  local: Map<string, Entry>
  remote: Map<string, Entry>
}

/**
 * Three layers:
 * image   public files shipped with this build, read-only
 * remote  root commits that the build has not caught up with yet
 * local   overlay that lives only in this browser (scratch and guestbook)
 * A higher layer hides the ones below it. A tomb hides the lower layer.
 */
export class VirtualFS {
  private local = new Map<string, Entry>()
  private remote = new Map<string, Entry>()
  private depth = 0
  private backup: OverlaySnap | null = null
  private pending = new Map<string, RemoteChange>()
  private steps: MutationStep[] = []
  private writes: string[] = []

  constructor(private image: Map<string, Node>) {
    if (!this.image.has('/')) this.image.set('/', emptyDir())
  }

  static fromFiles(files: Record<string, string>): VirtualFS {
    const image = new Map<string, Node>()
    image.set('/', emptyDir())
    for (const [raw, content] of Object.entries(files)) {
      const path = normalize(raw)
      ensureParents(image, path)
      image.set(path, textFile(content, 'root', 0))
    }
    installSystemDirs(image)
    return new VirtualFS(image)
  }

  loadOverlay(remote: [string, Entry][], local: [string, Entry][]) {
    this.remote = new Map(remote.filter((pair) => isEntry(pair[1])).map(([path, entry]) => [path, hydrate(entry)]))
    this.local = new Map(local.filter((pair) => isEntry(pair[1])).map(([path, entry]) => [path, hydrate(entry)]))
  }

  exportLayer(layer: 'local' | 'remote'): [string, Entry][] {
    const map = layer === 'local' ? this.local : this.remote
    return [...map.entries()].map(([path, entry]) => [path, clone(entry)])
  }

  usage(): { files: number; bytes: number } {
    let files = 0
    let bytes = 0
    for (const entry of this.local.values()) {
      if (entry.type === 'file') {
        files += 1
        bytes += entry.size
      }
    }
    return { files, bytes }
  }

  begin() {
    if (this.depth) throw new FsError('EIO', 'nested transaction')
    this.depth = 1
    this.backup = this.snapshot()
    this.pending = new Map()
    this.steps = []
    this.writes = []
  }

  inTx(): boolean {
    return this.depth > 0
  }

  abort() {
    if (this.backup) this.restore(this.backup)
    this.clearTx()
  }

  pendingChanges(): RemoteChange[] {
    return [...this.pending.values()].map((change) => ({ ...change }))
  }

  touched(): string[] {
    return [...this.writes]
  }

  finish(): MutationStep[] {
    const steps = this.steps.map((step) => clone(step))
    this.clearTx()
    return steps
  }

  queueRemote(change: RemoteChange) {
    this.assertTx()
    this.pending.set(change.path, { ...change })
  }

  snapshot(): OverlaySnap {
    return { local: cloneMap(this.local), remote: cloneMap(this.remote) }
  }

  restore(snap: OverlaySnap) {
    this.local = cloneMap(snap.local)
    this.remote = cloneMap(snap.remote)
  }

  restoreStep(step: MutationStep) {
    assign(this.local, step.path, step.beforeLocal)
    assign(this.remote, step.path, step.beforeRemote)
  }

  stat(user: User, raw: string): Stat {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    return {
      path,
      type: node.type,
      size:
        node.type === 'file'
          ? node.size
          : modePermits(user, cred(node), 4)
            ? this.childNames(path).length
            : 0,
      mtime: node.mtime,
      mode: node.mode,
      uid: node.uid,
      gid: node.gid || node.uid,
      encoding: node.type === 'file' ? node.encoding : undefined,
    }
  }

  /** True when the node itself grants this bit. Ancestors are not checked. Root always grants. */
  allows(user: User, raw: string, bit: 1 | 2 | 4): boolean {
    if (user.role === 'root') return true
    const node = this.visible(normalize(raw))
    if (!node) return false
    return modePermits(user, cred(node), bit)
  }

  read(user: User, raw: string): FileNode {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'file') throw new FsError('EISDIR', 'Is a directory')
    if (!modePermits(user, cred(node), 4)) throw new FsError('EACCES', 'Permission denied')
    return clone(node)
  }

  readdir(user: User, raw: string): string[] {
    const path = normalize(raw)
    this.assertSearch(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    if (!modePermits(user, cred(node), 4) || !modePermits(user, cred(node), 1)) {
      throw new FsError('EACCES', 'Permission denied')
    }
    return this.childNames(path).sort((a, b) => a.localeCompare(b, 'zh-CN'))
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
    if (path === '/') throw new FsError('EISDIR', 'Is a directory')
    if (byteLength(content) > MAX_FILE_BYTES) throw new FsError('EINVAL', 'File too large')
    this.prepareFile(user, path)
    const existing = this.lookup(path)
    if (user.role !== 'root' && existing.node && existing.from !== 'local') {
      throw new FsError('EACCES', 'Permission denied')
    }
    if (existing.node?.type === 'file' && existing.node.encoding === 'binary') {
      throw new FsError('EINVAL', 'cannot modify binary file')
    }
    const layer = publishes(user, path) ? 'remote' : 'local'
    const previous = this.publishedText(path)
    const step = this.capture(path)
    const prior = existing.node?.type === 'file' ? existing.node : null
    const node = textFile(
      content,
      prior?.uid ?? user.name,
      Date.now(),
      prior?.mode ?? createdMode(path, 'file'),
      prior?.gid || prior?.uid || user.name,
    )
    if (layer === 'remote') {
      this.local.delete(path)
      this.remote.set(path, node)
      if (previous !== content) {
        this.pending.set(path, { path, content, encoding: 'utf-8' })
        step.inverseRemote =
          previous === null
            ? { path, content: null, encoding: 'utf-8' }
            : { path, content: previous, encoding: 'utf-8' }
      }
    } else {
      this.local.set(path, node)
    }
    this.steps.push(step)
    this.writes.push(path)
  }

  /**
   * Store an uploaded binary in the browser layer.
   * A data URL keeps the bytes in IndexedDB, and wget downloads them again.
   * The published layer stays text-only, so root cannot upload a binary.
   */
  writeBinary(user: User, raw: string, url: string, size: number) {
    this.assertTx()
    const path = normalize(raw)
    if (path === '/') throw new FsError('EISDIR', 'Is a directory')
    if (!url.startsWith('data:')) throw new FsError('EINVAL', 'invalid binary data')
    if (size > MAX_UPLOAD_BYTES) throw new FsError('EINVAL', 'File too large')
    if (publishes(user, path)) throw new FsError('EINVAL', 'cannot publish a binary file')
    this.prepareFile(user, path)
    const existing = this.lookup(path)
    if (user.role !== 'root' && existing.node && existing.from !== 'local') {
      throw new FsError('EACCES', 'Permission denied')
    }
    const step = this.capture(path)
    const prior = existing.node?.type === 'file' ? existing.node : null
    const node: FileNode = {
      type: 'file',
      content: '',
      encoding: 'binary',
      url,
      size,
      mtime: Date.now(),
      mode: prior?.mode ?? createdMode(path, 'file'),
      uid: prior?.uid ?? user.name,
      gid: prior?.gid || prior?.uid || user.name,
    }
    this.local.set(path, node)
    this.steps.push(step)
    this.writes.push(path)
  }

  touch(user: User, raw: string) {
    const path = normalize(raw)
    if (!this.visible(path)) {
      this.write(user, path, '')
      return
    }
    this.assertTx()
    const existing = this.lookup(path)
    if (existing.node?.type !== 'file') throw new FsError('EISDIR', 'Is a directory')
    this.prepareFile(user, path)
    if (user.role !== 'root' && existing.from !== 'local') throw new FsError('EACCES', 'Permission denied')
    if (existing.node.encoding !== 'utf8') throw new FsError('EINVAL', 'cannot modify binary file')
    const step = this.capture(path)
    const node = textFile(
      existing.node.content,
      existing.node.uid,
      Date.now(),
      existing.node.mode,
      existing.node.gid || existing.node.uid,
    )
    if (publishes(user, path)) {
      this.local.delete(path)
      this.remote.set(path, node)
    } else {
      this.local.set(path, node)
    }
    this.steps.push(step)
  }

  cloneFile(user: User, fromRaw: string, toRaw: string) {
    const source = this.read(user, fromRaw)
    const path = normalize(toRaw)
    if (source.encoding === 'utf8') {
      this.write(user, path, source.content)
      return
    }
    this.assertTx()
    if (publishes(user, path)) throw new FsError('EINVAL', 'cannot modify binary file')
    this.prepareFile(user, path)
    const existing = this.lookup(path)
    if (user.role !== 'root' && existing.node && existing.from !== 'local') {
      throw new FsError('EACCES', 'Permission denied')
    }
    const step = this.capture(path)
    this.local.set(path, { ...clone(source), uid: user.name, gid: user.name, mtime: Date.now() })
    this.steps.push(step)
  }

  chmod(user: User, raw: string, mode: number) {
    this.assertTx()
    const path = normalize(raw)
    this.assertSearch(user, path)
    const found = this.lookup(path)
    if (!found.node) throw new FsError('ENOENT', 'No such file or directory')
    if (user.role !== 'root' && found.node.uid !== user.name) throw new FsError('EACCES', 'Permission denied')
    const step = this.capture(path)
    const next = clone(found.node)
    next.mode = mode & 0o7777
    this.saveMeta(path, found.from, next)
    this.steps.push(step)
  }

  chown(user: User, raw: string, owner: string, group: string | null) {
    this.assertTx()
    if (user.role !== 'root') throw new FsError('EACCES', 'Permission denied')
    const path = normalize(raw)
    this.assertSearch(user, path)
    const found = this.lookup(path)
    if (!found.node) throw new FsError('ENOENT', 'No such file or directory')
    const step = this.capture(path)
    const next = clone(found.node)
    if (owner) next.uid = owner
    if (group !== null) next.gid = group
    this.saveMeta(path, found.from, next)
    this.steps.push(step)
  }

  mkdir(user: User, raw: string, opts?: { parents?: boolean }) {
    this.assertTx()
    const path = normalize(raw)
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
    if (path === '/') throw new FsError('EINVAL', 'refusing to remove /')
    let node: Node | null
    try {
      this.assertSearch(user, path)
      node = this.visible(path)
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
        if (this.childNames(path).length) throw new FsError('ENOTEMPTY', 'Directory not empty')
      } else if (!opts?.recursive) {
        throw new FsError('EISDIR', 'Is a directory')
      }
      const paths = this.subtree(path).sort((a, b) => b.length - a.length)
      for (const child of paths) this.removeOne(user, child)
      return
    }
    if (opts?.dirOnly) throw new FsError('ENOTDIR', 'Not a directory')
    this.removeOne(user, path)
  }

  private mkdirOne(user: User, path: string) {
    this.assertCreate(user, path)
    if (this.visible(path)) throw new FsError('EEXIST', 'File exists')
    const parent = this.visible(dirname(path))
    if (!parent) throw new FsError('ENOENT', 'No such file or directory')
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    const remote = publishes(user, path)
    const step = this.capture(path)
    const node: DirNode = {
      type: 'dir',
      mtime: Date.now(),
      mode: createdMode(path, 'dir'),
      uid: user.name,
      gid: user.name,
    }
    if (remote) {
      this.local.delete(path)
      this.remote.set(path, node)
    } else {
      this.local.set(path, node)
    }
    this.steps.push(step)
    if (!remote) return
    const keep = `${path}/.gitkeep`
    const keepStep = this.capture(keep)
    this.local.delete(keep)
    this.remote.set(keep, textFile('', user.name))
    this.pending.set(keep, { path: keep, content: '', encoding: 'utf-8' })
    keepStep.inverseRemote = { path: keep, content: null, encoding: 'utf-8' }
    this.steps.push(keepStep)
  }

  private removeOne(user: User, path: string) {
    const existing = this.lookup(path)
    if (!existing.node) return
    if (existing.node.type === 'file' && existing.node.encoding === 'binary' && publishes(user, path)) {
      throw new FsError('EINVAL', 'cannot modify binary file')
    }
    this.assertUnlink(user, path)
    if (user.role !== 'root' && existing.from !== 'local') throw new FsError('EACCES', 'Permission denied')
    const remote = publishes(user, path)
    const previous = existing.node.type === 'file' && existing.node.encoding === 'utf8' ? existing.node.content : null
    const step = this.capture(path)
    if (remote) {
      this.local.delete(path)
      this.remote.set(path, { type: 'tomb' })
      if (existing.node.type === 'file') {
        this.pending.set(path, { path, content: null, encoding: 'utf-8' })
        step.inverseRemote =
          previous === null ? null : { path, content: previous, encoding: 'utf-8' }
      }
    } else {
      this.local.delete(path)
      if (this.visibleBelowLocal(path)) this.local.set(path, { type: 'tomb' })
    }
    this.steps.push(step)
  }

  private prepareFile(user: User, path: string) {
    this.assertWriteContent(user, path)
    const parent = this.visible(dirname(path))
    if (!parent) throw new FsError('ENOENT', 'No such file or directory')
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    const existing = this.visible(path)
    if (existing?.type === 'dir') throw new FsError('EISDIR', 'Is a directory')
  }

  private capture(path: string): MutationStep {
    return {
      path,
      beforeLocal: this.local.has(path) ? clone(this.local.get(path)!) : null,
      beforeRemote: this.remote.has(path) ? clone(this.remote.get(path)!) : null,
      inverseRemote: null,
    }
  }

  private assertTx() {
    if (!this.depth) throw new FsError('EIO', 'no transaction')
  }

  private saveMeta(path: string, from: 'local' | 'remote' | 'image' | 'none', node: Node) {
    if (from === 'local') {
      this.local.set(path, node)
      return
    }
    this.remote.set(path, node)
  }

  private assertSearch(user: User, path: string) {
    if (user.role === 'root') return
    for (const dir of parentChain(path)) {
      if (dir === path) break
      const node = this.visible(dir)
      if (!node) throw new FsError('ENOENT', 'No such file or directory')
      if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
      if (!modePermits(user, cred(node), 1)) throw new FsError('EACCES', 'Permission denied')
    }
  }

  private assertCreate(user: User, path: string) {
    if (!canWrite(user, path)) throw new FsError('EACCES', 'Permission denied')
    if (user.role === 'root') return
    this.assertSearch(user, path)
    const parent = this.visible(dirname(path))
    if (!parent || parent.type !== 'dir') return
    if (!modePermits(user, cred(parent), 2) || !modePermits(user, cred(parent), 1)) {
      throw new FsError('EACCES', 'Permission denied')
    }
  }

  private assertWriteContent(user: User, path: string) {
    if (!canWrite(user, path)) throw new FsError('EACCES', 'Permission denied')
    if (user.role === 'root') return
    this.assertSearch(user, path)
    const existing = this.visible(path)
    if (!existing) {
      this.assertCreate(user, path)
      return
    }
    if (!modePermits(user, cred(existing), 2)) throw new FsError('EACCES', 'Permission denied')
  }

  private assertUnlink(user: User, path: string) {
    if (!canWrite(user, path)) throw new FsError('EACCES', 'Permission denied')
    if (user.role === 'root') return
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

  private clearTx() {
    this.depth = 0
    this.backup = null
    this.pending = new Map()
    this.steps = []
    this.writes = []
  }

  private lookup(path: string): { node: Node | null; from: 'local' | 'remote' | 'image' | 'none' } {
    const local = this.local.get(path)
    if (local?.type === 'tomb') return { node: null, from: 'local' }
    if (local) return { node: local, from: 'local' }
    const remote = this.remote.get(path)
    if (remote?.type === 'tomb') return { node: null, from: 'remote' }
    if (remote) return { node: remote, from: 'remote' }
    const image = this.image.get(path)
    if (image) return { node: image, from: 'image' }
    return { node: null, from: 'none' }
  }

  private visible(path: string): Node | null {
    return this.lookup(path).node
  }

  private visibleBelowLocal(path: string): boolean {
    const remote = this.remote.get(path)
    if (remote?.type === 'tomb') return false
    if (remote) return true
    return this.image.has(path)
  }

  /** Published view: ignore the browser-only local layer. */
  private publishedText(path: string): string | null {
    const remote = this.remote.get(path)
    if (remote?.type === 'tomb') return null
    if (remote?.type === 'file') {
      if (remote.encoding !== 'utf8') throw new FsError('EINVAL', 'cannot modify binary file')
      return remote.content
    }
    if (remote?.type === 'dir') return null
    const image = this.image.get(path)
    if (image?.type === 'file') {
      if (image.encoding !== 'utf8') throw new FsError('EINVAL', 'cannot modify binary file')
      return image.content
    }
    return null
  }

  private childNames(dir: string): string[] {
    const names = new Set<string>()
    const consider = (path: string) => {
      if (dirname(path) !== dir) return
      const name = basename(path)
      if (name === '/' || name === '.gitkeep') return
      names.add(name)
    }
    for (const path of this.image.keys()) consider(path)
    for (const path of this.remote.keys()) consider(path)
    for (const path of this.local.keys()) consider(path)
    return [...names].filter((name) => this.visible(joinPath(dir, name)))
  }

  private subtree(path: string): string[] {
    const prefix = path === '/' ? '/' : `${path}/`
    const found = new Set<string>()
    const add = (candidate: string) => {
      if (candidate === path || candidate.startsWith(prefix)) found.add(candidate)
    }
    for (const candidate of this.image.keys()) add(candidate)
    for (const candidate of this.remote.keys()) add(candidate)
    for (const candidate of this.local.keys()) add(candidate)
    return [...found].filter((candidate) => this.visible(candidate))
  }
}

export function installSystemDirs(image: Map<string, Node>) {
  if (!image.has('/')) image.set('/', emptyDir())
  for (const dir of ['/tmp', '/root', '/var', '/var/guestbook', '/home', '/etc']) {
    if (!image.has(dir)) image.set(dir, emptyDir())
  }
  for (const [path, node] of image) {
    if (node.type !== 'file' && node.type !== 'dir') continue
    node.mode = shippedMode(path, node.type)
    node.uid = node.uid || 'root'
    node.gid = node.gid || node.uid
  }
}

function emptyDir(): DirNode {
  return { type: 'dir', mtime: 0, mode: 0o755, uid: 'root', gid: 'root' }
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

function ensureParents(image: Map<string, Node>, path: string) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`
    if (!image.has(current)) image.set(current, emptyDir())
  }
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function assign(map: Map<string, Entry>, path: string, entry: Entry | null) {
  if (entry === null) map.delete(path)
  else map.set(path, clone(entry))
}

function cloneMap(map: Map<string, Entry>): Map<string, Entry> {
  return new Map([...map.entries()].map(([path, entry]) => [path, clone(entry)]))
}

function isEntry(value: Entry): boolean {
  return value?.type === 'file' || value?.type === 'dir' || value?.type === 'tomb'
}
