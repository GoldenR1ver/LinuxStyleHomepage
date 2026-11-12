import { padEndDisplay } from '../../kernel/width'
import type { CommandResult } from '../result'
import { fileCommands } from './fs'
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
const specs: CommandSpec[] = [...fileCommands, ...textCommands, ...systemCommands, ...siteCommands, ...viewCommands].map(wrap)
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

const GUIDE = `home

[1;36mTry to use 'cat /home/owner/about.txt' to read the about page.[0m

Pages
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
  cp /home/owner/about.txt quote.txt  copy a page into your note
  mv old.txt new.txt                move or rename
  mail -m "subject"
  mail add
  mail push
  Text files are staged by mail add. Binary uploads stay in your browser; wget downloads them.
  echo "question" | mail add /home/owner/about.txt   comment on a page without attaching it
  The note stays in your browser. Mail push notifies the owner. It is not published.

Scratch
  ~                           /tmp/<you>, this browser only

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
  x                           close pane
  c                           new window
  n / p                       next / previous window
  0-9                         select window

Root
  github auth                 token stays in this browser
  journal                     commands run in this browser
  journal -m                  root edits
  rollback [id|--last]        undo edits from the last week

man <command> prints a longer description.

`

function metaCommands(all: CommandSpec[]): CommandSpec[] {
  return [
    {
      name: 'help',
      group: 'site',
      summary: 'site guide and commands',
      usage: 'help [command]',
      manual: 'With no argument, prints how to read the site and the command list.',
      run(_ctx, args) {
        const name = args[0]
        if (name) {
          const spec = all.find((item) => item.name === name)
          if (!spec) return { code: 1, stderr: `help: ${name}: not found\n` }
          return { code: 0, stdout: `${spec.name} - ${spec.summary}\n  ${spec.usage}\n\n${spec.manual}\n` }
        }
        const lines = [GUIDE.trimEnd(), '', 'Commands', '']
        for (const [group, label] of labels) {
          lines.push(label)
          for (const spec of all.filter((item) => item.group === group)) {
            lines.push(`  ${padEndDisplay(spec.name, 12)}${spec.summary}`)
          }
          lines.push('')
        }
        return { code: 0, stdout: `${lines.join('\n').trimEnd()}\n` }
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
      manual: 'Look up a name in the built-in command table.',
      run(_ctx, args) {
        const name = args[0]
        if (!name) return { code: 1, stderr: 'which: missing command\n' }
        if (!all.some((item) => item.name === name)) return { code: 1, stderr: `which: ${name}: not found\n` }
        return { code: 0, stdout: `${name}\n` }
      },
    },
  ]
}
