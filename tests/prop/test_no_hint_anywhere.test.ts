// 来源 INV-04 / FORB-06 / REQ-SG-12：命令、补全、man、help 都不出现这个名字。
import { describe, expect, it } from 'vitest'
import { allCommands, commandNames } from '../../src/shell/commands'
import { completeLine } from '../../src/shell/complete'
import { runLine } from '../../src/shell/runner'
import { boot } from '../../src/testkit'
import { read } from '../_support/repo'

const NAME = 'specgate'

describe('INV-04 the command set matches the help page', () => {
  it('lists every command name in help', async () => {
    const { ctx } = boot()
    ctx.columns = 100
    const result = await runLine('help', ctx)
    const text = result.stdout ?? ''
    for (const spec of allCommands()) expect(text).toContain(spec.name)
  })

  it('keeps the table free of the name', () => {
    expect(commandNames().filter((name) => name.includes(NAME))).toEqual([])
  })
})

describe('FORB-06 no hint of the name anywhere', () => {
  it('offers no completion candidate starting with spec', () => {
    const { ctx } = boot()
    for (const prefix of ['s', 'sp', 'spec', 'specgate', 'specgate ']) {
      const result = completeLine(prefix, ctx)
      expect(result.matches.filter((name) => name.includes(NAME))).toEqual([])
    }
  })

  it('prints no man page for it', async () => {
    const { ctx } = boot()
    const result = await runLine(`man ${NAME}`, ctx)
    expect(result.code).toBe(1)
    expect(result.stdout ?? '').toBe('')
  })

  it('answers which with not found', async () => {
    const { ctx } = boot()
    const result = await runLine(`which ${NAME}`, ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('not found')
  })

  it('keeps the name out of every entry point a guest lands on', () => {
    // The works/ page for the Specgate project may name it; that is content,
    // not an entry point. What must stay clean is what the shell offers first.
    for (const file of ['content/etc/motd', 'content/etc/issue', 'content/home/owner/about.txt']) {
      expect(read(file).toLowerCase()).not.toContain(NAME)
    }
  })
})
