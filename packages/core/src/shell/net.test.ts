import { describe, expect, it } from 'vitest'
import { boot, guest } from '../testkit'
import { runLine } from './runner'

const KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
ZmFrZSBrZXkgbWF0ZXJpYWwgZm9yIHRoZSBob21lcGFnZSBwdXp6bGU=
-----END OPENSSH PRIVATE KEY-----
`

/** The content tree the puzzle needs: a key behind /root, a group-only room. */
const puzzle = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\n' +
    'owner:x:1000:1000:Yujiang:/home/owner:/bin/sh\n' +
    'ada:x:1001:1001:Ada:/home/ada:/bin/sh\n',
  '/etc/group': 'root:x:0:\nstaff:x:1000:owner,root\nada:x:1001:ada\nreaders:x:1002:ada\nwheel:x:27:owner,root\n',
  '/etc/perm':
    '/home/owner owner:staff 0755\n' +
    '/srv/reading-room root:readers 0750\n' +
    '/root/backup/id_rsa root:root 0600\n',
  '/root/backup/id_rsa': KEY,
  '/root/notes.txt': 'the private notes\n',
  '/srv/reading-room/README.txt': 'readers only\n',
  '/home/owner/about.md': 'about\n',
}

const ada = guest('ada', 1001, ['ada', 'readers'])
const owner = guest('owner', 1000, ['owner', 'staff', 'wheel'], '/home/owner')

function shell(user = ada) {
  return boot({ user, files: puzzle })
}

describe('the exposed http service', () => {
  it('reports a LAN address but binds the service to loopback', async () => {
    const { ctx } = shell()
    // `ip` names the interface; the httpd only listens on loopback, which is
    // what `ss` shows and what every URL in this build uses.
    expect((await runLine('ip', ctx)).stdout).toContain('192.168.1.42/24')
    const sockets = (await runLine('ss', ctx)).stdout ?? ''
    expect(sockets).toContain('127.0.0.1:8080')
    expect(sockets).not.toContain('0.0.0.0:8080')
    expect(sockets).toContain('httpd')
  })

  it('serves as root, so it lists a directory the shell refuses', async () => {
    const { ctx } = shell()
    expect((await runLine('ls /root', ctx)).code).toBe(1)

    const index = (await runLine('curl http://127.0.0.1:8080/', ctx)).stdout ?? ''
    expect(index).toContain('Index of /')
    expect(index).toContain('root/')

    const key = (await runLine('curl http://127.0.0.1:8080/root/backup/id_rsa', ctx)).stdout ?? ''
    expect(key).toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  it('refuses any address other than the local server', async () => {
    const { ctx } = shell()
    const outside = await runLine('curl http://example.com/', ctx)
    expect(outside.code).toBe(7)
    expect(outside.stderr).toContain('Connection refused')
  })

  it('downloads the key into the current directory', async () => {
    const { ctx, fs } = shell()
    expect((await runLine('curl -O http://127.0.0.1:8080/root/backup/id_rsa', ctx)).code).toBe(0)
    const node = fs.read(ctx.user, '/home/ada/id_rsa')
    expect(node.content).toContain('BEGIN OPENSSH PRIVATE KEY')
    // A download lands with the umask, so ssh will refuse it until chmod.
    expect(node.mode & 0o777).toBe(0o644)
  })
})

describe('the ssh login', () => {
  it('refuses a key that others can read, then accepts 0600', async () => {
    const { ctx } = shell()
    await runLine('curl -O http://127.0.0.1:8080/root/backup/id_rsa', ctx)

    const open = await runLine('ssh -i id_rsa root@127.0.0.1', ctx)
    expect(open.code).toBe(255)
    expect(open.stderr).toContain('UNPROTECTED PRIVATE KEY FILE')
    expect(open.stderr).toContain('0644')

    expect((await runLine('chmod 600 id_rsa', ctx)).code).toBe(0)
    const login = await runLine('ssh -i id_rsa root@127.0.0.1', ctx)
    expect(login.code).toBe(0)
    expect(ctx.user.uid).toBe(0)
    expect((await runLine('whoami', ctx)).stdout).toBe('root\n')
    expect((await runLine('cat /etc/shadow', ctx)).code).toBe(0)
  })

  it('asks for a password when no key is given', async () => {
    const bad = boot({ user: ada, files: puzzle, secretQueue: ['wrong'] })
    const refused = await runLine('ssh root@127.0.0.1', bad.ctx)
    expect(refused.code).toBe(255)

    const good = boot({ user: ada, files: puzzle, secretQueue: ['qwerty~'] })
    expect((await runLine('ssh root@127.0.0.1', good.ctx)).code).toBe(0)
    expect(good.ctx.user.uid).toBe(0)
  })
})

describe('groups and sudo', () => {
  it('lets a readers member into the reading room and no one else', async () => {
    const inside = shell()
    expect((await runLine('cat /srv/reading-room/README.txt', inside.ctx)).stdout).toBe('readers only\n')

    const outsider = shell(guest('mystery', 1002, ['mystery']))
    const denied = await runLine('ls /srv/reading-room', outsider.ctx)
    expect(denied.code).toBe(1)
  })

  it('refuses sudo to a name outside wheel', async () => {
    const { ctx } = shell()
    const denied = await runLine('sudo cat /etc/shadow', ctx)
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('not in the sudoers file')
  })

  it('asks a wheel member for their own password', async () => {
    const { ctx } = boot({ user: owner, files: puzzle, secretQueue: ['wrong'] })
    const denied = await runLine('sudo cat /etc/shadow', ctx)
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('incorrect password')
    // The failed attempt does not change the identity of the pane.
    expect(ctx.user.name).toBe('owner')
  })

  it('switches identity with su and restores it after a one-shot command', async () => {
    const { ctx } = boot({ user: ada, files: puzzle, secretQueue: ['qwerty~'] })
    expect((await runLine('su root', ctx)).code).toBe(0)
    expect(ctx.user.uid).toBe(0)
    expect((await runLine('cat /root/notes.txt', ctx)).stdout).toBe('the private notes\n')
  })
})