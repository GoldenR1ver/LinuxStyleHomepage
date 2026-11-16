#!/usr/bin/env node
/**
 * Run the cheap document gates in one pass, cheapest first.
 * Usage: node tools/gates/run.mjs
 * G-TEST-01 is not here: it needs a real suite run, so it sits at merge.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Anchor every child at the repository, so running this from elsewhere cannot false-green. */
const REPO = resolve(HERE, '..', '..')

const GATES = [
  ['G-WORD-01', 'bannedWords.mjs'],
  ['G-DRAFT-01', 'draftCheck.mjs'],
  ['G-REF-01', 'refsCheck.mjs'],
  ['G-INV-01', 'constCoverage.mjs'],
  ['G-DT-01', 'dtCheck.mjs'],
  ['G-DEP-01', 'depCheck.mjs'],
]

let failed = 0
for (const [id, script] of GATES) {
  const run = spawnSync(process.execPath, [join(HERE, script)], { stdio: 'inherit', cwd: REPO })
  if (run.status !== 0) {
    failed += 1
    console.error(`${id} 红\n`)
  }
}

console.log(failed ? `${failed} 门红` : '全部文档门绿')
process.exitCode = failed ? 1 : 0
