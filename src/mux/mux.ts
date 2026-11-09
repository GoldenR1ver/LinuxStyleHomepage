import type { ShellCtx } from '../shell/context'
import type { PaneDir, SessionHost, SplitDir } from './host'

export type Layout =
  | { t: 'pane'; id: string }
  | { t: 'row'; a: Layout; b: Layout }
  | { t: 'col'; a: Layout; b: Layout }

export interface Win {
  id: string
  name: string
  layout: Layout
  active: string
}

export interface Session {
  name: string
  windows: Win[]
  active: number
}

export interface Pane {
  id: string
  pid: number
  ctx: ShellCtx
  cancel: () => void
}

/**
 * In-browser tmux.
 * This stores panes and splits. Drawing, keys, and each shell loop live in src/ui.
 */
export class Mux implements SessionHost {
  onPane: ((pane: Pane) => void) | null = null
  onLayout: (() => void) | null = null
  onStatus: (() => void) | null = null

  private sessions: Session[] = []
  private current: Session | null = null
  private readonly panes = new Map<string, Pane>()
  private seq = 0
  private pid = 0

  constructor(private readonly fork: (from: ShellCtx | null) => ShellCtx) {}

  start(name: string, ctx: ShellCtx): Pane {
    const pane = this.add(ctx)
    const session: Session = { name, windows: [this.windowFor(pane.id)], active: 0 }
    this.sessions = [session]
    this.current = session
    return pane
  }

  attachedSession(): Session {
    return this.require()
  }

  activePane(): Pane {
    const pane = this.panes.get(this.activeWindow().active)
    if (!pane) throw new Error('missing pane')
    return pane
  }

  paneCount(): number {
    return this.panes.size
  }

  listText(): string {
    if (!this.sessions.length) return ''
    return `${this.sessions
      .map((session) => `${session.name}${session === this.current ? '*' : ''} ${session.windows.length} windows`)
      .join('\n')}\n`
  }

  split(dir: SplitDir) {
    const win = this.activeWindow()
    const pane = this.add(this.fork(this.activePane().ctx))
    const previous = win.active
    win.layout = replacePane(win.layout, previous, (old) =>
      dir === 'h' ? { t: 'row', a: old, b: { t: 'pane', id: pane.id } } : { t: 'col', a: old, b: { t: 'pane', id: pane.id } },
    )
    win.active = pane.id
    this.onPane?.(pane)
    this.onLayout?.()
  }

  killPane(target = this.activeWindow().active): boolean {
    const session = this.require()
    if (countSession(session) <= 1) return false
    const winIndex = session.windows.findIndex((win) => hasPane(win.layout, target))
    const win = session.windows[winIndex]
    const pane = this.panes.get(target)
    if (!win || !pane) return false
    if (countLayout(win.layout) === 1) {
      session.windows.splice(winIndex, 1)
      if (session.active > winIndex) session.active -= 1
      if (session.active >= session.windows.length) session.active = session.windows.length - 1
    } else {
      const next = removePane(win.layout, target)
      if (!next) return false
      win.layout = next
      if (win.active === target) win.active = firstPane(next)
    }
    this.drop(pane)
    this.onLayout?.()
    return true
  }

  collect(): Pane[] {
    return [...this.panes.values()]
  }

  processes(): { pid: number; user: string; cwd: string; win: string; active: boolean }[] {
    const session = this.require()
    const rows: { pid: number; user: string; cwd: string; win: string; active: boolean }[] = []
    session.windows.forEach((win, index) => {
      for (const id of paneIds(win.layout)) {
        const pane = this.panes.get(id)
        if (!pane) continue
        rows.push({
          pid: pane.pid,
          user: pane.ctx.user.name,
          cwd: pane.ctx.cwd,
          win: String(index),
          active: index === session.active && id === win.active,
        })
      }
    })
    return rows
  }

  selectPane(dir: PaneDir) {
    const win = this.activeWindow()
    const next = neighbor(win.layout, win.active, dir)
    if (!next) return
    win.active = next
    this.onStatus?.()
  }

  focus(id: string) {
    const win = this.activeWindow()
    if (!hasPane(win.layout, id)) return
    win.active = id
    this.onStatus?.()
  }

  newWindow() {
    const session = this.require()
    const pane = this.add(this.fork(this.activePane().ctx))
    session.windows.push(this.windowFor(pane.id))
    session.active = session.windows.length - 1
    this.onPane?.(pane)
    this.onLayout?.()
  }

  nextWindow(delta: number) {
    const session = this.require()
    const count = session.windows.length
    session.active = (session.active + delta + count) % count
    this.onLayout?.()
  }

