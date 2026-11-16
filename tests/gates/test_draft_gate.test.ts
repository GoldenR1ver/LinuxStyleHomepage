// 来源 GATE G-DRAFT-01：门自己的负向测。造一个漏进 content/ 的草稿，门必须红。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MARKER, check } from '../../tools/gates/draftCheck.mjs'
import { REPO } from '../_support/repo'

const made: string[] = []
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

/** A throwaway root with a content/ tree. check() reads <root>/content. */
function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sg-draft-'))
  made.push(dir)
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, 'content', rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
  return dir
}

function gate(...args: string[]) {
  return spawnSync(process.execPath, ['tools/gates/draftCheck.mjs', ...args], { cwd: REPO, encoding: 'utf8' })
}

describe('G-DRAFT-01 negative test', () => {
  it('goes red on a marker in the first line', () => {
    const dir = root({ 'home/owner/x.md': `${MARKER}\n\nunfinished\n` })
    const problems = check(dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('草稿标记')
  })

  it('goes red on a marker deeper in the first five lines', () => {
    const dir = root({ 'notes/a.txt': `\n\n\n\n${MARKER}\nbody\n` })
    expect(check(dir)).toHaveLength(1)
  })

  it('stays green on the marker past the fifth line', () => {
    const dir = root({ 'notes/a.txt': `\n\n\n\n\n${MARKER}\n` })
    expect(check(dir)).toEqual([])
  })

  it('goes red on a drafts segment in the path', () => {
    const dir = root({ 'drafts/half-done.pdf': 'not really a pdf\n' })
    const problems = check(dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('路径段含 drafts')
  })

  it('does not read binaries for the marker', () => {
    const dir = root({ 'home/owner/me.pdf': MARKER })
    expect(check(dir)).toEqual([])
  })

  it('is green on a clean tree', () => {
    const dir = root({ 'home/owner/about.txt': 'about\n', 'etc/motd': 'welcome\n' })
    expect(check(dir)).toEqual([])
  })

  it('exits 1 as a script when a draft leaked', () => {
    const dir = root({ 'home/owner/x.md': `${MARKER}\n` })
    const run = gate(dir)
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('G-DRAFT-01')
  })

  it('is green on the real content tree', () => {
    const run = gate()
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('草稿痕迹 0 处')
  })

  it('anchors on the repository, not on the current directory', () => {
    // A gate run from tools/gates must still see the real content/ tree,
    // otherwise it reports a false green.
    const run = spawnSync(process.execPath, ['draftCheck.mjs'], {
      cwd: join(REPO, 'tools', 'gates'),
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('草稿痕迹 0 处')
  })
})
