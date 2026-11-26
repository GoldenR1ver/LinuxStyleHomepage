/** A modal editor with the core Vim model: modes, counts, operators, and ex commands. */

export interface VimKey {
  key: string
  ctrl: boolean
}

export interface VimPiece {
  text: string
  cursor: boolean
  visual: boolean
  col: number
}

export interface VimModel {
  rows: { gutter: string; pieces: VimPiece[]; row: number }[]
  status: string
  prompt: string
  insert: boolean
}

interface Pos {
  row: number
  col: number
}

interface Reg {
  text: string
  line: boolean
}

interface Motion {
  pos: Pos
  inclusive: boolean
  linewise: boolean
}

type Mode = 'normal' | 'insert' | 'replace' | 'visual' | 'vline' | 'command'
type Op = 'd' | 'c' | 'y' | '<' | '>' | 'lower' | 'upper' | 'swap'
type Wait = '' | 'g' | 'f' | 'F' | 't' | 'T' | 'r' | 'obj' | 'reg' | 'mark' | 'gomark'
type Step = { t: 'key'; key: VimKey } | { t: 'text'; text: string }

export class VimEngine {
  quit = false
  writeRequest: { quit: boolean } | null = null

  private lines: string[]
  private row = 0
  private col = 0
  private pref = 0
  private mode: Mode = 'normal'
  private top = 0
  private rows: number
  private filename: string
  private saved: string
  private number = false
  private list = false
  private message = ''
  private cmdline = ''
  private promptKind: ':' | '/' | '?' = ':'
  private countBuf = ''
  private op: Op | '' = ''
  private opCount = 0
  private wait: Wait = ''
  private objSide: 'i' | 'a' = 'i'
  private anchor: Pos = { row: 0, col: 0 }
  private searchPat = ''
  private searchDir: 1 | -1 = 1
  private lastFind: { ch: string; dir: 1 | -1; till: boolean } | null = null
  private marks = new Map<string, Pos>()
  private regs = new Map<string, Reg>()
  private regName = '"'
  private past: { lines: string[]; row: number; col: number }[] = []
  private future: { lines: string[]; row: number; col: number }[] = []
  private group = false
  private rec: Step[] | null = null
  private recBase = ''
  private last: Step[] | null = null
  private replaying = false

  constructor(text: string, filename: string, rows = 24) {
    const norm = text.replace(/\r\n/g, '\n')
    const trail = norm.endsWith('\n')
    const core = trail ? norm.slice(0, -1) : norm
    this.lines = core === '' ? [''] : core.split('\n')
    this.filename = filename
    this.rows = Math.max(1, rows)
    this.saved = this.text()
    if (norm === '') this.saved = ''
  }

  text(): string {
    if (this.lines.length === 1 && this.lines[0] === '') return ''
    return `${this.lines.join('\n')}\n`
  }

  dirty(): boolean {
    return this.text() !== this.saved
  }

  resize(rows: number) {
    this.rows = Math.max(1, rows)
    this.reveal()
  }

  place(row: number, col: number) {
    this.row = Math.max(0, Math.min(this.lines.length - 1, row))
    this.col = Math.max(0, col)
    this.clamp()
    this.pref = this.col
    this.reveal()
  }

  press(key: VimKey) {
    if (this.quit) return
    if (!this.replaying && this.idle() && key.key === '.' && !key.ctrl) {
      this.replay()
      return
    }
    this.note(key)
    this.apply(key)
    this.finishNote()
    this.finishGroup()
  }

  insertText(text: string) {
    if (!text || (this.mode !== 'insert' && this.mode !== 'replace')) return
    if (this.rec) this.rec.push({ t: 'text', text })
    this.begin()
    if (this.mode === 'replace') this.replaceText(text)
    else this.typeText(text)
    this.reveal()
  }

  acknowledgeWrite(error: string | null, notice = '') {
    const request = this.writeRequest
    this.writeRequest = null
    if (error) {
      this.message = error
      return
    }
    this.saved = this.text()
    this.message = notice || `"${this.filename}" written`
    if (request?.quit) this.quit = true
  }

  model(): VimModel {
    const end = Math.min(this.lines.length, this.top + this.rows)
    const rows = []
    for (let row = this.top; row < end; row++) rows.push({ gutter: this.gutter(row), pieces: this.pieces(row), row })
    const where = `${this.row + 1},${this.byteCol() + 1}`
    const mark = this.dirty() ? ' [+]' : ''
    const status = `${this.modeLabel()}  ${this.filename}${mark}  ${where}`
    let prompt = this.message
    if (this.mode === 'command') prompt = `${this.promptKind}${this.cmdline}`
    return {
      rows,
      status,
      prompt,
      insert: this.mode === 'insert' || this.mode === 'replace',
    }
  }

  private replay() {
    const steps = this.last
    if (!steps?.length) return
    this.replaying = true
    for (const step of steps) {
      if (step.t === 'key') this.apply(step.key)
      else this.insertText(step.text)
    }
    this.replaying = false
    this.finishGroup()
  }

  private note(key: VimKey) {
    if (this.replaying) return
    if (this.rec) {
      this.rec.push({ t: 'key', key })
      return
    }
    if (this.idle()) {
      this.rec = [{ t: 'key', key }]
      this.recBase = this.text()
    }
  }

  private finishNote() {
    if (this.replaying || !this.rec) return
    if (!this.idle()) return
    if (this.text() !== this.recBase) this.last = this.rec
    this.rec = null
  }

  private idle(): boolean {
    return this.mode === 'normal' && !this.op && !this.wait && !this.countBuf
  }

