import { describe, expect, it } from 'vitest'
import { authenticate } from '../kernel/accounts'
import { boot, guest, rootUser } from '../testkit'
import { runLine } from './runner'
import { createShell } from '../app/session'

/** The published tree, cut down to the four paths a setuid test needs. */
const base = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\n' + 'ada:x:1001:1001:Ada:/home/ada:/bin/sh\n' + 'owner:x:1000:1000::/home/owner:/bin/sh\n',
  '/etc/group': 'root:x:0:\nada:x:1001:\nstaff:x:1000:owner,root\nwheel:x:27:owner,root\n',
  '/etc/shadow':
    'root:$sha256$h0m3$76b39fbd3bd9c40a3c1e2da50e0ccaf842d340ca63450386354fa5dbe2f82d4e:19700:0:99999:7:::\n',
  '/etc/perm': '/bin/passwd root:root 4755\n',
  '/bin/passwd': '#!/bin/sh\n',
}

describe('setuid', () => {
  it('publishes 4755 on the binary and nothing else', async () => {
    const { ctx, fs } = boot({ files: base })
    const stat = fs.stat(guest('ada'), '/bin/passwd')
    expect(stat.mode & 0o7777).toBe(0o4755)
    expect(stat.uid).toBe('root')
    void ctx
  })

  it('refuses to rewrite /etc/shadow without the setuid binary', async () => {
    const { ctx } = boot({
      files: {
        ...base,
        // Same file, no setuid bit: exec no longer raises the effective uid.
        '/etc/perm': '/bin/passwd root:root 0755\n',
      },
      secretQueue: ['pwpw', 'next', 'next'],
    })
    const user = authenticate(ctx.rt.fs, 'bob', 'pwpw')
    expect(user?.created).toBe(true)
    const pane = createShell(ctx.rt, user!.user, user!.user.home)
    pane.host = ctx.host

    const result = await runLine('passwd', pane)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Permission denied')
  })

  it('lets passwd rewrite /etc/shadow through the setuid binary', async () => {
    const { ctx } = boot({ files: base, secretQueue: ['pwpw', 'newpass', 'newpass'] })
    const user = authenticate(ctx.rt.fs, 'bob', 'pwpw')
    const pane = createShell(ctx.rt, user!.user, user!.user.home)
    pane.host = ctx.host

    const result = await runLine('passwd', pane)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('password updated successfully')

    // The pane is still bob: elevation lasts for one command.
    expect(pane.user.name).toBe('bob')
    expect(pane.realUser.name).toBe('bob')

    // The guest still cannot read /etc/shadow; root can, and sees the new row.
    expect(() => pane.rt.fs.read(pane.user, '/etc/shadow')).toThrow()
    const shadow = pane.rt.fs.read(rootUser, '/etc/shadow').content
    expect(shadow).toContain('bob:$sha256$')
  })

  it('shows the logged-in name, not the elevated one, after the command', async () => {
    const { ctx } = boot({ files: base })
    const before = await runLine('whoami', ctx)
    expect(before.stdout).toBe('ada\n')
    // ada is not root, and /bin/passwd is root's, so the pane is unchanged.
    expect(ctx.user.name).toBe('ada')
    expect(ctx.realUser.uid).toBe(1001)
  })

  it('asks the real user for sudo, even with a setuid binary in PATH', async () => {
    const { ctx } = boot({ files: base })
    // sudo is not setuid in this build, so the wheel rule still applies to ada.
    const denied = await runLine('sudo cat /etc/shadow', ctx)
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('not in the sudoers file')
  })
})
