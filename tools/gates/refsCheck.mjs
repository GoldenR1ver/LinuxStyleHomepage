#!/usr/bin/env node
/**
 * G-REF-01: every path this round's documents promise can be opened.
 *
 * Usage: node tools/gates/refsCheck.mjs [root]
 * Root defaults to the repository. It scans:
 *   spec/spec.yaml            tests: [...]
 *   spec/const.yaml           check: { ref: ... }
 *   tests/MANIFEST.yaml       path: ...
 *   the four UML documents    every token that looks like a file
 * It also asserts that every *.test.ts under tests/ is registered in the
 * manifest, so a new test cannot become invisible.
 * Exits 1 and names the file and the broken path.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { readLines, stripComment } from './_flow.mjs'

const ROOT = resolve(process.argv[2] ?? '.')

const FILE = /[A-Za-z0-9_./-]+\.(?:yaml|yml|csv|md|txt|ts|mjs|json)/g

/** Documents whose prose and tables are promises to the reader. */
const MAPS = [
  'uml/README.md',
  'uml/state.md',
  'uml/sequence.md',
  'uml/dependency.md',
]

const STRUCTURED = ['spec/spec.yaml', 'spec/const.yaml', 'tests/MANIFEST.yaml']

function exists(rel) {
  return existsSync(join(ROOT, rel))
}

/** Paths written inside a bracketed field such as tests: [a, b]. */
function bracketedPaths(line) {
  const match = /\[(.*)\]/.exec(line)
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('"') && !part.includes(' '))
}

export function check(root = ROOT) {
  const problems = []
  const target = (rel) => existsSync(join(root, rel))
  for (const rel of STRUCTURED) {
    const full = join(root, rel)
    if (!existsSync(full)) {
      problems.push(`${rel}: 文件不存在`)
      continue
    }
    for (const raw of readLines(readFileSync(full, 'utf8'))) {
      const line = stripComment(raw)
      if (!line.trim()) continue
      const paths = []
      if (/^\s*(?:- )?tests:/.test(line)) paths.push(...bracketedPaths(line))
      const ref = /ref:\s*([^\s,}]+)/.exec(line)
      if (ref) paths.push(ref[1])
      if (/^\s*- \{ path:/.test(line) || /^\s*path:/.test(line)) {
        const entry = /path:\s*([^\s,}]+)/.exec(line)
        if (entry) paths.push(entry[1])
      }
      for (const candidate of paths) {
        if (candidate === 'none' || candidate === '-' || candidate.includes('<')) continue
        if (/^[A-Za-z]+-/.test(candidate) && !candidate.includes('/')) continue
        if (!target(candidate)) problems.push(`${rel}: 断链 ${candidate}`)
      }
    }
  }

  for (const rel of MAPS) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    for (const raw of readLines(readFileSync(full, 'utf8'))) {
      const line = stripComment(raw)
      for (const token of line.match(FILE) ?? []) {
        if (token.includes('<') || token.startsWith('-')) continue
        // A link may be written from the repository root or from the file's own directory.
        const fromRoot = target(token)
        const fromSibling = target(join(dirname(rel), token))
        if (!fromRoot && !fromSibling) problems.push(`${rel}: 断链 ${token}`)
      }
    }
  }

  // Every test file must be registered, and every registered file must exist.
  const manifest = join(root, 'tests/MANIFEST.yaml')
  if (existsSync(manifest)) {
    const text = readFileSync(manifest, 'utf8')
    const listed = new Set(
      [...text.matchAll(/path:\s*(tests\/\S+?\.test\.ts)/g)].map((match) => match[1]),
    )
    for (const rel of walkTests(join(root, 'tests'))) {
      if (!listed.has(rel)) problems.push(`tests/MANIFEST.yaml: 未登记的用例 ${rel}`)
    }
    for (const rel of listed) {
      if (!target(rel)) problems.push(`tests/MANIFEST.yaml: 断链 ${rel}`)
    }
  }

  return problems
}

/** Every *.test.ts under tests/, as a repository-relative path. */
function walkTests(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTests(full))
    else if (entry.name.endsWith('.test.ts')) {
      out.push(relative(ROOT, full).split(sep).join('/'))
    }
  }
  return out
}

const problems = check()
console.log(`G-REF-01  断链 ${problems.length} 处`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
