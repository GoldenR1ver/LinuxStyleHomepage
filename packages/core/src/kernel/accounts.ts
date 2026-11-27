import type { DirNode, Node, User } from './types'
import type { VirtualFS } from './vfs'

/**
 * The account database is `/etc/passwd`, `/etc/group` and `/etc/shadow`, the
 * same three files a real login reads. There is no second source of truth:
 * `login(1)` builds a `User` once and the credential is a snapshot, exactly
 * like a real session.
 */

export interface Account {
  name: string
  uid: number
  gid: number
  gecos: string
  home: string
  shell: string
}

export interface GroupEntry {
  name: string
  gid: number
  members: string[]
}

export interface ShadowEntry {
  name: string
  hash: string
}

export const ROOT: User = {
  name: 'root',
  uid: 0,
  gid: 0,
  groups: ['root'],
  home: '/root',
  shell: '/bin/sh',
}

const NAME_RE = /^[^\s/\\:\u0000]{1,32}$/

export function parsePasswd(text: string): Account[] {
  const rows: Account[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(':')
    if (parts.length < 7) continue
    const [name, , uid, gid, gecos, home, shell] = parts
    if (!name || !NAME_RE.test(name)) continue
    rows.push({
      name,
      uid: Number(uid) || 0,
      gid: Number(gid) || 0,
      gecos: gecos ?? '',
      home: home || `/home/${name}`,
      shell: shell || '/bin/sh',
    })
  }
  return rows
}

export function parseGroup(text: string): GroupEntry[] {
  const rows: GroupEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(':')
    if (parts.length < 3) continue
    const [name, , gid, members] = parts
    if (!name) continue
    rows.push({
      name,
      gid: Number(gid) || 0,
      members: (members ?? '')
        .split(',')
        .map((member) => member.trim())
        .filter(Boolean),
    })
  }
  return rows
}

export function parseShadow(text: string): ShadowEntry[] {
  const rows: ShadowEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [name, hash] = trimmed.split(':')
    if (name) rows.push({ name, hash: hash ?? '' })
  }
  return rows
}

export function formatPasswd(accounts: Account[]): string {
  return `${accounts
    .map((item) => `${item.name}:x:${item.uid}:${item.gid}:${item.gecos}:${item.home}:${item.shell}`)
    .join('\n')}\n`
}

export function formatGroup(groups: GroupEntry[]): string {
  return `${groups.map((item) => `${item.name}:x:${item.gid}:${item.members.join(',')}`).join('\n')}\n`
}

function readText(fs: VirtualFS, path: string): string | null {
  try {
    const node = fs.read(ROOT, path)
    return node.encoding === 'utf8' ? node.content : null
  } catch {
    return null
  }
}

export function readAccounts(fs: VirtualFS): { accounts: Account[]; groups: GroupEntry[] } {
  return {
    accounts: parsePasswd(readText(fs, '/etc/passwd') ?? ''),
    groups: parseGroup(readText(fs, '/etc/group') ?? ''),
  }
}

/**
 * `/etc/caps`: `name:CAP_A,CAP_B`, one account per line. An account listed here
 * carries those capabilities even when its uid is not 0. It is the file `execve`
 * would consult for a file capability; here it gates per account instead.
 */
export function parseCaps(text: string): Map<string, string[]> {
  const rows = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const cut = trimmed.indexOf(':')
    if (cut <= 0) continue
    const name = trimmed.slice(0, cut).trim()
    const caps = trimmed
      .slice(cut + 1)
      .split(',')
      .map((cap) => cap.trim())
      .filter(Boolean)
    if (name) rows.set(name, caps)
  }
  return rows
}

export function readCaps(fs: VirtualFS): Map<string, string[]> {
  return parseCaps(readText(fs, '/etc/caps') ?? '')
}

/** Primary group name, then every group whose member list names this user. */
export function groupNames(account: Account, groups: GroupEntry[]): string[] {
  const primary = groups.find((group) => group.gid === account.gid)?.name
  const names = new Set<string>()
  if (primary) names.add(primary)
  else names.add(account.name)
  for (const group of groups) {
    if (group.members.includes(account.name)) names.add(group.name)
  }
  return [...names]
}

export function toUser(account: Account, groups: GroupEntry[], caps: string[] = []): User {
  return {
    name: account.name,
    uid: account.uid,
    gid: account.gid,
    groups: groupNames(account, groups),
    home: account.home,
    shell: account.shell,
    ...(caps.length ? { caps } : {}),
  }
}

export function lookupAccount(fs: VirtualFS, name: string): Account | null {
  const { accounts } = readAccounts(fs)
  return accounts.find((account) => account.name === name) ?? null
}

