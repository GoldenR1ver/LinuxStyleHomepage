// 来源 REQ-SG-02 / REQ-SG-07 / REQ-SG-08 / INV-02 / FORB-01 / FORB-02：
// drafts/ 下的草稿既不进 git，也不进构建。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentPlugin } from '../../vite/content'
import { REPO, exists, read, walk } from '../_support/repo'

const SAMPLE = 'drafts/zz-probe-draft.md'

function ignored(path: string): boolean {
  const run = spawnSync('git', ['check-ignore', '-q', path], { cwd: REPO })
  return run.status === 0
}

function manifestPaths(): string[] {
  const plugin = contentPlugin(join(REPO, 'content'))
  let manifest = ''
  const context = {
    emitFile(file: { fileName: string; source: string | Uint8Array }) {
      if (file.fileName === 'fs/manifest.json') manifest = String(file.source)
    },
  }
  ;(plugin.generateBundle as unknown as { call: (this: unknown) => void }).call(context)
  return (JSON.parse(manifest) as { files: { path: string }[] }).files.map((file) => file.path)
}

afterEach(() => {
  const abs = join(REPO, SAMPLE)
  if (existsSync(abs)) rmSync(abs)
})

describe('REQ-SG-02 drafts live outside git', () => {
  it('keeps an explaining README tracked', () => {
    expect(exists('drafts/README.txt')).toBe(true)
    expect(read('drafts/README.txt')).toContain('chmod is not access control')
    expect(ignored('drafts/README.txt')).toBe(false)
  })

  it('ignores a new file dropped into drafts/', () => {
    writeFileSync(join(REPO, SAMPLE), 'unfinished\n')
    expect(ignored(SAMPLE)).toBe(true)
  })

  it('ignores every draft shape, not just one extension', () => {
    for (const name of ['a.md', 'b.txt', 'c.pdf', 'nested/deep.md']) {
      const rel = `drafts/${name}`
      const abs = join(REPO, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, 'x\n')
      try {
        expect({ rel, ignored: ignored(rel) }).toEqual({ rel, ignored: true })
      } finally {
        rmSync(abs, { force: true })
      }
    }
  })

  it('names the rule in .gitignore', () => {
    const text = read('.gitignore')
    expect(text).toContain('drafts/*')
    expect(text).toContain('!drafts/README.txt')
  })
})

describe('REQ-SG-05 no draft reaches the bundle', () => {
  it('keeps drafts out of the manifest', () => {
    writeFileSync(join(REPO, SAMPLE), 'unfinished\n')
    expect(manifestPaths().filter((path) => path.includes('drafts'))).toEqual([])
  })

  it('keeps content/ free of a drafts segment', () => {
    expect(walk('content').filter((path) => path.split('/').includes('drafts'))).toEqual([])
  })

  it('keeps the architecture out of the manifest too', () => {
    const published = manifestPaths()
    for (const dir of ['intent', 'spec', 'tests', 'uml', 'tools']) {
      expect({ dir, hits: published.filter((path) => path.startsWith(`/${dir}/`)) }).toEqual({ dir, hits: [] })
    }
  })
})
