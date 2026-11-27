import { formatCaps, hasCap } from '../../kernel/caps'
import { homeDir, lookupUser, parseGroup, readAccounts, setPassword, verifyPassword } from '../../kernel/accounts'
import type { MountRow } from '../../kernel/proc'
import { mountTable } from '../../app/system'
import type { User } from '../../kernel/types'
import { FsError } from '../../kernel/vfs'
import type { CommandResult, ShellCtx } from '../context'
import type { CommandSpec } from './types'
import { resolvePath } from './helpers'

export const systemCommands: CommandSpec[] = [
  {
    name: 'whoami',
    group: 'system',
    summary: 'print the user name',
    usage: 'whoami',
    manual: 'Print the user of this pane.',
    run: (ctx) => ({ code: 0, stdout: `${ctx.user.name}\n` }),
  },
  {
    name: 'id',
    group: 'system',
    summary: 'print user and group ids',
    usage: 'id [user]',
    manual: 'Print the uid, the primary gid and every group of this pane, the way id(1) does.',
    run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const user = args[0] ? lookupUser(ctx.rt.fs, args[0] ?? '') : ctx.user
      if (!user) return { code: 1, stderr: `id: '${args[0]}': no such user\n` }
      const { groups } = readAccounts(ctx.rt.fs)
      const rows = user.groups.map((name) => {
        const gid = groups.find((group) => group.name === name)?.gid ?? user.gid
        return `${gid}(${name})`
      })
      return {
        code: 0,
        stdout: `uid=${user.uid}(${user.name}) gid=${user.gid}(${user.groups[0] ?? user.name}) groups=${rows.join(',')}\n`,
      }
    },
  },
  {
    name: 'uname',
    group: 'system',
    summary: 'print system name',
    usage: 'uname [-a]',
    manual: 'This machine is Home Linux.',
    run(ctx, args) {
      if (args.some((arg) => arg !== '-a' && arg !== '--all')) throw new FsError('EINVAL', 'invalid option')
      if (args.length) return { code: 0, stdout: `Linux ${ctx.env.HOSTNAME ?? 'home'} 6.1-home #1 SMP Home\n` }
      return { code: 0, stdout: 'Linux\n' }
    },
  },
  {
    name: 'hostname',
    group: 'system',
    summary: 'print hostname',
    usage: 'hostname',
    manual: 'The name comes from the environment, defaulting to site.hostname.',
    run: (ctx) => ({ code: 0, stdout: `${ctx.env.HOSTNAME ?? ''}\n` }),
  },
  {
    name: 'date',
    group: 'system',
    summary: 'print the date',
    usage: 'date',
    manual: 'Print the local time.',
    run: () => ({ code: 0, stdout: `${new Date().toLocaleString('en-GB', { hour12: false })}\n` }),
  },
  {
    name: 'clear',
    group: 'system',
    summary: 'clear the pane',
    usage: 'clear',
    manual: 'Clear this pane. reset is an alias.',
    run: () => ({ code: 0, clear: true }),
  },
  {
    name: 'history',
    group: 'system',
    summary: 'command history',
    usage: 'history [-c]',
    manual: '-c clears this pane. Up and Down walk the list.',
    run(ctx, args) {
      if (args[0] === '-c' && args.length === 1) {
        ctx.history.length = 0
        return { code: 0 }
      }
      if (args.length) throw new FsError('EINVAL', 'invalid option')
      const text = ctx.history.map((line, index) => `${String(index + 1).padStart(4, ' ')}  ${line}`).join('\n')
      return { code: 0, stdout: text ? `${text}\n` : '' }
    },
  },
  {
    name: 'env',
    group: 'system',
    summary: 'print the environment',
    usage: 'env',
    manual: "Print this pane's environment.",
    run: (ctx) => ({ code: 0, stdout: formatEnv(ctx.env) }),
  },
  {
    name: 'export',
    group: 'system',
    summary: 'set environment variables',
    usage: 'export [NAME=value...]',
    manual: 'With no argument, same as env.',
    run(ctx, args) {
      if (!args.length) return { code: 0, stdout: formatEnv(ctx.env) }
      for (const arg of args) {
        const index = arg.indexOf('=')
        if (index <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg.slice(0, index))) {
          throw new FsError('EINVAL', `invalid identifier ${arg}`)
        }
        ctx.env[arg.slice(0, index)] = arg.slice(index + 1)
      }
      return { code: 0 }
    },
  },
  {
    name: 'alias',
    group: 'system',
    summary: 'define aliases',
    usage: "alias [name=value...]",
    manual:
      "An alias is text replaced in place before parsing, so it may contain a pipe: alias p='ls -l | wc -l'. It replaces only the first word, so it works only at the start of a command, and it takes no arguments. Use a function when you need $1. A name that a function already owns is refused; run unfunction first.",
    run(ctx, args) {
      if (!args.length) {
        const lines = Object.keys(ctx.aliases)
          .sort()
          .map((name) => `alias ${name}='${ctx.aliases[name] ?? ''}'`)
        return { code: 0, stdout: lines.length ? `${lines.join('\n')}\n` : '' }
      }
      for (const arg of args) {
        const index = arg.indexOf('=')
        if (index <= 0) {
          const value = ctx.aliases[arg]
          if (value === undefined) throw new FsError('EINVAL', `${arg}: not found`)
          return { code: 0, stdout: `alias ${arg}='${value}'\n` }
        }
        const name = arg.slice(0, index)
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new FsError('EINVAL', `invalid alias name ${name}`)
        if (name in ctx.functions) throw new FsError('EINVAL', `${name}: a function has that name; run unfunction first`)
        ctx.aliases[name] = arg.slice(index + 1)
      }
      return { code: 0 }
    },
  },
  {
    name: 'unalias',
    group: 'system',
    summary: 'remove aliases',
    usage: 'unalias name...',
    manual: 'Remove aliases from this pane.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      for (const name of args) {
        if (!(name in ctx.aliases)) throw new FsError('EINVAL', `${name}: not found`)
        delete ctx.aliases[name]
      }
      return { code: 0 }
    },
  },
  {
    name: 'functions',
    group: 'system',
    summary: 'list shell functions',
    usage: 'functions [name...]',
    manual:
      'Print functions defined in this pane, or just the names given. They are not saved: a refresh brings back only the built-in command table. A function body is one line, may not define another function, and may not use a builtin command name.',
    run(ctx, args) {
      const names = args.length ? args : Object.keys(ctx.functions).sort()
      if (args.length) {
        for (const name of names) {
          if (!(name in ctx.functions)) return { code: 1, stderr: `functions: ${name}: not found\n` }
        }
      }
      const lines = names.map((name) => `${name}() { ${ctx.functions[name] ?? ''}; }`)
      return { code: 0, stdout: lines.length ? `${lines.join('\n')}\n` : '' }
    },
  },
  {
    name: 'unfunction',
    group: 'system',
    summary: 'remove shell functions',
    usage: 'unfunction name...',
    manual: 'Remove functions from this pane. unfunction without a name is refused, so a typo cannot clear every function.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      for (const name of args) {
        if (!(name in ctx.functions)) throw new FsError('EINVAL', `${name}: not found`)
        delete ctx.functions[name]
      }
      return { code: 0 }
    },
  },
  {
    name: 'true',
    group: 'system',
    summary: 'exit status 0',
    usage: 'true',
    manual: 'Do nothing and succeed.',
    run: () => ({ code: 0 }),
  },
  {
    name: 'false',
    group: 'system',
    summary: 'exit status 1',
    usage: 'false',
    manual: 'Do nothing and fail.',
    run: () => ({ code: 1 }),
  },
  {
    name: 'seq',
    group: 'system',
    summary: 'print a number sequence',
    usage: 'seq [first [step]] last',
    manual: 'For example seq 1 5, or seq 1 2 10.',
    run(_ctx, args) {
      const nums = args.map(Number)
      if (!nums.length || nums.some((value) => !Number.isFinite(value))) throw new FsError('EINVAL', 'invalid number')
      let start = 1
      let step = 1
      let end = 1
      if (nums.length === 1) end = nums[0] ?? 1
      else if (nums.length === 2) {
        start = nums[0] ?? 1
        end = nums[1] ?? 1
      } else if (nums.length === 3) {
        start = nums[0] ?? 1
        step = nums[1] ?? 1
        end = nums[2] ?? 1
      } else throw new FsError('EINVAL', 'too many arguments')
      if (step === 0) throw new FsError('EINVAL', 'step is zero')
      const out: string[] = []
      if (step > 0) {
        for (let value = start; value <= end + 1e-9; value += step) out.push(trimNum(value))
      } else {
        for (let value = start; value >= end - 1e-9; value += step) out.push(trimNum(value))
      }
      if (out.length > 10000) throw new FsError('EINVAL', 'range too large')
      return { code: 0, stdout: out.length ? `${out.join('\n')}\n` : '' }
    },
  },
  {
    name: 'basename',
    group: 'system',
    summary: 'strip the directory',
    usage: 'basename path [suffix]',
    manual: 'Print the last path segment, optionally without a suffix.',
    run(_ctx, args) {
      const input = args[0]
      if (!input) throw new FsError('EINVAL', 'missing operand')
      let name = input.replace(/\/+$/, '')
      const slash = name.lastIndexOf('/')
      name = slash < 0 ? name || '/' : name.slice(slash + 1) || '/'
      const suffix = args[1]
      if (suffix && suffix !== name && name.endsWith(suffix)) name = name.slice(0, -suffix.length)
      return { code: 0, stdout: `${name}\n` }
    },
  },
  {
    name: 'dirname',
    group: 'system',
    summary: 'strip the last segment',
    usage: 'dirname path',
    manual: 'Print the directory portion of a path.',
    run(_ctx, args) {
      const input = args[0]
      if (!input) throw new FsError('EINVAL', 'missing operand')
      const trimmed = input.replace(/\/+$/, '')
      const slash = trimmed.lastIndexOf('/')
      if (slash < 0) return { code: 0, stdout: '.\n' }
      if (slash === 0) return { code: 0, stdout: '/\n' }
      return { code: 0, stdout: `${trimmed.slice(0, slash)}\n` }
    },
  },
  {
    name: 'du',
    group: 'system',
    summary: 'disk usage',
    usage: 'du [path...]',
    manual: 'Sum bytes. Directories include their files.',
    run(ctx, args) {
      const targets = args.length ? args : ['.']
      const lines = targets.map((target) => `${String(du(ctx, resolvePath(ctx, target))).padStart(8, ' ')} ${target}`)
      return { code: 0, stdout: `${lines.join('\n')}\n` }
    },
  },
  {
    name: 'df',
    group: 'system',
    summary: 'show mounted filesystems and their use',
    usage: 'df [-h]',
    manual: 'Read `/proc/mounts` and report each mount. The overlay is the image plus this browser; /tmp is a tmpfs; /proc stores nothing.',
    run(ctx, args) {
      for (const arg of args) if (arg !== '-h' && arg !== '--human-readable') throw new FsError('EINVAL', `invalid option -- ${arg}`)
      const mounts = mountsOf(ctx)
      const usage = ctx.rt.fs.usage()
      const rows = ['Filesystem      Type     Size  Used  Mounted on']
      for (const row of mounts) {
        // Only the writable overlay has bytes to count; the rest are generated.
        const used = row.type === 'overlay' ? human(usage.bytes) : '0'
        const size = row.type === 'overlay' ? '1.0G' : row.type === 'tmpfs' ? '64M' : '0'
        rows.push(`${row.device.padEnd(15)} ${row.type.padEnd(8)} ${size.padStart(4)}  ${used.padStart(4)}  ${row.dir}`)
      }
      if (mounts.some((row) => row.type === 'overlay')) {
        rows.push('', `${usage.files} files in the browser overlay`)
      }
      return { code: 0, stdout: `${rows.join('\n')}\n` }
    },
  },
  {
    name: 'mount',
    group: 'system',
    summary: 'list mounted filesystems',
    usage: 'mount',
    manual: 'Print `/proc/mounts`, the table that describes the three kinds of path this machine has.',
    run(ctx) {
      const rows = readProc(ctx, '/proc/mounts')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [device, dir, type, options] = line.split(/\s+/)
          return `${device} on ${dir} type ${type} (${options})`
        })
      return { code: 0, stdout: `${rows.join('\n')}\n` }
    },
  },
  {
    name: 'free',
    group: 'system',
    summary: 'show memory use',
    usage: 'free [-h]',
    manual: 'Read `/proc/meminfo`. The memory is the page the terminal runs on.',
    run(ctx, args) {
      for (const arg of args) if (arg !== '-h') throw new FsError('EINVAL', `invalid option -- ${arg}`)
      const info = readProc(ctx, '/proc/meminfo')
      const value = (key: string) => Number(/(\d+)/.exec(info.split('\n').find((line) => line.startsWith(key)) ?? '')?.[1] ?? 0)
      const total = value('MemTotal')
      const free = value('MemFree')
      const rows = [
        '              total    used    free',
        `Mem:      ${kb(total).padStart(8)}${kb(total - free).padStart(8)}${kb(free).padStart(8)}`,
        `Swap:     ${'0B'.padStart(8)}${'0B'.padStart(8)}${'0B'.padStart(8)}`,
      ]
      return { code: 0, stdout: `${rows.join('\n')}\n` }
    },
  },
  {
    name: 'umask',
    group: 'system',
    summary: 'set the file creation mask',
    usage: 'umask [octal]',
    manual:
      'With no argument, print the mask. With an octal value, set it: new files are 0666 and new directories 0777, minus the mask. The default is 022.',
    run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const current = ctx.rt.fs.mask()
      const arg = (args[0] ?? '').trim()
      if (!arg) return { code: 0, stdout: `0${current.toString(8).padStart(3, '0')}\n` }
      if (!/^[0-7]{1,3}$/.test(arg)) throw new FsError('EINVAL', `invalid mask: ${arg}`)
      ctx.rt.fs.setUmask(Number.parseInt(arg, 8))
      return { code: 0 }
    },
  },
  {
    name: 'capsh',
    group: 'system',
    summary: 'print the capabilities of an account',
    usage: 'capsh [--print] [user]',
    manual:
      'Print the capability set this pane carries. uid 0 holds all of them; any other account holds only what /etc/caps grants it. This is the mechanism that replaced "root may do anything".',
    run(ctx, args) {
      const rest = args.filter((arg) => arg !== '--print' && arg !== '--decode')
      if (rest.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const user = rest[0] ? lookupUser(ctx.rt.fs, rest[0]) : ctx.user
      if (!user) return { code: 1, stderr: `capsh: ${rest[0]}: no such user\n` }
      const body = formatCaps(user)
      return {
        code: 0,
        stdout: `Current: uid=${user.uid}(${user.name})\n${body}\n`,
      }
    },
  },
  {
    name: 'ps',
    group: 'system',
    summary: 'list panes',
    usage: 'ps',
    manual: 'List shells open in this browser, not operating-system processes.',
    run(ctx) {
      const rows = ctx.rt.procs()
      if (!rows.length) return { code: 0, stdout: `  PID USER  CWD\n    1 ${ctx.user.name}  ${ctx.cwd}\n` }
      const lines = ['  PID USER  WIN  CWD', ...rows.map((row) => `${String(row.pid).padStart(5, ' ')} ${row.user}  ${row.win}${row.active ? '*' : ' '}  ${row.cwd}`)]
      return { code: 0, stdout: `${lines.join('\n')}\n` }
    },
  },
  {
    name: 'su',
    group: 'system',
    summary: 'switch user',
    usage: 'su [user]',
    manual:
      'Ask for the target account\'s password, the way su(1) does. A process holding CAP_SETUID may become any account without one. Only this pane changes.',
    async run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const name = args[0] || 'root'
      const target = lookupUser(ctx.rt.fs, name)
      if (!target) return { code: 1, stderr: `su: user ${name} does not exist\n` }
      if (!hasCap(ctx.user, 'CAP_SETUID')) {
        const password = await ctx.host.askSecret('Password: ')
        if (password === null) return { code: 130 }
        if (!verifyPassword(ctx.rt.fs, name, password)) return { code: 1, stderr: 'su: Authentication failure\n' }
      }
      become(ctx, target)
      return { code: 0 }
    },
  },
  {
    name: 'sudo',
    group: 'system',
    summary: 'run a command as another user',
    usage: 'sudo [-u user] command [args...]',
    manual:
      'Only a member of the wheel group may use sudo, and the command asks for that user\'s own password. root needs no password. The write rules do not change: uid 0 still ignores the mode bits.',
    async run(ctx, args) {
      let target = 'root'
      const rest: string[] = []
      const me = ctx.realUser
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? ''
        if (arg === '-u' || arg === '--user') {
          target = args[++i] ?? ''
          continue
        }
        if (arg === '-l' || arg === '--list') {
          const allowed = canSudo(me)
          return {
            code: allowed ? 0 : 1,
            stdout: allowed ? `User ${me.name} may run any command as any user.\n` : '',
            stderr: allowed ? '' : `${me.name} is not in the sudoers file.\n`,
          }
        }
        if (arg === '--') {
          rest.push(...args.slice(i + 1))
          break
        }
        if (arg.startsWith('-') && arg !== '-') return { code: 1, stderr: `sudo: invalid option -- ${arg}\n` }
        rest.push(arg)
      }
      const line = rest.join(' ')
      if (!line) return { code: 1, stderr: 'usage: sudo [-u user] command [args...]\n' }
      if (!hasCap(me, 'CAP_SETUID')) {
        if (!canSudo(me)) {
          return { code: 1, stderr: `${me.name} is not in the sudoers file. This incident will be reported.\n` }
        }
        const password = await ctx.host.askSecret(`[sudo] password for ${me.name}: `)
        if (password === null) return { code: 130 }
        if (!verifyPassword(ctx.rt.fs, me.name, password)) {
          return { code: 1, stderr: 'sudo: 1 incorrect password attempt\n' }
        }
      }
      const user = lookupUser(ctx.rt.fs, target)
      if (!user) return { code: 1, stderr: `sudo: unknown user: ${target}\n` }
      return runAs(ctx, user, line)
    },
  },
  {
    name: 'passwd',
    group: 'system',
    summary: 'change a password',
    usage: 'passwd [user]',
    manual:
      'Without an argument, change your own password. root may name any account. The hash is written to /etc/shadow in this browser.',
    async     run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      // setuid binaries change the effective uid. `passwd` still has to know who
      // really typed the line, the way getuid(2) does.
      const me = ctx.realUser
      const name = args[0] || me.name
      const maySwitch = hasCap(me, 'CAP_SETUID')
      if (name !== me.name && !maySwitch) {
        return { code: 1, stderr: 'passwd: You may not view or modify password information for other users.\n' }
      }
      if (!lookupUser(ctx.rt.fs, name)) return { code: 1, stderr: `passwd: user '${name}' does not exist\n` }
      if (name === me.name && !maySwitch) {
        const current = await ctx.host.askSecret('Current password: ')
        if (current === null) return { code: 130 }
        if (!verifyPassword(ctx.rt.fs, name, current)) return { code: 1, stderr: 'passwd: Authentication token manipulation error\n' }
      }
      const first = await ctx.host.askSecret('New password: ')
      if (first === null) return { code: 130 }
      const second = await ctx.host.askSecret('Retype new password: ')
      if (second === null) return { code: 130 }
      if (!first || first !== second) return { code: 1, stderr: 'passwd: Have exhausted maximum number of retries for service\n' }
      try {
        // The write is made as the effective user: 0600 on /etc/shadow answers
        // unless a setuid /bin/passwd raised it to root first.
        setPassword(ctx.rt.fs, ctx.user, name, first)
      } catch (err) {
        return { code: 1, stderr: `passwd: ${err instanceof Error ? err.message : String(err)}\n` }
      }
      return { code: 0, stdout: 'passwd: password updated successfully\n' }
    },
  },
  {
    name: 'restore',
    group: 'system',
    summary: 'drop this browser\'s copy of a file',
    usage: 'restore path...',
    manual:
      'Delete the local overlay entry, including a tombstone, so the file shipped with the build shows through again. This is the way back from a local rm of a published file.',
    run(ctx, args) {
      if (!args.length) throw new FsError('EINVAL', 'missing operand')
      for (const input of args) ctx.rt.fs.restorePath(ctx.user, resolvePath(ctx, input))
      return { code: 0 }
    },
  },
  {
    name: 'logout',
    group: 'system',
    summary: 'log out',
    usage: 'logout',
    manual: 'Close every pane and return to the login prompt.',
    run: () => ({ code: 0, logout: true }),
  },
  {
    name: 'exit',
    group: 'system',
    summary: 'close this pane',
    usage: 'exit',
    manual: 'The last pane logs out. Ctrl-D on an empty line does the same.',
    run: () => ({ code: 0, exitPane: true }),
  },
  {
    name: 'login',
    group: 'system',
    summary: 'already logged in',
    usage: 'login',
    manual: 'Login happens before the shell. Switch with su, or leave with logout.',
    run: () => ({ code: 1, stderr: 'login: already logged in; use su or logout\n' }),
  },
]

