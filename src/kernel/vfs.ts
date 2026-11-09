import { basename, dirname, normalize } from './path'
import { canRead, canWrite, publishes } from './policy'
import {
  MAX_FILE_BYTES,
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
    for (const dir of ['/tmp', '/root', '/var', '/var/guestbook', '/home', '/etc']) {
      if (!image.has(dir)) image.set(dir, emptyDir())
    }
    return new VirtualFS(image)
  }

  loadOverlay(remote: [string, Entry][], local: [string, Entry][]) {
    this.remote = new Map(remote.filter((pair) => isEntry(pair[1])))
    this.local = new Map(local.filter((pair) => isEntry(pair[1])))
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
    this.assertRead(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    return {
      path,
      type: node.type,
      size: node.type === 'file' ? node.size : this.childNames(path).length,
      mtime: node.mtime,
      mode: node.mode,
      uid: node.uid,
      encoding: node.type === 'file' ? node.encoding : undefined,
    }
  }

  read(user: User, raw: string): FileNode {
    const path = normalize(raw)
    this.assertRead(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'file') throw new FsError('EISDIR', 'Is a directory')
    return clone(node)
  }

  readdir(user: User, raw: string): string[] {
    const path = normalize(raw)
    this.assertRead(user, path)
    const node = this.visible(path)
    if (!node) throw new FsError('ENOENT', 'No such file or directory')
    if (node.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    return this.childNames(path)
      .filter((name) => canRead(user, joinPath(path, name)))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
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
    const node = textFile(content, user.name)
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
    const node = textFile(existing.node.content, existing.node.uid)
    node.mode = existing.node.mode
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
    const step = this.capture(path)
    this.local.set(path, { ...clone(source), uid: user.name, mtime: Date.now() })
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
      this.assertRead(user, path)
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
    this.assertWriteZone(user, path)
    if (this.visible(path)) throw new FsError('EEXIST', 'File exists')
    const parent = this.visible(dirname(path))
    if (!parent) throw new FsError('ENOENT', 'No such file or directory')
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', 'Not a directory')
    const remote = publishes(user, path)
    const step = this.capture(path)
    const node = { ...emptyDir(), uid: user.name, mtime: Date.now() }
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
    this.assertWriteZone(user, path)
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
    this.assertWriteZone(user, path)
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

  private assertRead(user: User, path: string) {
    if (!canRead(user, path)) throw new FsError('EACCES', 'Permission denied')
  }

  private assertWriteZone(user: User, path: string) {
    this.assertRead(user, path)
    if (!canWrite(user, path)) throw new FsError('EACCES', 'Permission denied')
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

function emptyDir(): DirNode {
  return { type: 'dir', mtime: 0, mode: 0o755, uid: 'root' }
}

function textFile(content: string, uid: string, mtime = Date.now()): FileNode {
  return {
    type: 'file',
    content,
    encoding: 'utf8',
    size: byteLength(content),
    mtime,
    mode: 0o644,
    uid,
  }
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
