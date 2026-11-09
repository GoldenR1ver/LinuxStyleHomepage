export interface Download {
  filename: string
  href?: string
  text?: string
  mime?: string
}

export type Stage =
  | { kind: 'vim'; path: string | null; filename: string; text: string }
  | { kind: 'md'; title: string; text: string }
  | { kind: 'pdf'; title: string; url: string }

export interface CommandResult {
  code: number
  stdout?: string
  stderr?: string
  clear?: boolean
  logout?: boolean
  exitPane?: boolean
  pager?: string
  downloads?: Download[]
  stage?: Stage
}
