#!/usr/bin/env node
/**
 * G-WORD-01: no vague word in this round's machine-read documents.
 *
 * Usage: node tools/gates/bannedWords.mjs [file ...]
 * No argument scans the Specgate documents listed in DEFAULT.
 * Comment lines are skipped so a note cannot turn the gate red.
 * Exits 1 when a word is found, and names the file, the line and the word.
 */
import { readFileSync } from 'node:fs'
import { stripComment, readLines } from './_flow.mjs'

const DEFAULT = ['spec/spec.yaml', 'spec/const.yaml', 'intent/intent.yaml']

const WORDS = ['should', 'may', '可以', '快速', '支持', '处理', '等', '尽量']

export function checkFile(path) {
  const text = readFileSync(path, 'utf8')
  const problems = []
  readLines(text).forEach((raw, index) => {
    const line = stripComment(raw)
    if (!line.trim()) return
    const low = line.toLowerCase()
    for (const word of WORDS) {
      if (low.includes(word)) {
        problems.push(`${path}:${index + 1}: 模糊词 "${word}" -> ${line.trim()}`)
      }
    }
  })
  return problems
}

export function check(paths = DEFAULT) {
  return paths.flatMap((path) => checkFile(path))
}

const args = process.argv.slice(2)
const problems = check(args.length ? args : DEFAULT)
console.log(`G-WORD-01  模糊词 ${problems.length} 处`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
