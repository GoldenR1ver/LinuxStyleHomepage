import { describe, expect, it } from 'vitest'
import { pageGroups } from './page'

const page = [
  'Intro line.',
  '',
  '/',
  '|-- etc',
  '|   `-- hostname',
  '',
  '```',
  'const x = 1',
  '',
  'const y = 2',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '    indented code',
  '',
  'Closing prose.',
].join('\n')

describe('pageGroups', () => {
  it('keeps trees, code fences, tables and indented code monospace', () => {
    const groups = pageGroups(page)
    const block = groups.filter((group) => group.block).map((group) => group.text).join('\n')
    expect(block).toContain('|-- etc')
    expect(block).toContain('|   `-- hostname')
    expect(block).toContain('const x = 1')
    expect(block).toContain('const y = 2')
    expect(block).toContain('| a | b |')
    expect(block).toContain('| 1 | 2 |')
    expect(block).toContain('    indented code')
    expect(groups.some((group) => group.text.includes('Closing prose.') && !group.block)).toBe(true)
  })

  it('keeps a plain page in one prose run', () => {
    expect(pageGroups('one\ntwo\n\nthree')).toEqual([{ text: 'one\ntwo\n\nthree', block: false }])
  })

  it('keeps blank lines inside a fence in the block', () => {
    const groups = pageGroups(['```', 'a', '', 'b', '```', 'after'].join('\n'))
    expect(groups[0]).toEqual({ text: '```\na\n\nb\n```', block: true })
    expect(groups[1]).toEqual({ text: 'after', block: false })
  })
})
