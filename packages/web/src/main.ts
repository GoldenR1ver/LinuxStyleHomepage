import { createTokenStore } from '@home/core/remote/github'
import { createGithubRemote } from '@home/core/remote/github'
import { createMailer } from '@home/core/remote/mail'
import { createOutbox, restoreDraft } from '@home/core/remote/outbox'
import { createVault } from '@home/core/kernel/auth'
import { VirtualFS } from '@home/core/kernel/vfs'
import { loadImage } from './content/load'
import { openStore } from './persist/idb'
import type { Persisted } from '@home/core/app/store'
import { site } from '@home/core/config/site'
import type { Runtime } from '@home/core/app/runtime'
import { startApp } from './ui/screen'
import { applyTheme, initialTheme, watchSystemTheme } from './ui/themes'
import './ui/app.css'
import './ui/themes/swiss.css'
import './ui/themes/terminator.css'

const app = document.querySelector('#app')
// Before anything paints: the attribute the theme files key off, and the chrome.
applyTheme(initialTheme())
// Keep following the machine until the reader states a preference of their own.
watchSystemTheme()

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
  if (saved?.v === 1) fs.loadOverlay(saved.remote, saved.local)
  const tokens = createTokenStore(localStorage)
  const outbox = createOutbox(restoreDraft(saved?.v === 1 ? saved.outbox : null))
  const rt: Runtime = {
    site,
    fs,
    remote: createGithubRemote({
      owner: site.github.owner,
      repo: site.github.repo,
      branch: site.github.branch,
      contentRoot: site.github.contentRoot,
      token: () => tokens.get(),
    }),
    mail: createMailer(site.webhookUrl, site.email),
    outbox,
    vault: createVault(site.rootPassword, localStorage),
    tokens,
    persist: async () => {
      await opened.store.save({
        v: 1,
        remote: fs.exportLayer('remote'),
        local: fs.exportLayer('local'),
        outbox: outbox.draft,
      })
    },
    procs: () => [],
    mux: null,
  }
  if (app instanceof HTMLElement) app.replaceChildren()
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
