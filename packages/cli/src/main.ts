/**
 * The same core shell, in a real terminal.
 *
 * This exists to prove the split: `@home/core` needs no DOM, no browser API and
 * no build step of its own. Everything platform-specific is 30 lines below.
 *
 * Usage:
 *   node packages/cli/dist/cli.js                 # interactive
 *   node packages/cli/dist/cli.js ls /home/owner  # one line, then exit
 *   node packages/cli/dist/cli.js -C /var/guestbook ls
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { createShell } from '@home/core/app/session'
import type { Runtime } from '@home/core/app/runtime'
import { site } from '@home/core/config/site'
import type { DirNode, Node } from '@home/core/kernel/types'
import { stripLinks } from '@home/core/kernel/text'
import { installSystemDirs, VirtualFS } from '@home/core/kernel/vfs'
import { MemoryMail, MemoryRemote } from '@home/core/remote/memory'
import { createOutbox } from '@home/core/remote/outbox'
import type { ShellCtx } from '@home/core/shell/context'
import type { CommandResult } from '@home/core/shell/context'
import { runLine } from '@home/core/shell/runner'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const CONTENT = resolve(REPO, 'content')
const TEXT = new Set(['.md', '.txt', '.log', '.json', '.csv', '.html', '.yml', '.yaml', ''])

/** Build the in-memory image from the real content/ tree. The only filesystem glue. */
function buildImage(dir: string): Map<string, Node> {
  const image = new Map<string, Node>()
  image.set('/', dirNode())
  const visit = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name)
      const stat = statSync(full)
      const rel = relative(dir, full).split(sep).join('/')
      const path = `/${rel}`
      if (stat.isDirectory()) {
        image.set(path, dirNode(stat.mtimeMs))
        visit(full)
        continue
      }
      const text = TEXT.has(extname(name)) && stat.size <= 500_000
      image.set(path, {
        type: 'file',
        content: text ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : '',
        encoding: text ? 'utf8' : 'binary',
        url: text ? undefined : `file://${full}`,
        size: stat.size,
        mtime: stat.mtimeMs,
        mode: 0o644,
        uid: 'root',
        gid: 'root',
      })
    }
  }
  visit(dir)
  installSystemDirs(image)
  return image
}

function dirNode(mtime = 0): DirNode {
  return { type: 'dir', mtime, mode: 0o755, uid: 'root', gid: 'root' }
}

function extname(name: string): string {
  const cut = name.lastIndexOf('.')
  return cut < 0 ? '' : name.slice(cut).toLowerCase()
}

function runtime(): Runtime {
  const fs = new VirtualFS(buildImage(CONTENT))
  let password = site.rootPassword
  return {
    site,
    fs,
    remote: new MemoryRemote(false, false),
    mail: new MemoryMail(false),
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
}

async function print(result: CommandResult) {
  // The browser turns `cmd:` links into clicks; a real terminal cannot, so the
  // CLI prints the same text without the OSC wrapper.
  process.stdout.write(stripLinks(result.stdout ?? ''))
  process.stderr.write(stripLinks(result.stderr ?? ''))
  if (result.pager !== undefined) process.stdout.write(stripLinks(result.pager))
}

function prompt(ctx: ShellCtx): string {
  return `${ctx.user.name}@${ctx.env.HOSTNAME ?? 'home'}:${ctx.cwd}$ `
}

async function main() {
  const argv = process.argv.slice(2)
  let cwd = '/home/owner'
  const at = argv.indexOf('-C')
  if (at >= 0) {
    cwd = argv[at + 1] ?? cwd
    argv.splice(at, 2)
  }

  const rt = runtime()
  const user = { name: 'root', role: 'root' as const }
  const ctx = createShell(rt, user, cwd)
  const lines = argv.length ? [argv.join(' ')] : null

  if (lines) {
    for (const line of lines) {
      await print(await runLine(line, ctx))
      process.exitCode = 0
    }
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '' })
  const next = () =>
    new Promise<string | null>((done) => {
      rl.once('line', (value) => done(value))
      rl.once('close', () => done(null))
    })
  ctx.host = {
    async readStdin() {
      return (await next()) ?? ''
    },
    async askSecret() {
      return null
    },
    async pickFiles() {
      return null
    },
  }

  process.stdout.write(`${site.title}\nType 'help' to start.\n\n`)
  for (;;) {
    process.stdout.write(prompt(ctx))
    const line = await next()
    if (line === null) break
    if (!line.trim()) continue
    ctx.history.push(line)
    await print(await runLine(line, ctx))
    if (ctx.closing) break
  }
  rl.close()
}

await main()
