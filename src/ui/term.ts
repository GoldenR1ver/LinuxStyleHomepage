import { parseAnsi } from './ansi'

export interface Prompt {
  plain?: string
  user?: string
  host?: string
  cwd?: string
  sig?: string
  root?: boolean
}

export type ReadResult =
  | { type: 'submit'; value: string }
  | { type: 'eof' }
  | { type: 'interrupt' }
  | { type: 'closed' }

type Mode = 'idle' | 'line' | 'secret' | 'stdin' | 'pager' | 'stage'

/**
 * One pane.
 * Input is a real textarea so an IME candidate window can follow the caret.
 */
export class TermView {
  readonly el: HTMLElement
  onActivate: (() => void) | null = null
  onTab: ((line: string) => void) | null = null

  private readonly scroll: HTMLElement
  private readonly pagerEl: HTMLElement
  private readonly stageEl: HTMLElement
  private readonly prompt: HTMLElement
  private readonly row: HTMLElement
  private readonly input: HTMLTextAreaElement
  private pending: ((result: ReadResult) => void) | null = null
  private pagerDone: (() => void) | null = null
  private stageClose: (() => void) | null = null
  private stageFocus: (() => void) | null = null
  private mode: Mode = 'idle'
  private history: string[] = []
  private hist = -1
  private draft = ''
  private pagerLines: string[] = []
  private pagerTop = 0

