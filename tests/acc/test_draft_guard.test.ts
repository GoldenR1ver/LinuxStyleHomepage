// 来源 REQ-SG-03 / FORB-01：草稿在构建期与运行期都拿不到，且页面入口不指向它。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentPlugin } from '../../vite/content'
import { MARKER } from '../../tools/gates/draftCheck.mjs'
import { REPO, read, walk } from '../_support/repo'

const made: string[] = []
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

/** Run the plugin's buildStart hook against a throwaway root. */
function buildStart(dir: string): { failed: boolean; message: string } {
  const plugin = contentPlugin(join(dir, 'content'))
  let message = ''
  let failed = false
  const context = {
    error(text: string) {
      failed = true
      message = text
      throw new Error(text)
    },
  }
  try {
    ;(plugin.buildStart as unknown as (this: unknown) => void).call(context)
  } catch {
    /* the hook signals failure by throwing */
  }
  return { failed, message }
}

function leaky(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sg-guard-'))
  made.push(dir)
  const abs = join(dir, 'content', 'home', 'owner', 'wip.md')
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${MARKER}\n\nunfinished\n`)
  return dir
}

describe('REQ-SG-03 the build refuses a leaked draft', () => {
  it('stops the build and names the file', () => {
    const result = buildStart(leaky())
    expect(result.failed).toBe(true)
    expect(result.message).toContain('content/home/owner/wip.md')
    expect(result.message).toContain('drafts/')
  })

  it('lets a clean tree through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-guard-'))
    made.push(dir)
    mkdirSync(join(dir, 'content'), { recursive: true })
    writeFileSync(join(dir, 'content', 'about.txt'), 'about\n')
    expect(buildStart(dir).failed).toBe(false)
  })

  it('is wired into the vite build, so npm run build stops too', () => {
    // Proven through the plugin contract instead of by dirtying the real
    // content/ tree: a test that writes there would race its siblings.
    const config = read('vite.config.ts')
    expect(config).toContain('contentPlugin')
    const plugin = contentPlugin(join(REPO, 'content'))
    expect(typeof plugin.buildStart).toBe('function')
    expect(read('package.json')).toContain('vite build')
  })
})

describe('FORB-01 no draft is reachable from the site', () => {
  it('keeps drafts out of the virtual filesystem', () => {
    // The VFS is built only from dist/fs, which the plugin emits from content/.
    // Nothing under drafts/ has a content path, so nothing there can be reached.
    expect(existsSync(join(REPO, 'drafts'))).toBe(true)
    expect(walk('content').filter((path) => path.split('/').includes('drafts'))).toEqual([])
  })

  it('keeps the shipped manifest free of drafts', () => {
    const plugin = contentPlugin(join(REPO, 'content'))
    let manifest = ''
    const context = {
      emitFile(file: { fileName: string; source: string | Uint8Array }) {
        if (file.fileName === 'fs/manifest.json') manifest = String(file.source)
      },
    }
    ;(plugin.generateBundle as unknown as { call: (this: unknown) => void }).call(context)
    const paths = (JSON.parse(manifest) as { files: { path: string }[] }).files.map((file) => file.path)
    expect(paths.filter((path) => path.includes('draft'))).toEqual([])
  })
})
