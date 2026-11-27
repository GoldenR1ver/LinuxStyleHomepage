import { createMailer } from '@home/core/remote/mail'
import { createOutbox, restoreDraft } from '@home/core/remote/outbox'
import { VirtualFS } from '@home/core/kernel/vfs'
import type { Entry } from '@home/core/kernel/types'
import { loadImage } from './content/load'
import { openStore } from './persist/idb'
import type { Persisted } from '@home/core/app/store'
import { site } from '@home/core/config/site'
import type { Runtime } from '@home/core/app/runtime'
import { startApp } from './ui/screen'
import { applyTheme, initialTheme, watchSystemTheme } from './ui/themes'
import { installProc } from '@home/core/app/system'
import './ui/app.css'
// Every theme file in the folder ships. Adding a name to THEMES and a file beside
// this one is the whole change: the glob cannot fall out of step with the list,
// which an explicit import can (terminator.css was once listed but never bundled).
import.meta.glob('./ui/themes/*.css', { eager: true })

const app = document.querySelector('#app')
// Before anything paints: the attribute the theme files key off, and the chrome.
applyTheme(initialTheme())
// Until the reader picks a style, the page follows the machine's light/dark mode.
watchSystemTheme()

/** v1 kept a `remote` layer for unbuilt commits. Fold it into the local overlay. */
function legacyLocal(raw: unknown): [string, Entry][] | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as {
    v?: number
    local?: [string, Entry][]
    remote?: [string, Entry][]
  }
  if (value.v === 2 && Array.isArray(value.local)) return value.local
  if (value.v === 1) {
    const merged = new Map<string, Entry>()
    for (const pair of value.remote ?? []) merged.set(pair[0], pair[1])
    for (const pair of value.local ?? []) merged.set(pair[0], pair[1])
    return [...merged.entries()]
  }
  return null
}

try {
  const image = await loadImage()
  const fs = new VirtualFS(image)
  const opened = await openStore()
  let saved: Persisted | null = null
  try {
    saved = await opened.store.load()
  } catch {
    saved = null
  }
  const local = legacyLocal(saved)
  if (local) fs.loadOverlay(local)
  const outbox = createOutbox(restoreDraft(saved?.outbox ?? null))
  const rt: Runtime = {
    site,
    fs,
    mail: createMailer(site.webhookUrl, site.email),
    outbox,
    persist: async () => {
      await opened.store.save({
        v: 2,
        local: fs.exportLayer(),
        outbox: outbox.draft,
      })
    },
    procs: () => [],
    mux: null,
  }
  if (app instanceof HTMLElement) app.replaceChildren()
  // /proc, the mount table and the tmpfs that is /tmp.
  installProc(rt)
  startApp(rt, opened.warning)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  if (app instanceof HTMLElement) {
    app.className = 'screen'
    const pre = document.createElement('pre')
    pre.textContent = message
    app.replaceChildren(pre)
  }
}