/** Resolve a name the way `getpwnam(3)` does, without touching a password. */
export function lookupUser(fs: VirtualFS, name: string): User | null {
  const { accounts, groups } = readAccounts(fs)
  const account = accounts.find((item) => item.name === name)
  if (!account) return null
  return toUser(account, groups, readCaps(fs).get(name) ?? [])
}

export function primaryGroupOf(fs: VirtualFS, name: string): string {
  const { accounts, groups } = readAccounts(fs)
  const account = accounts.find((item) => item.name === name)
  if (!account) return name
  return groups.find((group) => group.gid === account.gid)?.name ?? account.name
}

export function homeDir(user: Pick<User, 'home'>): string {
  return user.home || '/'
}

/* ------------------------------------------------------------------ */
/* password hashes                                                     */
/* ------------------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift))

/** A dependency-free SHA-256. Small enough to keep the core free of a crypto import. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const blocks = Math.ceil((bytes.length + 9) / 64)
  const padded = new Uint8Array(blocks * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = bytes.length * 8
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded.length - 4, bits >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3)
      const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e ?? 0, 6) ^ rotr(e ?? 0, 11) ^ rotr(e ?? 0, 25)
      const ch = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0))
      const t1 = ((hh ?? 0) + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const S0 = rotr(a ?? 0, 2) ^ rotr(a ?? 0, 13) ^ rotr(a ?? 0, 22)
      const maj = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0))
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = ((h[0] ?? 0) + (a ?? 0)) >>> 0
    h[1] = ((h[1] ?? 0) + (b ?? 0)) >>> 0
    h[2] = ((h[2] ?? 0) + (c ?? 0)) >>> 0
    h[3] = ((h[3] ?? 0) + (d ?? 0)) >>> 0
    h[4] = ((h[4] ?? 0) + (e ?? 0)) >>> 0
    h[5] = ((h[5] ?? 0) + (f ?? 0)) >>> 0
    h[6] = ((h[6] ?? 0) + (g ?? 0)) >>> 0
    h[7] = ((h[7] ?? 0) + (hh ?? 0)) >>> 0
  }
  return [...h].map((value) => value.toString(16).padStart(8, '0')).join('')
}

export function makeHash(password: string, salt = Math.random().toString(36).slice(2, 10)): string {
  return `$sha256$${salt}$${sha256Hex(`${salt}:${password}`)}`
}

const HASHED = /^\$sha256\$([^$]*)\$([0-9a-f]{64})$/

export function checkHash(stored: string, password: string): boolean {
  if (!stored || stored === '!' || stored === '*') return false
  const match = HASHED.exec(stored)
  if (!match) return stored === password
  return sha256Hex(`${match[1] ?? ''}:${password}`) === match[2]
}

export function hasPassword(fs: VirtualFS, name: string): boolean {
  const shadow = parseShadow(readText(fs, '/etc/shadow') ?? '')
  const entry = shadow.find((item) => item.name === name)
  return Boolean(entry && checkHashCapable(entry.hash))
}

function checkHashCapable(hash: string): boolean {
  return Boolean(hash) && hash !== '!' && hash !== '*'
}

/** Check a password against `/etc/shadow`, never against a build-time constant. */
export function verifyPassword(fs: VirtualFS, name: string, password: string): boolean {
  const shadow = parseShadow(readText(fs, '/etc/shadow') ?? '')
  const entry = shadow.find((item) => item.name === name)
  if (!entry) return false
  return checkHash(entry.hash, password)
}

/**
 * Rewrite one row of `/etc/shadow`. The write is made as `actor`, so a guest can
 * only do it through a setuid binary (`/bin/passwd`); without one the 0600 mode
 * on the file is the answer, exactly as on a real machine.
 */
