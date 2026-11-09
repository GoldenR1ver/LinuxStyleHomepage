import { basename } from '../../kernel/path'
import type { RemoteChange } from '../../kernel/types'
import { FsError } from '../../kernel/vfs'
import type { PaneDir } from '../../mux/host'
import type { CommandSpec } from './types'
import { mailCommand } from './mail'
import { resolvePath } from './helpers'

export const siteCommands: CommandSpec[] = [
  {
    name: 'less',
    group: 'site',
    summary: 'page through text',
    usage: 'less [file...]',
    manual: 'Space pages down, b pages up, j/k or arrows move, g/G jump, q quits. Also works at the end of a pipe.',
    readsStdin: (args) => args.filter((arg) => !arg.startsWith('-')).length === 0,
    run(ctx, args, stdin) {
      const files = args.filter((arg) => !arg.startsWith('-'))
      if (args.some((arg) => arg.startsWith('-') && arg !== '-')) throw new FsError('EINVAL', 'unsupported option')
      let text = stdin
      if (files.length) {
        text = files
          .map((file) => {
            const node = ctx.rt.fs.read(ctx.user, resolvePath(ctx, file))
            if (node.encoding !== 'utf8') throw new FsError('EINVAL', `${file}: binary file, use wget`)
            return files.length > 1 ? `==> ${file} <==\n${node.content}` : node.content
          })
          .join('\n')
      }
      if (text && !text.endsWith('\n')) text += '\n'
      return { code: 0, pager: text }
    },
  },
  {
    name: 'wget',
    group: 'site',
    summary: 'download a site file',
    usage: 'wget [-O name] path...',
    manual: 'Download a file from this site to your computer. External URLs are disabled. Use this for PDF and other binary files.',
    run(ctx, args) {
      let output = ''
      const files: string[] = []
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? ''
        if (arg === '-O') output = args[++i] ?? ''
        else if (arg.startsWith('-')) throw new FsError('EINVAL', `invalid option -- ${arg}`)
        else files.push(arg)
      }
      if (!files.length) throw new FsError('EINVAL', 'missing url')
      if (output && files.length !== 1) throw new FsError('EINVAL', '-O requires one file')
      const downloads = []
      let stderr = ''
      for (const file of files) {
        if (/^[a-z]+:\/\//i.test(file)) {
          stderr += `wget: external urls are disabled: ${file}\n`
          continue
        }
        const path = resolvePath(ctx, file)
        const node = ctx.rt.fs.read(ctx.user, path)
        const filename = output || basename(path)
        if (node.encoding === 'binary') {
          if (!node.url) {
            stderr += `wget: ${file}: no data\n`
            continue
          }
          downloads.push({ filename, href: node.url, mime: mimeOf(filename) })
        } else {
          downloads.push({ filename, text: node.content, mime: mimeOf(filename) })
        }
      }
      return { code: stderr ? 1 : 0, stderr, downloads }
    },
  },
  {
    name: 'journal',
    group: 'site',
    summary: 'show the local log',
    usage: 'journal [-m] [-n N]',
    manual: 'Print logins and commands from this browser. -m lists root edits. Entries older than site.journalDays are dropped. The log stays in this browser unless a root edit was committed to GitHub.',
    run(ctx, args) {
      let count = 30
      let mutations = false
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '-m') mutations = true
        else if (arg === '-n') count = positive(args[++i])
        else throw new FsError('EINVAL', `invalid option -- ${arg ?? ''}`)
      }
      if (mutations) {
        const items = ctx.rt.journal.mutations(true).slice(0, count)
        if (!items.length) return { code: 0, stdout: 'no edits recorded.\n' }
        const lines = items.map((item) => `${item.id}  ${stamp(item.ts)}  ${item.reverted ? 'reverted  ' : ''}${item.command}`)
        return { code: 0, stdout: `${lines.join('\n')}\n` }
      }
      const events = ctx.rt.journal.events().slice(0, count)
      if (!events.length) return { code: 0, stdout: 'no activity recorded.\n' }
      const lines = events.map((event) => `${stamp(event.ts)}  ${event.user}  ${event.action}  ${event.detail}`)
      return { code: 0, stdout: `${lines.join('\n')}\n` }
    },
  },
  {
    name: 'rollback',
    group: 'site',
    summary: 'undo root edits',
    usage: 'rollback [id|--last]',
    manual: 'With no argument, list edits that can still be undone. An id restores the state from before that command, including newer edits. Publishing the restore needs a GitHub token.',
    run(ctx, args) {
      if (ctx.user.role !== 'root') return { code: 1, stderr: 'rollback: Permission denied\n' }
      if (args.length > 1) throw new FsError('EINVAL', 'too many arguments')
      const items = ctx.rt.journal.mutations()
      if (!args.length) {
        if (!items.length) return { code: 0, stdout: 'nothing to roll back.\n' }
        const lines = items.map((item) => `${item.id}  ${stamp(item.ts)}  ${item.command}`)
        return { code: 0, stdout: `${lines.join('\n')}\n` }
      }
      const id = args[0] === '--last' ? items[0]?.id : args[0]
      if (!id) return { code: 1, stderr: 'rollback: not found\n' }
      const targets = ctx.rt.journal.rollbackSet(id)
      if (!targets.length) return { code: 1, stderr: 'rollback: not found\n' }
      const changes = new Map<string, RemoteChange>()
      for (const target of targets) {
        for (const step of [...target.steps].reverse()) {
          ctx.rt.fs.restoreStep(step)
          if (step.inverseRemote) changes.set(step.inverseRemote.path, { ...step.inverseRemote })
        }
      }
      for (const change of changes.values()) ctx.rt.fs.queueRemote(change)
      ctx.revertIds = targets.map((target) => target.id)
      return { code: 0, stdout: `restored to before ${id}, undid ${targets.length} edit(s).\n` }
    },
  },
  {
    name: 'passwd',
    group: 'site',
    summary: 'change the root password',
    usage: 'passwd',
    manual: 'Changes the password remembered in this browser. site.rootPassword still applies on other devices until you edit that file.',
    async run(ctx) {
      if (ctx.user.role !== 'root') return { code: 1, stderr: 'passwd: Permission denied\n' }
      const first = await ctx.host.askSecret('New password: ')
      if (first === null) return { code: 130 }
      const second = await ctx.host.askSecret('Retype password: ')
      if (second === null) return { code: 130 }
      if (!first || first !== second) return { code: 1, stderr: 'passwd: password unchanged\n' }
      ctx.rt.vault.set(first)
      return { code: 0, stdout: 'root password updated in this browser. Other devices still use site.ts.\n' }
    },
  },
  {
    name: 'github',
    group: 'site',
    summary: 'GitHub credentials',
    usage: 'github status|auth|logout',
    manual: 'github auth stores a token in this browser. The token needs Contents read and write. It is not echoed, and it is not written to the repository.',
    async run(ctx, args) {
      const sub = args[0] || 'status'
      if (sub === 'status' && args.length === 1) {
        const github = ctx.rt.site.github
        return {
          code: 0,
          stdout: [
            `owner: ${github.owner || '(empty)'}`,
            `repo: ${github.repo || '(empty)'}`,
            `branch: ${github.branch}`,
            `content: ${github.contentRoot}`,
            `token: ${ctx.rt.tokens.get() ? 'yes' : 'no'}`,
            `remote: ${ctx.rt.remote.configured ? 'configured' : 'off'} / ${ctx.rt.remote.authenticated ? 'authenticated' : 'anonymous'}`,
            '',
          ].join('\n'),
        }
      }
      if (sub === 'auth' && args.length === 1) {
        const token = await ctx.host.askSecret('GitHub token: ')
        if (token === null) return { code: 130 }
        if (!token.trim()) return { code: 1, stderr: 'github: empty token\n' }
        ctx.rt.tokens.set(token.trim())
        return { code: 0, stdout: 'token saved in this browser. It is not written to the repository.\n' }
      }
      if (sub === 'logout' && args.length === 1) {
        ctx.rt.tokens.clear()
        return { code: 0, stdout: 'token cleared\n' }
      }
      return { code: 1, stderr: 'github: usage: github status|auth|logout\n' }
    },
  },
  mailCommand,
  {
    name: 'tmux',
    group: 'site',
    summary: 'multiplex panes',
    usage: 'tmux <subcommand>',
    manual: 'Ctrl-b is the prefix. % splits left/right, " splits up/down, arrows move, x closes, c opens a window, n/p switch windows. Keys are also listed by help.',
    run(ctx, args) {
      const mux = ctx.rt.mux
      if (!mux) return { code: 1, stderr: 'tmux: not available\n' }
      const sub = args[0] || 'ls'
      if (sub === 'ls') return { code: 0, stdout: mux.listText() }
      if (sub === 'split-window' || sub === 'splitw') {
        mux.split(args.includes('-h') ? 'h' : 'v')
        return { code: 0 }
      }
      if (sub === 'select-pane') {
        const flag = args.find((arg) => arg === '-L' || arg === '-R' || arg === '-U' || arg === '-D')
        if (!flag) return { code: 1, stderr: 'tmux: usage: select-pane -L|-R|-U|-D\n' }
        mux.selectPane(flag.slice(1) as PaneDir)
        return { code: 0 }
      }
      if (sub === 'kill-pane') {
        const killed = mux.killPane()
        return { code: killed ? 0 : 1, stderr: killed ? '' : 'tmux: cannot kill the last pane\n' }
      }
      if (sub === 'new-window') {
        mux.newWindow()
        return { code: 0 }
      }
      if (sub === 'next-window') {
        mux.nextWindow(1)
        return { code: 0 }
      }
      if (sub === 'prev-window') {
        mux.nextWindow(-1)
        return { code: 0 }
      }
      if (sub === 'new' || sub === 'new-session') {
        const name = option(args, '-s')
        if (!name) return { code: 1, stderr: 'tmux: usage: tmux new -s name\n' }
        if (!mux.newSession(name)) return { code: 1, stderr: 'tmux: cannot create session\n' }
        return { code: 0 }
      }
      if (sub === 'switch' || sub === 'attach') {
        const name = option(args, '-t')
        if (!name || !mux.switchSession(name)) return { code: 1, stderr: 'tmux: session not found\n' }
        return { code: 0 }
      }
      if (sub === 'kill-session') {
        const name = option(args, '-t')
        if (!name || !mux.killSession(name)) return { code: 1, stderr: 'tmux: cannot kill session\n' }
        return { code: 0 }
      }
      return {
        code: 1,
        stderr: 'tmux: ls | split-window [-h] | select-pane -L|-R|-U|-D | kill-pane | new-window | next-window | prev-window | new -s name | switch -t name | kill-session -t name\n',
      }
    },
  },
]

function mimeOf(name: string): string {
  if (name.endsWith('.md')) return 'text/markdown;charset=utf-8'
  if (name.endsWith('.txt')) return 'text/plain;charset=utf-8'
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

function option(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? '' : ''
}

function positive(value: string | undefined): number {
  const number = Number(value)
  if (!value || !Number.isInteger(number) || number <= 0) throw new FsError('EINVAL', 'invalid count')
  return number
}

function stamp(ms: number): string {
  const date = new Date(ms)
  const p = (value: number) => String(value).padStart(2, '0')
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}
