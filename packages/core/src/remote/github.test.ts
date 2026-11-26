import { describe, expect, it } from 'vitest'
import { createGithubRemote } from './github'

describe('github remote', () => {
  it('creates one commit for a text write', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined })
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit1' } })
      if (url.endsWith('/git/commits/commit1')) return json({ tree: { sha: 'tree1' } })
      if (url.endsWith('/git/blobs')) return json({ sha: 'blob1' })
      if (url.endsWith('/git/trees')) return json({ sha: 'tree2' })
      if (url.endsWith('/git/commits')) return json({ sha: 'commit2' })
      if (url.endsWith('/git/refs/heads/main')) return json({ ref: 'refs/heads/main' })
      return json({ message: 'nope' }, 404)
    }
    const remote = createGithubRemote({
      owner: 'me',
      repo: 'home',
      branch: 'main',
      contentRoot: 'content',
      token: () => 'secret',
      fetchImpl,
    })
    expect(remote.authenticated).toBe(true)
    await remote.commit([{ path: '/home/owner/about.md', content: 'hi\n', encoding: 'utf-8' }], 'homepage: test')
    const treeCall = calls.find((call) => call.url.endsWith('/git/trees'))
    expect(treeCall?.body).toContain('content/home/owner/about.md')
    expect(calls.some((call) => call.method === 'PATCH')).toBe(true)
    expect(calls.some((call) => call.body?.includes('secret'))).toBe(false)
  })
})
