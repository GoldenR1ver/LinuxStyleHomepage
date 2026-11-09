export interface Host {
  /** null means Ctrl-C. Ctrl-D resolves with the text entered so far, which may be empty. */
  readStdin(): Promise<string | null>
  askSecret(prompt: string): Promise<string | null>
}
