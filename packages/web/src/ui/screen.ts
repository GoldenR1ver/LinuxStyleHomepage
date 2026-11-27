import { createShell } from '@home/core/app/session'
import type { Runtime } from '@home/core/app/runtime'
import { authenticate, homeDir } from '@home/core/kernel/auth'
import { doctor } from '@home/core/kernel/doctor'
import type { User } from '@home/core/kernel/types'
import { publicHome } from '@home/core/config/site'
import { Mux, type Layout, type Pane } from '@home/core/mux/mux'
import { lookup } from '@home/core/shell/commands'
import { link } from '@home/core/shell/commands/helpers'
import { INTRO_MS_MAX, typeBlock } from './ansi'
import { readLanding } from './landing'
import { shellLoop } from './loop'
import { TermView } from './term'

const PREFIX_HELP = 'type help\n'
/** A path in content/ is read by root, the same identity the build uses. */
const ROOT_USER: User = { name: 'root', role: 'root' }

export function startApp(rt: Runtime, warning = '') {
  const root = document.querySelector('#app')
  if (!(root instanceof HTMLElement)) throw new Error('missing #app')
  root.className = 'screen'
  const layout = document.createElement('div')
  layout.className = 'layout'
  const status = document.createElement('footer')
  status.className = 'status'
  const statusLeft = document.createElement('div')
  statusLeft.className = 'status-left'
  const statusRight = document.createElement('div')
  statusRight.className = 'status-right'
  const splitH = touchButton('side', () => current?.split('h'))
  const splitV = touchButton('stack', () => current?.split('v'))
  const clock = document.createElement('span')
  clock.className = 'clock'
  statusRight.append(splitH, splitV, clock)
  status.append(statusLeft, statusRight)
  root.append(layout, status)

  const views = new Map<string, TermView>()
  let current: Mux | null = null
  let front: TermView | null = null
  let epoch = 0
  let prefix = false
  let focusTimer = 0
  const visits: string[] = []

  rt.procs = () => current?.processes() ?? []
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('focus', restoreFocus)
  window.setInterval(() => renderStatus(), 30_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushVisits()
      return
    }
    restoreFocus()
  })

  void startSession()

  async function startSession() {
    const mine = epoch
    status.hidden = true
    const user = await login(layout, rt, (view) => {
      front = view
    })
    if (mine !== epoch) return
    const hostname = readHostname(rt)
    const cwd = rt.fs.exists(user, publicHome(rt.site)) ? publicHome(rt.site) : '/'
    ensureScratch(rt, user)
    const ctx = createShell(rt, user, cwd)
    ctx.env.HOSTNAME = hostname
    const mux = new Mux((from) => {
      if (!from) return ctx
      return {
        user: from.user,
        cwd: from.cwd,
        env: { ...from.env },
        aliases: { ...from.aliases },
        functions: { ...from.functions },
        args: [],
        history: [],
        rt,
        host: from.host,
        columns: from.columns,
        closing: false,
        line: '',
      }
    })
    current = mux
    rt.mux = mux
    mux.onPane = (pane) => startPane(mux, pane)
    mux.onLayout = () => renderLayout()
    mux.onStatus = () => {
      markActive()
      focusActive()
      renderStatus()
    }
    const pane = mux.start('main', ctx)
    startPane(mux, pane, `${warning}${intro(rt, user)}`)
    status.hidden = false
    document.title = `${user.name}@${hostname}`
    renderLayout()
  }

  function startPane(mux: Mux, pane: Pane, introText = '') {
    const mine = epoch
    const view = new TermView()
    views.set(pane.id, view)
    pane.cancel = () => {
      views.delete(pane.id)
      view.cancel()
    }
    view.onActivate = () => {
      if (current !== mux) return
      mux.focus(pane.id)
      markActive()
      focusActive()
    }
    void shellLoop(view, pane.ctx, {
      intro: introText,
      onPrompt: () => renderStatus(),
      onCommand: (line, code) => noteVisit(pane.ctx.user.name, pane.ctx.user.role, line, code),
    }).then((reason) => {
      if (mine !== epoch || current !== mux) return
      if (reason === 'closed') return
      if (reason === 'logout' || mux.paneCount() <= 1) {
        endSession()
        return
      }
      if (reason === 'exit') mux.killPane(pane.id)
    })
  }

  function endSession() {
    epoch += 1
    prefix = false
    const mux = current
    current = null
    rt.mux = null
    if (mux) for (const pane of mux.collect()) pane.cancel()
    views.clear()
    layout.replaceChildren()
    document.title = rt.site.title
    void startSession()
  }

  function renderLayout() {
    const mux = current
    if (!mux) return
    const session = mux.attachedSession()
    const win = session.windows[session.active]
    layout.replaceChildren(win ? renderNode(win.layout) : document.createElement('div'))
    markActive()
    focusActive()
    renderStatus()
  }

  function renderNode(node: Layout): HTMLElement {
    if (node.t === 'pane') {
      const wrap = document.createElement('div')
      wrap.className = 'split-child'
      const view = views.get(node.id)
      if (view) wrap.append(view.el)
      return wrap
    }
    const el = document.createElement('div')
    el.className = `split ${node.t === 'row' ? 'across' : 'stack'}`
    el.append(renderNode(node.a), renderNode(node.b))
    return el
  }

  function markActive() {
    const id = current ? safeActiveId(current) : ''
    for (const [paneId, view] of views) view.setActive(paneId === id)
  }

  function focusActive() {
    const id = current ? safeActiveId(current) : ''
    const view = views.get(id)
    if (view) front = view
    view?.focus()
  }

  function restoreFocus() {
    window.clearTimeout(focusTimer)
    focusTimer = window.setTimeout(() => {
      if (selectionInScroll()) return
      front?.focus()
    }, 0)
  }

  function renderStatus() {
    statusLeft.replaceChildren()
    const mux = current
    if (!mux) {
      clock.textContent = ''
      return
    }
    const session = mux.attachedSession()
    const name = document.createElement('span')
    name.className = 'session'
    name.textContent = session.name
    statusLeft.append(name)
    session.windows.forEach((win, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = index === session.active ? 'win on' : 'win'
      button.textContent = `${index}:${win.name}${index === session.active ? '*' : ''}`
      button.addEventListener('click', () => mux.selectWindow(index))
      statusLeft.append(button)
    })
    if (prefix) {
      clock.textContent = 'prefix'
      return
    }
    const pane = mux.activePane()
    const now = new Date()
    const p = (value: number) => String(value).padStart(2, '0')
    clock.textContent = `${pane.ctx.user.name}  ${pane.ctx.cwd}  ${p(now.getHours())}:${p(now.getMinutes())}`
  }

  function onKey(event: KeyboardEvent) {
    if (event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      event.stopPropagation()
      prefix = true
      renderStatus()
      return
    }
    if (!prefix) return
    event.preventDefault()
    event.stopPropagation()
    prefix = false
    const mux = current
    if (!mux || event.isComposing) {
      renderStatus()
      return
    }
    const key = event.key
    if (key === '%') mux.split('h')
    else if (key === '"') mux.split('v')
    else if (key === 'ArrowLeft' || key === 'h') mux.selectPane('L')
    else if (key === 'ArrowRight' || key === 'l') mux.selectPane('R')
    else if (key === 'ArrowUp' || key === 'k') mux.selectPane('U')
    else if (key === 'ArrowDown' || key === 'j') mux.selectPane('D')
    else if (key === 'x') {
      if (!mux.killPane()) activeView()?.print('cannot close the last pane. use exit.\n', 'dim')
    } else if (key === 'c') mux.newWindow()
    else if (key === 'n') mux.nextWindow(1)
    else if (key === 'p') mux.nextWindow(-1)
    else if (key === 'd') activeView()?.print('already attached. there is only one client.\n', 'dim')
    else if (key === '?') activeView()?.print(PREFIX_HELP, 'dim')
    else if (/^[0-9]$/.test(key)) mux.selectWindow(Number(key))
    renderStatus()
  }

  function activeView(): TermView | undefined {
    const mux = current
    if (!mux) return undefined
    return views.get(safeActiveId(mux))
  }

  function noteVisit(user: string, role: User['role'], line: string, code: number) {
    if (!rt.site.reportVisits || role === 'root' || !rt.mail.configured) return
    visits.push(`${new Date().toISOString()} ${user} ${code} ${line}`)
    if (visits.length >= 20) void flushVisits()
  }

  async function flushVisits() {
    if (!visits.length) return
    const body = visits.splice(0, visits.length).join('\n')
    try {
      await rt.mail.send({ kind: 'visit', user: 'guest', body })
    } catch {
      /* a failed visit report must not break the shell */
    }
  }
}