  private apply(key: VimKey) {
    if (this.mode === 'command') {
      this.commandKey(key)
      return
    }
    if (this.mode === 'insert' || this.mode === 'replace') {
      this.insertKey(key)
      return
    }
    this.message = ''
    const name = key.ctrl ? `c-${key.key.length === 1 ? key.key.toLowerCase() : key.key}` : key.key
    if (this.wait === 'reg') {
      this.wait = ''
      if (/^[a-zA-Z"]$/.test(name)) this.regName = name === '"' ? '"' : name.toLowerCase()
      return
    }
    if (this.wait === 'r') {
      this.wait = ''
      this.doReplace(name)
      return
    }
    if (this.wait === 'f' || this.wait === 'F' || this.wait === 't' || this.wait === 'T') {
      const wait = this.wait
      const op = this.op
      const from = this.pos()
      this.wait = ''
      if (name.length === 1) {
        this.lastFind = { ch: name, dir: wait === 'f' || wait === 't' ? 1 : -1, till: wait === 't' || wait === 'T' }
        this.runFind(this.lastFind, Math.max(1, this.product(this.takeCount())))
        if (op) {
          const dest = this.pos()
          this.clearOp()
          this.applyMotion(op, { pos: dest, inclusive: wait === 'f' || wait === 'F', linewise: false, from })
          return
        }
      }
      this.clearOp()
      return
    }
    if (this.wait === 'obj') {
      this.wait = ''
      this.runObject(name)
      return
    }
    if (this.wait === 'mark') {
      this.wait = ''
      if (/^[a-z]$/.test(name)) this.marks.set(name, this.pos())
      return
    }
    if (this.wait === 'gomark') {
      this.wait = ''
      const mark = this.marks.get(name)
      if (!mark) this.message = `mark ${name} not set`
      else this.jump(mark)
      return
    }
    if (this.wait === 'g') {
      this.wait = ''
      this.afterG(name)
      return
    }
    if (name === '"') {
      this.wait = 'reg'
      return
    }
    if (/^[1-9]$/.test(name) || (name === '0' && this.countBuf)) {
      this.countBuf += name
      return
    }
    if (this.mode === 'visual' || this.mode === 'vline') {
      this.visualKey(name)
      return
    }
    if (this.op) {
      this.operatorMotion(name)
      return
    }
    this.normal(name)
  }

  private normal(name: string) {
    const count = this.takeCount()
    const times = Math.max(1, count)
    if (name === 'd' || name === 'c' || name === 'y' || name === '<' || name === '>') {
      this.op = name
      this.opCount = count
      return
    }
    if (name === 'g') {
      this.wait = 'g'
      this.opCount = count
      return
    }
    if (isMove(name)) {
      this.moveName(name, times)
      return
    }
    if (name === 'x' || name === 'Delete') this.deleteChars(times, true)
    else if (name === 'X') this.deleteChars(times, false)
    else if (name === 'r') this.wait = 'r'
    else if (name === '~') this.swapCase(times)
    else if (name === 'J') this.join(times)
    else if (name === 'p') this.put(true)
    else if (name === 'P') this.put(false)
    else if (name === 'u') this.undo()
    else if (name === 'c-r') this.redoAct()
    else if (name === 'i') this.mode = 'insert'
    else if (name === 'a') this.enterAppend(false)
    else if (name === 'A') this.enterAppend(true)
    else if (name === 'I') this.enterInsertFirst()
    else if (name === 'o') this.openLine(true)
    else if (name === 'O') this.openLine(false)
    else if (name === 's') {
      this.deleteChars(times, true)
      this.mode = 'insert'
    } else if (name === 'S') this.changeLines(times)
    else if (name === 'C') this.changeToEnd()
    else if (name === 'D') this.deleteToEnd()
    else if (name === 'Y') this.yankLines(times)
    else if (name === 'v') this.startVisual(false)
    else if (name === 'V') this.startVisual(true)
    else if (name === 'R') this.mode = 'replace'
    else if (name === '.') return
    else if (name === ':') this.startCommand(':')
    else if (name === '/') this.startCommand('/')
    else if (name === '?') this.startCommand('?')
    else if (name === 'n') this.findNext(this.searchDir)
    else if (name === 'N') this.findNext(this.searchDir === 1 ? -1 : 1)
    else if (name === '*') this.searchWord(1)
    else if (name === '#') this.searchWord(-1)
    else if (name === 'm') this.wait = 'mark'
    else if (name === "'" || name === '`') this.wait = 'gomark'
    else if (name === 'f' || name === 'F' || name === 't' || name === 'T') {
      this.wait = name
      this.opCount = count
    } else if (name === ';' || name === ',') this.repeatFind(name === ';' ? 1 : -1, times)
    else if (name === '%') this.matchPair()
    else if (name === 'c-g') this.message = `${this.filename} line ${this.row + 1} of ${this.lines.length}`
    else if (name === 'c-l') this.message = ''
    else if (name === 'Escape' || name === 'c-c' || name === 'c-[') this.clearOp()
  }

  private visualKey(name: string) {
    const times = Math.max(1, this.takeCount())
    if (name === 'Escape' || name === 'c-c' || name === 'c-[') {
      this.mode = 'normal'
      return
    }
    if (name === 'v') {
      this.mode = this.mode === 'visual' ? 'normal' : 'visual'
      return
    }
    if (name === 'V') {
      this.mode = this.mode === 'vline' ? 'normal' : 'vline'
      return
    }
    if (name === 'o') {
      const next = this.anchor
      this.anchor = this.pos()
      this.jump(next)
      return
    }
    if (isMove(name) || name === 'g') {
      if (name === 'g') {
        this.wait = 'g'
        return
      }
      this.moveName(name, times)
      return
    }
    if (name === 'd' || name === 'x' || name === 'Delete' || name === 'c' || name === 's' || name === 'y' || name === '>' || name === '<' || name === '~') {
      const span = this.selection()
      if (name === 'y') {
        this.yank(this.copy(span.from, span.to, span.linewise), span.linewise)
        this.mode = 'normal'
        this.jump(span.from)
        return
      }
      if (name === '~') {
        this.touchCase(span.from, span.to)
        this.mode = 'normal'
        return
      }
      if (name === '>' || name === '<') {
        this.indent(span.from.row, span.to.row, name === '>')
        this.mode = 'normal'
        return
      }
      this.begin()
      const text = this.remove(span.from, span.to, span.linewise)
      this.yank(text, span.linewise)
      if (name === 'c' || name === 's') this.mode = 'insert'
      else this.mode = 'normal'
      return
    }
    if (name === 'i' || name === 'a') {
      this.op = 'd'
      this.wait = 'obj'
      this.objSide = name
      this.mode = 'normal'
    }
  }

  private operatorMotion(name: string) {
    const op = this.op
    if (!op) return
    if ((name === 'd' && op === 'd') || (name === 'c' && op === 'c') || (name === 'y' && op === 'y') || (name === '<' && op === '<') || (name === '>' && op === '>')) {
      const times = Math.max(1, (this.opCount || 1) * Math.max(1, this.takeCount()))
      this.clearOp()
      if (op === '<' || op === '>') this.indent(this.row, Math.min(this.lines.length - 1, this.row + times - 1), op === '>')
      else if (op === 'y') this.yankLines(times)
      else if (op === 'c') this.changeLines(times)
      else this.deleteLines(times)
      return
    }
    if (name === 'i' || name === 'a') {
      this.wait = 'obj'
      this.objSide = name
      return
    }
    if (name === 'g') {
      this.wait = 'g'
      return
    }
    if (name === 'f' || name === 'F' || name === 't' || name === 'T') {
      this.wait = name
      return
    }
    const times = Math.max(1, (this.opCount || 1) * Math.max(1, this.takeCount()))
    const motion = this.motion(name, times)
    this.clearOp()
    if (!motion) return
    this.applyMotion(op, motion)
  }

  private afterG(name: string) {
    const count = this.opCount
    this.opCount = 0
    if (name === 'g') {
      const dest = count ? count - 1 : 0
      const from = this.pos()
      this.jump({ row: dest, col: 0 })
      if (this.op) {
        const op = this.op
        this.clearOp()
        this.applyMotion(op, { pos: this.pos(), inclusive: false, linewise: true, from })
        return
      }
      this.toFirstNonBlank()
      return
    }
    if (name === 'u' || name === 'U' || name === '~') {
      this.op = name === 'u' ? 'lower' : name === 'U' ? 'upper' : 'swap'
      this.opCount = count
      return
    }
    if (name === 'j' || name === 'ArrowDown') this.moveV(Math.max(1, count), 1)
    else if (name === 'k' || name === 'ArrowUp') this.moveV(Math.max(1, count), -1)
    else if (this.op) this.operatorMotion(name)
  }

  private runObject(name: string) {
    const op = this.op
    this.clearOp()
    const span = this.object(this.objSide, name)
    if (!span || !op) return
    this.applyMotion(op, { pos: span.to, inclusive: true, linewise: span.linewise, from: span.from })
  }

  private applyMotion(op: Op, motion: Motion & { from?: Pos }) {
    if (motion.linewise) {
      const from = motion.from ?? this.pos()
      const top = Math.min(from.row, motion.pos.row)
      const bottom = Math.max(from.row, motion.pos.row)
      this.row = top
      if (op === 'y') this.yank(this.copy({ row: top, col: 0 }, { row: bottom, col: 0 }, true), true)
      else if (op === '<' || op === '>') this.indent(top, bottom, op === '>')
      else if (op === 'lower' || op === 'upper' || op === 'swap') this.mapLines(top, bottom, op)
      else if (op === 'c') this.changeLines(bottom - top + 1)
      else this.deleteLines(bottom - top + 1)
      return
    }
    const start = motion.from ?? this.pos()
    let left = start
    let right = motion.pos
    if (cmp(right, left) < 0) {
      const swap = left
      left = right
      right = swap
    }
    if (!motion.inclusive) {
      if (cmp(motion.pos, start) >= 0) right = this.stepBack(right)
      else left = this.stepForward(left)
    }
    if (cmp(right, left) < 0) return
    if (op === 'y') {
      this.yank(this.copy(left, right, false), false)
      this.jump(left)
      return
    }
    if (op === '<' || op === '>') {
      this.indent(left.row, right.row, op === '>')
      return
    }
    if (op === 'lower' || op === 'upper' || op === 'swap') {
      this.touchCase(left, right, op === 'swap' ? 'swap' : op === 'lower' ? 'lower' : 'upper')
      return
    }
    this.begin()
    const text = this.remove(left, right, false)
    this.yank(text, false)
    if (op === 'c') this.mode = 'insert'
  }

  private motion(name: string, times: number): (Motion & { from?: Pos }) | null {
    const from = this.pos()
    if (name === 'j' || name === 'k' || name === 'ArrowDown' || name === 'ArrowUp' || name === '+' || name === '-' || name === 'Enter') {
      const dir = name === 'k' || name === 'ArrowUp' || name === '-' ? -1 : 1
      this.moveV(times, dir)
      return { pos: this.pos(), inclusive: false, linewise: true, from }
    }
    if (name === '{') {
      this.paragraph(-times)
      return { pos: this.pos(), inclusive: false, linewise: true, from }
    }
    if (name === '}') {
      this.paragraph(times)
      return { pos: this.pos(), inclusive: false, linewise: true, from }
    }
    if (name === 'G') {
      this.jump({ row: this.countTarget(times), col: 0 })
      return { pos: this.pos(), inclusive: false, linewise: true, from }
    }
    const moved = this.moveName(name, times)
    if (!moved) return null
    const inclusive = name === 'e' || name === 'E' || name === '$' || name === 'f' || name === 'F' || name === '%'
    return { pos: this.pos(), inclusive, linewise: false, from }
  }

  private moveName(name: string, times: number): boolean {
    const before = this.pos()
    if (name === 'h' || name === 'ArrowLeft' || name === 'Backspace') this.moveH(times)
    else if (name === 'l' || name === 'ArrowRight' || name === ' ') this.moveL(times)
    else if (name === 'j' || name === 'ArrowDown' || name === 'Enter' || name === '+') this.moveV(times, 1)
    else if (name === 'k' || name === 'ArrowUp' || name === '-') this.moveV(times, -1)
    else if (name === 'w') this.word(times, 1, 'start', false)
    else if (name === 'W') this.word(times, 1, 'start', true)
    else if (name === 'b') this.word(times, -1, 'start', false)
    else if (name === 'B') this.word(times, -1, 'start', true)
    else if (name === 'e') this.word(times, 1, 'end', false)
    else if (name === 'E') this.word(times, 1, 'end', true)
    else if (name === '0' || name === 'Home') this.col = 0
    else if (name === '^') this.toFirstNonBlank()
    else if (name === '$' || name === 'End') this.col = this.maxCol()
    else if (name === 'G') this.jump({ row: this.countTarget(times), col: 0 })
    else if (name === 'c-d') this.moveV(Math.max(1, Math.floor(this.rows / 2)) * times, 1)
    else if (name === 'c-u') this.moveV(Math.max(1, Math.floor(this.rows / 2)) * times, -1)
    else if (name === 'c-f' || name === 'PageDown') this.moveV(Math.max(1, this.rows - 1) * times, 1)
    else if (name === 'c-b' || name === 'PageUp') this.moveV(Math.max(1, this.rows - 1) * times, -1)
    else if (name === 'n') this.findNext(this.searchDir)
    else if (name === 'N') this.findNext(this.searchDir === 1 ? -1 : 1)
    else if (name === '%') this.matchPair()
    else if (name === '{') this.paragraph(-times)
    else if (name === '}') this.paragraph(times)
    else if (name === 'zz') this.top = Math.max(0, this.row - Math.floor(this.rows / 2))
    else if (name === 'zt') this.top = this.row
    else if (name === 'zb') this.top = Math.max(0, this.row - this.rows + 1)
    else return false
    if (name === '0' || name === '^' || name === '$' || name === 'Home' || name === 'End' || name === 'h' || name === 'l' || name === 'w' || name === 'b' || name === 'e' || name === 'W' || name === 'B' || name === 'E') {
      this.pref = this.col
    }
    this.reveal()
    return cmp(before, this.pos()) !== 0 || name === 'zz' || name === 'zt' || name === 'zb' || name === '0'
  }

  private countTarget(fallbackTimes: number): number {
    if (fallbackTimes > 1) return Math.min(this.lines.length, fallbackTimes) - 1
    return this.lines.length - 1
  }

  private insertKey(key: VimKey) {
    const name = key.ctrl ? `c-${key.key.toLowerCase()}` : key.key
    if (name === 'Escape' || name === 'c-c' || name === 'c-[') {
      this.mode = 'normal'
      this.moveH(1)
      this.finishGroup()
      return
    }
    if (name === 'Backspace') this.backspace()
    else if (name === 'Delete') this.deleteChars(1, true)
    else if (name === 'Enter') this.splitLine()
    else if (name === 'ArrowLeft' || name === 'c-h') this.moveH(1)
    else if (name === 'ArrowRight') this.moveL(1)
    else if (name === 'ArrowUp') this.moveV(1, -1)
    else if (name === 'ArrowDown') this.moveV(1, 1)
    else if (name === 'Home' || name === 'c-a') this.col = 0
    else if (name === 'End' || name === 'c-e') this.col = this.line().length
    else if (name === 'c-w') this.deleteWordBack()
    else if (name === 'c-u') this.deleteToStart()
    else if (name === 'Tab') this.typeText('  ')
  }

  private commandKey(key: VimKey) {
    const name = key.ctrl ? `c-${key.key.toLowerCase()}` : key.key
    if (name === 'Escape' || name === 'c-c' || name === 'c-[') {
      this.mode = 'normal'
      this.cmdline = ''
      return
    }
    if (name === 'Enter') {
      const line = this.cmdline
      const kind = this.promptKind
      this.cmdline = ''
      this.mode = 'normal'
      if (kind === '/') this.runSearch(line, 1)
      else if (kind === '?') this.runSearch(line, -1)
      else this.ex(line)
      return
    }
    if (name === 'Backspace') {
      this.cmdline = Array.from(this.cmdline).slice(0, -1).join('')
      return
    }
    if (name.length === 1) this.cmdline += name
  }

  private ex(line: string) {
    const text = line.trim()
    if (!text) return
    if (/^\d+$/.test(text)) {
      this.jump({ row: Number(text) - 1, col: 0 })
      return
    }
    if (text === 'q') {
      if (this.dirty()) this.message = 'No write since last change (add ! to override)'
      else this.quit = true
      return
    }
    if (text === 'q!') {
      this.quit = true
      return
    }
    if (text === 'w') {
      this.writeRequest = { quit: false }
      return
    }
    if (text === 'wq' || text === 'x') {
      this.writeRequest = { quit: true }
      return
    }
    if (text === 'wq!') {
      this.writeRequest = { quit: true }
      return
    }
    if (text === 'set nu' || text === 'set number') {
      this.number = true
      return
    }
    if (text === 'set nonu' || text === 'set nonumber') {
      this.number = false
      return
    }
    if (text === 'set list') {
      this.list = true
      return
    }
    if (text === 'set nolist') {
      this.list = false
      return
    }
    if (text === 'noh' || text === 'nohlsearch') {
      this.searchPat = ''
      return
    }
    if (text === 'help') {
      this.message = ':w write  :q quit  :q! discard  i insert  v visual  / search'
      return
    }
    const sub = parseSub(text)
    if (sub) {
      this.substitute(sub)
      return
    }
    this.message = `Not an editor command: ${text}`
  }

  private runSearch(pat: string, dir: 1 | -1) {
    if (!pat) pat = this.searchPat
    if (!pat) {
      this.message = 'No previous search'
      return
    }
    this.searchPat = pat
    this.searchDir = dir
    this.findNext(dir)
  }

  private findNext(dir: 1 | -1) {
    if (!this.searchPat) {
      this.message = 'No previous search'
      return
    }
    const spots: Pos[] = []
    for (let row = 0; row < this.lines.length; row++) {
      const line = this.lines[row] ?? ''
      let at = 0
      while (at <= line.length) {
        const found = line.indexOf(this.searchPat, at)
        if (found < 0) break
        spots.push({ row, col: found })
        at = found + Math.max(1, this.searchPat.length)
      }
    }
    if (!spots.length) {
      this.message = 'Pattern not found'
      return
    }
    const here = this.row * 1_000_000 + this.col
    const score = (pos: Pos) => pos.row * 1_000_000 + pos.col
    const next =
      dir === 1
        ? (spots.find((pos) => score(pos) > here) ?? spots[0])
        : ([...spots].reverse().find((pos) => score(pos) < here) ?? spots[spots.length - 1])
    if (!next) return
    this.jump(next)
  }

  private searchWord(dir: 1 | -1) {
    const word = this.wordAtCursor()
    if (!word) return
    this.searchPat = word
    this.searchDir = dir
    this.findNext(dir)
  }

  private substitute(sub: { all: boolean; pat: string; rep: string; global: boolean }) {
    if (!sub.pat) return
    const grouped = this.group
    this.begin()
    const rows = sub.all ? this.lines.map((_, index) => index) : [this.row]
    let hits = 0
    for (const row of rows) {
      const line = this.lines[row] ?? ''
      if (!line.includes(sub.pat)) continue
      hits += 1
      this.lines[row] = sub.global ? line.split(sub.pat).join(sub.rep) : line.replace(sub.pat, sub.rep)
    }
    this.clamp()
    if (!hits) {
      if (!grouped) this.past.pop()
      this.group = grouped
      this.message = 'Pattern not found'
      return
    }
    this.message = `${hits} substitution${hits === 1 ? '' : 's'}`
  }

  private startCommand(kind: ':' | '/' | '?') {
    this.mode = 'command'
    this.promptKind = kind
    this.cmdline = ''
  }

  private startVisual(line: boolean) {
    this.anchor = this.pos()
    this.mode = line ? 'vline' : 'visual'
  }

  private enterAppend(end: boolean) {
    if (end) this.col = this.line().length
    else if (this.line()) this.col = Math.min(this.line().length, this.col + cpLen(cpAt(this.line(), this.col)))
    this.mode = 'insert'
  }

  private enterInsertFirst() {
    this.toFirstNonBlank()
    this.mode = 'insert'
  }

  private openLine(below: boolean) {
    this.begin()
    const at = below ? this.row + 1 : this.row
    this.lines.splice(at, 0, '')
    this.row = at
    this.col = 0
    this.mode = 'insert'
    this.reveal()
  }

  private typeText(text: string) {
    for (const ch of Array.from(text)) {
      if (ch === '\n') this.splitLine()
      else {
        const line = this.line()
        this.lines[this.row] = line.slice(0, this.col) + ch + line.slice(this.col)
        this.col += ch.length
      }
    }
    this.pref = this.col
  }

  private replaceText(text: string) {
    for (const ch of Array.from(text)) {
      if (ch === '\n') this.splitLine()
      else {
        const line = this.line()
        const next = cpAt(line, this.col)
        const rest = next ? this.col + next.length : this.col
        this.lines[this.row] = line.slice(0, this.col) + ch + line.slice(rest)
        this.col += ch.length
      }
    }
    this.pref = this.col
  }

  private splitLine() {
    this.begin()
    const line = this.line()
    this.lines.splice(this.row, 1, line.slice(0, this.col), line.slice(this.col))
    this.row += 1
    this.col = 0
    this.pref = 0
    this.reveal()
  }

  private backspace() {
    if (this.col === 0 && this.row === 0) return
    this.begin()
    if (this.col === 0) {
      const left = this.lines[this.row - 1] ?? ''
      const right = this.line()
      this.col = left.length
      this.lines.splice(this.row - 1, 2, left + right)
      this.row -= 1
    } else {
      const line = this.line()
      const prev = Array.from(line.slice(0, this.col))
      const last = prev.pop() ?? ''
      const cut = prev.join('').length
      this.lines[this.row] = line.slice(0, cut) + line.slice(cut + last.length)
      this.col = cut
    }
    this.pref = this.col
  }

  private deleteWordBack() {
    this.begin()
    const line = this.line()
    let col = this.col
    while (col > 0 && /\s/u.test(cpBefore(line, col))) col = indexBefore(line, col)
    while (col > 0 && !/\s/u.test(cpBefore(line, col))) col = indexBefore(line, col)
    this.lines[this.row] = line.slice(0, col) + line.slice(this.col)
    this.col = col
  }

  private deleteToStart() {
    this.begin()
    this.lines[this.row] = this.line().slice(this.col)
    this.col = 0
  }

  private deleteChars(times: number, forward: boolean) {
    if (!this.line() && forward) return
    this.begin()
    for (let i = 0; i < times; i++) {
      const line = this.line()
      if (forward) {
        const ch = cpAt(line, this.col)
        if (!ch) break
        this.yank(ch, false)
        this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + ch.length)
      } else {
        if (this.col <= 0) break
        const at = indexBefore(line, this.col)
        const ch = line.slice(at, this.col)
        this.yank(ch, false)
        this.lines[this.row] = line.slice(0, at) + line.slice(this.col)
        this.col = at
      }
    }
    this.clamp()
  }

  private deleteToEnd() {
    this.begin()
    const line = this.line()
    this.yank(line.slice(this.col), false)
    this.lines[this.row] = line.slice(0, this.col)
    this.clamp()
  }

  private changeToEnd() {
    this.deleteToEnd()
    this.mode = 'insert'
    this.col = this.line().length
  }

  private deleteLines(times: number) {
    this.begin()
    const top = this.row
    const bottom = Math.min(this.lines.length, this.row + times)
    const text = this.lines.slice(top, bottom).join('\n') + '\n'
    this.yank(text, true)
    this.lines.splice(top, bottom - top)
    if (!this.lines.length) this.lines.push('')
    this.row = Math.min(top, this.lines.length - 1)
    this.col = 0
    this.clamp()
    this.reveal()
  }

  private changeLines(times: number) {
    this.begin()
    const top = this.row
    const bottom = Math.min(this.lines.length, this.row + times)
    this.yank(this.lines.slice(top, bottom).join('\n') + '\n', true)
    this.lines.splice(top, bottom - top, '')
    this.row = top
    this.col = 0
    this.mode = 'insert'
    this.reveal()
  }

  private yankLines(times: number) {
    const top = this.row
    const bottom = Math.min(this.lines.length, this.row + times)
    this.yank(this.lines.slice(top, bottom).join('\n') + '\n', true)
    this.message = `${bottom - top} line${bottom - top === 1 ? '' : 's'} yanked`
  }

  private doReplace(name: string) {
    if (name.length !== 1 || !this.line()) return
    this.begin()
    const line = this.line()
    const ch = cpAt(line, this.col)
    if (!ch) return
    this.lines[this.row] = line.slice(0, this.col) + name + line.slice(this.col + ch.length)
  }

  private swapCase(times: number) {
    this.begin()
    for (let i = 0; i < times; i++) {
      const line = this.line()
      const ch = cpAt(line, this.col)
      if (!ch) break
      const next = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
      this.lines[this.row] = line.slice(0, this.col) + next + line.slice(this.col + ch.length)
      this.moveL(1)
    }
  }

  private join(times: number) {
    this.begin()
    const count = Math.max(1, times)
    for (let i = 0; i < count && this.row < this.lines.length - 1; i++) {
      const right = (this.lines[this.row + 1] ?? '').replace(/^\s+/, '')
      const left = (this.lines[this.row] ?? '').replace(/\s+$/, '')
      const gap = left && right ? ' ' : ''
      this.col = left.length
      this.lines.splice(this.row, 2, left + gap + right)
    }
    this.pref = this.col
  }

  private put(after: boolean) {
    const reg = this.regs.get(this.regName) ?? this.regs.get('"')
    this.regName = '"'
    if (!reg?.text) return
    this.begin()
    if (reg.line) {
      const chunk = reg.text.replace(/\n$/, '').split('\n')
      const at = after ? this.row + 1 : this.row
      this.lines.splice(at, 0, ...chunk)
      this.row = at
      this.col = 0
    } else {
      const ins = Array.from(reg.text).join('')
      const line = this.line()
      const at = after && line ? Math.min(line.length, this.col + cpLen(cpAt(line, this.col))) : this.col
      this.lines[this.row] = line.slice(0, at) + ins + line.slice(at)
      this.col = Math.max(0, at + ins.length - cpLen(Array.from(ins).at(-1) ?? ''))
    }
    this.clamp()
    this.reveal()
  }

  private indent(top: number, bottom: number, right: boolean) {
    this.begin()
    for (let row = top; row <= bottom && row < this.lines.length; row++) {
      if (right) this.lines[row] = `  ${this.lines[row] ?? ''}`
      else this.lines[row] = (this.lines[row] ?? '').replace(/^ {1,2}/, '')
    }
    this.row = top
    this.toFirstNonBlank()
  }

  private mapLines(top: number, bottom: number, op: 'lower' | 'upper' | 'swap') {
    this.begin()
    for (let row = top; row <= bottom && row < this.lines.length; row++) {
      this.lines[row] = mapCase(this.lines[row] ?? '', op)
    }
  }

  private touchCase(from: Pos, to: Pos, op: 'lower' | 'upper' | 'swap' = 'swap') {
    this.begin()
    if (from.row === to.row) {
      const line = this.lines[from.row] ?? ''
      this.lines[from.row] = line.slice(0, from.col) + mapCase(line.slice(from.col, to.col + cpLen(cpAt(line, to.col))), op) + line.slice(to.col + cpLen(cpAt(line, to.col)))
      return
    }
    this.mapLines(from.row, to.row, op)
  }

  private yank(text: string, line: boolean) {
    const item = { text, line }
    this.regs.set('"', item)
    if (this.regName !== '"') this.regs.set(this.regName, item)
    this.regName = '"'
  }

  private copy(from: Pos, to: Pos, linewise: boolean): string {
    if (linewise) return this.lines.slice(from.row, to.row + 1).join('\n') + '\n'
    if (from.row === to.row) {
      const line = this.lines[from.row] ?? ''
      const end = Math.min(line.length, to.col + cpLen(cpAt(line, to.col)))
      return line.slice(from.col, end)
    }
    const first = (this.lines[from.row] ?? '').slice(from.col)
    const mid = this.lines.slice(from.row + 1, to.row)
    const lastLine = this.lines[to.row] ?? ''
    const last = lastLine.slice(0, to.col + cpLen(cpAt(lastLine, to.col)))
    return [first, ...mid, last].join('\n')
  }

  private remove(from: Pos, to: Pos, linewise: boolean): string {
    if (linewise) {
      const text = this.copy(from, to, true)
      this.lines.splice(from.row, to.row - from.row + 1)
      if (!this.lines.length) this.lines.push('')
      this.row = Math.min(from.row, this.lines.length - 1)
      this.col = 0
      this.clamp()
      return text
    }
    const text = this.copy(from, to, false)
    if (from.row === to.row && to.col >= (this.lines[to.row] ?? '').length && to.row < this.lines.length - 1) {
      const left = (this.lines[from.row] ?? '').slice(0, from.col)
      const right = this.lines[to.row + 1] ?? ''
      this.lines.splice(from.row, 2, left + right)
    } else if (from.row === to.row) {
      const line = this.lines[from.row] ?? ''
      const end = to.col + cpLen(cpAt(line, to.col))
      this.lines[from.row] = line.slice(0, from.col) + line.slice(end)
    } else {
      const left = (this.lines[from.row] ?? '').slice(0, from.col)
      const last = this.lines[to.row] ?? ''
      const right = last.slice(to.col + cpLen(cpAt(last, to.col)))
      this.lines.splice(from.row, to.row - from.row + 1, left + right)
    }
    this.row = from.row
    this.col = from.col
    this.clamp()
    this.reveal()
    return text
  }

  private object(side: 'i' | 'a', name: string): { from: Pos; to: Pos; linewise: boolean } | null {
    if (name === 'w' || name === 'W') return this.wordObject(side, name === 'W')
    if (name === 'p') return this.paragraphObject()
    if (name === '"' || name === "'" || name === '`') return this.quoteObject(name, side)
    const pair: Record<string, string> = { '(': ')', ')': ')', '[': ']', ']': ']', '{': '}', '}': '}', t: '>', '<': '>', '>': '>' }
    const open: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }
    const closer = pair[name]
    if (!closer) return null
    const opener = open[closer] ?? (name === 't' ? '<' : name)
    return this.pairObject(opener, closer, side)
  }

