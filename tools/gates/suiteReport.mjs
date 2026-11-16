#!/usr/bin/env node
/**
 * G-TEST-01: the suite is green and not empty.
 *
 * Usage: node tools/gates/suiteReport.mjs [report.json]
 * Reads a vitest JSON reporter file, or stdin when no path is given.
 * Exits 1 when any test failed, when nothing ran, or when the report is unreadable.
 * The negative test feeds a synthetic failing report, so this script stays cheap.
 */
import { readFileSync } from 'node:fs'

export function judge(report) {
  const problems = []
  const total = Number(report?.numTotalTests ?? 0)
  const failed = Number(report?.numFailedTests ?? 0)
  const suites = Number(report?.numTotalTestSuites ?? 0)
  if (!Number.isFinite(total) || total === 0) {
    problems.push('no test ran; an empty suite is not a pass')
  }
  if (!Number.isFinite(suites) && total > 0) {
    problems.push('report has no suite count')
  }
  if (failed > 0) problems.push(`${failed} test(s) failed`)
  if (report?.success === false && failed === 0) problems.push('report marked unsuccessful')
  return problems
}

function readInput() {
  const path = process.argv[2]
  if (path) return readFileSync(path, 'utf8')
  return readFileSync(0, 'utf8')
}

let problems
try {
  problems = judge(JSON.parse(readInput()))
} catch (err) {
  problems = [`报告读不出：${err.message}`]
}

console.log(`G-TEST-01  测试报告问题 ${problems.length} 个`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
