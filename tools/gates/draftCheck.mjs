/**
 * G-DRAFT-01: nothing under content/ looks like a draft.
 *
 * No shebang on purpose: the vite plugin and the gate tests import this module,
 * and a `#!` line makes esbuild reject it during transform. Run it with
 * `node tools/gates/draftCheck.mjs`, which needs no shebang.
 *
 * Usage: node tools/gates/draftCheck.mjs [root]
 * Root defaults to the repository. The predicate has one judgment with two
 * detectors, the same shape as G-WORD-01's word list:
 *   1 a path segment under content/ is named drafts
 *   2 a text file under content/ carries the marker in its first lines
 *
 * The marker is the contract. A draft starts with it; when a draft is copied
 * into content/ and the line is still there, the build stops until a person
 * removes it on purpose. That is the conscious publish step.
 *
 * Runs from the build (vite buildStart) and as a pre-commit gate, so the two
 * cannot drift: both call check().
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The first non-empty line of a draft. Case-sensitive on purpose. */
export const MARKER = 'DRAFT: unpublished'

/** Files whose bytes are read when looking for the marker. */
const TEXT = new Set(['.md', '.txt', '.log', '.json', '.csv', '.html', '.yml', '.yaml', ''])

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Text up to the fifth line, enough to hold a marker and its blank lines. */
function head(file) {
  return readFileSync(file, 'utf8').split('\n').slice(0, 5).join('\n')
}

/** Repository root: this file lives at tools/gates/, so two levels up. */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

export function check(root = REPO_ROOT) {
  const content = join(root, 'content')
  const problems = []
  for (const file of walk(content)) {
    const rel = relative(content, file).split(sep).join('/')
    if (rel.split('/').includes('drafts')) {
      problems.push(`content/${rel}: 路径段含 drafts`)
      continue
    }
    const ext = extname(file).toLowerCase()
    if (!TEXT.has(ext)) continue
    if (head(file).includes(MARKER)) {
      problems.push(`content/${rel}: 前五行含草稿标记 ${MARKER}`)
    }
  }
  return problems
}

// Compare absolute paths, not string tails: a suffix test breaks when the
// runner reports a path with different separators or a symlinked prefix.
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  // Anchor on the repository, never on the current directory: running from
  // tools/gates must not report a false green.
  const problems = check(process.argv[2] ?? REPO_ROOT)
  console.log(`G-DRAFT-01  草稿痕迹 ${problems.length} 处`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exitCode = problems.length ? 1 : 0
}