  private wordObject(side: 'i' | 'a', big: boolean): { from: Pos; to: Pos; linewise: boolean } | null {
    const units = this.units(this.line(), big)
    const hit = units.findIndex((unit) => unit.i <= this.col && this.col < unit.i + unit.ch.length)
    if (hit < 0) return null
    const kind = units[hit]?.kind
    let left = hit
    let right = hit
    while (left > 0 && units[left - 1]?.kind === kind) left -= 1
    while (right + 1 < units.length && units[right + 1]?.kind === kind) right += 1
    if (side === 'a' && kind !== 's') {
      let extra = right + 1
      while (extra < units.length && units[extra]?.kind === 's') {
        right = extra
        extra += 1
      }
    }
    const from = units[left]?.i ?? 0
    const last = units[right]
    if (!last) return null
    return { from: { row: this.row, col: from }, to: { row: this.row, col: last.i }, linewise: false }
  }

  private paragraphObject(): { from: Pos; to: Pos; linewise: boolean } | null {
    let top = this.row
    let bottom = this.row
    while (top > 0 && (this.lines[top] ?? '').trim()) top -= 1
    while (bottom < this.lines.length - 1 && (this.lines[bottom] ?? '').trim()) bottom += 1
    if (!(this.lines[top] ?? '').trim() && top < bottom) top += 1
    if (!(this.lines[bottom] ?? '').trim() && bottom > top) bottom -= 1
    return { from: { row: top, col: 0 }, to: { row: bottom, col: 0 }, linewise: true }
  }

