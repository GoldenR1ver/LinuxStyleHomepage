import { describe, expect, it } from 'vitest'
import { FsError, VirtualFS } from './vfs'

const root = { name: 'root', role: 'root' as const }
const ada = { name: 'ada', role: 'guest' as const }

function fs() {
  return VirtualFS.fromFiles({
    '/home/owner/about.md': 'v1\n',
    '/root/README.md': 'secret\n',
    '/var/guestbook/README.md': 'write here\n',
  })
}

describe('vfs', () => {
  it('hides root files and other guests scratch', () => {
    const tree = fs()
    expect(() => tree.read(ada, '/root/README.md')).toThrow(FsError)
    tree.begin()
    tree.mkdir(ada, '/tmp/ada')
    tree.write(ada, '/tmp/ada/note.txt', 'hi')
    tree.finish()
    expect(tree.read(ada, '/tmp/ada/note.txt').content).toBe('hi')
    expect(() => tree.read({ name: 'bob', role: 'guest' }, '/tmp/ada/note.txt')).toThrow(FsError)
  })

  it('keeps guest writes off the published layer', () => {
    const tree = fs()
    tree.begin()
    tree.mkdir(ada, '/tmp/ada')
    tree.write(ada, '/var/guestbook/ada.txt', 'hello')
    const changes = tree.pendingChanges()
    tree.finish()
    expect(changes).toEqual([])
    expect(tree.read(ada, '/var/guestbook/ada.txt').content).toBe('hello')
    tree.begin()
    expect(() => tree.write(ada, '/home/owner/about.md', 'nope')).toThrowError(/Permission denied/)
    tree.abort()
    expect(tree.read(ada, '/home/owner/about.md').content).toBe('v1\n')
  })

  it('keeps an uploaded binary in the browser layer', () => {
    const tree = fs()
    tree.begin()
    tree.writeBinary(ada, '/var/guestbook/shot.png', 'data:image/png;base64,AA==', 1)
    const changes = tree.pendingChanges()
    tree.finish()
    expect(changes).toEqual([])
    const node = tree.read(ada, '/var/guestbook/shot.png')
    expect(node.encoding).toBe('binary')
    expect(node.url).toBe('data:image/png;base64,AA==')
    expect(node.size).toBe(1)
    tree.begin()
    expect(() => tree.writeBinary(root, '/home/owner/shot.png', 'data:image/png;base64,AA==', 1)).toThrow(FsError)
    tree.abort()
  })

  it('records an inverse patch when root edits a published file', () => {
    const tree = fs()
    tree.begin()
    tree.write(root, '/home/owner/about.md', 'v2\n')
    const changes = tree.pendingChanges()
    const steps = tree.finish()
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v2\n')
    expect(changes).toEqual([{ path: '/home/owner/about.md', content: 'v2\n', encoding: 'utf-8' }])
    expect(steps[0]?.inverseRemote).toEqual({
      path: '/home/owner/about.md',
      content: 'v1\n',
      encoding: 'utf-8',
    })
    tree.restoreStep(steps[0]!)
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v1\n')
  })

  it('rolls a published delete back to the original text', () => {
    const tree = fs()
    tree.begin()
    tree.remove(root, '/home/owner/about.md')
    const steps = tree.finish()
    expect(() => tree.read(root, '/home/owner/about.md')).toThrow(FsError)
    tree.restoreStep(steps[0]!)
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v1\n')
    expect(steps[0]?.inverseRemote?.content).toBe('v1\n')
  })

  it('refuses guest removal of published guestbook files', () => {
    const tree = fs()
    tree.begin()
    expect(() => tree.remove(ada, '/var/guestbook/README.md')).toThrow(FsError)
    tree.abort()
    expect(tree.read(ada, '/var/guestbook/README.md').content).toBe('write here\n')
  })

  it('keeps scratch private and lets a guest remove their own sticky entry', () => {
    const tree = fs()
    expect(tree.stat(root, '/tmp').mode & 0o7777).toBe(0o1777)
    expect(tree.stat(root, '/root').mode & 0o777).toBe(0o700)
    tree.begin()
    tree.mkdir(ada, '/tmp/ada')
    tree.write(ada, '/tmp/ada/note.txt', 'hi')
    tree.write(ada, '/var/guestbook/ada.txt', 'hello')
    expect(tree.stat(ada, '/tmp/ada').mode & 0o777).toBe(0o700)
    expect(tree.stat(ada, '/tmp/ada/note.txt').mode & 0o777).toBe(0o600)
    tree.remove(ada, '/var/guestbook/ada.txt')
    tree.finish()
    expect(tree.exists(ada, '/var/guestbook/ada.txt')).toBe(false)
    expect(() => tree.readdir(ada, '/root')).toThrow(FsError)
    expect(() => tree.read({ name: 'bob', role: 'guest' }, '/tmp/ada/note.txt')).toThrow(FsError)
  })

  it('lets root bypass mode bits that stop a guest', () => {
    const tree = fs()
    tree.begin()
    tree.chmod(root, '/home/owner/about.md', 0o600)
    tree.mkdir(ada, '/tmp/ada')
    tree.write(ada, '/tmp/ada/note.txt', 'hi')
    tree.chmod(ada, '/tmp/ada/note.txt', 0)
    expect(() => tree.chown(ada, '/tmp/ada/note.txt', 'bob', null)).toThrow(FsError)
    tree.finish()
    expect(() => tree.read(ada, '/home/owner/about.md')).toThrow(FsError)
    expect(tree.read(root, '/home/owner/about.md').content).toBe('v1\n')
    expect(() => tree.read(ada, '/tmp/ada/note.txt')).toThrow(FsError)
    expect(tree.read(root, '/tmp/ada/note.txt').content).toBe('hi')
  })
})
