import { parseGroup, parsePasswd, planHomes } from './accounts'
import { shippedMode } from './policy'

/**
 * Build-time metadata.
 *
 * A static build stores bytes, not inode metadata. This module computes the
 * mode, owner and group for every path once, at build time, so the manifest
 * carries them the way a tar or squashfs image does. The browser then never has
 * to re-derive ownership at boot: it reads the image and knows who owns what.
 *
 * The rules, in order:
 *   1. the shipped default (`shippedMode`)
 *   2. the account table: a home belongs to its account, mode 0700
 *   3. `/etc/perm`: an explicit exception, one `path owner:group mode` per line
 */

export interface Meta {
  mode: number
  uid: string
  gid: string
}

export interface MetaEntry {
  path: string
  kind: 'file' | 'dir'
}

export interface PermLine {
  path: string
  uid: string
  gid: string
  /** null keeps the mode the path already has. */
  mode: number | null
}

/** `/etc/perm`: path, owner:group, octal mode. A blank or `#` line is a comment. */
export function parsePerm(text: string): PermLine[] {
  const rows: PermLine[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [path, owner, mode] = trimmed.split(/\s+/)
    if (!path || !owner) continue
    const [uid, gid] = owner.split(':')
    if (!uid) continue
    const parsed = mode ? Number.parseInt(mode, 8) : Number.NaN
    rows.push({
      path,
      uid,
      gid: gid || uid,
      mode: Number.isFinite(parsed) ? parsed & 0o7777 : null,
    })
  }
  return rows
}

/**
 * Metadata for every path the image publishes. `read` returns the text of a
 * file, or null when the path is not a text file; only the three account files
 * and `/etc/perm` are ever read.
 */
export function buildMetadata(entries: MetaEntry[], read: (path: string) => string | null): Map<string, Meta> {
  const accounts = parsePasswd(read('/etc/passwd') ?? '')
  const groups = parseGroup(read('/etc/group') ?? '')
  const present = new Set(entries.map((entry) => entry.path))
  const meta = new Map<string, Meta>()

  for (const entry of entries) {
    meta.set(entry.path, { mode: shippedMode(entry.path, entry.kind), uid: 'root', gid: 'root' })
  }

  // A home that ships in the tree belongs to its account, not to root.
  for (const home of planHomes(accounts, groups)) {
    if (present.has(home.path)) meta.set(home.path, { mode: home.mode, uid: home.uid, gid: home.gid })
  }

  // An explicit line wins over both defaults, which is how /bin/passwd gets 4755.
  for (const line of parsePerm(read('/etc/perm') ?? '')) {
    if (!present.has(line.path)) continue
    const current = meta.get(line.path) ?? { mode: 0o644, uid: 'root', gid: 'root' }
    meta.set(line.path, {
      mode: line.mode ?? current.mode,
      uid: line.uid,
      gid: line.gid,
    })
  }

  return meta
}