  private quoteObject(quote: string, side: 'i' | 'a'): { from: Pos; to: Pos; linewise: boolean } | null {
    const line = this.line()
    const start = line.lastIndexOf(quote, Math.max(0, this.col))
    if (start < 0) return null
    const end = line.indexOf(quote, Math.max(start + 1, this.col + 1))
    if (end < 0) return null
    const from = side === 'a' ? start : start + quote.length
    const to = side === 'a' ? end : end - quote.length
    if (to < from) return null
    return { from: { row: this.row, col: from }, to: { row: this.row, col: to }, linewise: false }
  }

  private pairObject(open: string, close: string, side: 'i' | 'a'): { from: Pos; to: Pos; linewise: boolean } | null {
    const found = this.findPair(open, close)
    if (!found) return null
    if (side === 'a') return { from: found.open, to: found.close, linewise: false }
    const innerFrom = this.stepForward(found.open)
    const innerTo = this.stepBack(found.close)
    if (cmp(innerTo, innerFrom) < 0) return null
    return { from: innerFrom, to: innerTo, linewise: false }
  }

  private findPair(open: string, close: string): { open: Pos; close: Pos } | null {
    const all = this.indexedChars()
    const here = all.findIndex((item) => item.row === this.row && item.col <= this.col && this.col < item.col + item.ch.length)
    const start = here < 0 ? all.length - 1 : here
    let depth = 0
    for (let i = start; i >= 0; i--) {
      const item = all[i]
      if (!item) continue
      if (item.ch === close && close !== open) depth += 1
      else if (item.ch === open) {
        if (depth === 0) {
          let inner = 0
          for (let j = i + 1; j < all.length; j++) {
            const next = all[j]
            if (!next) continue
            if (next.ch === open && open !== close) inner += 1
            else if (next.ch === close) {
              if (inner === 0) return { open: { row: item.row, col: item.col }, close: { row: next.row, col: next.col } }
              inner -= 1
            }
          }
          return null
        }
        depth -= 1
      }
    }
    return null
  }

