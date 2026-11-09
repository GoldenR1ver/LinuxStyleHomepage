import { describe, expect, it } from 'vitest'
import { Journal } from './journal'
import type { MutationStep } from './types'

const step: MutationStep = {
  path: '/home/owner/about.md',
  beforeLocal: null,
  beforeRemote: null,
  inverseRemote: { path: '/home/owner/about.md', content: 'old', encoding: 'utf-8' },
}

describe('journal', () => {
  it('drops events outside the retention window', () => {
    let now = 10 * 24 * 60 * 60 * 1000
    const journal = new Journal({ events: [], mutations: [] }, 7, () => now, () => 'id')
    journal.recordEvent({ user: 'ada', role: 'guest', action: 'exec', detail: 'ls' })
    now += 8 * 24 * 60 * 60 * 1000
    journal.recordEvent({ user: 'ada', role: 'guest', action: 'exec', detail: 'pwd' })
    expect(journal.events().map((item) => item.detail)).toEqual(['pwd'])
  })

  it('selects a mutation and everything newer', () => {
    let n = 0
    const journal = new Journal({ events: [], mutations: [] }, 7, () => 1_000 + n, () => `m${n}`)
    n = 1
    journal.recordMutation({ user: 'root', command: 'first', steps: [step] })
    n = 2
    journal.recordMutation({ user: 'root', command: 'second', steps: [step] })
    expect(journal.rollbackSet('m1').map((item) => item.command)).toEqual(['second', 'first'])
    journal.markReverted('m2')
    expect(journal.rollbackSet('m1').map((item) => item.command)).toEqual(['first'])
    expect(journal.mutations(true)).toHaveLength(2)
    expect(journal.mutations()).toHaveLength(1)
  })
})
