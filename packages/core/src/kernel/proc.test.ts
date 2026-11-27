import { describe, expect, it } from 'vitest'
import { boot, guest, rootUser } from '../testkit'
import { runLine } from '../shell/runner'

describe('/proc', () => {
  it('lists the generated files', async () => {
    const { ctx } = boot()
    const names = (await runLine('ls /proc', ctx)).stdout ?? ''
    for (const name of ['cpuinfo', 'meminfo', 'mounts', 'self', 'uptime', 'version']) {
      expect(names).toContain(name)
    }
  })

  it('generates content on read, with no bytes in the overlay', async () => {
    const { ctx, fs } = boot()
    const version = (await runLine('cat /proc/version', ctx)).stdout ?? ''
    expect(version).toContain('Linux version 6.1-home')
    // Nothing was written: /proc is not in the persisted layer.
    expect(fs.exportLayer().map(([path]) => path)).not.toContain('/proc/version')
  })

  it('describes this pane in /proc/self/status', async () => {
    const { ctx } = boot({ user: guest('ada', 1001, ['ada', 'readers']) })
    const status = (await runLine('cat /proc/self/status', ctx)).stdout ?? ''
    expect(status).toContain('Name:\tada')
    expect(status).toContain('Uid:\t1001')
    expect(status).toContain('Groups:\tada readers')
  })

  it('refuses every write', async () => {
    const root = boot({ user: rootUser })
    const write = await runLine('echo x > /proc/mounts', root.ctx)
    expect(write.code).toBe(1)
    expect(write.stderr).toContain('Read-only file system')

    const rm = await runLine('rm /proc/mounts', root.ctx)
    expect(rm.code).toBe(1)
    expect(rm.stderr).toContain('Read-only file system')

    // Even root cannot shadow it with an overlay copy.
    expect(root.fs.exportLayer().map(([path]) => path)).not.toContain('/proc/mounts')
  })

  it('agrees with mount and df', async () => {
    const { ctx } = boot()
    const mount = (await runLine('mount', ctx)).stdout ?? ''
    expect(mount).toContain('on / type overlay')
    expect(mount).toContain('on /proc type proc')
    expect(mount).toContain('on /tmp type tmpfs')

    const df = (await runLine('df', ctx)).stdout ?? ''
    expect(df).toContain('overlay')
    expect(df).toContain('/proc')
  })

  it('makes /tmp a tmpfs: present, writable, and gone after a reload', async () => {
    const { ctx, fs } = boot()
    expect((await runLine('echo scratch > /tmp/note.txt', ctx)).code).toBe(0)
    expect(fs.read(ctx.user, '/tmp/note.txt').content).toBe('scratch\n')
    expect(fs.exportLayer().map(([path]) => path)).not.toContain('/tmp/note.txt')
  })
})