  private matchPair() {
    const pairs: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' }
    const ch = cpAt(this.line(), this.col)
    const other = pairs[ch]
    if (!other) return
    const open = '([{<'.includes(ch)
    const all = this.indexedChars()
    const index = all.findIndex((item) => item.row === this.row && item.col === this.col)
    if (index < 0) return
    let depth = 0
    const step = open ? 1 : -1
    for (let i = index + step; i >= 0 && i < all.length; i += step) {
      const item = all[i]
      if (!item) continue
      if (item.ch === ch) depth += 1
      else if (item.ch === other) {
        if (depth === 0) {
          this.jump({ row: item.row, col: item.col })
          return
        }
        depth -= 1
      }
    }
  }

  private indexedChars(): { row: number; col: number; ch: string }[] {
    const out: { row: number; col: number; ch: string }[] = []
    for (let row = 0; row < this.lines.length; row++) {
      let col = 0
      for (const ch of Array.from(this.lines[row] ?? '')) {
        out.push({ row, col, ch })
        col += ch.length
      }
    }
    return out
  }

  private word(times: number, dir: 1 | -1, edge: 'start' | 'end', big: boolean) {
    for (let n = 0; n < times; n++) {
      if (!this.wordOnce(dir, edge, big)) break
    }
    this.reveal()
  }

