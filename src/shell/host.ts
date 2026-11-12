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

export interface Host {
  /** null means Ctrl-C. Ctrl-D resolves with the text entered so far, which may be empty. */
  readStdin(): Promise<string | null>
  askSecret(prompt: string): Promise<string | null>
  /** null means the chooser was dismissed. */
  pickFiles(options?: PickOptions): Promise<PickedFile[] | null>
}
