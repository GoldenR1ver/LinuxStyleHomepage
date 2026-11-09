export interface TokenStore {
  get(): string
  set(token: string): void
  clear(): void
}

const TOKEN_KEY = 'hp.github.token'

export function createTokenStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): TokenStore {
  return {
    get() {
      try {
        return storage?.getItem(TOKEN_KEY)?.trim() ?? ''
      } catch {
        return ''
      }
    },
    set(token: string) {
      storage?.setItem(TOKEN_KEY, token.trim())
    },
    clear() {
      storage?.removeItem(TOKEN_KEY)
    },
  }
}
