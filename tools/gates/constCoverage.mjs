#!/usr/bin/env node
/**
 * G-INV-01: every constraint names one check, and the check can be opened.
 *
 * Usage: node tools/gates/constCoverage.mjs [const.yaml] [root]
 * Exits 1 and names the constraint id and the reason.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readLines, stripComment } from './_flow.mjs'

const FILE = 'spec/const.yaml'
const file = process.argv[2] ?? FILE
const root = resolve(process.argv[3] ?? '.')

export function blocks(text) {
  const out = []
  let current = null
  for (const raw of readLines(text)) {
    const line = stripComment(raw)
    const start = /^\s*-\s+id:\s*(\S+)/.exec(line)
    if (start) {
      current = { id: start[1], lines: [] }
      out.push(current)
      continue
    }
    if (/^\S/.test(line) && line.trim()) {
      current = null
      continue
    }
    if (current) current.lines.push(line)
  }
  return out
}

function field(block, name) {
  for (const line of block.lines) {
    const flow = new RegExp(`${name}:\\s*\\{([^}]*)\\}`).exec(line)
    if (flow) return flow[1]
  }
  for (const line of block.lines) {
    const plain = new RegExp(`^\\s*${name}:\\s*(.+)$`).exec(line)
    if (plain) return plain[1].trim()
  }
  return null
}

function refOf(block) {
  const flow = field(block, 'check')
  if (!flow) return null
  const match = /ref:\s*([^\s,}]+)/.exec(flow)
  return match ? match[1] : null
}

export function check(path = file, base = root) {
  const full = isAbsolute(path) ? path : join(base, path)
  if (!existsSync(full)) return [`${path}: 文件不存在`]
  const problems = []
  for (const block of blocks(readFileSync(full, 'utf8'))) {
    const kind = field(block, 'kind')
    const type = (() => {
      const flow = field(block, 'check')
      if (!flow) return null
      const match = /type:\s*([^\s,}]+)/.exec(flow)
      return match ? match[1] : null
    })()
    if (!type) {
      problems.push(`${block.id}: 无 check.type`)
      continue
    }
    const ref = refOf(block)
    if (!ref) {
      problems.push(`${block.id}: check 缺 ref`)
      continue
    }
    if (ref.includes('/') && !existsSync(join(base, ref))) {
      problems.push(`${block.id}: ref 打不开 ${ref}`)
    }
    if (kind === 'invariant' && !type) problems.push(`${block.id}: invariant 必须可判`)
  }
  return problems
}

const problems = check()
console.log(`G-INV-01  约束问题 ${problems.length} 个`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
