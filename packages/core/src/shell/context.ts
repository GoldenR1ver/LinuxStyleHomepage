import type { User } from '../kernel/types'
import type { Runtime } from '../app/runtime'

/** One file chosen from the visitor's computer. */
export interface PickedFile {
  name: string
  type: string
  size: number
  /** Read only after the size check, so a huge file is never loaded into memory. */
  read: () => Promise<ArrayBuffer>
}

export interface PickOptions {
  multiple?: boolean
  accept?: string
}

/** What a command may ask the terminal for. The UI answers; the shell never draws. */
export interface Host {
  /** null means Ctrl-C. Ctrl-D resolves with the text entered so far, which may be empty. */
  readStdin(): Promise<string | null>
  askSecret(prompt: string): Promise<string | null>
  /** null means the chooser was dismissed. */
  pickFiles(options?: PickOptions): Promise<PickedFile[] | null>
}

export interface Download {
  filename: string
  href?: string
  text?: string
  mime?: string
}

export type Stage =
  | { kind: 'vim'; path: string | null; filename: string; text: string }
  | { kind: 'md'; title: string; text: string; base: string }
  | { kind: 'pdf'; title: string; url: string }

/** Everything one command line returns. The view decides how to present each field. */
export interface CommandResult {
  code: number
  stdout?: string
  stderr?: string
  /** stdout is a page to read; a host may set it in a proportional face. */
  prose?: boolean
  clear?: boolean
  logout?: boolean
  exitPane?: boolean
  pager?: string
  downloads?: Download[]
  stage?: Stage
}

export interface ShellCtx {
  user: User
  cwd: string
  env: Record<string, string>
  aliases: Record<string, string>
  /** Bodies defined with name() { ... }. Kept in this pane only. */
  functions: Record<string, string>
  /** Positional arguments of the running function: $1, $2, ... */
  args: string[]
  history: string[]
  rt: Runtime
  host: Host
  columns: number
  closing: boolean
  line: string
}
