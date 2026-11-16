// 来源 REQ-SG-05 / INV-04：命令表里没有 specgate。
import { describe, expect, it } from 'vitest'
import { allCommands, commandNames, lookup } from '../../src/shell/commands'
import { completeLine } from '../../src/shell/complete'
import { runLine } from '../../src/shell/runner'
import { boot } from '../../src/testkit'

describe('REQ-SG-02 no specgate command', () => {
  it('is absent from the command table', () => {
    expect(commandNames()).not.toContain('specgate')
    expect(lookup('specgate')).toBeUndefined()
    expect(allCommands().some((spec) => spec.name === 'specgate')).toBe(false)
  })

  it('is not offered by Tab completion', () => {
    const { ctx } = boot()
    for (const prefix of ['spec', 'specg', 'spe']) {
      const result = completeLine(prefix, ctx)
      expect(result.matches).not.toContain('specgate')
    }
  })

  it('is unknown to the shell', async () => {
    const { ctx } = boot()
    const result = await runLine('specgate', ctx)
    expect(result.code).not.toBe(0)
    expect(result.stdout ?? '').not.toContain('INT-HOME')
  })

  it('is unknown to help, man and which', async () => {
    const { ctx } = boot()
    for (const line of ['help specgate', 'man specgate', 'which specgate']) {
      const result = await runLine(line, ctx)
      expect({ line, code: result.code }).toEqual({ line, code: expect.any(Number) })
      expect(result.code).not.toBe(0)
      expect(result.stderr ?? '').toMatch(/not found|no entry/)
    }
  })

  it('does not mention the name in the help page', async () => {
    const { ctx } = boot()
    const result = await runLine('help', ctx)
    expect(result.stdout ?? '').not.toContain('specgate')
  })
})
