import { padEndDisplay } from '../../kernel/text'
import type { CommandResult } from '../context'
import { fileCommands } from './fs'
import { netCommands } from './net'
import { siteCommands } from './site'
import { systemCommands } from './system'
import { textCommands } from './text'
import { viewCommands } from './view'
import type { CommandSpec } from './types'

/**
 * Command table.
 * Add a command by appending one entry in the matching group file.
 * help, man, and tab completion all read this table.
 */
const specs: CommandSpec[] = [...fileCommands, ...textCommands, ...systemCommands, ...netCommands, ...siteCommands, ...viewCommands].map(wrap)
for (const spec of metaCommands(specs)) specs.push(wrap(spec))

const map = new Map<string, CommandSpec>()
for (const spec of specs) {
  if (map.has(spec.name)) throw new Error(`duplicate command ${spec.name}`)
  map.set(spec.name, spec)
}

export function lookup(name: string): CommandSpec | undefined {
  return map.get(name)
}

export function commandNames(): string[] {
  return [...map.keys()].sort()
}

export function allCommands(): CommandSpec[] {
  return [...specs]
}

function wrap(spec: CommandSpec): CommandSpec {
  return {
    ...spec,
    run(ctx, args, stdin) {
      try {
        const result = spec.run(ctx, args, stdin)
        if (result instanceof Promise) return result.catch((err) => failed(spec.name, err))
        return result
      } catch (err) {
        return failed(spec.name, err)
      }
    },
  }
}

function failed(name: string, err: unknown): CommandResult {
  const message = err instanceof Error ? err.message : String(err)
  const text = message.endsWith('\n') ? message : `${message}\n`
  return { code: 1, stderr: text.startsWith(`${name}:`) ? text : `${name}: ${text}` }
}

const labels = [
  ['file', 'files'],
  ['text', 'text'],
  ['system', 'system'],
  ['site', 'site'],
] as const

const GUIDE = `Pages
  [1;33m/home/owner[0m                     about, projects, notes, resume
  cat about.txt                   
  vim about.txt                   
  md about.md                     open markdown file in browser
  pdf about.pdf                   open pdf file in browser
  wget about.pdf                  download, including pdf

Guestbook
  [1;33mcd /var/guestbook to write a note or add an attachment[0m
  vim your-name.txt                 write your note
  scp                               upload files from this computer
  cp /home/owner/a.txt b.txt        copy a page into your note
  mv old.txt new.txt                move or rename
  mail status                      show the staging area
  mail --user you@example.com       set the address the owner can reply to
  mail -m "subject"
  mail add .                       stage text files in this directory
  mail push                        needs an address, so nothing is anonymous
  mail reset                       unstage everything
  Text files are staged by mail add . Binary uploads stay in your browser; wget downloads them.
  echo "question" | mail add /home/owner/about.txt   comment on a page without attaching it
  The note stays in your browser. Mail push notifies the owner. It is not published.

Scratch
  ~                           /tmp/<you>, this browser only

Shell functions
  [1;33mname() { commands; }[0m         define, all on one line
  greet() { echo "hi $1"; }        $1..$9, $#, $@
  greet ada                        call it
  functions                        list this pane's functions
  unfunction greet                 remove one
  A function may call another at most 6 levels deep. It replaces no builtin,
  may not define another function, and is not saved across a refresh.

This terminal is equipped with [1;33mtmux and vim[0m.
Keys
  Up/Down                     history
  Tab                         complete
  Ctrl-L                      clear
  Ctrl-D                      close this pane
  Ctrl-C                      cancel the line

Ctrl-b, then
  %                           split left/right
  "                           split up/down
  arrows or hjkl              move
  Alt+arrows                  resize the pane
  x                           close pane
  c                           new window
  &                           close window
  n / p                       next / previous window
  0-9                         select window
  tmux list-windows           the same table from the shell

Accounts
  id                          your uid and groups
  su [user]                   switch user, asks the target password
  sudo -u root command        wheel only, asks your own password
  ssh -i key root@127.0.0.1   log in with a private key
  ip / ss                     addresses and listening sockets

man <command> prints a longer description.

`

function metaCommands(all: CommandSpec[]): CommandSpec[] {
  return [
    {
      name: 'help',
      group: 'site',
      summary: 'site guide and commands',
      usage: 'help [command]',
      manual:
        'Opens the guide in the pager: space or f pages down, b pages up, j/k move, g/G jump, q quits. A command name prints just that entry.',
      run(_ctx, args) {
        const name = args[0]
        if (name) {
          const spec = all.find((item) => item.name === name)
          if (!spec) return { code: 1, stderr: `help: ${name}: not found\n` }
          return { code: 0, stdout: `${spec.name} - ${spec.summary}\n  ${spec.usage}\n\n${spec.manual}\n` }
        }
        const intro = `\x1b[1mhome\x1b[0m  a site you read through a shell.
Files, notes, a guestbook, and a resume. Every path printed here is a link: a folder lists, a page opens.

\x1b[34mQuick Start
- Type 'index' to see the map again. Every path is clickable.
- Type 'ls' to see the files and folders in this path.
- Type 'cat about.txt' to read the introduction to this page.
- Type 'pdf me.pdf' to see my resume.
- Type 'cd /home/owner/works/projects' to see all my projects.
- Type 'help <command>' for one entry, 'man <command>' for the long form.\x1b[0m`
        const lines = [intro, '', GUIDE.trimEnd(), '', 'Commands', '']
        for (const [group, label] of labels) {
          lines.push(label)
          for (const spec of all.filter((item) => item.group === group)) {
            lines.push(`  ${padEndDisplay(spec.name, 12)}${spec.summary}`)
          }
          lines.push('')
        }
        // The first screen is the introduction; space opens the guide and the command list.
        return { code: 0, pager: `${lines.join('\n').trimEnd()}\n` }
      },
    },
    {
      name: 'man',
      group: 'site',
      summary: 'describe a command',
      usage: 'man command',
      manual: 'Print the usage and description of one command.',
      run(_ctx, args) {
        const spec = all.find((item) => item.name === args[0])
        if (!spec) return { code: 1, stderr: `man: no entry for ${args[0] ?? ''}\n` }
        return { code: 0, stdout: `${spec.name}\n\nSYNOPSIS\n  ${spec.usage}\n\n${spec.manual}\n` }
      },
    },
    {
      name: 'which',
      group: 'site',
      summary: 'locate a command',
      usage: 'which command',
      manual: 'Look up a name in the built-in command table, then in this pane\'s functions and aliases.',
      run(ctx, args) {
        const name = args[0]
        if (!name) return { code: 1, stderr: 'which: missing command\n' }
        if (all.some((item) => item.name === name)) return { code: 0, stdout: `${name}\n` }
        if (name in ctx.functions) return { code: 0, stdout: `${name} (function)\n` }
        if (name in ctx.aliases) return { code: 0, stdout: `${name} (alias)\n` }
        return { code: 1, stderr: `which: ${name}: not found\n` }
      },
    },
  ]
}
