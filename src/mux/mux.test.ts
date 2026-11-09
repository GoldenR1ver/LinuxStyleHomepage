import { describe, expect, it } from 'vitest'
import type { ShellCtx } from '../shell/context'
import { Mux } from './mux'

function ctx(): ShellCtx {
  return {
    user: { name: 'ada', role: 'guest' },
    cwd: '/home/owner',
    env: {},
    aliases: {},
    history: [],
    rt: {} as ShellCtx['rt'],
    host: {
      async readStdin() {
        return ''
      },
      async askSecret() {
        return null
      },
    },
    columns: 80,
    closing: false,
    line: '',
  }
}

describe('mux', () => {
  it('splits, moves and refuses to close the last pane', () => {
    const mux = new Mux((from) => {
      const next = ctx()
      if (from) next.cwd = from.cwd
      return next
    })
    const first = mux.start('main', ctx())
    expect(mux.paneCount()).toBe(1)
    expect(mux.killPane()).toBe(false)
    mux.split('h')
    expect(mux.paneCount()).toBe(2)
    expect(mux.activePane().id).not.toBe(first.id)
    mux.selectPane('L')
    expect(mux.activePane().id).toBe(first.id)
    expect(mux.killPane()).toBe(true)
    expect(mux.paneCount()).toBe(1)
    mux.newWindow()
    expect(mux.attachedSession().windows).toHaveLength(2)
    mux.nextWindow(-1)
    expect(mux.attachedSession().active).toBe(0)
  })
})
