import { createTokenStore } from './remote/token'
import { createGithubRemote } from './remote/github'
import { createMailer } from './remote/mail'
import { createOutbox, restoreDraft } from './remote/outbox'
import { createVault } from './kernel/auth'
import { Journal } from './kernel/journal'
import { VirtualFS } from './kernel/vfs'
import { loadImage } from './content/load'
import { openStore, type Persisted } from './persist/store'
import { site } from './config/site'
import type { Runtime } from './app/runtime'
import { startApp } from './ui/screen'
import './ui/app.css'

const app = document.querySelector('#app')

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
  const journal = new Journal(saved?.v === 1 ? saved.journal : { events: [], mutations: [] }, site.journalDays)
  const tokens = createTokenStore(localStorage)
  const outbox = createOutbox(restoreDraft(saved?.v === 1 ? saved.outbox : null))
  const rt: Runtime = {
    site,
    fs,
    journal,
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
        journal: journal.export(),
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
