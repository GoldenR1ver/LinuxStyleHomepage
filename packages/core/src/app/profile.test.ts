import { describe, expect, it } from 'vitest'
import { boot, guest, rootUser } from '../testkit'
import { runProfile } from './profile'
import { runLine } from '../shell/runner'

const profile = {
  '/etc/profile': [
    '# a comment',
    'umask 077',
    'export FLAVOUR=home',
    "alias sl='ls -l'",
    'greet() { echo hi $1; }',
  ].join('\n'),
  '/home/ada/.profile': 'export PRIVATE=yes\n',
}

describe('/etc/profile', () => {
  it('runs the system file, then the user file', async () => {
    const { ctx } = boot({ user: guest('ada'), files: profile })
    await runProfile(ctx)
    expect(ctx.env.FLAVOUR).toBe('home')
    expect(ctx.env.PRIVATE).toBe('yes')
    expect(ctx.aliases.sl).toBe('ls -l')
    expect(ctx.functions.greet).toBe('echo hi $1')
    expect((await runLine('greet world', ctx)).stdout).toBe('hi world\n')
  })

  it('applies umask to files created afterwards', async () => {
    const { ctx, fs } = boot({ user: guest('ada'), files: profile })
    await runProfile(ctx)
    expect((await runLine('touch /home/ada/a.txt', ctx)).code).toBe(0)
    expect(fs.stat(ctx.user, '/home/ada/a.txt').mode & 0o777).toBe(0o600)
    expect((await runLine('mkdir /home/ada/sub', ctx)).code).toBe(0)
    expect(fs.stat(ctx.user, '/home/ada/sub').mode & 0o777).toBe(0o700)
  })

  it('keeps running after a line that fails', async () => {
    const { ctx } = boot({
      user: guest('ada'),
      files: { '/etc/profile': 'export A=1\nnosuchcommand\nexport B=2\n' },
    })
    const out = await runProfile(ctx)
    expect(out).toContain('command not found')
    expect(ctx.env.A).toBe('1')
    expect(ctx.env.B).toBe('2')
  })

  it('is a no-op when neither file exists', async () => {
    const { ctx } = boot({ user: rootUser })
    expect(await runProfile(ctx)).toBe('')
  })

  it('prints the mask with umask', async () => {
    const { ctx } = boot()
    expect((await runLine('umask', ctx)).stdout).toBe('0022\n')
    expect((await runLine('umask 077', ctx)).code).toBe(0)
    expect((await runLine('umask', ctx)).stdout).toBe('0077\n')
    expect((await runLine('umask 999', ctx)).code).toBe(1)
  })
})
