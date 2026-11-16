import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const REPO = process.cwd()

/** The nine artifacts of one round, in step order. Step 9 has no file. */
export const ARTIFACTS = [
  'intent/intent.yaml',
  'spec/spec.yaml',
  'spec/decisionTable/decisions.csv',
  'spec/const.yaml',
  'intent/prototype.md',
  'tests/MANIFEST.yaml',
  'spec/gates/gate.yaml',
  'uml/README.md',
]

/** Directories the architecture owns. None of them may be published. */
export const ARCHITECTURE_DIRS = ['intent', 'spec', 'tests', 'uml', 'tools']

export function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

export function exists(rel: string): boolean {
  return existsSync(join(REPO, rel))
}

/** Every file under a directory, as repository-relative POSIX paths. */
export function walk(rel: string): string[] {
  const abs = join(REPO, rel)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(child))
    else if (entry.isFile()) out.push(child)
  }
  return out
}

export function posix(path: string): string {
  return path.split(sep).join('/')
}

export function rel(abs: string): string {
  return posix(relative(REPO, abs))
}
