import { clearDraft, MAIL_SEND_MAX, MAIL_SUBJECT_MAX } from '../../remote/outbox'
import type { ShellCtx } from '../context'
import { composeLetter, stageAddedPath, stageWorktree, unstagePath, worktreeFiles } from '../mailbox'
import type { CommandSpec } from './types'

const USAGE =
  'mail: usage: mail [status] | mail -m "subject" | mail add [-A|--all] [path...] | mail reset [path...] | mail push\n'

/**
 * Flags and URL-shaped arguments are refused so a letter cannot retarget the relay.
 * The subject value itself may mention a URL. It is still one header line.
 */
function fixedRoute(args: string[]): string | null {
  const subjectIndex = (() => {
    const at = args.indexOf('-m')
    return at >= 0 ? at + 1 : -1
  })()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (/^(?:--?(?:to|url|webhook|recipient|cc|bcc|token|auth|password))(?:=|$)/i.test(arg)) {
      return 'mail: the relay and recipient are fixed\n'
    }
    if (i !== subjectIndex && /^(?:https?|mailto|ssh|ftp|github):/i.test(arg)) {
      return 'mail: the relay and recipient are fixed\n'
    }
  }
  return null
}

export const mailCommand: CommandSpec = {
  name: 'mail',
  group: 'site',
  summary: 'send a note to the owner',
  usage: 'mail [status] | mail -m "subject" | mail add [-A|--all] [path...] | mail reset [path...] | mail push',
  manual:
    'Stages a letter and sends it to the owner. The relay URL and the recipient come from site.ts. This command cannot change either of them, and it does not read the GitHub token.\n\n' +
    'The staging area works like git. The work tree is /var/guestbook and /tmp/<you>.\n' +
    '  mail status          show the relay, the subject, and staged and unstaged text files\n' +
    '  mail add .           stage every text file under the current directory\n' +
    '  mail add <path...>   stage a file, or a directory recursively\n' +
    '  mail add             stage the whole work tree\n' +
    '  mail add -A          same as mail add\n' +
    '  mail reset           clear the staging area and the subject\n' +
    '  mail reset <path...> unstage a file or a directory\n' +
    '  mail -m "subject"    set the subject\n' +
    '  mail push            send one letter with everything staged\n\n' +
    'A path outside the work tree stages a comment when a note is piped, and the page body is not attached: echo "question" | mail add /home/owner/about.txt. Saving a new guestbook file stages it. scp copies a file from your computer into the current directory first. The owner reads the letter in the mailbox behind webhookUrl. Other visitors cannot see it, and it is not committed.',
  async run(ctx, args, stdin) {
    const blocked = fixedRoute(args)
    if (blocked) return { code: 1, stderr: blocked }
    if (!args.length) return status(ctx)
    if (args[0] === 'status') {
      if (args.length !== 1) return { code: 1, stderr: 'mail: usage: mail status\n' }
      return status(ctx)
    }
    if (args[0] === '-m') return setSubject(ctx, args.slice(1))
    if (args[0] === 'add') return add(ctx, args.slice(1), stdin)
    if (args[0] === 'push') {
      if (args.length !== 1) return { code: 1, stderr: 'mail: usage: mail push\n' }
      return push(ctx)
    }
    if (args[0] === 'reset') return reset(ctx, args.slice(1))
    return { code: 1, stderr: USAGE }
  },
}

function status(ctx: ShellCtx) {
  const draft = ctx.rt.outbox.draft
  const lines = [`relay: ${ctx.rt.mail.configured ? 'configured' : 'off'}`, `subject: ${draft.subject || '(unset)'}`, 'staged:']
  if (!draft.files.length && !draft.notes.length) lines.push('  (empty)')
  for (const file of draft.files) lines.push(`  ${file}`)
  for (const note of draft.notes) lines.push(`  comment ${note.about || '(message)'}`)
  const staged = new Set(draft.files)
  const unstaged = worktreeFiles(ctx).filter((path) => !staged.has(path))
  if (unstaged.length) {
    lines.push('not staged:')
    for (const path of unstaged) lines.push(`  ${path}`)
  }
  if (!draft.files.length && !draft.notes.length) {
    lines.push('', 'nothing staged. mail add . stages the current directory.')
  } else if (!draft.subject) {
    lines.push('', 'mail -m "subject", then mail push.')
  } else {
    lines.push('', 'mail push sends the staged letter.')
  }
  return { code: 0, stdout: `${lines.join('\n')}\n` }
}

