import { describe, expect, it } from 'vitest'
import { buildMetadata, parsePerm, type MetaEntry } from './perm'

const files: Record<string, string> = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\n' + 'ada:x:1001:1001:Ada:/home/ada:/bin/sh\n' + 'nobody:x:65534:65534::/nonexistent:/usr/sbin/nologin\n',
  '/etc/group': 'root:x:0:\nada:x:1001:\nreaders:x:1002:\n',
  '/etc/perm': [
    '# a comment',
    '',
    '/srv/room    root:readers 0750',
    '/bin/passwd  root:root    4755',
    '/tmp/keep    root:root',
  ].join('\n'),
}

const entries: MetaEntry[] = [
  { path: '/etc/passwd', kind: 'file' },
  { path: '/etc/shadow', kind: 'file' },
  { path: '/home/ada', kind: 'dir' },
  { path: '/srv/room', kind: 'dir' },
  { path: '/bin/passwd', kind: 'file' },
  { path: '/tmp/keep', kind: 'dir' },
]

const meta = buildMetadata(entries, (path) => files[path] ?? null)

describe('build-time metadata', () => {
  it('reads the perm table and ignores comments and blank lines', () => {
    expect(parsePerm(files['/etc/perm'] ?? '')).toEqual([
      { path: '/srv/room', uid: 'root', gid: 'readers', mode: 0o750 },
      { path: '/bin/passwd', uid: 'root', gid: 'root', mode: 0o4755 },
      { path: '/tmp/keep', uid: 'root', gid: 'root', mode: null },
    ])
  })

  it('gives a shipped home to its account, not to root', () => {
    expect(meta.get('/home/ada')).toEqual({ mode: 0o700, uid: 'ada', gid: 'ada' })
  })

  it('keeps the shipped defaults for everything else', () => {
    expect(meta.get('/etc/passwd')).toEqual({ mode: 0o644, uid: 'root', gid: 'root' })
    expect(meta.get('/etc/shadow')).toEqual({ mode: 0o600, uid: 'root', gid: 'root' })
  })

  it('lets the perm table carry a group and a setuid bit', () => {
    expect(meta.get('/srv/room')).toEqual({ mode: 0o750, uid: 'root', gid: 'readers' })
    expect(meta.get('/bin/passwd')).toEqual({ mode: 0o4755, uid: 'root', gid: 'root' })
  })

  it('keeps the mode it already had when a line names no mode', () => {
    // /tmp is 1777 by default; the line only changes the owner.
    expect(meta.get('/tmp/keep')).toEqual({ mode: 0o1777, uid: 'root', gid: 'root' })
  })

  it('does not create a home for a nologin account', () => {
    const rows = buildMetadata([{ path: '/nonexistent', kind: 'dir' }], (path) => files[path] ?? null)
    expect(rows.get('/nonexistent')).toEqual({ mode: 0o755, uid: 'root', gid: 'root' })
  })
})
