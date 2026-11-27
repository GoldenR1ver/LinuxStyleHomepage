import { stripLinks } from '@home/core/kernel/text'
import { homeDir } from '@home/core/kernel/accounts'
import type { ShellCtx, PickOptions, PickedFile } from '@home/core/shell/context'
import { MOTION_MS_MAX, parseLines, revealDuration, revealSchedule, typedIndex, type Line as TextLine, type Span, type TypedRun } from './ansi'
import { currentTheme, setTheme, autoTheme, THEMES } from './themes'

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

interface MotionPlan {
  typed: { node: Node; full: string; cls: string }[]
  fades: { el: HTMLElement; step: number }[]
  cps: number
  faded: number
}

/** The typed spans as runs, so the cadence can see colors and paragraph breaks. */
function runsOf(plan: MotionPlan): TypedRun[] {
  return plan.typed.map((item) => ({ text: item.full, className: item.cls }))
}

/**
 * One pane.
 * Input is a real textarea so an IME candidate window can follow the caret.
 */
export class TermView {
  readonly el: HTMLElement
  onActivate: (() => void) | null = null
  onTab: ((line: string) => void) | null = null
  /** Answers `style` in the shell. The page restyles itself; the shell only asks. */
  readonly style = {
    list: () => [...THEMES] as string[],
    current: () => currentTheme() as string,
    set: (name: string) => setTheme(name) !== null,
    auto: () => autoTheme() as string,
  }

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
  private pagerLines: TextLine[] = []
  private pagerTop = 0
  /** Set while a typed reveal is running, so any key can end it. */
  private animating: (() => void) | null = null

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
    this.scroll.addEventListener('click', (event) => this.onLinkClick(event))
  }

  /** A link in the scrollback runs a command, but only when the prompt is waiting. */
  private onLinkClick(event: MouseEvent) {
    const anchor = event.target instanceof Element ? event.target.closest('a[data-cmd]') : null
    if (!(anchor instanceof HTMLElement)) return
    const raw = anchor.dataset.cmd ?? ''
    if (!raw) return
    if (this.holdsSelection()) return
    event.preventDefault()
    let command = raw
    try {
      command = decodeURIComponent(raw)
    } catch {
      /* an undecodable target is used as it is */
    }
    this.submitLine(command)
  }

  /** Type the line and press Enter. Ignored unless a prompt is waiting. */
  submitLine(value: string) {
    if (this.mode !== 'line' || !this.pending) return
    this.activate()
    this.setInput(value)
    this.submit()
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
    const style = getComputedStyle(this.scroll)
    const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    const content = Math.max(0, width - pad)
    return Math.max(40, Math.floor(content / this.charWidth()) - 1)
  }

  /** Width of one monospace cell in the terminal font. The CSS value is not assumed. */
  private charWidth(): number {
    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(20)
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;pointer-events:none'
    this.scroll.append(probe)
    const width = probe.getBoundingClientRect().width / 20
    probe.remove()
    return width > 0 ? width : 8.8
  }

  async print(
    text: string,
    kind: string = 'out',
    opts: { maxMs?: number } = {},
  ): Promise<void> {
    if (!text) return
    let body = text
    if (body.length > 80_000) body = `${body.slice(0, 80_000)}\n...(truncated)\n`
    if (body.endsWith('\n')) body = body.slice(0, -1)
    const stick = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < 48
    const plan = this.appendLines(parseLines(body), kind)
    if (stick) this.scroll.scrollTop = this.scroll.scrollHeight
    await this.reveal(plan, opts.maxMs)
  }

  /** Append a figure that holds one image, for the pre-login portrait. */
  printImage(url: string, alt: string, instant = false): void {
    const figure = document.createElement('figure')
    figure.className = instant ? 'ln portrait portrait-instant' : 'ln portrait'
    const img = document.createElement('img')
    img.src = url
    img.alt = alt
    img.decoding = 'async'
    figure.append(img)
    this.scroll.append(figure)
    this.scroll.scrollTop = this.scroll.scrollHeight
  }

  clear() {
    this.animating?.()
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

  async pickFiles(options?: PickOptions): Promise<PickedFile[] | null> {
    this.print('(choose files from your computer)\n', 'dim')
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options?.multiple ?? true
    if (options?.accept) input.accept = options.accept
    input.hidden = true
    this.el.append(input)
    const chosen = await new Promise<File[] | null>((resolve) => {
      let settled = false
      let timer = 0
      function finish(value: File[] | null) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        window.removeEventListener('focus', onFocus)
        input.remove()
        resolve(value)
      }
      function onFocus() {
        timer = window.setTimeout(() => {
          if (!input.files?.length) finish(null)
        }, 500)
      }
      input.addEventListener('change', () => finish(input.files ? Array.from(input.files) : []))
      input.addEventListener('cancel', () => finish(null))
      // The cancel event is recent. Focus back on the window also means the chooser closed.
      window.addEventListener('focus', onFocus)
      input.click()
    })
    this.focusIfActive()
    if (!chosen) return null
    const picked: PickedFile[] = []
    for (const file of chosen) {
      picked.push({ name: file.name, type: file.type, size: file.size, read: () => file.arrayBuffer() })
    }
    return picked
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
    const plain = stripLinks(text)
    // Color is kept: a file may carry SGR, and help highlights its headings.
    this.pagerLines = parseLines(plain.length ? plain.replace(/\n$/, '') : '')
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
    this.animating?.()
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
    for (const line of slice) this.appendPagerLine(line)
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
    // The identity plate: one element so a theme can paint `user@host` as a
    // single block. The colon, the cwd and the sigil stay separate.
    const who = document.createElement('span')
    who.className = 'who'
    who.append(
      span(prompt.root ? 'user root' : 'user', prompt.user ?? ''),
      text('@'),
      span('host', prompt.host ?? ''),
    )
    this.prompt.append(who, text(':'), span('cwd', prompt.cwd ?? ''), text(`${prompt.sig ?? '$'} `))
  }

  private addLine(line: TextLine, kind: string, plan: MotionPlan): HTMLElement {
    const el = document.createElement('div')
    el.className = `ln ${kind}`
    if (!line.spans.length) el.append(document.createTextNode('\u00a0'))
    for (const part of line.spans) {
      if (part.anim?.mode === 'type' && part.text) {
        const node = renderPart({ ...part, text: '' })
        el.append(node)
        if (part.anim.rate < plan.cps) plan.cps = part.anim.rate
        plan.typed.push({ node, full: part.text, cls: part.className })
        continue
      }
      if (part.anim?.mode === 'fade') {
        el.classList.add('motion-fade')
        plan.fades.push({ el, step: plan.faded++ * part.anim.rate })
      }
      el.append(renderPart(part))
    }
    this.scroll.append(el)
    while (this.scroll.childElementCount > 2000) this.scroll.firstElementChild?.remove()
    return el
  }

  /** Build the lines now so the scroll height is final, then return what still has to be revealed. */
  private appendLines(lines: TextLine[], kind: string): MotionPlan {
    const plan: MotionPlan = { typed: [], fades: [], cps: Number.POSITIVE_INFINITY, faded: 0 }
    for (const line of lines) this.addLine(line, kind, plan)
    // The fades start after the last typed character, so the block reads in order.
    const cps = Number.isFinite(plan.cps) ? plan.cps : 90
    const base = revealDuration(runsOf(plan), cps)
    for (const item of plan.fades) item.el.style.animationDelay = `${base + item.step}ms`
    return plan
  }

  /**
   * Reveal typed characters. Any key or click finishes it at once, and a hidden
   * tab or a reader who asked for reduced motion sees the final text immediately.
   */
  private reveal(plan: MotionPlan, maxMs = MOTION_MS_MAX): Promise<void> {
    if (!plan.typed.length) return Promise.resolve()
    const showAll = () => {
      for (const item of plan.typed) item.node.textContent = item.full
    }
    // A hidden tab and a reader who asked for reduced motion both get the final text at once.
    if (this.reducedMotion() || document.visibilityState === 'hidden') {
      showAll()
      return Promise.resolve()
    }
    const total = plan.typed.reduce((sum, item) => sum + [...item.full].length, 0)
    if (!total) {
      showAll()
      return Promise.resolve()
    }
    const cps = Number.isFinite(plan.cps) ? plan.cps : 90
    // Pauses are part of the cadence, so the block ends when the schedule ends.
    const schedule = revealSchedule(runsOf(plan), cps, maxMs)
    const times = schedule.times
    const span = schedule.duration

    return new Promise((resolve) => {
      let raf = 0
      let done = false
      const started = performance.now()
      const apply = (count: number) => {
        let left = count
        for (const item of plan.typed) {
          const chars = [...item.full]
          const visible = Math.max(0, Math.min(chars.length, left))
          left -= chars.length
          const next = chars.slice(0, visible).join('')
          if (item.node.textContent !== next) item.node.textContent = next
        }
      }
      const finish = () => {
        if (done) return
        done = true
        cancelAnimationFrame(raf)
        window.removeEventListener('keydown', onSkip, true)
        this.el.removeEventListener('mousedown', onSkip, true)
        if (this.animating === finish) this.animating = null
        this.input.readOnly = !this.el.classList.contains('active')
        apply(total)
        resolve()
      }
      const onSkip = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        finish()
      }
      this.animating = finish
      this.input.readOnly = true
      window.addEventListener('keydown', onSkip, true)
      this.el.addEventListener('mousedown', onSkip, true)

      const tick = () => {
        if (done) return
        const elapsed = performance.now() - started
        if (elapsed >= span) {
          finish()
          return
        }
        apply(typedIndex(times, elapsed))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })
  }

  private reducedMotion(): boolean {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }

  /** One pager row, with the same color spans the scroll uses. Links stay inert here. */
  private appendPagerLine(line: TextLine) {
    const row = document.createElement('div')
    if (!line.spans.length) row.append(document.createTextNode('\u00a0'))
    for (const part of line.spans) row.append(renderPart(part))
    this.pagerEl.append(row)
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

/** A run of text, colored, or linked. A `cmd:` link is typed at the prompt on click. */
function renderPart(part: Span): Node {
  if (!part.href) return part.className ? span(part.className, part.text) : document.createTextNode(part.text)
  const anchor = document.createElement('a')
  anchor.className = part.className ? `ln-link ${part.className}` : 'ln-link'
  anchor.textContent = part.text
  if (part.href.startsWith('cmd:')) {
    anchor.dataset.cmd = part.href.slice(4)
  } else {
    anchor.href = part.href
    anchor.target = '_blank'
    anchor.rel = 'noopener'
  }
  return anchor
}

function text(value: string): Text {
  return document.createTextNode(value)
}

/** The prompt for one pane: the home directory shortens to ~, and a narrow pane keeps the host short. */
export function promptParts(ctx: ShellCtx): Prompt {
  const home = ctx.env.HOME || homeDir(ctx.user)
  let cwd = ctx.cwd
  if (cwd === home) cwd = '~'
  else if (home !== '/' && cwd.startsWith(`${home}/`)) cwd = `~${cwd.slice(home.length)}`
  const host = ctx.env.HOSTNAME || 'home'
  return {
    user: ctx.user.name,
    host: ctx.columns && ctx.columns < 52 ? 'home' : host,
    cwd,
    sig: ctx.user.uid === 0 ? '#' : '$',
    root: ctx.user.uid === 0,
  }
}
