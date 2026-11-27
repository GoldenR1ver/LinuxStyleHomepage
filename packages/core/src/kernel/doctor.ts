import { mailRelayProblem, type SiteConfig } from '../config/site'
import type { DirNode, FileNode, Node } from './types'
import { parseGroup, parsePasswd, parseShadow } from './accounts'
import { VirtualFS } from './vfs'

const root = { name: 'root', uid: 0, gid: 0, groups: ['root'], home: '/root', shell: '/bin/sh' }

/**
 * Account self-checks shown to root at login. They are the checks `fsck` would
 * make about the three files that decide who may do what: every home exists and
 * belongs to its account, every group a file names exists, and shadow is closed.
 */
export function doctor(fs: VirtualFS, site: SiteConfig): string[] {
  const notes: string[] = []
  const read = (path: string): string => {
    try {
      const node: FileNode | DirNode = fs.read(root, path)
      return node.type === 'file' && node.encoding === 'utf8' ? node.content : ''
    } catch {
      notes.push(`missing ${path}`)
      return ''
    }
  }

  const accounts = parsePasswd(read('/etc/passwd'))
  const groups = parseGroup(read('/etc/group'))
  const shadow = parseShadow(read('/etc/shadow'))

  if (!accounts.length) notes.push('/etc/passwd has no account')
  if (!accounts.some((account) => account.uid === 0)) notes.push('/etc/passwd has no uid 0')
  if (!groups.some((group) => group.gid === 0)) notes.push('/etc/group has no gid 0')

  const groupNames = new Set(groups.map((group) => group.name))
  for (const account of accounts) {
    if (account.shell.endsWith('nologin')) continue
    const primary = groups.find((group) => group.gid === account.gid)?.name
    if (!primary) notes.push(`${account.name} has gid ${account.gid}, which no group owns`)
    if (!account.name || !account.home) notes.push(`${account.name} has an empty home`)
    let stat
    try {
      stat = fs.stat(root, account.home)
    } catch {
      notes.push(`missing home ${account.home}`)
      continue
    }
    if (stat.type !== 'dir') notes.push(`${account.home} is not a directory`)
    else if (stat.uid !== account.name) notes.push(`${account.home} is owned by ${stat.uid}, not ${account.name}`)
    // The default is 0700, but /etc/perm may open a home on purpose. What is
    // never fine is a group- or world-writable home.
    if ((stat.mode & 0o022) !== 0) notes.push(`${account.home} is 0${stat.mode.toString(8)}, group or other can write`)
  }

  for (const entry of shadow) {
    if (!accounts.some((account) => account.name === entry.name)) {
      notes.push(`/etc/shadow has ${entry.name}, which /etc/passwd does not`)
    }
  }

  for (const account of accounts) {
    if (account.uid === 0 && !shadow.some((entry) => entry.name === account.name)) {
      notes.push('root has no /etc/shadow entry, so su root cannot work')
    }
  }

  for (const group of groups) {
    for (const member of group.members) {
      if (!accounts.some((account) => account.name === member)) {
        notes.push(`group ${group.name} names ${member}, who has no account`)
      }
    }
  }

  const walk = (path: string) => {
    let names: string[]
    try {
      names = fs.readdir(root, path)
    } catch {
      return
    }
    for (const name of names) {
      const child = path === '/' ? `/${name}` : `${path}/${name}`
      let node: Node | null = null
      try {
        const stat = fs.stat(root, child)
        if (stat.type === 'dir') {
          walk(child)
          continue
        }
        node = fs.read(root, child)
      } catch {
        continue
      }
      if (node && node.gid && !groupNames.has(node.gid)) {
        notes.push(`${child} has group ${node.gid}, which /etc/group does not define`)
      }
    }
  }
  walk('/')

  const relay = mailRelayProblem(site.webhookUrl)
  if (relay) notes.push(`${relay}, so mail push cannot notify you`)
  return notes
}
