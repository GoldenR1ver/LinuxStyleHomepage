// 来源 GATE G-DEP-01：门自己的负向测。造一个 kernel 里 import ui 的样本，门必须红。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO } from '../_support/repo'

/** The gate resolves imports from the repository, so the sample lives inside it. */
function sample(files: Record<string, string>): string {
  const dir = mkdtempSync(join(REPO, '.gate-tmp-'))
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
  return dir
}

function gate(dir: string, ...zones: string[]) {
  const subject = relative(REPO, dir).split(sep).join('/')
  return spawnSync(process.execPath, ['tools/gates/depCheck.mjs', subject, ...zones], {
    cwd: REPO,
    encoding: 'utf8',
  })
}

const made: string[] = []
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

describe('G-DEP-01 negative test', () => {
  it.each(['src/ui', 'src/shell', 'src/remote', 'src/mux', 'src/app'])(
    'goes red when the sample imports %s',
    (zone) => {
      const dir = sample({ 'probe.ts': `import type { X } from '../${zone}/somewhere'\n` })
      made.push(dir)
      const run = gate(dir)
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('越界 import')
    },
  )

  it('stays green on an import inside the subject', () => {
    const dir = sample({ 'probe.ts': "import { a } from './local'\n", 'local.ts': 'export const a = 1\n' })
    made.push(dir)
    expect(gate(dir).status).toBe(0)
  })

  it('stays green on a package import', () => {
    const dir = sample({ 'probe.ts': "import { describe } from 'vitest'\n" })
    made.push(dir)
    expect(gate(dir).status).toBe(0)
  })

  it('uses src/kernel as the default subject and is green there', () => {
    const run = spawnSync(process.execPath, ['tools/gates/depCheck.mjs'], { cwd: REPO, encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('主语 src/kernel')
    expect(run.stdout).toContain('越界 import 0 处')
  })
})
