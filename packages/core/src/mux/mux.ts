import type { ShellCtx } from '../shell/context'

export type SplitDir = 'h' | 'v'
export type PaneDir = 'L' | 'R' | 'U' | 'D'

/** Multiplexer surface used by shell commands. The UI draws the result. */
export interface SessionHost {
  listText(): string
  split(dir: SplitDir): void
  killPane(): boolean
  selectPane(dir: PaneDir): void
  newWindow(): void
  nextWindow(delta: number): void
  selectWindow(index: number): boolean
  newSession(name: string): boolean
  switchSession(name: string): boolean
  killSession(name: string): boolean
  /** `tmux list-windows`: one line per window in the attached session. */
  windowsText(): string
  /** `tmux list-panes`: one line per pane in the active window. */
  panesText(): string
  /** `tmux rename-window NAME`, or null when no window carries that name. */
  renameWindow(name: string): boolean
  /** `tmux kill-window`, which collapses the session when it was the last one. */
  killWindow(): boolean
  /** `tmux resize-pane DIR [N]`: N cells, or one twentieth of the split. */
  resizePane(dir: PaneDir, cells?: number): boolean
}

export type Layout =
  | { t: 'pane'; id: string }
  | { t: 'row'; a: Layout; b: Layout; ratio: number }
  | { t: 'col'; a: Layout; b: Layout; ratio: number }

/** The share of the split the first child takes. Clamped so neither side vanishes. */
export const RATIO_MIN = 0.1
export const RATIO_MAX = 0.9

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
      .map((session) => {
        const count = session.windows.length
        const mark = session === this.current ? '*' : ''
        return `${session.name}${mark} ${count} ${count === 1 ? 'window' : 'windows'}`
      })
      .join('\n')}\n`
  }

  split(dir: SplitDir) {
    const win = this.activeWindow()
    const pane = this.add(this.fork(this.activePane().ctx))
    const previous = win.active
    win.layout = replacePane(win.layout, previous, (old): Layout =>
      dir === 'h'
        ? { t: 'row', a: old, b: { t: 'pane', id: pane.id }, ratio: 0.5 }
        : { t: 'col', a: old, b: { t: 'pane', id: pane.id }, ratio: 0.5 },
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

  /* ---------------------------------------------------------------- */
  /* inspection, naming and geometry                                  */
  /* ---------------------------------------------------------------- */

  windowsText(): string {
    const session = this.require()
    return `${session.windows
      .map((win, index) => {
        const mark = index === session.active ? '*' : ' '
        const panes = countLayout(win.layout)
        return `${index}: ${win.name}${mark}${panes > 1 ? ` (${panes} panes)` : ''}`
      })
      .join('\n')}\n`
  }

  panesText(): string {
    const win = this.activeWindow()
    const width = this.snapshot().find((pane) => pane.active)?.width ?? 0
    return `${paneIds(win.layout)
      .map((id) => {
        const mark = id === win.active ? '*' : ' '
        const size = id === win.active && width ? ` ${width} cols` : ''
        return `${id}${mark}${size}`
      })
      .join('\n')}\n`
  }

  renameWindow(name: string): boolean {
    const clean = name.trim()
    if (!clean || clean.length > 32 || /[\r\n\0]/.test(clean)) return false
    this.activeWindow().name = clean
    this.onStatus?.()
    return true
  }

  killWindow(): boolean {
    const session = this.require()
    if (session.windows.length <= 1) return false
    const index = session.active
    const win = session.windows[index]
    if (!win) return false
    for (const id of paneIds(win.layout)) {
      const pane = this.panes.get(id)
      if (pane) this.drop(pane)
    }
    session.windows.splice(index, 1)
    session.active = Math.min(index, session.windows.length - 1)
    this.onLayout?.()
    return true
  }

  /**
   * Move the divider that faces `dir`. `cells` is a terminal width, so the
   * caller's console is the unit; without it, a twentieth of the split moves.
   */
  resizePane(dir: PaneDir, cells?: number): boolean {
    const win = this.activeWindow()
    const path = findPath(win.layout, win.active)
    if (!path) return false
    const horizontal = dir === 'L' || dir === 'R'
    const forward = dir === 'R' || dir === 'D'
    for (let index = path.length - 2; index >= 0; index--) {
      const node = path[index]
      const child = path[index + 1]
      if (!node || node.t === 'pane' || !child) continue
      if ((node.t === 'row') !== horizontal) continue
      // The divider the key reaches is the one on the active pane's `dir` side:
      // R and D need the active pane to be the first child, L and U the second.
      const inSecond = node.b === child
      if (inSecond === forward) continue
      // Moving that divider outward grows the active pane, so the first child's
      // share grows for R/D and shrinks for L/U.
      const step = (cells ?? 1) * 0.02
      const next = clampRatio(node.ratio + (forward ? step : -step))
      if (next === node.ratio) return false
      win.layout = resizeAt(win.layout, node, next)
      this.onLayout?.()
      return true
    }
    return false
  }

  /** A flat view of every pane, for `ps` and for the status line. */
  snapshot(): { pid: number; user: string; cwd: string; win: string; active: boolean; width: number }[] {
    const rows: { pid: number; user: string; cwd: string; win: string; active: boolean; width: number }[] = []
    const session = this.current
    if (!session) return rows
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
          width: pane.ctx.columns,
        })
      }
    })
    return rows
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
  return { ...layout, a: replacePane(layout.a, id, build), b: replacePane(layout.b, id, build) }
}

function resizeAt(layout: Layout, target: Layout, ratio: number): Layout {
  if (layout === target) {
    return layout.t === 'pane' ? layout : { ...layout, ratio }
  }
  if (layout.t === 'pane') return layout
  return { ...layout, a: resizeAt(layout.a, target, ratio), b: resizeAt(layout.b, target, ratio) }
}

function clampRatio(value: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, Math.round(value * 100) / 100))
}

function removePane(layout: Layout, id: string): Layout | null {
  if (layout.t === 'pane') return layout.id === id ? null : layout
  const a = removePane(layout.a, id)
  const b = removePane(layout.b, id)
  if (a === layout.a && b === layout.b) return layout
  if (!a) return b
  if (!b) return a
  return { ...layout, a, b }
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
