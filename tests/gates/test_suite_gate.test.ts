// 来源 GATE G-TEST-01：门自己的负向测。喂一份合成的失败报告，门必须红。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

function gate(report: unknown | string) {
  const file = join(mkdtempSync(join(tmpdir(), 'sg-suite-')), 'report.json')
  writeFileSync(file, typeof report === 'string' ? report : JSON.stringify(report))
  return spawnSync(process.execPath, ['tools/gates/suiteReport.mjs', file], { cwd: REPO, encoding: 'utf8' })
}

describe('G-TEST-01 negative test', () => {
  it('goes red on a failing report', () => {
    const run = gate({ numTotalTests: 12, numTotalTestSuites: 3, numFailedTests: 1, success: false })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('1 test(s) failed')
  })

  it('goes red on an empty suite', () => {
    const run = gate({ numTotalTests: 0, numTotalTestSuites: 0, numFailedTests: 0, success: true })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('no test ran')
  })

  it('goes red on an unreadable report', () => {
    const run = gate('not json')
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('报告读不出')
  })

  it('stays green on a clean report', () => {
    const run = gate({ numTotalTests: 89, numTotalTestSuites: 16, numFailedTests: 0, success: true })
    expect(run.status).toBe(0)
  })
})
