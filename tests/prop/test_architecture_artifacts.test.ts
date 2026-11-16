// 来源 REQ-SG-04 / PRE-01：架构仍然在仓库里，九件产物逐条可打开。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARTIFACTS, ARCHITECTURE_DIRS, REPO, exists, read } from '../_support/repo'

describe('REQ-SG-04 the architecture stays in the repository', () => {
  it('keeps the six directories', () => {
    for (const dir of [...ARCHITECTURE_DIRS, 'drafts']) expect(exists(dir)).toBe(true)
  })

  it.each(ARTIFACTS)('opens %s', (file) => {
    expect(existsSync(join(REPO, file))).toBe(true)
    expect(read(file).length).toBeGreaterThan(0)
  })

  it('keeps the gate scripts that judge it', () => {
    for (const script of [
      'tools/gates/bannedWords.mjs',
      'tools/gates/refsCheck.mjs',
      'tools/gates/constCoverage.mjs',
      'tools/gates/depCheck.mjs',
      'tools/gates/dtCheck.mjs',
      'tools/gates/suiteReport.mjs',
      'tools/gates/run.mjs',
    ]) {
      expect(exists(script)).toBe(true)
    }
  })

  it('carries a round number in the intent', () => {
    // The round increments each cycle, so assert the shape, not the value.
    expect(read('intent/intent.yaml')).toMatch(/^\s+round: \d+$/m)
  })
})
