import { isInside, normalize, resolve } from '../kernel/path'
import type { User } from '../kernel/types'
import type { VirtualFS } from '../kernel/vfs'
import { clipText, MAIL_BODY_MAX, MAIL_ITEM_MAX, MAIL_LETTER_MAX, type MailDraft } from '../remote/outbox'
import type { ShellCtx } from './context'

/**
 * The work tree is this browser's guestbook files and this user's scratch.
 * Published pages can be mentioned. Their bytes are not attached.
 */
export function isWorktreePath(user: User, path: string): boolean {
  let p: string
  try {
    p = normalize(path)
  } catch {
    return false
  }
  if (p !== '/var/guestbook' && isInside('/var/guestbook', p)) return true
  const scratch = `/tmp/${user.name}`
  return p !== scratch && isInside(scratch, p)
}

export function stageSavedGuestbook(ctx: ShellCtx, path: string): string {
  let normal: string
  try {
    normal = normalize(path)
  } catch {
    return ''
  }
  if (!isWorktreePath(ctx.user, normal)) return ''
  const text = localTexts(ctx.rt.fs).get(normal)
  if (text === undefined) return ''
  if (!text.trim()) return 'note saved in this browser.\n'
  if (addFile(ctx.rt.outbox.draft, normal) === 'full') return 'note saved in this browser. The mail draft is full.\n'
  const next = ctx.rt.outbox.draft.subject
    ? 'mail push notifies the owner.'
    : 'mail -m "subject", then mail push, notifies the owner.'
  return `staged ${normal}. ${next}\n`
}

/** A rename or delete can leave a staged work-tree path behind. Drop it before the next send. */
export function pruneMissingDraft(ctx: ShellCtx): string {
  const draft = ctx.rt.outbox.draft
  const kept: string[] = []
  const dropped: string[] = []
  for (const file of draft.files) {
    let path: string
    try {
      path = normalize(file)
    } catch {
      kept.push(file)
      continue
    }
    if (!isWorktreePath(ctx.user, path) || readable(ctx, path)) kept.push(file)
    else dropped.push(path)
  }
  if (!dropped.length) return ''
  draft.files = kept
  return `dropped ${dropped.join(', ')} from the draft (missing).\n`
}

export function stageWorktree(ctx: ShellCtx, stdin: string): { lines: string; error: string } {
  const paths = [...localTexts(ctx.rt.fs).entries()]
    .filter(([path, text]) => isWorktreePath(ctx.user, path) && text.trim() && readable(ctx, path))
    .map(([path]) => path)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const lines: string[] = []
  if (!paths.length && !stdin.trim()) {
    return {
      lines: '',
      error: `mail: work tree is empty. Write /var/guestbook/name.txt or /tmp/${ctx.user.name}/name.txt.\n`,
    }
  }
  for (const path of paths) {
    const placed = addFile(ctx.rt.outbox.draft, path)
    if (placed === 'full') return { lines: lines.join(''), error: 'mail: the draft is full\n' }
    if (placed === 'added') lines.push(`staged ${path}\n`)
  }
  if (stdin.trim()) {
    const placed = addNote(ctx.rt.outbox.draft, '', clipText(stdin.trim(), MAIL_BODY_MAX))
    if (placed === 'full') return { lines: lines.join(''), error: 'mail: the draft is full\n' }
    lines.push('staged a note\n')
  }
  if (!lines.length) return { lines: 'staged paths were already in the draft.\n', error: '' }
  return { lines: lines.join(''), error: '' }
}

