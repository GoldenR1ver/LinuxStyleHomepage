// 来源 GATE G-INV-01：门自己的负向测。造无 check、断 ref 两种样本。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

function gate(file: string, root: string) {
  return spawnSync(process.execPath, ['tools/gates/constCoverage.mjs', file, root], {
    cwd: REPO,
    encoding: 'utf8',
  })
}

function sample(text: string): { file: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'sg-inv-'))
  const file = join(root, 'const.yaml')
  writeFileSync(file, text)
  return { file, root }
}

describe('G-INV-01 negative test', () => {
  it('goes red on a constraint without a check', () => {
    const { file, root } = sample('constraints:\n  - id: INV-99\n    kind: invariant\n    statement: "x"\n')
    const run = gate(file, root)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('INV-99: 无 check.type')
  })

  it('goes red when the ref cannot be opened', () => {
    const { file, root } = sample(
      'constraints:\n  - id: INV-98\n    kind: invariant\n    check: { type: property, ref: tests/prop/test_gone.ts }\n',
    )
    const run = gate(file, root)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('ref 打不开 tests/prop/test_gone.ts')
  })

  it('is green on the real const file', () => {
    const run = gate('spec/const.yaml', REPO)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('G-INV-01  约束问题 0 个')
  })
})
