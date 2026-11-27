import { describe, expect, it } from 'vitest'
import { boot, guest, rootUser } from '../testkit'
import { runLine } from '../shell/runner'
import { capsOf, hasCap, isRoot } from './caps'

/** A machine whose /etc/caps grants one account one power. */
const files = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\n' +
    'ada:x:1001:1001:Ada:/home/ada:/bin/sh\n' +
    'backup:x:1002:1002::/home/backup:/bin/sh\n',
  '/etc/group': 'root:x:0:\nada:x:1001:\nbackup:x:1002:\n',
  '/etc/caps': '# a comment\nbackup:CAP_DAC_READ_SEARCH\n',
  '/etc/perm': '/home/backup backup:backup 0755\n',
  '/root/README.md': 'secret\n',
}

describe('capabilities', () => {
  it('gives uid 0 every capability', () => {
    expect(isRoot(rootUser)).toBe(true)
    expect(capsOf(rootUser).size).toBe(8)
    expect(hasCap(rootUser, 'CAP_CHOWN')).toBe(true)
  })

  it('gives an ordinary account none', () => {
    expect(capsOf(guest('ada')).size).toBe(0)
    expect(hasCap(guest('ada'), 'CAP_DAC_OVERRIDE')).toBe(false)
  })

  it('reads /etc/caps, so one account can have one power', async () => {
    const { ctx } = boot({ user: guest('backup', 1002, ['backup']), files })
    // CAP_DAC_READ_SEARCH lets it read, but not write, anything.
    expect((await runLine('cat /root/README.md', ctx)).stdout).toBe('secret\n')
    const denied = await runLine('echo x > /root/README.md', ctx)
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('Permission denied')
  })

  it('reports the set with capsh', async () => {
    const root = boot({ user: rootUser, files })
    expect((await runLine('capsh', root.ctx)).stdout).toContain('+cap_dac_override')

    const ada = boot({ user: guest('ada'), files })
    const out = (await runLine('capsh', ada.ctx)).stdout ?? ''
    expect(out).toContain('-cap_dac_override')
    expect(out).not.toContain('+cap_dac_override')
  })

  it('keeps chown and chmod behind their own capabilities', async () => {
    const { ctx } = boot({ files })
    const chown = await runLine('chown backup /home/ada', ctx)
    expect(chown.code).toBe(1)
    expect(chown.stderr).toContain('Permission denied')

    // A guest may chmod a file it owns; CAP_FOWNER is what allows any other.
    expect((await runLine('echo hi > /home/ada/a.txt', ctx)).code).toBe(0)
    expect((await runLine('chmod 600 /home/ada/a.txt', ctx)).code).toBe(0)
  })
})
