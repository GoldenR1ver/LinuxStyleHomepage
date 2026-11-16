// 来源 GATE G-DT-01：门自己的负向测。造漏行、重叠、死行、未知动作四种样本。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

function gate(file?: string) {
  const args = ['tools/gates/dtCheck.mjs']
  if (file) args.push(file)
  return spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' })
}

function sample(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'sg-dt-')), 'decisions.csv')
  writeFileSync(
    file,
    [
      '---',
      'decision_table:',
      '  id: DT-SAMPLE',
      '  hit_policy: unique',
      '  conditions:',
      '    - { id: C1, domain: [true, false] }',
      '  actions:',
      '    - { id: A1 }',
      '    - { id: A2 }',
      '  rows:',
      body,
    ].join('\n'),
  )
  return file
}

describe('G-DT-01 negative test', () => {
  it('goes red on a missing combination', () => {
    const run = gate(sample('    - when: { C1: true }\n      do: [A1]\n'))
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('漏组合')
  })

  it('goes red on overlapping rows', () => {
    const run = gate(sample('    - when: { C1: "-" }\n      do: [A1]\n    - when: { C1: true }\n      do: [A2]\n'))
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('重叠')
  })

  it('goes red on a dead row', () => {
    const run = gate(
      sample(
        '    - when: { C1: true }\n      do: [A1]\n    - when: { C1: false }\n      do: [A2]\n    - when: { C1: "neither" }\n      do: [A1]\n',
      ),
    )
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('死行')
  })

  it('goes red on an unknown action', () => {
    const run = gate(
      sample('    - when: { C1: true }\n      do: [A9]\n    - when: { C1: false }\n      do: [A1]\n'),
    )
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('未知动作 A9')
  })

  it('is green on the real table', () => {
    const run = gate()
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('G-DT-01  决策表问题 0 个')
  })
})
