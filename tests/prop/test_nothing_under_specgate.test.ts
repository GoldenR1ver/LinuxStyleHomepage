// 来源 FORB-04 / FORB-05 / REQ-SG-10 / REQ-SG-11：站点里没有 specgate 这条路径。
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentPlugin } from '../../vite/content'
import { REPO, exists, walk } from '../_support/repo'

function manifestPaths(): string[] {
  const plugin = contentPlugin(join(REPO, 'content'))
  let manifest = ''
  const context = {
    emitFile(file: { fileName: string; source: string | Uint8Array }) {
      if (file.fileName === 'fs/manifest.json') manifest = String(file.source)
    },
  }
  ;(plugin.generateBundle as unknown as (this: unknown) => void).call(context)
  return (JSON.parse(manifest) as { files: { path: string }[] }).files.map((file) => file.path)
}

describe('FORB-01 the manifest has no workspace path', () => {
  it('registers no path under /home/owner/specgate', () => {
    const hits = manifestPaths().filter((path) => path.startsWith('/home/owner/specgate'))
    expect(hits).toEqual([])
  })

  it('registers no path segment named specgate', () => {
    const hits = manifestPaths().filter((path) => path.split('/').includes('specgate'))
    expect(hits).toEqual([])
  })
})

describe('FORB-02 content/ has no specgate entry', () => {
  it('has no directory or file with that name', () => {
    expect(walk('content').filter((path) => path.split('/').includes('specgate'))).toEqual([])
  })

  it('does not provide the old workspace directory', () => {
    expect(exists('content/home/owner/specgate')).toBe(false)
  })
})
