import { site } from './config/site'
import { ROOT, lookupUser } from './kernel/accounts'
import { installProc } from './app/system'
import { createShell } from './app/session'
import type { Runtime } from './app/runtime'
import type { User } from './kernel/types'
import { VirtualFS } from './kernel/vfs'
import { MemoryMail } from './remote/memory'
import { createOutbox } from './remote/outbox'
import type { PickedFile } from './shell/context'

/** The same root user every host uses. uid 0 is the whole privilege model. */
export const rootUser: User = ROOT

export function guest(name: string, uid = 1001, groups: string[] = [name], home = `/home/${name}`): User {
  return { name, uid, gid: uid, groups, home, shell: '/bin/sh' }
}

/** The account that owns the public page, the way /etc/passwd describes it. */
export const ownerUser: User = {
  name: 'owner',
  uid: 1000,
  gid: 1000,
  groups: ['owner', 'staff'],
  home: '/home/owner',
  shell: '/bin/sh',
}

const files = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\n' +
    'owner:x:1000:1000:Yujiang:/home/owner:/bin/sh\n' +
    'ada:x:1001:1001:Ada:/home/ada:/bin/sh\n',
  '/etc/group': 'root:x:0:\nstaff:x:1000:owner,root\nada:x:1001:ada\nreaders:x:1002:ada\nwheel:x:27:owner,root\n',
  '/etc/perm': '/home/owner owner:staff 0755\n/bin/passwd root:root 4755\n',
  '/bin/passwd': '#!/bin/sh\n',
  // The same rows as content/etc/shadow, so a test that copies a leaked password
  // behaves like the site.
  '/etc/shadow':
    'root:$sha256$h0m3$76b39fbd3bd9c40a3c1e2da50e0ccaf842d340ca63450386354fa5dbe2f82d4e:19700:0:99999:7:::\n' +
    'owner:$sha256$own3r$9fb090689519f03b32e8eefd9309d5dd2a154e9a4037de90502ffc22af03749a:19700:0:99999:7:::\n',
  '/etc/motd': 'welcome\n',
  '/etc/hostname': 'home\n',
  '/home/owner/about.md': 'about\n',
  '/home/owner/notes/a.md': 'note\n',
  '/var/guestbook/README.md': 'leave a note\n',
  '/root/README.md': 'secret\n',
}

export function boot(options?: {
  user?: User
  stdin?: string
  secret?: string | null
  secretQueue?: (string | null)[]
  webhook?: boolean
  picked?: PickedFile[] | null
  files?: Record<string, string>
}) {
  // `fromFiles` installs the system dirs and applies /etc/passwd, so ownership
  // and modes match what the browser and CLI build.
  const fs = VirtualFS.fromFiles({ ...files, ...(options?.files ?? {}) })
  // Resolve the pane's identity from the account files, so a fixture that grants
  // a capability or a group is honoured the way `login(1)` would honour it.
  const user = (options?.user ? lookupUser(fs, options.user.name) : null) ?? options?.user ?? guest('ada')
  const mail = new MemoryMail(Boolean(options?.webhook))
  const rt: Runtime = {
    site: { ...site, webhookUrl: options?.webhook ? 'https://example.test/hook' : '' },
    fs,
    mail,
    outbox: createOutbox(),
    persist: async () => {},
    procs: () => [],
    mux: null,
  }
  installProc(rt)
  const ctx = createShell(rt, user, user.home)
  const stdin = options?.stdin ?? ''
  const secrets = [...(options?.secretQueue ?? [])]
  const secret = options?.secret ?? null
  ctx.host = {
    async readStdin() {
      return stdin
    },
    async askSecret() {
      return secrets.length ? (secrets.shift() ?? null) : secret
    },
    async pickFiles() {
      return options?.picked ?? null
    },
  }
  return { ctx, rt, fs, mail }
}
