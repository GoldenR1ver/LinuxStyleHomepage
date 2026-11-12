import { site } from './config/site'
import { createShell } from './app/session'
import type { Runtime } from './app/runtime'
import { Journal } from './kernel/journal'
import type { User } from './kernel/types'
import { VirtualFS } from './kernel/vfs'
import { MemoryMail, MemoryRemote } from './remote/memory'
import { createOutbox } from './remote/outbox'
import type { PickedFile } from './shell/host'

const files = {
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
  authenticated?: boolean
  configured?: boolean
  webhook?: boolean
  picked?: PickedFile[] | null
}) {
  const user = options?.user ?? { name: 'ada', role: 'guest' as const }
  const fs = VirtualFS.fromFiles(files)
  if (user.role === 'guest') {
    fs.begin()
    fs.mkdir(user, `/tmp/${user.name}`, { parents: true })
    fs.finish()
  }
  const remote = new MemoryRemote(options?.configured ?? true, options?.authenticated ?? false)
  const mail = new MemoryMail(Boolean(options?.webhook))
  const journal = new Journal({ events: [], mutations: [] }, site.journalDays)
  let password = '123456'
  const rt: Runtime = {
    site: { ...site, webhookUrl: options?.webhook ? 'https://example.test/hook' : '' },
    fs,
    journal,
    remote,
    mail,
    outbox: createOutbox(),
    vault: {
      get: () => password,
      set(next: string) {
        password = next
      },
    },
    tokens: { get: () => '', set() {}, clear() {} },
    persist: async () => {},
    procs: () => [],
    mux: null,
  }
  const ctx = createShell(rt, user, '/home/owner')
  const stdin = options?.stdin ?? ''
  const secret = options?.secret ?? null
  ctx.host = {
    async readStdin() {
      return stdin
    },
    async askSecret() {
      return secret
    },
    async pickFiles() {
      return options?.picked ?? null
    },
  }
  return { ctx, rt, fs, remote, mail }
}
