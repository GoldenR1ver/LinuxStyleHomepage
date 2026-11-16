// 来源 GATE G-REF-01：门自己的负向测。造一棵缺文件的树，门必须红。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

function gate(root: string) {
  return spawnSync(process.execPath, ['tools/gates/refsCheck.mjs', root], { cwd: REPO, encoding: 'utf8' })
}

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sg-ref-'))
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
  return dir
}

describe('G-REF-01 negative test', () => {
  it('goes red when a spec test path does not exist', () => {
    const dir = tree({
      'spec/spec.yaml': 'requirements:\n  - id: REQ-X\n    tests: [tests/acc/test_gone.test.ts]\n',
      'spec/const.yaml': 'constraints: []\n',
      'tests/MANIFEST.yaml': 'manifest: []\n',
    })
    const run = gate(dir)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('断链 tests/acc/test_gone.test.ts')
  })

  it('goes red when a map promises a missing diagram', () => {
    const dir = tree({
      'spec/spec.yaml': '',
      'spec/const.yaml': 'constraints: []\n',
      'tests/MANIFEST.yaml': 'manifest: []\n',
      'uml/README.md': 'see uml/state.md\n',
    })
    const run = gate(dir)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('断链 uml/state.md')
  })

  it('is green on the real tree', () => {
    const run = gate(REPO)
    expect(run.stdout).toContain('G-REF-01  断链 0 处')
    expect(run.status).toBe(0)
  })
})
