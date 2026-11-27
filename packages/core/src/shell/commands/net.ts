import { ROOT, lookupUser, verifyPassword } from '../../kernel/accounts'
import { hasCap } from '../../kernel/caps'
import { basename, normalize } from '../../kernel/path'
import type { User } from '../../kernel/types'
import { FsError } from '../../kernel/vfs'
import type { CommandResult, ShellCtx } from '../context'
import type { CommandSpec } from './types'
import { resolvePath } from './helpers'

/**
 * The little network this machine has: one loopback address, one LAN address,
 * and an HTTP server on 8080 that answers as root. ssh is a real login, not a
 * remote shell: the host is always this machine.
 *
 * The httpd binds to loopback only, so `ss` shows 127.0.0.1 and every URL in this
 * build is a loopback URL. `ip` still reports a LAN address because a machine
 * has one; it is background, not a route into the service.
 */

const LAN = '192.168.1.42'
const LOOPBACK = '127.0.0.1'
const HTTP = 8080

export const netCommands: CommandSpec[] = [
  {
    name: 'ip',
    group: 'site',
    summary: 'show interfaces and addresses',
    usage: 'ip [addr]',
    manual: 'Print the loopback and the one Ethernet interface. There is no routing table to change.',
    run(_ctx, args) {
      void _ctx
      const sub = args[0] ?? 'addr'
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      if (!['addr', 'a', 'address', 'link', 'l', 'route', 'r'].includes(sub)) {
        throw new FsError('EINVAL', `unknown command "${sub}"`)
      }
      if (sub === 'route' || sub === 'r') {
        return { code: 0, stdout: `default via 192.168.1.1 dev eth0\n192.168.1.0/24 dev eth0 proto kernel scope link src ${LAN}\n` }
      }
      if (sub === 'link' || sub === 'l') {
        return { code: 0, stdout: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP\n` }
      }
      return {
        code: 0,
        stdout: [
          '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN',
          '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
          '    inet 127.0.0.1/8 scope host lo',
          '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP',
          '    link/ether 02:42:ac:11:00:02 brd ff:ff:ff:ff:ff:ff',
          `    inet ${LAN}/24 brd 192.168.1.255 scope global eth0`,
          '',
        ].join('\n'),
      }
    },
  },
  {
    name: 'ss',
    group: 'site',
    summary: 'list listening sockets',
    usage: 'ss [-tuln]',
    manual: 'Print the sockets this machine is listening on. The HTTP server is the interesting one.',
    run(_ctx, args) {
      for (const arg of args) {
        if (!/^-[tuln]+$/.test(arg)) throw new FsError('EINVAL', `invalid option -- ${arg}`)
      }
      const rows = [
        'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
        `LISTEN 0      128    ${LOOPBACK}:${HTTP}           0.0.0.0:*      users:(("httpd",pid=1,fd=3))`,
        `LISTEN 0      128    ${LOOPBACK}:22           0.0.0.0:*      users:(("sshd",pid=2,fd=3))`,
      ]
      return { code: 0, stdout: `${rows.join('\n')}\n` }
    },
  },
  {
    name: 'curl',
    group: 'site',
    summary: 'fetch a URL from this machine',
    usage: 'curl [-s] [-O] [url]',
    manual:
      'Only http://127.0.0.1:8080 is reachable. The server answers as root, so it will serve a path the shell would refuse to read. -O writes the body to a file named after the URL.',
    run(ctx, args) {
      let output: string | null = null
      let silent = false
      let url = ''
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? ''
        if (arg === '-O' || arg === '--remote-name') {
          output = ''
          continue
        }
        if (arg === '-o' || arg === '--output') {
          output = args[++i] ?? ''
          if (!output) throw new FsError('EINVAL', 'curl: option -o requires a file name')
          continue
        }
        if (arg === '-s' || arg === '--silent' || arg === '-S' || arg === '--show-error') {
          silent = arg === '-s' || arg === '--silent'
          continue
        }
        if (arg.startsWith('-')) throw new FsError('EINVAL', `curl: option ${arg}: is unknown`)
        url = arg
      }
      if (!url) throw new FsError('EINVAL', 'curl: no URL specified')
      const target = parseLocalUrl(url)
      if (!target) {
        return { code: 7, stderr: `curl: (7) Failed to connect to ${hostOf(url)} port 8080: Connection refused\n` }
      }

      let node
      try {
        // The HTTP server runs as root. That is the whole vulnerability: it can
        // read a 0700 directory that no visitor can open from the shell.
        node = ctx.rt.fs.stat(ROOT, target)
      } catch {
        return { code: 22, stderr: `${silent ? '' : ''}curl: (22) The requested URL returned error: 404\n` }
      }

      if (node.type === 'dir') {
        const names = ctx.rt.fs.readdir(ROOT, target)
        const body = directoryListing(ctx, target, names)
        if (output !== null) {
          const file = output || 'index.html'
          ctx.rt.fs.write(ctx.user, resolvePath(ctx, file), body)
          return { code: 0 }
        }
        return { code: 0, stdout: body }
      }

      const file = ctx.rt.fs.read(ROOT, target)
      if (file.encoding !== 'utf8') {
        return { code: 0, stderr: `curl: (6) binary response from ${target}; this build only prints text\n` }
      }
      if (output !== null) {
        const name = output || basename(target)
        ctx.rt.fs.write(ctx.user, resolvePath(ctx, name), file.content)
        return { code: 0, stdout: '' }
      }
      return { code: 0, stdout: file.content }
    },
  },
  {
    name: 'ssh',
    group: 'site',
    summary: 'log in to this machine',
    usage: 'ssh [-i key] [user@]host [command]',
    manual:
      'The only host is this machine. With -i, the key must be a private key whose mode hides it from everyone else (0600), the way ssh(1) insists. Without a key, it asks for the account password.',
    async run(ctx, args) {
      let identity: string | null = null
      const rest: string[] = []
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? ''
        if (arg === '-i') {
          identity = args[++i] ?? ''
          if (!identity) throw new FsError('EINVAL', 'ssh: option -i requires a key file')
          continue
        }
        if (arg === '-p') {
          i += 1
          continue
        }
        if (arg === '-o') {
          i += 1
          continue
        }
        if (arg.startsWith('-')) throw new FsError('EINVAL', `ssh: unknown option -- ${arg}`)
        rest.push(arg)
      }
      const destination = rest.shift() ?? ''
      if (!destination) throw new FsError('EINVAL', 'usage: ssh [-i key] [user@]host [command]')
      const at = destination.lastIndexOf('@')
      const name = at >= 0 ? destination.slice(0, at) : ctx.user.name
      const host = at >= 0 ? destination.slice(at + 1) : destination
      if (![LOOPBACK, 'localhost', 'home', ctx.env.HOSTNAME].includes(host)) {
        return { code: 255, stderr: `ssh: Could not resolve hostname ${host}: Name or service not known\n` }
      }

      const target = lookupUser(ctx.rt.fs, name)
      if (!target) return { code: 255, stderr: `${name}@${host}: Permission denied (publickey,password).\n` }

      if (identity !== null) {
        const key = readKey(ctx, identity)
        if (!key.ok) return { code: 255, stderr: key.error }
      } else if (!hasCap(ctx.user, 'CAP_SETUID')) {
        const password = await ctx.host.askSecret(`${name}@${host}'s password: `)
        if (password === null) return { code: 130 }
        if (!verifyPassword(ctx.rt.fs, name, password)) {
          return { code: 255, stderr: `Permission denied, please try again.\n` }
        }
      }

      const command = rest.join(' ')
      if (command) return runAs(ctx, target, command)
      become(ctx, target)
      return {
        code: 0,
        stdout: `Welcome to Home Linux 6.1-home (GNU/Linux 6.1-home x86_64)\n\nLast login: ${new Date().toLocaleString('en-GB', { hour12: false })} from ${LOOPBACK}\n`,
      }
    },
  },
]

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url)
  return match?.[1] ?? url
}

