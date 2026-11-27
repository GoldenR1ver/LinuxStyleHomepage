/**
 * Public surface of the platform-neutral core.
 *
 * Everything here runs without a DOM: the kernel, the shell, the remote
 * adapters and the pane model. A host (the browser app, a Node CLI) supplies a
 * Store, an image and an http function; nothing in this package reaches for a
 * platform API on its own.
 */
export type { Runtime, Proc } from './app/runtime'
export { createShell } from './app/session'
export type { Persisted, Store } from './app/store'
export { memoryStore } from './app/store'

export { site, publicHome, mailRelay, mailRelayProblem } from './config/site'
export type { SiteConfig } from './config/site'

export { VirtualFS, FsError, installSystemDirs } from './kernel/vfs'
export type { Node, Entry, FileNode, DirNode, Stat, User } from './kernel/types'
export {
  authenticate,
  applyAccounts,
  homeDir,
  lookupUser,
  parseGroup,
  parsePasswd,
  parseShadow,
  readAccounts,
  setPassword,
  verifyPassword,
} from './kernel/accounts'
export type { Account, GroupEntry, Login, ShadowEntry } from './kernel/accounts'

export { Mux } from './mux/mux'
export type { Layout, Pane, SessionHost } from './mux/mux'

export { createMailer } from './remote/mail'
export type { Mailer } from './remote/mail'
export { createOutbox, restoreDraft } from './remote/outbox'
export type { MailDraft } from './remote/outbox'

export { runLine } from './shell/runner'
export { lookup, commandNames, allCommands } from './shell/commands'
export type {
  ShellCtx,
  Host,
  PickedFile,
  PickOptions,
  CommandResult,
  Stage,
  Download,
} from './shell/context'
