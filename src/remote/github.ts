import type { RemoteChange } from '../kernel/types'
import type { RemoteRepo } from './repo'

interface GithubOptions {
  owner: string
  repo: string
  branch: string
  contentRoot: string
  token: () => string
  fetchImpl?: typeof fetch
}

interface GithubCommit {
  sha: string
  tree: { sha: string }
}

/**
 * Turn a batch of file changes into one commit via the Git Data API.
 * The token is read from the caller and is never written to the repo.
 */
export function createGithubRemote(options: GithubOptions): RemoteRepo {
  const configured = Boolean(options.owner.trim() && options.repo.trim())
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    configured,
    get authenticated() {
      return configured && options.token().trim().length > 0
    },
    async commit(changes, message) {
      if (!changes.length) return
      const token = options.token().trim()
      if (!configured) throw new Error('github is not configured')
      if (!token) throw new Error('missing token')
      await publish(fetchImpl, options, token, changes, message)
    },
  }
}

async function publish(
  fetchImpl: typeof fetch,
  options: GithubOptions,
  token: string,
  changes: RemoteChange[],
  message: string,
) {
  const base = `https://api.github.com/repos/${options.owner}/${options.repo}`
  const gh = async (method: string, path: string, body?: unknown) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'homepage-shell',
        'x-github-api-version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      let detail = text
      try {
        detail = String((JSON.parse(text) as { message?: string }).message || text)
      } catch {
        detail = text
      }
      throw new Error(`github ${response.status}: ${detail}`)
    }
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }

  const ref = (await gh('GET', `/git/ref/heads/${options.branch}`)) as { object?: { sha?: string } }
  const parent = ref.object?.sha
  if (!parent) throw new Error('github: missing branch sha')
  const current = (await gh('GET', `/git/commits/${parent}`)) as unknown as GithubCommit
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
  for (const change of changes) {
    const path = repoPath(options.contentRoot, change.path)
    if (change.content === null) {
      tree.push({ path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    const blob = (await gh('POST', '/git/blobs', { content: change.content, encoding: change.encoding })) as { sha?: string }
    if (!blob.sha) throw new Error('github: missing blob sha')
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const nextTree = (await gh('POST', '/git/trees', { base_tree: current.tree.sha, tree })) as { sha?: string }
  if (!nextTree.sha) throw new Error('github: missing tree sha')
  const next = (await gh('POST', '/git/commits', { message, tree: nextTree.sha, parents: [parent] })) as { sha?: string }
  if (!next.sha) throw new Error('github: missing commit sha')
  await gh('PATCH', `/git/refs/heads/${options.branch}`, { sha: next.sha })
}

function repoPath(contentRoot: string, vfsPath: string): string {
  const relative = vfsPath.replace(/^\/+/, '')
  const root = contentRoot.replace(/^\/+|\/+$/g, '')
  return root ? `${root}/${relative}` : relative
}