async function login(
  layout: HTMLElement,
  rt: Runtime,
  claim: (view: TermView) => void,
): Promise<User> {
  const hostname = readHostname(rt)
  const view = new TermView()
  claim(view)
  view.setActive(true)
  layout.replaceChildren(view.el)
  view.focus()
  await showLanding(view, rt)
  for (;;) {
    const name = await view.readLine({ plain: `${hostname} login: ` })
    if (name.type !== 'submit' || !name.value.trim()) continue
    const password = await view.askSecret('Password: ')
    if (password === null) {
      view.print('\n')
      continue
    }
    const user = authenticate(name.value, password, rt.vault.get())
    if (!user) {
      view.print('Login incorrect\n')
      await delay(400)
      continue
    }
    return user
  }
}

/**
 * The pre-login page: a large serif welcome, then the portrait at the right edge
 * under it, then the message wrapping around the picture. Text lives in
 * /etc/landing; this function sets the pace. A key or a click skips the rest.
 */
async function showLanding(view: TermView, rt: Runtime) {
  const landing = readLanding(rt)
  try {
    await document.fonts.load('400 17px Roboto')
  } catch {
    /* the fallback stack still works */
  }
  let skipped = false
  const skip = () => {
    skipped = true
  }
  window.addEventListener('keydown', skip, true)
  window.addEventListener('mousedown', skip, true)
  try {
    await view.print(typeBlock(landing.hero, 30), 'hero', { maxMs: 900 })
    const url = landing.portrait ? portraitUrl(rt, landing.portrait.path) : null
    if (url && landing.portrait) {
      // After the headline on purpose: the float then starts below `Welcome`,
      // and only the message below it wraps.
      view.printImage(url, landing.portrait.alt, skipped)
      if (!skipped) await delay(400)
    }
    // Beside the plate the message fills the column; the float shortens its lines.
    await view.print(typeBlock(landing.body, 90), url ? 'intro beside' : 'intro', {
      maxMs: skipped ? 0 : INTRO_MS_MAX,
    })
  } finally {
    window.removeEventListener('keydown', skip, true)
    window.removeEventListener('mousedown', skip, true)
  }
}