  private wordOnce(dir: 1 | -1, edge: 'start' | 'end', big: boolean): boolean {
    const units = this.units(this.line(), big)
    const index = units.findIndex((unit) => unit.i <= this.col && this.col < unit.i + unit.ch.length)
    if (dir === 1) {
      let cursor = index
      if (edge === 'end') {
        if (cursor >= 0 && units[cursor]?.kind !== 's') {
          while (cursor + 1 < units.length && units[cursor + 1]?.kind === units[cursor]?.kind) cursor += 1
          if ((units[cursor]?.i ?? 0) !== this.col) {
            this.col = units[cursor]?.i ?? this.col
            return true
          }
        }
        cursor = Math.max(cursor, 0) + 1
        while (cursor < units.length && units[cursor]?.kind === 's') cursor += 1
        if (cursor >= units.length) return this.nextLine(1)
        const kind = units[cursor]?.kind
        while (cursor + 1 < units.length && units[cursor + 1]?.kind === kind) cursor += 1
        this.col = units[cursor]?.i ?? this.col
        return true
      }
      const kind = cursor >= 0 ? units[cursor]?.kind : 's'
      let cursorNext = cursor + 1
      if (kind !== 's') while (cursorNext < units.length && units[cursorNext]?.kind === kind) cursorNext += 1
      while (cursorNext < units.length && units[cursorNext]?.kind === 's') cursorNext += 1
      if (cursorNext >= units.length) return this.nextLine(1)
      this.col = units[cursorNext]?.i ?? this.col
      return true
    }
    let cursor = index < 0 ? units.length - 1 : index
    if (cursor > 0 && units[cursor]?.i === this.col) cursor -= 1
    while (cursor > 0 && units[cursor]?.kind === 's') cursor -= 1
    const kind = units[cursor]?.kind
    while (cursor > 0 && units[cursor - 1]?.kind === kind) cursor -= 1
    if (cursor < 0 || !units.length) return this.nextLine(-1)
    this.col = units[cursor]?.i ?? 0
    return true
  }

