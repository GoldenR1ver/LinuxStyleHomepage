import { describe, expect, it } from 'vitest'
import { createShell } from '../app/session'
import { boot, guest } from '../testkit'
import { runLine } from '../shell/runner'
import { Mux, RATIO_MAX, RATIO_MIN, type Layout } from './mux'

/** A shell pane on a real (if tiny) machine, attached to a mux. */
function session() {
  const { rt } = boot({ user: guest('ada') })
  const ctx = createShell(rt, guest('ada'), '/home/ada')
  const mux = new Mux((from) => createShell(rt, from?.user ?? ctx.user, from?.cwd ?? '/home/ada'))
  const pane = mux.start('main', ctx)
  rt.mux = mux
  const run = (line: string) => runLine(line, ctx)
  return { ctx, mux, pane, run }
}

/** The first split node in a layout, or null. */
function firstSplit(layout: Layout): Extract<Layout, { t: 'row' | 'col' }> | null {
  if (layout.t === 'pane') return null
  return layout
}

describe('tmux', () => {
  it('lists sessions, windows and panes', async () => {
    const { run } = session()
    expect((await run('tmux ls')).stdout).toBe('main* 1 window\n')
    expect((await run('tmux list-windows')).stdout).toContain('0: sh*')
    expect((await run('tmux list-panes')).stdout).toContain('*')
  })

  it('splits both ways and reports the pane tally', async () => {
    const { mux, run } = session()
    expect((await run('tmux split-window')).code).toBe(0)
    expect((await run('tmux split-window -h')).code).toBe(0)
    expect(mux.paneCount()).toBe(3)
    expect((await run('tmux list-windows')).stdout).toContain('(3 panes)')
  })

  it('moves between panes', async () => {
    const { mux, run } = session()
    await run('tmux split-window -h')
    const right = mux.activePane().id
    expect((await run('tmux select-pane -L')).code).toBe(0)
    expect(mux.activePane().id).not.toBe(right)
    expect((await run('tmux select-pane -R')).code).toBe(0)
    expect(mux.activePane().id).toBe(right)
  })

  it('resizes the divider in cells and keeps both sides usable', async () => {
    const { mux, run } = session()
    await run('tmux split-window -h')
    const before = firstSplit(mux.attachedSession().windows[0]!.layout)
    expect(before?.ratio).toBe(0.5)

    // The new pane is on the right, so `-L` moves its left edge outward.
    expect((await run('tmux resize-pane -L 5')).code).toBe(0)
    const after = firstSplit(mux.attachedSession().windows[0]!.layout)
    expect(after?.ratio).toBeLessThan(0.5)

    // `-R` from the right pane has no divider to reach.
    expect((await run('tmux resize-pane -R')).code).toBe(1)
  })

  it('clamps the ratio so neither side can vanish', async () => {
    const { mux, run } = session()
    await run('tmux split-window -h')
    for (let i = 0; i < 50; i++) await run('tmux resize-pane -L')
    expect(firstSplit(mux.attachedSession().windows[0]!.layout)?.ratio).toBe(RATIO_MIN)

    await run('tmux select-pane -L')
    for (let i = 0; i < 80; i++) await run('tmux resize-pane -R')
    expect(firstSplit(mux.attachedSession().windows[0]!.layout)?.ratio).toBe(RATIO_MAX)
  })

  it('refuses a resize with no divider in that direction', async () => {
    const { run } = session()
    // A single pane has no split at all.
    const result = await run('tmux resize-pane -L')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('no divider')
  })

  it('names a window and lists the new name', async () => {
    const { run } = session()
    expect((await run('tmux rename-window notes')).code).toBe(0)
    expect((await run('tmux list-windows')).stdout).toContain('0: notes*')
    expect((await run('tmux rename-window ""')).code).toBe(1)
  })

  it('selects and closes windows by index', async () => {
    const { mux, run } = session()
    await run('tmux new-window')
    await run('tmux new-window')
    expect(mux.attachedSession().windows).toHaveLength(3)

    expect((await run('tmux select-window -t 0')).code).toBe(0)
    expect(mux.attachedSession().active).toBe(0)
    expect((await run('tmux select-window -t 9')).code).toBe(1)
    expect((await run('tmux select-window -t x')).code).toBe(1)

    expect((await run('tmux kill-window')).code).toBe(0)
    expect(mux.attachedSession().windows).toHaveLength(2)
  })

  it('keeps windows and sessions apart', async () => {
    const { mux, run } = session()
    await run('tmux new-window')
    await run('tmux new -s work')
    expect((await run('tmux ls')).stdout).toContain('work* 1 window')
    expect((await run('tmux ls')).stdout).toContain('main 2 windows')
    expect((await run('tmux kill-session -t work')).code).toBe(0)
    expect(mux.attachedSession().name).toBe('main')
  })

  it('refuses to kill the last pane or the last window', async () => {
    const { run } = session()
    expect((await run('tmux kill-pane')).code).toBe(1)
    expect((await run('tmux kill-window')).code).toBe(1)
  })

  it('reports that tmux is missing where there is no mux', async () => {
    const { rt } = boot()
    const ctx = createShell(rt, guest('ada'), '/home/ada')
    rt.mux = null
    const result = await runLine('tmux ls', ctx)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('not available')
  })
})
