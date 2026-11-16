// 来源 REQ-SG-01 / INV-01 / INV-03 / IDEM-01：构建只发布 content/。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentPlugin } from '../../vite/content'
import { REPO, walk } from '../_support/repo'

interface Emitted {
  fileName: string
  source: string | Uint8Array
}

/** Run the plugin's bundle hook against one directory with a stub context. */
function emit(dir: string): Emitted[] {
  const plugin = contentPlugin(dir)
  const out: Emitted[] = []
  const context = {
    emitFile(file: Emitted) {
      out.push(file)
    },
  }
  // The hook only needs emitFile; the plugin never touches the rest of the bundle.
  ;(plugin.generateBundle as unknown as (this: unknown) => void).call(context)
  return out
}

function manifestFiles(emitted: Emitted[]): { path: string; url: string }[] {
  const entry = emitted.find((file) => file.fileName === 'fs/manifest.json')
  expect(entry).toBeDefined()
  return (JSON.parse(String(entry!.source)) as { files: { path: string; url: string }[] }).files
}

const made: string[] = []
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

/** A tiny content tree, so the hook can be exercised without the real PDFs. */
function sample(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sg-content-'))
  made.push(dir)
  mkdirSync(join(dir, 'notes'))
  writeFileSync(join(dir, 'about.txt'), 'about\n')
  writeFileSync(join(dir, 'notes', 'a.md'), '# a\n')
  writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))
  return dir
}

describe('REQ-SG-01 build publishes content only', () => {
  it('emits the manifest plus one asset per file', () => {
    const emitted = emit(sample())
    expect(emitted).toHaveLength(4)
    expect(manifestFiles(emitted)).toHaveLength(3)
  })

  it('prefixes every emitted file with fs/', () => {
    for (const file of emit(sample())) expect(file.fileName.startsWith('fs/')).toBe(true)
  })

  it('maps every manifest path back to a real file', () => {
    const dir = sample()
    for (const file of manifestFiles(emit(dir))) {
      expect(existsSync(join(dir, file.path.replace(/^\//, '')))).toBe(true)
      expect(file.url.startsWith('fs/')).toBe(true)
    }
  })

  it('emits the same names and bytes twice', () => {
    const dir = sample()
    const first = emit(dir)
    const second = emit(dir)
    expect(first.map((file) => file.fileName)).toEqual(second.map((file) => file.fileName))
    expect(first.map((file) => String(file.source))).toEqual(second.map((file) => String(file.source)))
  })

  it('walks the real content tree and nothing beside it', () => {
    const published = new Set(manifestFiles(emit(join(REPO, 'content'))).map((file) => file.path))
    const contentFiles = new Set(walk('content').map((path) => path.replace(/^content/, '')))
    expect(published).toEqual(contentFiles)
  })

  it('never names an architecture directory', () => {
    for (const file of emit(join(REPO, 'content'))) {
      for (const dir of ['intent/', 'spec/', 'tests/', 'uml/', 'tools/']) {
        expect(file.fileName.startsWith(`fs/${dir}`)).toBe(false)
      }
    }
  })
})