  private nextLine(dir: 1 | -1): boolean {
    const row = this.row + dir
    if (row < 0 || row >= this.lines.length) return false
    this.row = row
    this.col = 0
    return true
  }

  private units(line: string, big: boolean): { i: number; ch: string; kind: 'w' | 's' | 'o' }[] {
    const out: { i: number; ch: string; kind: 'w' | 's' | 'o' }[] = []
    let i = 0
    for (const ch of Array.from(line)) {
      let kind: 'w' | 's' | 'o' = 'o'
      if (/\s/u.test(ch)) kind = 's'
      else if (big || /[\p{L}\p{N}_]/u.test(ch)) kind = 'w'
      out.push({ i, ch, kind })
      i += ch.length
    }
    return out
  }

  private paragraph(delta: number) {
    const dir = delta < 0 ? -1 : 1
    let left = Math.abs(delta)
    while (left > 0) {
      let row = this.row + dir
      if (row < 0 || row >= this.lines.length) break
      while (row >= 0 && row < this.lines.length && !(this.lines[row] ?? '').trim()) row += dir
      while (row >= 0 && row < this.lines.length && (this.lines[row] ?? '').trim()) row += dir
      if (dir < 0) row = Math.max(0, row)
      if (dir > 0) row = Math.min(this.lines.length - 1, row)
      this.row = row
      left -= 1
    }
    this.col = 0
    this.reveal()
  }

  private runFind(find: { ch: string; dir: 1 | -1; till: boolean }, times: number) {
    let col = this.col
    for (let n = 0; n < times; n++) {
      const line = this.line()
      let next = -1
      if (find.dir === 1) next = line.indexOf(find.ch, col + 1)
      else {
        const slice = line.slice(0, col)
        next = slice.lastIndexOf(find.ch)
      }
      if (next < 0) return
      col = next
    }
    if (find.till) col += find.dir === 1 ? -1 : find.ch.length
    this.col = Math.max(0, col)
    this.pref = this.col
  }

  private repeatFind(sign: 1 | -1, times: number) {
    if (!this.lastFind) return
    const find = { ...this.lastFind, dir: (this.lastFind.dir * sign) as 1 | -1 }
    this.runFind(find, times)
  }

  private moveH(times: number) {
    for (let i = 0; i < times; i++) {
      if (this.col <= 0) break
      this.col = indexBefore(this.line(), this.col)
    }
    this.pref = this.col
  }

  private moveL(times: number) {
    for (let i = 0; i < times; i++) {
      const max = this.inserting() ? this.line().length : this.maxCol()
      if (this.col >= max) break
      const ch = cpAt(this.line(), this.col)
      if (!ch) break
      this.col += ch.length
    }
    this.pref = this.col
  }

  private moveV(times: number, dir: 1 | -1) {
    this.row = Math.max(0, Math.min(this.lines.length - 1, this.row + dir * times))
    this.col = Math.min(this.pref, this.maxCol())
    this.reveal()
  }

  private jump(pos: Pos) {
    this.row = Math.max(0, Math.min(this.lines.length - 1, pos.row))
    this.col = Math.max(0, pos.col)
    this.clamp()
    this.pref = this.col
    this.reveal()
  }

  private toFirstNonBlank() {
    const match = /^\s*/.exec(this.line())
    this.col = match ? match[0].length : 0
    if (!this.inserting() && this.col > this.maxCol()) this.col = this.maxCol()
    this.pref = this.col
  }

  private wordAtCursor(): string {
    const units = this.units(this.line(), false)
    const hit = units.find((unit) => unit.i <= this.col && this.col < unit.i + unit.ch.length && unit.kind === 'w')
    if (!hit) return ''
    const same = units.filter((unit) => unit.kind === 'w')
    const start = same.findIndex((unit) => unit.i === hit.i)
    let left = start
    let right = start
    const all = this.units(this.line(), false)
    const index = all.indexOf(hit)
    left = index
    right = index
    while (left > 0 && all[left - 1]?.kind === 'w') left -= 1
    while (right + 1 < all.length && all[right + 1]?.kind === 'w') right += 1
    return all
      .slice(left, right + 1)
      .map((unit) => unit.ch)
      .join('')
  }

  private undo() {
    const snap = this.past.pop()
    if (!snap) {
      this.message = 'Already at oldest change'
      return
    }
    this.future.push(this.snapshot())
    this.restore(snap)
    this.group = false
  }

  private redoAct() {
    const snap = this.future.pop()
    if (!snap) {
      this.message = 'Already at newest change'
      return
    }
    this.past.push(this.snapshot())
    this.restore(snap)
  }

  private begin() {
    if (this.group) return
    this.past.push(this.snapshot())
    if (this.past.length > 200) this.past.shift()
    this.future.length = 0
    this.group = true
  }

  private finishGroup() {
    if (this.mode !== 'insert' && this.mode !== 'replace') this.group = false
  }

  private snapshot() {
    return { lines: this.lines.slice(), row: this.row, col: this.col }
  }

