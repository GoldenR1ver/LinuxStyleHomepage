// 来源 DEP-01：kernel 是底层，不 import ui、shell、remote、mux、app。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO, walk } from '../_support/repo'

describe('DEP-01 kernel layering', () => {
  it('has no kernel file importing an upper layer', () => {
    const offenders: string[] = []
    for (const file of walk('src/kernel')) {
      if (!/\.ts$/.test(file)) continue
      const text = readFileSync(join(REPO, file), 'utf8')
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        const spec = match[1]!
        if (!spec.startsWith('..')) continue
        if (/(^|\/)(ui|shell|remote|mux|app)\//.test(spec) || /^\.\.\/(ui|shell|remote|mux|app)$/.test(spec)) {
          offenders.push(`${file}: ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('passes the dependency gate on the real tree', () => {
    const run = spawnSync(process.execPath, ['tools/gates/depCheck.mjs'], { cwd: REPO, encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('G-DEP-01  越界 import 0 处')
  })
})