/** Accept only the one address the local HTTP server listens on. */
function parseLocalUrl(url: string): string | null {
  const match = new RegExp(`^http://(${LOOPBACK}|localhost):${HTTP}(/[^?#]*)?`, 'i').exec(url)
  if (!match) return null
  let path = match[2] ?? '/'
  try {
    path = decodeURIComponent(path)
  } catch {
    /* a broken escape is still a path */
  }
  if (!path.startsWith('/')) path = `/${path}`
  try {
    return normalizeVirtual(path)
  } catch {
    return null
  }
}

function normalizeVirtual(path: string): string {
  return normalize(path)
}

function directoryListing(ctx: ShellCtx, path: string, names: string[]): string {
  const shown = path.endsWith('/') ? path : `${path}/`
  const rows = names.map((name) => {
    const child = `${path === '/' ? '' : path}/${name}`
    let suffix = ''
    try {
      if (ctx.rt.fs.stat(ROOT, child).type === 'dir') suffix = '/'
    } catch {
      suffix = ''
    }
    return `<a href="${name}${suffix}">${name}${suffix}</a>`
  })
  return [
    '<!doctype html>',
    '<html><head><title>Index of ' + shown + '</title></head>',
    '<body><h1>Index of ' + shown + '</h1><pre>',
    '<a href="../">../</a>',
    ...rows,
    '</pre><hr><address>Home Linux httpd</address></body></html>',
    '',
  ].join('\n')
}

function readKey(ctx: ShellCtx, input: string): { ok: true } | { ok: false; error: string } {
  const path = resolvePath(ctx, input)
  let node
  try {
    node = ctx.rt.fs.read(ctx.user, path)
  } catch {
    return { ok: false, error: `Warning: Identity file ${input} not accessible: No such file or directory.\n` }
  }
  if (node.encoding !== 'utf8') return { ok: false, error: `Warning: Identity file ${input} is not a text key.\n` }
  if ((node.mode & 0o077) !== 0) {
    return {
      ok: false,
      error: [
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
        '@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @',
        '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
        `Permissions 0${(node.mode & 0o777).toString(8)} for '${input}' are too open.`,
        'It is required that your private key files are NOT accessible by others.',
        `This private key will be ignored.`,
        'Load key "' + input + '": bad permissions',
        `${ctx.user.name}@${LOOPBACK}: Permission denied (publickey).`,
        '',
      ].join('\n'),
    }
  }
  if (!node.content.includes('BEGIN OPENSSH PRIVATE KEY')) {
    return { ok: false, error: `Load key "${input}": invalid format\nroot@${LOOPBACK}: Permission denied (publickey).\n` }
  }
  return { ok: true }
}

async function runAs(ctx: ShellCtx, user: User, line: string): Promise<CommandResult> {
  const previous = ctx.user
  const previousReal = ctx.realUser
  const env = { ...ctx.env }
  become(ctx, user)
  try {
    if (!ctx.reexec) return { code: 1, stderr: 'ssh: the shell cannot run a command here\n' }
    return await ctx.reexec(line)
  } finally {
    ctx.user = previous
    ctx.realUser = previousReal
    ctx.env = env
  }
}

function become(ctx: ShellCtx, user: User) {
  ctx.user = user
  ctx.realUser = user
  ctx.env.USER = user.name
  ctx.env.LOGNAME = user.name
  ctx.env.HOME = user.home
}
