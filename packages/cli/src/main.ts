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

import { applyAccounts, ROOT } from '@home/core/kernel/accounts'
import { createShell } from '@home/core/app/session'
import type { Runtime } from '@home/core/app/runtime'
import { installProc } from '@home/core/app/system'
import { runProfile } from '@home/core/app/profile'
import { site } from '@home/core/config/site'
import type { Node } from '@home/core/kernel/types'
import { stripLinks } from '@home/core/kernel/text'
import { buildMetadata } from '@home/core/kernel/perm'
import { installSystemDirs, VirtualFS } from '@home/core/kernel/vfs'
import { MemoryMail } from '@home/core/remote/memory'
import { createOutbox } from '@home/core/remote/outbox'
import type { ShellCtx } from '@home/core/shell/context'
import type { CommandResult } from '@home/core/shell/context'
import { runLine } from '@home/core/shell/runner'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const CONTENT = resolve(REPO, 'content')
const TEXT = new Set(['.md', '.txt', '.log', '.json', '.csv', '.html', '.yml', '.yaml', '.sh', ''])

/** Build the in-memory image from the real content/ tree. The only filesystem glue. */
function buildImage(dir: string): Map<string, Node> {
  const shape = new Map<string, { kind: 'file' | 'dir'; abs: string; size: number; mtime: number; text?: string }>()
  shape.set('/', { kind: 'dir', abs: dir, size: 0, mtime: 0 })
  const visit = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name)
      const stat = statSync(full)
      const rel = relative(dir, full).split(sep).join('/')
      const path = `/${rel}`
      if (stat.isDirectory()) {
        shape.set(path, { kind: 'dir', abs: full, size: 0, mtime: stat.mtimeMs })
        visit(full)
        continue
      }
      const textual = TEXT.has(extname(name)) && stat.size <= 500_000
      shape.set(path, {
        kind: 'file',
        abs: full,
        size: stat.size,
        mtime: stat.mtimeMs,
        text: textual ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : undefined,
      })
    }
  }
  visit(dir)

  // The same build-time metadata the browser gets from the manifest.
  const meta = buildMetadata(
    [...shape].map(([path, node]) => ({ path, kind: node.kind })),
    (path) => shape.get(path)?.text ?? null,
  )

  const image = new Map<string, Node>()
  for (const [path, node] of shape) {
    const found = meta.get(path) ?? { mode: 0o644, uid: 'root', gid: 'root' }
    if (node.kind === 'dir') {
      image.set(path, { type: 'dir', mtime: node.mtime, mode: found.mode, uid: found.uid, gid: found.gid })
      continue
    }
    image.set(path, {
      type: 'file',
      content: node.text ?? '',
      encoding: node.text === undefined ? 'binary' : 'utf8',
      url: node.text === undefined ? `file://${node.abs}` : undefined,
      size: node.size,
      mtime: node.mtime,
      mode: found.mode,
      uid: found.uid,
      gid: found.gid,
    })
  }
  installSystemDirs(image)
  applyAccounts(image)
  return image
}

function extname(name: string): string {
  const cut = name.lastIndexOf('.')
  return cut < 0 ? '' : name.slice(cut).toLowerCase()
}

function runtime(): Runtime {
  const fs = new VirtualFS(buildImage(CONTENT))
  return {
    site,
    fs,
    mail: new MemoryMail(false),
    outbox: createOutbox(),
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
  return `${ctx.user.name}@${ctx.env.HOSTNAME ?? 'home'}:${ctx.cwd}${ctx.user.uid === 0 ? '#' : '$'} `
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
  installProc(rt)
  const ctx = createShell(rt, ROOT, cwd)
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
  const profile = await runProfile(ctx)
  if (profile) process.stdout.write(profile)
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