  private restore(snap: { lines: string[]; row: number; col: number }) {
    this.lines = snap.lines.slice()
    this.row = snap.row
    this.col = snap.col
    this.clamp()
    this.reveal()
  }

  private selection(): { from: Pos; to: Pos; linewise: boolean } {
    const [from, to] = order(this.anchor, this.pos())
    if (this.mode === 'vline') return { from: { row: from.row, col: 0 }, to: { row: to.row, col: 0 }, linewise: true }
    return { from, to, linewise: false }
  }

  private pieces(row: number): VimPiece[] {
    const line = this.lines[row] ?? ''
    const range = this.mode === 'visual' || this.mode === 'vline' ? this.selection() : null
    const pieces: VimPiece[] = []
    let col = 0
    const chars = Array.from(line)
    if (!chars.length) {
      pieces.push({ text: ' ', cursor: row === this.row, visual: this.inRange(row, 0, range), col: 0 })
    }
    for (const ch of chars) {
      const cursor = row === this.row && col === this.col
      pieces.push({ text: ch === ' ' ? ' ' : ch, cursor, visual: this.inRange(row, col, range), col })
      col += ch.length
    }
    if (row === this.row && this.inserting() && this.col >= line.length) {
      pieces.push({ text: ' ', cursor: true, visual: false, col: line.length })
    }
    if (this.list) pieces.push({ text: '$', cursor: false, visual: false, col: line.length })
    return mergePieces(pieces)
  }

  private inRange(row: number, col: number, range: { from: Pos; to: Pos; linewise: boolean } | null): boolean {
    if (!range) return false
    if (range.linewise) return row >= range.from.row && row <= range.to.row
    const pos = { row, col }
    return cmp(pos, range.from) >= 0 && cmp(pos, range.to) <= 0
  }

  private gutter(row: number): string {
    if (!this.number) return ''
    return String(row + 1).padStart(3, ' ') + ' '
  }

  private modeLabel(): string {
    if (this.mode === 'insert') return '-- INSERT --'
    if (this.mode === 'replace') return '-- REPLACE --'
    if (this.mode === 'visual') return '-- VISUAL --'
    if (this.mode === 'vline') return '-- VISUAL LINE --'
    if (this.op) return `-- ${this.op.toUpperCase()} --`
    return ''
  }

  private reveal() {
    if (this.row < this.top) this.top = this.row
    if (this.row >= this.top + this.rows) this.top = this.row - this.rows + 1
    const max = Math.max(0, this.lines.length - this.rows)
    this.top = Math.max(0, Math.min(this.top, max))
  }

  private clamp() {
    this.row = Math.max(0, Math.min(this.lines.length - 1, this.row))
    const max = this.inserting() ? this.line().length : this.maxCol()
    this.col = Math.max(0, Math.min(max, this.col))
  }

  private maxCol(): number {
    const line = this.line()
    if (!line) return 0
    return indexBefore(line, line.length)
  }

  private inserting(): boolean {
    return this.mode === 'insert' || this.mode === 'replace'
  }

  private line(): string {
    return this.lines[this.row] ?? ''
  }

  private pos(): Pos {
    return { row: this.row, col: this.col }
  }

  private byteCol(): number {
    return Array.from(this.line().slice(0, this.col)).length
  }

  private takeCount(): number {
    const count = this.countBuf ? Number(this.countBuf) : 0
    this.countBuf = ''
    return count
  }

  private product(extra: number): number {
    return Math.max(1, (this.opCount || 1) * Math.max(1, extra))
  }

  private clearOp() {
    this.op = ''
    this.opCount = 0
    this.wait = ''
  }

  private stepBack(pos: Pos): Pos {
    if (pos.col > 0) return { row: pos.row, col: indexBefore(this.lines[pos.row] ?? '', pos.col) }
    if (pos.row === 0) return pos
    const prev = this.lines[pos.row - 1] ?? ''
    return { row: pos.row - 1, col: prev.length }
  }

  private stepForward(pos: Pos): Pos {
    const line = this.lines[pos.row] ?? ''
    const ch = cpAt(line, pos.col)
    if (ch) return { row: pos.row, col: pos.col + ch.length }
    if (pos.row >= this.lines.length - 1) return pos
    return { row: pos.row + 1, col: 0 }
  }
}

function isMove(name: string): boolean {
  return (
    'hjklwbeWBE0$^G{}%nN'.includes(name) ||
    name === 'ArrowLeft' ||
    name === 'ArrowRight' ||
    name === 'ArrowUp' ||
    name === 'ArrowDown' ||
    name === 'Home' ||
    name === 'End' ||
    name === 'Backspace' ||
    name === 'Enter' ||
    name === ' ' ||
    name === '+' ||
    name === '-' ||
    name === 'c-d' ||
    name === 'c-u' ||
    name === 'c-f' ||
    name === 'c-b' ||
    name === 'PageDown' ||
    name === 'PageUp' ||
    name === 'zz' ||
    name === 'zt' ||
    name === 'zb'
  )
}

function cmp(a: Pos, b: Pos): number {
  if (a.row !== b.row) return a.row - b.row
  return a.col - b.col
}

function order(a: Pos, b: Pos): [Pos, Pos] {
  return cmp(a, b) <= 0 ? [a, b] : [b, a]
}

function cpAt(line: string, index: number): string {
  return Array.from(line.slice(index))[0] ?? ''
}

function cpLen(ch: string): number {
  return ch.length
}

function indexBefore(line: string, index: number): number {
  const parts = Array.from(line.slice(0, index))
  parts.pop()
  return parts.join('').length
}

function cpBefore(line: string, index: number): string {
  return Array.from(line.slice(0, index)).at(-1) ?? ''
}

function mapCase(text: string, op: 'lower' | 'upper' | 'swap'): string {
  return Array.from(text)
    .map((ch) => {
      if (op === 'lower') return ch.toLowerCase()
      if (op === 'upper') return ch.toUpperCase()
      return ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
    })
    .join('')
}

function mergePieces(pieces: VimPiece[]): VimPiece[] {
  const out: VimPiece[] = []
  for (const piece of pieces) {
    const prev = out[out.length - 1]
    if (prev && prev.cursor === piece.cursor && prev.visual === piece.visual && !piece.cursor) prev.text += piece.text
    else out.push({ ...piece })
  }
  return out
}

function parseSub(text: string): { all: boolean; pat: string; rep: string; global: boolean } | null {
  const all = text.startsWith('%')
  const body = all ? text.slice(1).trim() : text
  if (!body.startsWith('s') || body.length < 4) return null
  const sep = body[1] ?? ''
  if (!sep || sep === ' ') return null
  const parts = body.slice(2).split(sep)
  if (parts.length < 2) return null
  const flags = parts[2] ?? ''
  return { all, pat: parts[0] ?? '', rep: parts[1] ?? '', global: flags.includes('g') }
}
