#!/usr/bin/env node
/**
 * G-DEP-01: the kernel is the bottom layer.
 *
 * Usage: node tools/gates/depCheck.mjs [dir] [forbidden ...]
 * Default subject is src/kernel; default forbidden zones are the four layers
 * that must never be reachable from it. An import is resolved relative to the
 * importing file, so ../ui/term from src/kernel lands in src/ui/term and is
 * caught, while ./policy stays inside the kernel.
 *
 * Exits 1 and names the file, the import and the zone it reached.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { readLines, stripComment } from './_flow.mjs'

const REPO = resolve('.')
const DEFAULT_DIR = 'src/kernel'
const DEFAULT_FORBIDDEN = ['src/ui', 'src/shell', 'src/remote', 'src/mux', 'src/app']

const [dir = DEFAULT_DIR, ...rest] = process.argv.slice(2)
const forbidden = rest.length ? rest : DEFAULT_FORBIDDEN

function walk(rel) {
  const abs = join(REPO, rel)
  if (!existsSync(abs)) return []
  const out = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(child))
    else if (/\.(?:ts|tsx|mjs)$/.test(entry.name)) out.push(child)
  }
  return out
}

/** The repository-relative path an import lands on, or null for a package. */
function target(file, spec) {
  if (!spec.startsWith('.')) return null
  return relative(REPO, resolve(dirname(join(REPO, file)), spec)).split(sep).join('/')
}

function zoneOf(targetPath) {
  return forbidden.find((zone) => targetPath === zone || targetPath.startsWith(`${zone}/`)) ?? null
}

export function check(subject = dir, zones = forbidden) {
  const problems = []
  for (const file of walk(subject)) {
    for (const raw of readLines(readFileSync(join(REPO, file), 'utf8'))) {
      const line = stripComment(raw)
      if (!/^\s*(?:import|export)\b/.test(line)) continue
      const spec = /from\s+['"]([^'"]+)['"]/.exec(line)?.[1]
      if (!spec) continue
      const landed = target(file, spec)
      if (!landed) continue
      const zone = zones.find((item) => landed === item || landed.startsWith(`${item}/`))
      if (zone) problems.push(`${file}: ${spec} -> ${zone}`)
    }
  }
  return problems
}

const problems = check()
console.log(`G-DEP-01  越界 import ${problems.length} 处（主语 ${dir}）`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
