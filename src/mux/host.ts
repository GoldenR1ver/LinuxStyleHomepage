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
}
