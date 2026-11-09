import { homeDir } from '../../kernel/auth'
import { FsError } from '../../kernel/vfs'
import type { ShellCtx } from '../context'
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
    summary: 'print user id',
    usage: 'id',
    manual: 'root is 0. Guests are 1000. This is a label, not a credential.',
    run: (ctx) => {
      const id = ctx.user.role === 'root' ? 0 : 1000
      return { code: 0, stdout: `uid=${id}(${ctx.user.name}) gid=${id}(${ctx.user.name})\n` }
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
    manual: 'Print this pane\'s environment.',
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
    manual: "For example alias ll='ls -l'. An alias replaces only the first word and cannot contain a pipe.",
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
        ctx.aliases[arg.slice(0, index)] = arg.slice(index + 1)
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
    summary: 'where data lives',
    usage: 'df',
    manual: 'There is no disk. This reports the local overlay and whether GitHub is authenticated.',
    run(ctx) {
      const usage = ctx.rt.fs.usage()
      const remote = ctx.rt.remote.authenticated ? 'github authenticated' : ctx.rt.remote.configured ? 'github anonymous' : 'github off'
      return {
        code: 0,
        stdout: `browser overlay  ${usage.files} files  ${usage.bytes} bytes\n${remote}\n`,
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
    manual: 'su and su root ask for the root password. root can become any guest without a password. Only this pane changes.',
    async run(ctx, args) {
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const name = args[0] || 'root'
      if (name === 'root' || name.toLowerCase() === 'root') {
        const password = await ctx.host.askSecret('Password: ')
        if (password === null) return { code: 130 }
        if (password !== ctx.rt.vault.get()) return { code: 1, stderr: 'su: Authentication failure\n' }
        become(ctx, { name: 'root', role: 'root' })
        return { code: 0 }
      }
      if (ctx.user.role !== 'root') return { code: 1, stderr: 'su: Permission denied\n' }
      if (!/^[^\s/\\:]{1,32}$/.test(name) || name === '.' || name === '..') {
        return { code: 1, stderr: 'su: invalid user\n' }
      }
      const user = { name, role: 'guest' as const }
      const home = homeDir(user)
      if (!ctx.rt.fs.exists(user, home)) ctx.rt.fs.mkdir(user, home, { parents: true })
      become(ctx, user)
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

function formatEnv(env: Record<string, string>): string {
  return `${Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key] ?? ''}`)
    .join('\n')}\n`
}

function trimNum(value: number): string {
  return String(Math.round(value * 1e9) / 1e9)
}

function du(ctx: ShellCtx, path: string): number {
  const stat = ctx.rt.fs.stat(ctx.user, path)
  if (stat.type === 'file') return stat.size
  return ctx.rt.fs.readdir(ctx.user, path).reduce((sum, name) => sum + du(ctx, `${path === '/' ? '' : path}/${name}`), 0)
}

function become(ctx: ShellCtx, user: ShellCtx['user']) {
  ctx.user = user
  ctx.env.USER = user.name
  ctx.env.LOGNAME = user.name
  ctx.env.HOME = homeDir(user)
}
