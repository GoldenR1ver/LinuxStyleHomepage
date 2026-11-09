import type { User } from './types'

const USER_RE = /^[^\s/\\:\u0000]{1,32}$/

export type { User }

export function homeDir(user: User): string {
  return user.role === 'root' ? '/root' : `/tmp/${user.name}`
}

/**
 * root checks the password. Any other legal name is a guest, and the password is ignored.
 * This switches a role on a static page. It does not prove identity.
 */
export function authenticate(nameRaw: string, password: string, rootPassword: string): User | null {
  const name = nameRaw.trim()
  if (!name || name === '.' || name === '..') return null
  if (name.toLowerCase() === 'root') {
    if (password !== rootPassword) return null
    return { name: 'root', role: 'root' }
  }
  if (!USER_RE.test(name)) return null
  return { name, role: 'guest' }
}

export interface PasswordVault {
  get(): string
  set(next: string): void
}

const PASSWORD_KEY = 'hp.rootPassword'

export function createVault(
  fallback: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): PasswordVault {
  return {
    get() {
      try {
        return storage?.getItem(PASSWORD_KEY) || fallback
      } catch {
        return fallback
      }
    },
    set(next: string) {
      storage?.setItem(PASSWORD_KEY, next)
    },
  }
}