export function stageAddedPath(ctx: ShellCtx, input: string, stdin: string): { line: string; error: string } {
  let path: string
  try {
    path = normalize(resolve(ctx.cwd, input))
  } catch {
    return { line: '', error: 'mail: invalid path\n' }
  }
  if (isWorktreePath(ctx.user, path)) {
    const reason = readableFile(ctx, path)
    if (reason) return { line: '', error: `mail: ${path}: ${reason}\n` }
    const text = localTexts(ctx.rt.fs).get(path)
    if (text === undefined) return { line: '', error: `mail: ${path}: not in the work tree\n` }
    if (!text.trim()) return { line: '', error: `mail: ${path}: empty\n` }
    if (addFile(ctx.rt.outbox.draft, path) === 'full') return { line: '', error: 'mail: the draft is full\n' }
    return { line: `staged ${path}\n`, error: '' }
  }
  const reason = readableFile(ctx, path)
  if (reason) return { line: '', error: `mail: ${path}: ${reason}\n` }
  const body = stdin.trim()
  if (!body) {
    return {
      line: '',
      error: `mail: ${path}: not in the work tree. Pipe a note to mention it. The file is not attached.\n`,
    }
  }
  if (addNote(ctx.rt.outbox.draft, path, clipText(body, MAIL_BODY_MAX)) === 'full') {
    return { line: '', error: 'mail: the draft is full\n' }
  }
  const truncated = [...body].length > MAIL_BODY_MAX ? ' (truncated)' : ''
  return { line: `staged a comment about ${path}${truncated}\n`, error: '' }
}

export function composeLetter(ctx: ShellCtx): { body: string; path: string } | { error: string } {
  const draft = ctx.rt.outbox.draft
  if (!draft.files.length && !draft.notes.length) return { error: 'mail: nothing staged. Use mail add.\n' }
  const local = localTexts(ctx.rt.fs)
  const parts = [`from: ${senderName(ctx.user.name)}`]
  let first = ''
  for (const file of draft.files) {
    let path: string
    try {
      path = normalize(file)
    } catch {
      return { error: 'mail: invalid path. The letter was not sent.\n' }
    }
    if (!isWorktreePath(ctx.user, path)) {
      return { error: `mail: ${path}: not in the work tree. The letter was not sent.\n` }
    }
    if (!readable(ctx, path)) {
      return { error: `mail: ${path}: Permission denied. The letter was not sent.\n` }
    }
    const text = local.get(path)
    if (text === undefined) return { error: `mail: ${path}: missing. The letter was not sent.\n` }
    if (!first) first = path
    parts.push('', `--- ${path}`, clipText(text, MAIL_BODY_MAX))
  }
  for (const note of draft.notes) {
    const about = note.about ? oneLine(note.about, 200) : '(message)'
    if (!first) first = about
    parts.push('', `--- ${about}`, clipText(note.body, MAIL_BODY_MAX))
  }
  let body = parts.join('\n')
  if (!body.trim()) return { error: 'mail: nothing to send.\n' }
  if ([...body].length > MAIL_LETTER_MAX) body = `${clipText(body, MAIL_LETTER_MAX)}\n(truncated)`
  if (!body.endsWith('\n')) body += '\n'
  return { body, path: first }
}

function addFile(draft: MailDraft, path: string): 'added' | 'have' | 'full' {
  if (draft.files.includes(path)) return 'have'
  if (draft.files.length + draft.notes.length >= MAIL_ITEM_MAX) return 'full'
  draft.files.push(path)
  return 'added'
}

function addNote(draft: MailDraft, about: string, body: string): 'added' | 'full' {
  const found = draft.notes.find((note) => note.about === about)
  if (found) {
    found.body = body
    return 'added'
  }
  if (draft.files.length + draft.notes.length >= MAIL_ITEM_MAX) return 'full'
  draft.notes.push({ about, body })
  return 'added'
}

function localTexts(fs: VirtualFS): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, entry] of fs.exportLayer('local')) {
    if (entry.type === 'file' && entry.encoding === 'utf8') map.set(path, entry.content)
  }
  return map
}

function readable(ctx: ShellCtx, path: string): boolean {
  try {
    return ctx.rt.fs.read(ctx.user, path).encoding === 'utf8'
  } catch {
    return false
  }
}

function readableFile(ctx: ShellCtx, path: string): string {
  try {
    const stat = ctx.rt.fs.stat(ctx.user, path)
    if (stat.type === 'dir') return 'Is a directory'
    if (stat.encoding === 'binary') return 'binary file'
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'guest'
}

function oneLine(value: string, max: number): string {
  return clipText(value.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim(), max)
}