export function setPassword(fs: VirtualFS, actor: User, name: string, password: string) {
  const text = readText(fs, '/etc/shadow') ?? ''
  const rows = parseShadow(text)
  const hash = makeHash(password)
  const next = rows.some((row) => row.name === name)
    ? rows.map((row) => (row.name === name ? { name, hash } : row))
    : [...rows, { name, hash }]
  const out = `${next.map((row) => `${row.name}:${row.hash}:19700:0:99999:7:::`).join('\n')}\n`
  fs.begin()
  try {
    fs.write(actor, '/etc/shadow', out)
    fs.finish()
  } catch (err) {
    fs.abort()
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* boot-time ownership                                                 */
/* ------------------------------------------------------------------ */

function emptyDir(mode: number, uid: string, gid: string): DirNode {
  return { type: 'dir', mtime: 0, mode, uid, gid }
}

function ensureParent(image: Map<string, Node>, path: string) {
  const parts = path.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current += `/${parts[i]}`
    if (!image.has(current)) image.set(current, emptyDir(0o755, 'root', 'root'))
  }
}

/**
 * The home directory `pam_mkhomedir` would create for each account, with the
 * owner and the group the account table gives it. The build publishes the same
 * plan for homes that exist in the tree; this is the fallback for the rest.
 */
export function planHomes(
  accounts: Account[],
  groups: GroupEntry[],
): { path: string; mode: number; uid: string; gid: string }[] {
  const rows: { path: string; mode: number; uid: string; gid: string }[] = []
  for (const account of accounts) {
    // A nologin account is a name for a daemon, not a place to live.
    if (account.shell.endsWith('nologin')) continue
    const path = account.home || `/home/${account.name}`
    const primary = groups.find((group) => group.gid === account.gid)?.name ?? account.name
    rows.push({ path, mode: 0o700, uid: account.name, gid: primary })
  }
  return rows
}

/**
 * Give every account a home if the image has none, the way `pam_mkhomedir` does.
 * Ownership of the paths that do exist comes from the build metadata in
 * `perm.ts`, so this only fills the gaps: one boot step, one job.
 */
export function applyAccounts(image: Map<string, Node>) {
  const passwd = image.get('/etc/passwd')
  const groupFile = image.get('/etc/group')
  const accounts = parsePasswd(passwd?.type === 'file' ? passwd.content : '')
  const groups = parseGroup(groupFile?.type === 'file' ? groupFile.content : '')

  for (const home of planHomes(accounts, groups)) {
    if (image.has(home.path)) continue
    ensureParent(image, home.path)
    image.set(home.path, emptyDir(home.mode, home.uid, home.gid))
  }
}

/* ------------------------------------------------------------------ */
/* login                                                               */
/* ------------------------------------------------------------------ */

export interface Login {
  user: User
  created: boolean
}

/**
 * Console login. An existing account is accepted with any password, except root:
 * root is the one credential that keeps a password, so the puzzle has a lock.
 * An unknown name is created in this browser, owned by itself, under /home/<name>.
 * Both the account line and that home live in the local overlay and are never
 * persisted, so a refresh forgets them.
 */
export function authenticate(fs: VirtualFS, nameRaw: string, password: string): Login | null {
  const name = nameRaw.trim()
  if (!name || name === '.' || name === '..' || !NAME_RE.test(name)) return null

  const { accounts, groups } = readAccounts(fs)
  const found = accounts.find((account) => account.name === name)
  if (found) {
    if (found.uid === 0 && !verifyPassword(fs, name, password)) return null
    return { user: toUser(found, groups, readCaps(fs).get(name) ?? []), created: false }
  }

  // The next free uid above the normal user range. System accounts (nobody at
  // 65534) are skipped, the way useradd does not pick a system id.
  const uid =
    accounts.reduce((max, account) => (account.uid < 60_000 ? Math.max(max, account.uid) : max), 1000) + 1
  return { user: createAccount(fs, name, uid, groups, password), created: true }
}

/**
 * The account a console login creates for an unknown name. The password typed at
 * the prompt becomes the account's password, the way `useradd -p` would store it,
 * so the guest can change it later through `passwd`. The account line, the home
 * and the shadow row are all session-only: a refresh forgets the whole account.
 */
function createAccount(fs: VirtualFS, name: string, uid: number, groups: GroupEntry[], password: string): User {
  const account: Account = {
    name,
    uid,
    gid: uid,
    gecos: 'Guest',
    home: `/home/${name}`,
    shell: '/bin/sh',
  }
  const text = readText(fs, '/etc/passwd') ?? ''
  const line = `${name}:x:${uid}:${uid}:Guest:${account.home}:/bin/sh`
  const next = text.endsWith('\n') || !text ? `${text}${line}\n` : `${text}\n${line}\n`
  const shadow = readText(fs, '/etc/shadow') ?? ''
  const row = `${name}:${makeHash(password)}:19700:0:99999:7:::`
  const nextShadow = shadow.endsWith('\n') || !shadow ? `${shadow}${row}\n` : `${shadow}\n${row}\n`
  fs.begin()
  try {
    fs.write(ROOT, '/etc/passwd', next)
    fs.write(ROOT, '/etc/group', `${readText(fs, '/etc/group') ?? ''}${name}:x:${uid}:\n`)
    fs.write(ROOT, '/etc/shadow', nextShadow)
    if (!fs.exists(ROOT, account.home)) fs.mkdir(ROOT, account.home, { parents: true })
    fs.chown(ROOT, account.home, name, name)
    fs.chmod(ROOT, account.home, 0o700)
    fs.finish()
  } catch (err) {
    fs.abort()
    throw err
  }
  fs.markEphemeral('/etc/passwd')
  fs.markEphemeral('/etc/group')
  // The row belongs to an account that only exists in this page load, so it goes
  // with it. A root password change in the same session is lost too; that is the
  // price of one file holding both.
  fs.markEphemeral('/etc/shadow')
  fs.markEphemeral(account.home)
  return toUser(account, [...groups, { name, gid: uid, members: [name] }])
}