  constructor() {
    this.el = document.createElement('section')
    this.el.className = 'pane'
    const wrap = document.createElement('div')
    wrap.className = 'scroll-wrap'
    this.scroll = document.createElement('div')
    this.scroll.className = 'scroll'
    this.pagerEl = document.createElement('div')
    this.pagerEl.className = 'pager'
    this.pagerEl.hidden = true
    this.stageEl = document.createElement('div')
    this.stageEl.className = 'stage'
    this.stageEl.hidden = true
    wrap.append(this.scroll, this.pagerEl, this.stageEl)
    const row = document.createElement('div')
    row.className = 'row'
    this.row = row
    this.prompt = document.createElement('span')
    this.prompt.className = 'prompt'
    this.input = document.createElement('textarea')
    this.input.className = 'cmd'
    this.input.rows = 1
    this.input.spellcheck = false
    this.input.autocomplete = 'off'
    this.input.autocapitalize = 'off'
    this.input.setAttribute('aria-label', 'terminal input')
    row.append(this.prompt, this.input)
    this.el.append(wrap, row)
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    this.input.addEventListener('input', () => this.fit())
    this.el.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      if (this.mode === 'stage') {
        const target = event.target
        if (target instanceof Element && target.closest('iframe, a, button, input, textarea')) return
        this.stageFocus?.()
        return
      }
      const inScroll = event.target instanceof Node && this.scroll.contains(event.target)
      if (!inScroll) {
        this.activate()
        return
      }
      window.addEventListener(
        'mouseup',
        () => {
          if (this.holdsSelection()) return
          this.activate()
        },
        { once: true, capture: true },
      )
    })
  }

  private activate() {
    this.onActivate?.()
    this.focus()
  }

  private holdsSelection(): boolean {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
    const node = sel.anchorNode
    return node instanceof Node && this.scroll.contains(node)
  }

  focus() {
    if (this.mode === 'idle') return
    if (this.mode === 'stage') {
      this.stageFocus?.()
      return
    }
    this.input.focus()
  }

  async present(
    mount: (
      root: HTMLElement,
      api: { done: () => void; onFocus: (fn: () => void) => void },
    ) => (() => void) | undefined,
  ): Promise<void> {
    this.mode = 'stage'
    this.stageEl.hidden = false
    this.stageEl.replaceChildren()
    this.row.hidden = true
    let cleanup: (() => void) | undefined
    let settled = false
    await new Promise<void>((resolve) => {
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      this.stageClose = done
      cleanup = mount(this.stageEl, {
        done,
        onFocus: (fn) => {
          this.stageFocus = fn
        },
      })
    })
    cleanup?.()
    this.stageClose = null
    this.stageFocus = null
    this.stageEl.hidden = true
    this.stageEl.replaceChildren()
    this.row.hidden = false
    if (this.mode === 'stage') this.mode = 'idle'
  }

  setActive(on: boolean) {
    this.el.classList.toggle('active', on)
    this.input.readOnly = !on
    this.input.tabIndex = on ? 0 : -1
  }

  setHistory(lines: string[]) {
    this.history = lines
  }

  setInput(value: string) {
    this.input.value = value
    this.fit()
    const end = value.length
    this.input.setSelectionRange(end, end)
  }

  columns(): number {
    const width = this.scroll.clientWidth || this.el.clientWidth || 720
    return Math.max(40, Math.floor((width - 28) / 8.8))
  }

  print(text: string, kind: 'out' | 'err' | 'dim' = 'out') {
    if (!text) return
    let body = text
    if (body.length > 80_000) body = `${body.slice(0, 80_000)}\n...(truncated)\n`
    const stick = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < 48
    const parts = body.split('\n')
    if (body.endsWith('\n')) parts.pop()
    for (const part of parts) this.addLine(part, kind)
    if (stick) this.scroll.scrollTop = this.scroll.scrollHeight
  }

  clear() {
    this.scroll.replaceChildren()
  }

  async readLine(prompt: Prompt): Promise<ReadResult> {
    this.resolve({ type: 'closed' })
    this.mode = 'line'
    this.input.classList.remove('secret')
    this.input.value = ''
    this.hist = -1
    this.pagerEl.hidden = true
    this.renderPrompt(prompt)
    this.fit()
    this.focusIfActive()
    return this.wait()
  }

  async askSecret(prompt: string): Promise<string | null> {
    this.resolve({ type: 'closed' })
    this.mode = 'secret'
    this.input.classList.add('secret')
    this.input.value = ''
    this.renderPrompt({ plain: prompt })
    this.fit()
    this.focusIfActive()
    const result = await this.wait()
    this.input.classList.remove('secret')
    return result.type === 'submit' ? result.value : null
  }

  async readStdin(): Promise<string | null> {
    this.resolve({ type: 'closed' })
    this.mode = 'stdin'
    this.input.classList.remove('secret')
    this.input.value = ''
    this.renderPrompt({ plain: '' })
    this.print('(Ctrl-D to finish, Ctrl-C to cancel)\n', 'dim')
    this.fit()
    this.focusIfActive()
    const result = await this.wait()
    return result.type === 'submit' ? result.value : null
  }

  pager(text: string): Promise<void> {
    this.mode = 'pager'
    this.pagerLines = text.length ? text.replace(/\n$/, '').split('\n') : ['']
    this.pagerTop = 0
    this.pagerEl.hidden = false
    this.input.value = ''
    this.renderPrompt({ plain: '' })
    this.drawPager()
    return new Promise((resolve) => {
      this.pagerDone = resolve
    })
  }

  cancel() {
    this.mode = 'idle'
    this.resolve({ type: 'closed' })
    this.endPager()
    this.stageClose?.()
  }

  private wait(): Promise<ReadResult> {
    return new Promise((resolve) => {
      this.pending = resolve
    })
  }

  private resolve(result: ReadResult) {
    const pending = this.pending
    this.pending = null
    pending?.(result)
  }

  private onKey(event: KeyboardEvent) {
    if (event.isComposing || event.key === 'Process') return
    if (this.mode === 'idle') return
    if (this.mode === 'pager') {
      event.preventDefault()
      this.onPagerKey(event.key)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && (this.mode === 'line' || this.mode === 'secret')) {
      event.preventDefault()
      this.submit()
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      this.print('^C\n', 'dim')
      this.input.value = ''
      this.fit()
      this.mode = 'idle'
      this.resolve({ type: 'interrupt' })
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      if (this.mode === 'stdin') {
        const value = this.input.value
        if (value) this.print(value.endsWith('\n') ? value : `${value}\n`)
        this.input.value = ''
        this.fit()
        this.mode = 'idle'
        this.resolve({ type: 'submit', value })
        return
      }
      if (!this.input.value) {
        this.mode = 'idle'
        this.resolve({ type: 'eof' })
      }
      return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'l' && this.mode === 'line') {
      event.preventDefault()
      this.clear()
      return
    }
    if (event.key === 'Tab' && this.mode === 'line') {
      event.preventDefault()
      this.onTab?.(this.input.value)
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.mode === 'line') {
      event.preventDefault()
      this.browseHistory(event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  private submit() {
    const value = this.input.value
    const entered = document.createElement('div')
    entered.className = 'entered'
    entered.append(this.prompt.cloneNode(true))
    if (this.mode !== 'secret') entered.append(document.createTextNode(value))
    this.scroll.append(entered)
    this.scroll.scrollTop = this.scroll.scrollHeight
    this.input.value = ''
    this.hist = -1
    this.fit()
    this.mode = 'idle'
    this.resolve({ type: 'submit', value })
  }

  private browseHistory(delta: number) {
    if (!this.history.length) return
    if (delta < 0) {
      if (this.hist < 0) this.draft = this.input.value
      const next = this.hist < 0 ? this.history.length - 1 : this.hist - 1
      if (next < 0) return
      this.hist = next
      this.setInput(this.history[next] ?? '')
      return
    }
    if (this.hist < 0) return
    this.hist += 1
    if (this.hist >= this.history.length) {
      this.hist = -1
      this.setInput(this.draft)
      return
    }
    this.setInput(this.history[this.hist] ?? '')
  }

  private onPagerKey(key: string) {
    const page = this.pageSize()
    if (key === 'q' || key === 'Escape') {
      this.endPager()
      return
    }
    if (key === ' ' || key === 'PageDown' || key === 'f') this.pagerTop += page
    else if (key === 'b' || key === 'PageUp') this.pagerTop -= page
    else if (key === 'j' || key === 'ArrowDown') this.pagerTop += 1
    else if (key === 'k' || key === 'ArrowUp') this.pagerTop -= 1
    else if (key === 'g' || key === 'Home') this.pagerTop = 0
    else if (key === 'G' || key === 'End') this.pagerTop = Math.max(0, this.pagerLines.length - page)
    this.pagerTop = Math.max(0, Math.min(this.pagerTop, Math.max(0, this.pagerLines.length - 1)))
    this.drawPager()
  }

  private endPager() {
    this.pagerEl.hidden = true
    this.pagerEl.replaceChildren()
    if (this.mode === 'pager') this.mode = 'line'
    const done = this.pagerDone
    this.pagerDone = null
    done?.()
  }

  private drawPager() {
    const page = this.pageSize()
    const slice = this.pagerLines.slice(this.pagerTop, this.pagerTop + page)
    const end = this.pagerTop + page >= this.pagerLines.length
    this.pagerEl.replaceChildren()
    for (const line of slice) this.appendPlain(this.pagerEl, line)
    const status = document.createElement('div')
    status.className = 'dim'
    status.textContent = end
      ? '(END)'
      : `:${this.pagerTop + 1}  ${this.pagerLines.length} lines  space page  q quit`
    this.pagerEl.append(status)
  }

  private pageSize(): number {
    return Math.max(4, Math.floor((this.scroll.clientHeight || 360) / 22) - 1)
  }

  private renderPrompt(prompt: Prompt) {
    this.prompt.replaceChildren()
    if (prompt.plain !== undefined) {
      this.prompt.textContent = prompt.plain
      return
    }
    this.prompt.append(
      span(prompt.root ? 'user root' : 'user', prompt.user ?? ''),
      text('@'),
      span('host', prompt.host ?? ''),
      text(':'),
      span('cwd', prompt.cwd ?? ''),
      text(`${prompt.sig ?? '$'} `),
    )
  }

  private addLine(text: string, kind: string) {
    const line = document.createElement('div')
    line.className = `ln ${kind}`
    if (!text) line.append(document.createTextNode('\u00a0'))
    else {
      for (const part of parseAnsi(text)) {
        if (!part.className) line.append(document.createTextNode(part.text))
        else {
          const node = document.createElement('span')
          node.className = part.className
          node.textContent = part.text
          line.append(node)
        }
      }
    }
    this.scroll.append(line)
    while (this.scroll.childElementCount > 2000) this.scroll.firstElementChild?.remove()
  }

  private appendPlain(parent: HTMLElement, text: string) {
    const line = document.createElement('div')
    line.textContent = text || '\u00a0'
    parent.append(line)
  }

  private focusIfActive() {
    if (this.el.classList.contains('active')) this.input.focus()
  }

  private fit() {
    this.input.style.height = 'auto'
    this.input.style.height = `${Math.min(this.input.scrollHeight, 180)}px`
  }
}

function span(className: string, value: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = className
  node.textContent = value
  return node
}

function text(value: string): Text {
  return document.createTextNode(value)
}