  selectWindow(index: number): boolean {
    const session = this.require()
    if (index < 0 || index >= session.windows.length) return false
    session.active = index
    this.onLayout?.()
    return true
  }

  newSession(name: string): boolean {
    if (!/^[\w.-]{1,32}$/.test(name)) return false
    if (this.sessions.some((session) => session.name === name)) return false
    const pane = this.add(this.fork(this.activePane().ctx))
    const session: Session = { name, windows: [this.windowFor(pane.id)], active: 0 }
    this.sessions.push(session)
    this.current = session
    this.onPane?.(pane)
    this.onLayout?.()
    return true
  }

  switchSession(name: string): boolean {
    const session = this.sessions.find((item) => item.name === name)
    if (!session) return false
    this.current = session
    this.onLayout?.()
    return true
  }

  killSession(name: string): boolean {
    if (this.sessions.length <= 1) return false
    const index = this.sessions.findIndex((session) => session.name === name)
    const session = this.sessions[index]
    if (!session) return false
    const ids = session.windows.flatMap((win) => paneIds(win.layout))
    this.sessions.splice(index, 1)
    if (this.current === session) this.current = this.sessions[Math.max(0, index - 1)] ?? null
    for (const id of ids) {
      const pane = this.panes.get(id)
      if (pane) this.drop(pane)
    }
    this.onLayout?.()
    return true
  }

  private activeWindow(): Win {
    const session = this.require()
    const win = session.windows[session.active]
    if (!win) throw new Error('missing window')
    return win
  }

  private require(): Session {
    if (!this.current) throw new Error('no session')
    return this.current
  }

  private add(ctx: ShellCtx): Pane {
    this.seq += 1
    this.pid += 1
    const pane: Pane = { id: `p${this.seq}`, pid: this.pid, ctx, cancel: () => {} }
    this.panes.set(pane.id, pane)
    return pane
  }

  private drop(pane: Pane) {
    pane.ctx.closing = true
    pane.cancel()
    this.panes.delete(pane.id)
  }

  private windowFor(paneId: string): Win {
    this.seq += 1
    return { id: `w${this.seq}`, name: 'sh', layout: { t: 'pane', id: paneId }, active: paneId }
  }
}

function countLayout(layout: Layout): number {
  if (layout.t === 'pane') return 1
  return countLayout(layout.a) + countLayout(layout.b)
}

function countSession(session: Session): number {
  return session.windows.reduce((sum, win) => sum + countLayout(win.layout), 0)
}

function firstPane(layout: Layout): string {
  return layout.t === 'pane' ? layout.id : firstPane(layout.a)
}

function paneIds(layout: Layout): string[] {
  return layout.t === 'pane' ? [layout.id] : [...paneIds(layout.a), ...paneIds(layout.b)]
}

function hasPane(layout: Layout, id: string): boolean {
  return paneIds(layout).includes(id)
}

function replacePane(layout: Layout, id: string, build: (old: Layout) => Layout): Layout {
  if (layout.t === 'pane') return layout.id === id ? build(layout) : layout
  return { t: layout.t, a: replacePane(layout.a, id, build), b: replacePane(layout.b, id, build) }
}

function removePane(layout: Layout, id: string): Layout | null {
  if (layout.t === 'pane') return layout.id === id ? null : layout
  const a = removePane(layout.a, id)
  const b = removePane(layout.b, id)
  if (a === layout.a && b === layout.b) return layout
  if (!a) return b
  if (!b) return a
  return { t: layout.t, a, b }
}

function neighbor(layout: Layout, id: string, dir: PaneDir): string | null {
  const path = findPath(layout, id)
  if (!path) return null
  const horizontal = dir === 'L' || dir === 'R'
  const forward = dir === 'R' || dir === 'D'
  for (let index = path.length - 2; index >= 0; index--) {
    const node = path[index]
    const child = path[index + 1]
    if (!node || node.t === 'pane' || !child) continue
    if ((node.t === 'row') !== horizontal) continue
    const inSecond = node.b === child
    if (forward && !inSecond) return edge(node.b, 'first')
    if (!forward && inSecond) return edge(node.a, 'last')
  }
  return null
}

function findPath(layout: Layout, id: string): Layout[] | null {
  if (layout.t === 'pane') return layout.id === id ? [layout] : null
  const left = findPath(layout.a, id)
  if (left) return [layout, ...left]
  const right = findPath(layout.b, id)
  if (right) return [layout, ...right]
  return null
}

function edge(layout: Layout, which: 'first' | 'last'): string {
  if (layout.t === 'pane') return layout.id
  return edge(which === 'first' ? layout.a : layout.b, which)
}
