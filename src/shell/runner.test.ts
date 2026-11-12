import { describe, expect, it } from 'vitest'
import { runLine } from './runner'
import { boot } from '../testkit'
import { MAX_UPLOAD_BYTES } from '../kernel/types'
import { FsError } from '../kernel/vfs'

const root = { name: 'root', role: 'root' as const }
const ada = { name: 'ada', role: 'guest' as const }

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

  it('uploads text and binary files with scp, then copies and moves them', async () => {
    const note = new TextEncoder().encode('hello upload\n')
    const picture = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const { ctx, fs } = boot({
      picked: [
        { name: 'note.txt', type: 'text/plain', size: note.byteLength, read: async () => note.buffer as ArrayBuffer },
        {
          name: 'picture.png',
          type: 'image/png',
          size: picture.byteLength,
          read: async () => picture.buffer as ArrayBuffer,
        },
      ],
    })
    const uploaded = await runLine('scp /var/guestbook', ctx)
    expect(uploaded.code).toBe(0)
    expect(uploaded.stdout).toContain('/var/guestbook/note.txt')
    expect(uploaded.stdout).toContain('binary')
    expect(fs.read(ctx.user, '/var/guestbook/note.txt').content).toBe('hello upload\n')
    const binary = fs.read(ctx.user, '/var/guestbook/picture.png')
    expect(binary.encoding).toBe('binary')
    expect(binary.url).toContain('data:image/png;base64,')
    expect(binary.size).toBe(6)

    expect((await runLine('cd /var/guestbook', ctx)).code).toBe(0)
    expect((await runLine('cp note.txt copy.txt', ctx)).code).toBe(0)
    expect((await runLine('mv picture.png shot.png', ctx)).code).toBe(0)
    expect(fs.read(ctx.user, '/var/guestbook/copy.txt').content).toBe('hello upload\n')
    expect(fs.exists(ctx.user, '/var/guestbook/picture.png')).toBe(false)
    expect(fs.read(ctx.user, '/var/guestbook/shot.png').encoding).toBe('binary')
    const downloaded = await runLine('wget shot.png', ctx)
    expect(downloaded.code).toBe(0)
    expect(downloaded.downloads?.[0]?.href).toContain('data:image/png;base64,')
  })

  it('keeps the draft in step when an uploaded note is renamed', async () => {
    const note = new TextEncoder().encode('hello\n')
    const { ctx, mail, rt } = boot({
      picked: [
        { name: 'note.txt', type: 'text/plain', size: note.byteLength, read: async () => note.buffer as ArrayBuffer },
      ],
      webhook: true,
    })
    expect((await runLine('cd /var/guestbook', ctx)).code).toBe(0)
    expect((await runLine('scp', ctx)).code).toBe(0)
    expect(rt.outbox.draft.files).toEqual(['/var/guestbook/note.txt'])
    expect((await runLine('mv note.txt my-note.txt', ctx)).code).toBe(0)
    expect(rt.outbox.draft.files).toContain('/var/guestbook/my-note.txt')
    expect(rt.outbox.draft.files).not.toContain('/var/guestbook/note.txt')
    await runLine('mail -m "renamed"', ctx)
    expect((await runLine('mail push', ctx)).code).toBe(0)
    expect(mail.notes[0]?.body).toContain('/var/guestbook/my-note.txt')
    expect(mail.notes[0]?.body).not.toContain('/var/guestbook/note.txt')
  })

  it('refuses uploads outside the work tree and reports a cancelled chooser', async () => {
    const data = new TextEncoder().encode('x')
    const denied = boot({
      picked: [
        { name: 'note.txt', type: 'text/plain', size: data.byteLength, read: async () => data.buffer as ArrayBuffer },
      ],
    })
    const refused = await runLine('scp /home/owner', denied.ctx)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Permission denied')
    expect(denied.fs.exists(denied.ctx.user, '/home/owner/note.txt')).toBe(false)

    const cancelled = boot({ picked: null })
    expect((await runLine('scp /var/guestbook', cancelled.ctx)).code).toBe(130)
  })

  it('refuses an oversized upload before reading it', async () => {
    let read = false
    const { ctx } = boot({
      picked: [
        {
          name: 'big.bin',
          type: 'application/octet-stream',
          size: MAX_UPLOAD_BYTES + 1,
          read: async () => {
            read = true
            return new ArrayBuffer(0)
          },
        },
      ],
    })
    const result = await runLine('scp /var/guestbook', ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('larger')
    expect(read).toBe(false)
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

  it('stages with git-like add, status and reset', async () => {
    const { ctx, rt } = boot({ webhook: true })
    await runLine('mkdir -p /var/guestbook/sub', ctx)
    await runLine('echo one > /var/guestbook/one.txt', ctx)
    await runLine('echo two > /var/guestbook/sub/two.txt', ctx)
    await runLine('echo scratch > /tmp/ada/scratch.txt', ctx)
    await runLine('mail reset', ctx)
    expect((await runLine('cd /var/guestbook', ctx)).code).toBe(0)

    const added = await runLine('mail add .', ctx)
    expect(added.code).toBe(0)
    expect(added.stdout).toContain('/var/guestbook/one.txt')
    expect(added.stdout).toContain('/var/guestbook/sub/two.txt')
    expect(rt.outbox.draft.files).not.toContain('/tmp/ada/scratch.txt')

    const listed = await runLine('mail status', ctx)
    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain('staged:')
    expect(listed.stdout).toContain('/var/guestbook/one.txt')
    expect(listed.stdout).toContain('not staged:')
    expect(listed.stdout).toContain('/tmp/ada/scratch.txt')

    await runLine('mail -m "git habits"', ctx)
    const one = await runLine('mail reset one.txt', ctx)
    expect(one.code).toBe(0)
    expect(one.stdout).toContain('unstaged /var/guestbook/one.txt')
    expect(rt.outbox.draft.files).toEqual(['/var/guestbook/sub/two.txt'])
    expect(rt.outbox.draft.subject).toBe('git habits')

    const all = await runLine('mail add -A', ctx)
    expect(all.code).toBe(0)
    expect(rt.outbox.draft.files).toContain('/tmp/ada/scratch.txt')
  })

  it('defines a function and binds positional arguments', async () => {
    const { ctx, rt } = boot()
    expect((await runLine('greet() { echo "hi $1 from $0"; }', ctx)).code).toBe(0)
    expect(rt.outbox.draft.subject).toBe('')
    const called = await runLine('greet ada', ctx)
    expect(called.code).toBe(0)
    expect(called.stdout).toBe('hi ada from sh\n')

    expect((await runLine('count() { echo $#; }', ctx)).code).toBe(0)
    expect((await runLine('count a b c', ctx)).stdout).toBe('3\n')
    expect((await runLine('all() { echo $@; }', ctx)).code).toBe(0)
    expect((await runLine('all a b', ctx)).stdout).toBe('a b\n')

    const listed = await runLine('functions greet', ctx)
    expect(listed.stdout).toBe('greet() { echo "hi $1 from $0"; }\n')
    expect((await runLine('which greet', ctx)).stdout).toBe('greet (function)\n')
    expect((await runLine('unfunction greet', ctx)).code).toBe(0)
    expect((await runLine('greet ada', ctx)).code).toBe(127)
  })

  it('lets a function run pipes, redirects and other functions', async () => {
    const { ctx, fs } = boot()
    expect((await runLine('p() { echo hi | wc -c; }', ctx)).code).toBe(0)
    expect((await runLine('p', ctx)).stdout).toBe('      3\n')

    expect((await runLine("save() { echo note > /tmp/ada/f.txt; }", ctx)).code).toBe(0)
    const saved = await runLine('save', ctx)
    expect(saved.code).toBe(0)
    expect(fs.read(ctx.user, '/tmp/ada/f.txt').content).toBe('note\n')

    expect((await runLine('outer() { inner x; }', ctx)).code).toBe(0)
    expect((await runLine('inner() { echo "inner $1"; }', ctx)).code).toBe(0)
    expect((await runLine('outer', ctx)).stdout).toBe('inner x\n')

    expect((await runLine('caps() { echo shout; }', ctx)).code).toBe(0)
    expect((await runLine('caps | grep shout', ctx)).stdout).toBe('shout\n')

    const redirected = await runLine('caps > /tmp/ada/said.txt', ctx)
    expect(redirected.code).toBe(0)
    expect(redirected.stdout ?? '').toBe('')
    expect(fs.read(ctx.user, '/tmp/ada/said.txt').content).toBe('shout\n')
  })

  it('stops recursion at the documented depth', async () => {
    const { ctx } = boot()
    expect((await runLine('deep() { deep; }', ctx)).code).toBe(0)
    const result = await runLine('deep', ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('too many levels of function calls')
    expect(result.stderr).toContain('6 allowed')

    expect((await runLine('alt() { other; }', ctx)).code).toBe(0)
    expect((await runLine('other() { alt; }', ctx)).code).toBe(0)
    expect((await runLine('alt', ctx)).stderr).toContain('too many levels')
  })

  it('stops a fan-out before it can flood the page', async () => {
    const { ctx } = boot()
    expect((await runLine('fan() { fan; fan; fan; }', ctx)).code).toBe(0)
    const result = await runLine('fan', ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('too many levels of function calls')
    expect(result.stderr).toContain('more than 200 commands')
    expect((result.stderr ?? '').trimEnd().split('\n')).toHaveLength(2)
  })

  it('accepts the function keyword and keeps one name per kind', async () => {
    const { ctx } = boot()
    expect((await runLine('function hello { echo hi; }', ctx)).code).toBe(0)
    expect((await runLine('hello', ctx)).stdout).toBe('hi\n')
    expect((await runLine('function nope', ctx)).stderr).toContain('one line')

    expect((await runLine('mine() { echo x; }', ctx)).code).toBe(0)
    const clash = await runLine("alias mine='ls'", ctx)
    expect(clash.code).toBe(1)
    expect(clash.stderr).toContain('function has that name')
    expect((await runLine('functions', ctx)).stdout).toContain('mine() { echo x; }')
  })

  it('refuses a function that would shadow a builtin, and bad bodies', async () => {
    const { ctx } = boot()
    const builtin = await runLine('ls() { echo nope; }', ctx)
    expect(builtin.code).toBe(1)
    expect(builtin.stderr).toContain('builtin')
    expect((await runLine('if() { echo x; }', ctx)).stderr).toContain('reserved')

    expect((await runLine('ll() { echo x; }', ctx)).stderr).toContain('alias has that name')
    expect((await runLine('f() { }', ctx)).stderr).toContain('empty function body')
    expect((await runLine('f() { echo x', ctx)).stderr).toContain('missing }')
    expect((await runLine('f()', ctx)).stderr).toContain('one line')
    expect((await runLine('f() { g() { echo x; }; }', ctx)).stderr).toContain('cannot define another function')
    expect((await runLine('f() { echo x; } extra', ctx)).stderr).toContain('may follow')
  })

  it('caps the number of functions and their length', async () => {
    const { ctx } = boot()
    for (let i = 0; i < 32; i++) {
      expect((await runLine(`f${i}() { echo ${i}; }`, ctx)).code).toBe(0)
    }
    const over = await runLine('extra() { echo x; }', ctx)
    expect(over.code).toBe(1)
    expect(over.stderr).toContain('too many functions')

    const long = await runLine(`g() { echo ${'x'.repeat(600)}; }`, ctx)
    expect(long.stderr).toContain('longer than 512')

    const many = await runLine(`h() { ${Array.from({ length: 21 }, () => 'true;').join(' ')} }`, ctx)
    expect(many.stderr).toContain('the limit is 20')
  })

  it('gives a function the stdin of the pipeline that called it', async () => {
    const { ctx } = boot()
    expect((await runLine('upper() { cat; }', ctx)).code).toBe(0)
    const piped = await runLine('echo hello | upper', ctx)
    expect(piped.code).toBe(0)
    expect(piped.stdout).toBe('hello\n')

    expect((await runLine("echo 'from file' > /tmp/ada/in.txt", ctx)).code).toBe(0)
    const redirected = await runLine('upper < /tmp/ada/in.txt', ctx)
    expect(redirected.code).toBe(0)
    expect(redirected.stdout).toBe('from file\n')
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

  it('enforces mode bits and the tree switches', async () => {
    const guest = boot()
    expect((await runLine('cd /root', guest.ctx)).code).toBe(1)
    expect((await runLine('chmod 600 /home/owner/about.md', guest.ctx)).stderr).toContain('Permission denied')
    expect((await runLine('chown ada /tmp/ada', guest.ctx)).code).toBe(1)
    expect((await runLine('echo hi > /tmp/ada/a.txt', guest.ctx)).code).toBe(0)
    expect((await runLine('chmod 000 /tmp/ada/a.txt', guest.ctx)).code).toBe(0)
    expect((await runLine('cat /tmp/ada/a.txt', guest.ctx)).code).toBe(1)
    expect(guest.fs.read(root, '/tmp/ada/a.txt').content).toBe('hi\n')

    const owned = boot({ user: root })
    expect((await runLine('chmod 600 /home/owner/about.md', owned.ctx)).code).toBe(0)
    expect(() => owned.fs.read(ada, '/home/owner/about.md')).toThrow(FsError)
    expect(owned.fs.read(root, '/home/owner/about.md').content).toBe('about\n')
    expect((await runLine('chown ada:readers /home/owner/about.md', owned.ctx)).code).toBe(0)
    expect(owned.fs.stat(root, '/home/owner/about.md').gid).toBe('readers')

    const { ctx, fs } = boot()
    const plain = await runLine('tree -L 1', ctx)
    expect(plain.stdout).toBe('.\n|-- about.md\n`-- notes\n')
    const ansi = await runLine('tree -A -L 1', ctx)
    expect(ansi.stdout).toContain('├── about.md')
    expect(ansi.stdout).toContain('└── notes')
    const dirs = await runLine('tree -d', ctx)
    expect(dirs.stdout).not.toContain('about.md')
    expect(dirs.stdout).toContain('notes')
    const perm = await runLine('tree -p -L 1', ctx)
    expect(perm.stdout).toContain('[drwxr-xr-x] notes')
    expect(perm.stdout).toContain('[-rw-r--r--] about.md')
    const flat = await runLine('tree -f -i -L 1', ctx)
    expect(flat.stdout).toContain('./about.md')
    expect(flat.stdout).not.toContain('|--')
    expect((await runLine('tree -C -L 1 -d', ctx)).stdout).toContain('\x1b[34m')
    expect((await runLine('tree -C -n -L 1 -d', ctx)).stdout).not.toContain('\x1b[')
    expect((await runLine('tree -l -L 0', ctx)).stdout).toBe('.\n')
    expect((await runLine('tree -z', ctx)).code).toBe(1)

    fs.begin()
    fs.write(root, '/home/owner/z.txt', 'z\n')
    fs.finish()
    const timed = ((await runLine('tree -t -L 1', ctx)).stdout ?? '').split('\n')
    expect(timed[1] ?? '').toContain('z.txt')
    fs.begin()
    fs.write(root, '/home/owner/a\u0007b.txt', 'x\n')
    fs.finish()
    expect((await runLine('tree -q -L 1 -P "a*"', ctx)).stdout).toContain('a?b.txt')
    expect((await runLine('tree -N -L 1 -P "a*"', ctx)).stdout).toContain('a\u0007b.txt')
    expect((await runLine('tree -L 1 -P "a*"', ctx)).stdout).toContain('a\\007b.txt')
    const marked = await runLine('tree -F -g -s -D -d', ctx)
    expect(marked.stdout).toContain('[root]')
    expect(marked.stdout).toContain('notes/')
  })
})
