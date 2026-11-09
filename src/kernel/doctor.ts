import { mailRelay, publicHome, type SiteConfig } from '../config/site'
import type { VirtualFS } from './vfs'

const root = { name: 'root', role: 'root' as const }

/** Config checks shown to root at login. Guests do not see them. */
export function doctor(fs: VirtualFS, site: SiteConfig): string[] {
  const notes: string[] = []
  const home = publicHome(site)
  try {
    const stat = fs.stat(root, home)
    if (stat.type !== 'dir') notes.push(`${home} is not a directory`)
  } catch {
    notes.push(`missing ${home}. site.owner must match the directory under content/home`)
  }
  try {
    const file = fs.read(root, '/etc/hostname')
    const hostname = file.encoding === 'utf8' ? file.content.trim() : ''
    if (hostname && hostname !== site.hostname) {
      notes.push(`/etc/hostname is "${hostname}", site.hostname is "${site.hostname}"`)
    }
  } catch {
    notes.push('missing /etc/hostname')
  }
  if (!site.github.owner || !site.github.repo) {
    notes.push('github.owner / github.repo are unset, so server files cannot be changed')
  }
  if (!mailRelay(site.webhookUrl)) notes.push('webhookUrl is unset or not an https relay, so mail push cannot notify you')
  return notes
}