/** The sudoers rule in this build: membership of wheel, checked by name. */
function canSudo(user: User): boolean {
  return user.uid === 0 || user.groups.includes('wheel')
}

async function runAs(ctx: ShellCtx, user: User, line: string): Promise<CommandResult> {
  const previous = ctx.user
  const previousReal = ctx.realUser
  const env = { ...ctx.env }
  become(ctx, user)
  try {
    if (!ctx.reexec) return { code: 1, stderr: 'sudo: the shell cannot run a command here\n' }
    return await ctx.reexec(line)
  } finally {
    ctx.user = previous
    ctx.realUser = previousReal
    ctx.env = env
  }
}

/** Read a `/proc` file; the synthetic tree answers without touching the overlay. */
function readProc(ctx: ShellCtx, path: string): string {
  const node = ctx.rt.fs.read(ctx.user, path)
  return node.encoding === 'utf8' ? node.content : ''
}

/** The mount table, preferring `/proc/mounts` so the two never disagree. */
function mountsOf(ctx: ShellCtx): MountRow[] {
  try {
    const rows = readProc(ctx, '/proc/mounts')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [device, dir, type, ...rest] = line.split(/\s+/)
        return { device: device ?? '', dir: dir ?? '', type: type ?? '', options: rest.slice(0, -2).join(',') }
      })
    if (rows.length) return rows
  } catch {
    /* a filesystem without /proc still has a table */
  }
  return mountTable()
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)}M`
}

function formatEnv(env: Record<string, string>): string {  return `${Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key] ?? ''}`)
    .join('\n')}\n`
}

function trimNum(value: number): string {
  return String(Math.round(value * 1e9) / 1e9)
}

function du(ctx: ShellCtx, path: string): number {
  let stat
  try {
    stat = ctx.rt.fs.stat(ctx.user, path)
  } catch {
    return 0
  }
  if (stat.type === 'file') return stat.size
  let names: string[]
  try {
    names = ctx.rt.fs.readdir(ctx.user, path)
  } catch {
    return 0
  }
  return names.reduce((sum, name) => sum + du(ctx, `${path === '/' ? '' : path}/${name}`), 0)
}

function become(ctx: ShellCtx, user: User) {
  ctx.user = user
  ctx.realUser = user
  ctx.env.USER = user.name
  ctx.env.LOGNAME = user.name
  ctx.env.HOME = homeDir(user)
}

/** Kept for tests that read a node's group through the shell. */
export function groupFile(ctx: ShellCtx): ReturnType<typeof parseGroup> {
  const node = ctx.rt.fs.read(ctx.user, '/etc/group')
  return parseGroup(node.content)
}