/** The URL of a binary in the content tree, or null when the path is missing or text. */
function portraitUrl(rt: Runtime, path: string): string | null {
  try {
    const node = rt.fs.read(ROOT_USER, path)
    if (node.type !== 'file' || !node.url) return null
    return node.url
  } catch {
    return null
  }
}

/** The motd is the first long page a visitor reads, so it types at a reading pace. */
const MOTD_CPS = 140

function intro(rt: Runtime, user: User): string {
  let text = ''
  const previous = rememberLogin(user.name)
  if (previous) text += `Last login: ${previous}\n`
  try {
    const motd = rt.fs.read(user, '/etc/motd')
    if (motd.encoding === 'utf8') {
      const body = motd.content.endsWith('\n') ? motd.content : `${motd.content}\n`
      text += typeBlock(linkQuotedCommands(body), MOTD_CPS)
    }
  } catch {
    text += `${link('help', 'help')}\n`
  }
  if (user.role === 'root') {
    for (const note of doctor(rt.fs, rt.site)) text += `doctor: ${note}\n`
  }
  return text
}

/**
 * Link a command the motd names in quotes, so the hint is one click.
 * Only a quoted word that is a command is linked; any other text stays as written.
 */
function linkQuotedCommands(text: string): string {
  return text.replace(/'([a-z][a-z0-9-]*)'/g, (whole: string, name: string) =>
    lookup(name) ? `'${link(name, name)}'` : whole,
  )
}

function ensureScratch(rt: Runtime, user: User) {
  if (user.role === 'root') return
  const home = homeDir(user)
  try {
    if (rt.fs.exists(user, home)) return
  } catch {
    return
  }
  rt.fs.begin()
  try {
    rt.fs.mkdir(user, home, { parents: true })
    rt.fs.finish()
  } catch {
    if (rt.fs.inTx()) rt.fs.abort()
  }
}

function readHostname(rt: Runtime): string {
  try {
    const file = rt.fs.read(ROOT_USER, '/etc/hostname')
    if (file.encoding === 'utf8' && file.content.trim()) return file.content.trim()
  } catch {
    /* fall back to the configured name */
  }
  return rt.site.hostname
}

function rememberLogin(name: string): string {
  const key = `hp.lastLogin.${name}`
  try {
    const previous = localStorage.getItem(key) ?? ''
    localStorage.setItem(key, new Date().toLocaleString('en-GB', { hour12: false }))
    return previous
  } catch {
    return ''
  }
}

function selectionInScroll(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.anchorNode) return false
  const el = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement
  return Boolean(el?.closest('.scroll'))
}

function safeActiveId(mux: Mux): string {
  try {
    return mux.activePane().id
  } catch {
    return ''
  }
}

function touchButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'touch'
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
