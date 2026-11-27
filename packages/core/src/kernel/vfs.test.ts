import { describe, expect, it } from 'vitest'
import { guest, rootUser } from '../testkit'
import { FsError, VirtualFS } from './vfs'

const root = rootUser
const ada = guest('ada')

function fs() {
  return VirtualFS.fromFiles({
    '/etc/passwd': 'root:x:0:0:root:/root:/bin/sh\nowner:x:1000:1000:Yujiang:/home/owner:/bin/sh\nada:x:1001:1001:Ada:/home/ada:/bin/sh\n',
    '/etc/group': 'root:x:0:\nstaff:x:1000:owner,root\nada:x:1001:ada\nwheel:x:27:root\n',
    '/etc/perm': '/home/owner owner:staff 0755\n',
    '/home/owner/about.md': 'v1\n',
    '/root/README.md': 'secret\n',
    '/var/guestbook/README.md': 'write here\n',
  })
}

describe('vfs', () => {
  it('gives every account a private home and keeps /root closed', () => {
    const tree = fs()
    expect(tree.stat(root, '/home/ada').mode & 0o777).toBe(0o700)
    expect(tree.stat(root, '/home/ada').uid).toBe('ada')
    expect(tree.stat(root, '/home/owner').mode & 0o777).toBe(0o755)
    expect(tree.stat(root, '/root').mode & 0o777).toBe(0o700)
    expect(() => tree.read(ada, '/root/README.md')).toThrow(FsError)
  })

  it('keeps a guest inside the modes the files carry', () => {
    const tree = fs()
    tree.begin()
    tree.write(ada, '/var/guestbook/ada.txt', 'hello')
    tree.finish()
    expect(tree.read(ada, '/var/guestbook/ada.txt').content).toBe('hello')
    // The page is 0644 in a 0755 home, so a guest may read it and not write it.
    tree.begin()
    expect(() => tree.write(ada, '/home/owner/about.md', 'nope')).toThrowError(/Permission denied/)
    tree.abort()
    expect(tree.read(ada, '/home/owner/about.md').content).toBe('v1\n')
  })

  it('keeps an uploaded binary in the browser overlay', () => {
    const tree = fs()
    tree.begin()
    tree.writeBinary(ada, '/var/guestbook/shot.png', 'data:image/png;base64,AA==', 1)
    tree.finish()
    const node = tree.read(ada, '/var/guestbook/shot.png')
    expect(node.encoding).toBe('binary')
    expect(node.url).toBe('data:image/png;base64,AA==')
    expect(node.size).toBe(1)
    // root owns the home, so root may add a binary there like any other file.
    tree.begin()
    tree.writeBinary(root, '/home/owner/shot.png', 'data:image/png;base64,AA==', 1)
    tree.finish()
    expect(tree.read(root, '/home/owner/shot.png').encoding).toBe('binary')
  })

  it('lets root edit a page and keeps the edit in the overlay', () => {
    const tree = fs()
    tree.begin()
    tree.write(root, '/home/owner/about.md', 'v2\n')
    tree.finish()
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v2\n')
    expect(tree.exportLayer().map(([path]) => path)).toContain('/home/owner/about.md')
  })

  it('hides a deleted page with a tombstone and brings it back with restore', () => {
    const tree = fs()
    tree.begin()
    tree.remove(root, '/home/owner/about.md')
    tree.finish()
    expect(() => tree.read(root, '/home/owner/about.md')).toThrow(FsError)
    expect(tree.readdir(root, '/home/owner')).not.toContain('about.md')

    tree.begin()
    tree.restorePath(root, '/home/owner/about.md')
    tree.finish()
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v1\n')
  })

  it('refuses a guest removal of a shipped guestbook file', () => {
    const tree = fs()
    tree.begin()
    expect(() => tree.remove(ada, '/var/guestbook/README.md')).toThrow(FsError)
    tree.abort()
    expect(tree.read(ada, '/var/guestbook/README.md').content).toBe('write here\n')
  })

  it('lets a guest add their own guestbook file, then remove it', () => {
    const tree = fs()
    tree.begin()
    tree.write(ada, '/var/guestbook/ada.txt', 'hello')
    tree.finish()
    expect(tree.read(ada, '/var/guestbook/ada.txt').content).toBe('hello')
    tree.begin()
    tree.remove(ada, '/var/guestbook/ada.txt')
    tree.finish()
    expect(tree.exists(ada, '/var/guestbook/ada.txt')).toBe(false)
    expect(() => tree.readdir(ada, '/root')).toThrow(FsError)
  })

  it('lets the owner chmod and root bypass any mode', () => {
    const tree = fs()
    tree.begin()
    tree.write(ada, '/var/guestbook/ada.txt', 'hi')
    tree.chmod(ada, '/var/guestbook/ada.txt', 0)
    expect(() => tree.read(ada, '/var/guestbook/ada.txt')).toThrow(FsError)
    expect(() => tree.chown(ada, '/var/guestbook/ada.txt', 'bob', null)).toThrow(FsError)
    tree.finish()
    expect(tree.read(root, '/var/guestbook/ada.txt').content).toBe('hi')
  })

  it('clears setuid and setgid when anyone but root writes the file', () => {
    const tree = fs()
    tree.begin()
    tree.write(ada, '/home/ada/tool', 'v1\n')
    tree.chmod(root, '/home/ada/tool', 0o6755)
    tree.finish()
    expect(tree.stat(ada, '/home/ada/tool').mode & 0o6000).toBe(0o6000)

    tree.begin()
    tree.write(ada, '/home/ada/tool', 'v2\n')
    tree.finish()
    expect(tree.stat(ada, '/home/ada/tool').mode & 0o6000).toBe(0)
    expect(tree.read(ada, '/home/ada/tool').content).toBe('v2\n')

    // root keeps the bits it set, the way the kernel does.
    tree.begin()
    tree.chmod(root, '/home/ada/tool', 0o4755)
    tree.write(root, '/home/ada/tool', 'v3\n')
    tree.finish()
    expect(tree.stat(root, '/home/ada/tool').mode & 0o4000).toBe(0o4000)
  })

  it('nests transactions so a command may call the shell again', () => {
    const tree = fs()
    tree.begin()
    tree.write(root, '/tmp/a.txt', 'outer\n')
    tree.begin()
    tree.write(root, '/tmp/b.txt', 'inner\n')
    tree.abort()
    expect(tree.exists(root, '/tmp/b.txt')).toBe(false)
    expect(tree.exists(root, '/tmp/a.txt')).toBe(true)
    tree.abort()
    expect(tree.exists(root, '/tmp/a.txt')).toBe(false)
  })

  it('keeps a session-only path out of the persisted layer', () => {
    const tree = fs()
    tree.begin()
    tree.write(root, '/etc/passwd', 'root:x:0:0:root:/root:/bin/sh\nguest:x:2000:2000::/home/guest:/bin/sh\n')
    tree.mkdir(root, '/home/guest')
    tree.finish()
    tree.markEphemeral('/home/guest')
    tree.markEphemeral('/etc/passwd')
    const paths = tree.exportLayer().map(([path]) => path)
    expect(paths).not.toContain('/home/guest')
    expect(paths).not.toContain('/etc/passwd')
  })
})
