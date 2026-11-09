import type { ShellCtx } from '../shell/context'
import { writeFile } from '../shell/commands/helpers'
import { seal } from '../shell/seal'
import type { Stage } from '../shell/result'
import type { TermView } from './term'
import { VimEngine, type VimKey } from './vim/engine'

export async function presentStage(view: TermView, ctx: ShellCtx, stage: Stage): Promise<void> {
  if (stage.kind === 'vim') await presentVim(view, ctx, stage)
  else await presentDocument(view, stage)
}

async function presentVim(
  view: TermView,
  ctx: ShellCtx,
  stage: Extract<Stage, { kind: 'vim' }>,
): Promise<void> {
  const engine = new VimEngine(stage.text, stage.filename, 24)
  await view.present((root, api) => {
    const screen = document.createElement('div')
    screen.className = 'vim-screen'
    const lines = document.createElement('div')
    lines.className = 'vim-lines'
    const status = document.createElement('div')
    status.className = 'vim-status'
    const prompt = document.createElement('div')
    prompt.className = 'vim-prompt'
    const ime = document.createElement('textarea')
    ime.className = 'vim-ime'
    ime.rows = 1
    ime.spellcheck = false
    ime.autocomplete = 'off'
    ime.autocapitalize = 'off'
    ime.setAttribute('aria-label', 'vim input')
    screen.append(lines, status, prompt, ime)
    root.append(screen)

    let composing = false
    const draw = () => {
      const height = lines.clientHeight || root.clientHeight - 48
      engine.resize(Math.max(1, Math.floor(height / 23)))
      const model = engine.model()
      lines.replaceChildren()
      let cursor: HTMLElement | null = null
      for (const row of model.rows) {
        const line = document.createElement('div')
        line.className = 'vim-line'
        if (row.gutter) {
          const gutter = document.createElement('span')
          gutter.className = 'vim-gutter'
          gutter.textContent = row.gutter
          line.append(gutter)
        }
        for (const piece of row.pieces) {
          const span = document.createElement('span')
          const classes = ['vim-cell']
          if (piece.visual) classes.push('vim-visual')
          if (piece.cursor) classes.push('vim-cursor')
          span.className = classes.join(' ')
          span.dataset.row = String(row.row)
          span.dataset.col = String(piece.col)
          span.textContent = piece.text
          if (piece.cursor) cursor = span
          line.append(span)
        }
        lines.append(line)
      }
      status.textContent = model.status
      prompt.textContent = model.prompt || '\u00a0'
      if (cursor) {
        const box = cursor.getBoundingClientRect()
        const host = screen.getBoundingClientRect()
        ime.style.left = `${box.left - host.left}px`
        ime.style.top = `${box.top - host.top}px`
        ime.style.height = `${Math.max(box.height, 18)}px`
        cursor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }

    const settle = async () => {
      const request = engine.writeRequest
      if (request) {
        const saved = stage.path ? await saveBuffer(ctx, stage.path, engine.text()) : { error: 'No file name', notice: '' }
        engine.acknowledgeWrite(saved.error, saved.notice)
      }
      if (engine.quit) api.done()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process' || composing) return
      const typing = engine.model().insert
      const plain = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
      if (typing && plain) return
      event.preventDefault()
      event.stopPropagation()
      engine.press(keyOf(event))
      void settle().then(() => {
        if (!engine.quit) draw()
      })
    }

    ime.addEventListener('compositionstart', () => {
      composing = true
    })
    ime.addEventListener('compositionend', () => {
      composing = false
      const text = ime.value
      ime.value = ''
      if (text) engine.insertText(text)
      void settle().then(() => {
        if (!engine.quit) draw()
      })
    })
    ime.addEventListener('input', () => {
      if (composing) return
      const text = ime.value
      ime.value = ''
      if (!text) return
      engine.insertText(text)
      void settle().then(() => {
        if (!engine.quit) draw()
      })
    })
    ime.addEventListener('keydown', onKey)
    lines.addEventListener('mousedown', (event) => {
      const span = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null
      if (!span) return
      const row = Number(span.dataset.row)
      const col = Number(span.dataset.col)
      const offset = caretOffset(event, span)
      engine.place(row, col + offset)
      draw()
      ime.focus()
    })
    api.onFocus(() => ime.focus())
    draw()
    requestAnimationFrame(() => {
      if (!engine.quit) draw()
    })
    ime.focus()
    return () => {
      ime.removeEventListener('keydown', onKey)
    }
  })
}

async function presentDocument(view: TermView, stage: Extract<Stage, { kind: 'md' | 'pdf' }>): Promise<void> {
  await view.present((root, api) => {
    const bar = document.createElement('div')
    bar.className = 'stage-bar'
    const title = document.createElement('span')
    title.className = 'stage-title'
    title.textContent = stage.title
    const command = document.createElement('span')
    command.className = 'stage-command'
    command.textContent = ':q'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'stage-close'
    button.textContent = ':q'
    button.addEventListener('click', () => api.done())
    bar.append(title, command, button)
    const body = document.createElement('div')
    body.className = 'stage-body'
    if (stage.kind === 'md') body.innerHTML = stage.text
    else {
      const frame = document.createElement('iframe')
      frame.className = 'stage-pdf'
      frame.src = stage.url
      frame.title = stage.title
      body.append(frame)
    }
    root.tabIndex = 0
    root.append(bar, body)
    let typed = ''
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (event.ctrlKey && event.key.toLowerCase() === 'c') || (event.key === 'q' && !typed)) {
        event.preventDefault()
        event.stopPropagation()
        api.done()
        return
      }
      if (event.key === ':' && !typed) {
        event.preventDefault()
        typed = ':'
        command.textContent = ':'
        return
      }
      if (!typed) return
      event.preventDefault()
      if (event.key === 'Enter') {
        if (typed === ':q') api.done()
        else {
          typed = ''
          command.textContent = ':q'
        }
        return
      }
      if (event.key === 'Backspace') {
        typed = typed.slice(0, -1)
        command.textContent = typed || ':q'
        return
      }
      if (event.key === 'Escape') {
        typed = ''
        command.textContent = ':q'
        return
      }
      if (event.key.length === 1 && typed.length < 20) {
        typed += event.key
        command.textContent = typed
      }
    }
    const onWindow = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', onWindow, true)
    api.onFocus(() => root.focus())
    root.focus()
    return () => window.removeEventListener('keydown', onWindow, true)
  })
}

async function saveBuffer(ctx: ShellCtx, path: string, text: string): Promise<{ error: string | null; notice: string }> {
  ctx.rt.fs.begin()
  try {
    writeFile(ctx.rt.fs, ctx.user, path, text, false)
    const note = await seal(ctx)
    return { error: null, notice: note.trim() }
  } catch (err) {
    if (ctx.rt.fs.inTx()) ctx.rt.fs.abort()
    return { error: err instanceof Error ? err.message : String(err), notice: '' }
  }
}

function keyOf(event: KeyboardEvent): VimKey {
  return { key: event.key, ctrl: event.ctrlKey }
}

function caretOffset(event: MouseEvent, span: HTMLElement): number {
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (!range || !span.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) return 0
  return Math.min(span.textContent?.length ?? 0, range.startOffset)
}
