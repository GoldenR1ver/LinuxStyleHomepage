// 来源 GATE G-WORD-01：门自己的负向测。造一个含模糊词的样本，门必须红。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

function gate(...args: string[]) {
  return spawnSync(process.execPath, ['tools/gates/bannedWords.mjs', ...args], { cwd: REPO, encoding: 'utf8' })
}

describe('G-WORD-01 negative test', () => {
  it('goes red on a sample with a vague word', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-word-'))
    const file = join(dir, 'spec.yaml')
    writeFileSync(file, 'requirements:\n  - id: REQ-X\n    shall: "系统应尽量快速地处理请求"\n')
    const run = gate(file)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('模糊词')
    expect(run.stdout).toContain('尽量')
  })

  it('ignores a comment line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-word-'))
    const file = join(dir, 'spec.yaml')
    writeFileSync(file, '# 这里可以写说明\nshall: "the system shall print one line"\n')
    expect(gate(file).status).toBe(0)
  })

  it('is green on the real documents', () => {
    const run = gate()
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('G-WORD-01  模糊词 0 处')
  })
})
