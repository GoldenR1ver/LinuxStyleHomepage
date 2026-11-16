#!/usr/bin/env node
/**
 * G-DT-01: the dispatch table has no gap, no overlap, no dead row, no typo.
 *
 * Usage: node tools/gates/dtCheck.mjs [file]
 * Default is spec/decisionTable/decisions.csv, which is YAML inside a .csv name.
 * Exits 1 on any problem and names the table, the row and the combination.
 */
import { readFileSync } from 'node:fs'
import { parseFlow, readLines, stripComment } from './_flow.mjs'

const DEFAULT = 'spec/decisionTable/decisions.csv'

function documents(text) {
  return String(text)
    .split(/^---\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk && /^\s*decision_table:/m.test(chunk))
}

function tables(text) {
  return documents(text).map((chunk) => {
    const table = { id: '?', hit_policy: 'unique', conditions: [], actions: [], rows: [] }
    const lines = readLines(chunk)
    let section = null
    for (let i = 0; i < lines.length; i += 1) {
      const line = stripComment(lines[i])
      if (!line.trim()) continue
      const top = /^(?:decision_table:|\s*)(id|hit_policy|scope|traces):\s*(.*)$/.exec(line)
      if (/^\s*conditions:/.test(line)) {
        section = 'conditions'
        continue
      }
      if (/^\s*actions:/.test(line)) {
        section = 'actions'
        continue
      }
      if (/^\s*rows:/.test(line)) {
        section = 'rows'
        continue
      }
      if (top && !/^\s*-/.test(line)) {
        if (top[1] === 'id') table.id = top[2].trim()
        if (top[1] === 'hit_policy') table.hit_policy = top[2].trim()
        continue
      }
      const flow = /^\s*-\s*(\{.*\})\s*$/.exec(line)
      if (flow && (section === 'conditions' || section === 'actions')) {
        const parsed = parseFlow(flow[1])
        if (section === 'conditions') {
          table.conditions.push({ id: parsed.id, domain: parsed.domain ?? [] })
        } else {
          table.actions.push({ id: parsed.id })
        }
        continue
      }
      const when = /^\s*-\s*when:\s*(\{.*\})\s*$/.exec(line)
      if (when) {
        const row = { when: parseFlow(when[1]), do: [] }
        const next = lines[i + 1] ? stripComment(lines[i + 1]) : ''
        const action = /^\s*do:\s*(\[.*\])\s*$/.exec(next)
        if (action) {
          row.do = parseFlow(action[1])
          i += 1
        }
        table.rows.push(row)
      }
    }
    return table
  })
}

function combos(table) {
  const ids = table.conditions.map((condition) => condition.id)
  let out = [{}]
  table.conditions.forEach((condition, index) => {
    const next = []
    for (const partial of out) {
      for (const value of condition.domain) next.push({ ...partial, [ids[index]]: value })
    }
    out = next
  })
  return out
}

function matches(when, combo) {
  for (const [id, value] of Object.entries(combo)) {
    const want = when[id] ?? '-'
    if (want === '-') continue
    if (Array.isArray(want)) {
      if (!want.includes(value)) return false
    } else if (want !== value) {
      return false
    }
  }
  return true
}

function checkTable(table) {
  const problems = []
  const { id, hit_policy: policy, conditions, actions, rows } = table
  const conditionIds = new Set(conditions.map((condition) => condition.id))
  const actionIds = new Set(actions.map((action) => action.id))

  if (!conditions.length) problems.push(`${id}: 无 conditions，表不成立`)
  if (!rows.length) problems.push(`${id}: 无 rows`)

  rows.forEach((row, index) => {
    for (const key of Object.keys(row.when)) {
      if (!conditionIds.has(key)) problems.push(`${id} 行${index}: 未知条件 ${key}`)
    }
    if (!row.do.length) problems.push(`${id} 行${index}: 无动作`)
    for (const action of row.do) {
      if (!actionIds.has(action)) problems.push(`${id} 行${index}: 未知动作 ${action}`)
    }
  })

  const reached = new Set()
  for (const combo of combos(table)) {
    const hits = rows.map((row, index) => (matches(row.when, combo) ? index : -1)).filter((index) => index >= 0)
    if (!hits.length) {
      problems.push(`${id}: 漏组合 ${JSON.stringify(combo)}`)
      continue
    }
    if (policy === 'unique' && hits.length > 1) {
      problems.push(`${id}: 行 ${hits.join(',')} 重叠于 ${JSON.stringify(combo)}`)
    }
    for (const hit of hits) reached.add(hit)
  }

  rows.forEach((_row, index) => {
    if (!reached.has(index)) problems.push(`${id} 行${index}: 死行，任何组合都走不到`)
  })

  return problems
}

export function check(path = DEFAULT) {
  return tables(readFileSync(path, 'utf8')).flatMap(checkTable)
}

const problems = check(process.argv[2] ?? DEFAULT)
console.log(`G-DT-01  决策表问题 ${problems.length} 个`)
for (const problem of problems) console.log(`  - ${problem}`)
process.exitCode = problems.length ? 1 : 0
