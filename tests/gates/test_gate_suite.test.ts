// 来源 POST-01：六道文档门一起跑时以 0 退出，且每道门都真的执行了。
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO, read } from '../_support/repo'

function run() {
  return spawnSync(process.execPath, ['tools/gates/run.mjs'], { cwd: REPO, encoding: 'utf8' })
}

describe('POST-01 the document gates pass together', () => {
  it('exits 0 and reports every gate', () => {
    const result = run()
    expect(result.status).toBe(0)
    for (const id of ['G-WORD-01', 'G-DRAFT-01', 'G-REF-01', 'G-INV-01', 'G-DT-01', 'G-DEP-01']) {
      expect(result.stdout).toContain(id)
    }
    expect(result.stdout).toContain('全部文档门绿')
  })

  it('takes its gate list from the runner, so a new gate cannot be skipped', () => {
    // Read the ids out of run.mjs rather than hard-coding a count that drifts.
    const source = read('tools/gates/run.mjs')
    const declared = [...source.matchAll(/\['(G-[A-Z]+-\d+)'/g)].map((match) => match[1]!)
    expect(declared.length).toBeGreaterThanOrEqual(6)
    // One run answers every id; a run per id costs minutes and proves nothing more.
    const stdout = run().stdout
    for (const id of declared) expect(stdout).toContain(id)
  })

  it('anchors every child at the repository, so an outside run cannot false-green', () => {
    const run = spawnSync(process.execPath, [join(REPO, 'tools', 'gates', 'run.mjs')], {
      cwd: tmpdir(),
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('全部文档门绿')
    expect(run.stdout).toContain('草稿痕迹 0 处')
  })
})