function setSubject(ctx: ShellCtx, args: string[]) {
  if (args.length !== 1) return { code: 1, stderr: 'mail: usage: mail -m "subject"\n' }
  const raw = args[0] ?? ''
  if (/[\r\n\0]/.test(raw)) return { code: 1, stderr: 'mail: subject cannot contain a line break\n' }
  const subject = raw.trim()
  if (!subject) return { code: 1, stderr: 'mail: empty subject\n' }
  if ([...subject].length > MAIL_SUBJECT_MAX) {
    return { code: 1, stderr: `mail: subject is longer than ${MAIL_SUBJECT_MAX} characters\n` }
  }
  ctx.rt.outbox.draft.subject = subject
  return { code: 0, stdout: 'subject set\n' }
}

function add(ctx: ShellCtx, args: string[], stdin: string) {
  const flags = args.filter((arg) => arg.startsWith('-'))
  const paths = args.filter((arg) => !arg.startsWith('-'))
  if (flags.length) {
    const unknown = flags.find((flag) => flag !== '-A' && flag !== '--all')
    if (unknown) return { code: 1, stderr: `mail: invalid option -- ${unknown}\n` }
    if (paths.length) return { code: 1, stderr: 'mail: usage: mail add [-A|--all]\n' }
    const result = stageWorktree(ctx, stdin)
    if (result.error) return { code: 1, stdout: result.lines, stderr: result.error }
    return { code: 0, stdout: result.lines }
  }
  if (!paths.length) {
    const result = stageWorktree(ctx, stdin)
    if (result.error) return { code: 1, stdout: result.lines, stderr: result.error }
    return { code: 0, stdout: result.lines }
  }
  let stdout = ''
  for (const input of paths) {
    const result = stageAddedPath(ctx, input, stdin)
    stdout += result.lines.join('')
    if (result.error) return { code: 1, stdout, stderr: result.error }
  }
  return { code: 0, stdout }
}

function reset(ctx: ShellCtx, args: string[]) {
  if (!args.length) {
    clearDraft(ctx.rt.outbox.draft)
    return { code: 0, stdout: 'draft cleared\n' }
  }
  let stdout = ''
  for (const input of args) {
    if (input.startsWith('-')) return { code: 1, stdout, stderr: `mail: invalid option -- ${input}\n` }
    const result = unstagePath(ctx, input)
    stdout += result.lines.join('')
    if (result.error) return { code: 1, stdout, stderr: result.error }
  }
  return { code: 0, stdout }
}

async function push(ctx: ShellCtx) {
  const draft = ctx.rt.outbox.draft
  if (!draft.subject) return { code: 1, stderr: 'mail: missing subject. Use mail -m "subject".\n' }
  const letter = composeLetter(ctx)
  if ('error' in letter) return { code: 1, stderr: letter.error }
  if (ctx.rt.outbox.sent >= MAIL_SEND_MAX) return { code: 1, stderr: 'mail: too many letters from this page.\n' }
  if (!ctx.rt.mail.configured) return { code: 1, stderr: 'mail: relay is not configured. The letter stays in this browser.\n' }
  let status: 'sent' | 'skipped' | 'failed' = 'failed'
  try {
    status = await ctx.rt.mail.send({
      kind: 'letter',
      user: ctx.user.name,
      subject: draft.subject,
      path: letter.path,
      body: letter.body,
    })
  } catch {
    status = 'failed'
  }
  if (status !== 'sent') {
    const why =
      status === 'skipped'
        ? 'mail: relay is not configured. The letter stays in this browser.\n'
        : 'mail: delivery failed. The letter stays staged.\n'
    return { code: 1, stderr: why }
  }
  clearDraft(draft)
  ctx.rt.outbox.sent += 1
  return { code: 0, stdout: 'sent. The owner can read this letter in the mailbox. It is not published.\n' }
}
