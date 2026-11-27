import type { User } from './types'

/**
 * Linux capabilities, cut down to the ones this kernel actually consults.
 *
 * `uid 0` used to be a single magic branch: "root may do anything". Linux has
 * not worked that way for twenty years. A process carries a set of capabilities,
 * and each privileged operation asks for one of them. An account with uid 0 gets
 * all of them, which is why root still behaves like root; an account with one
 * extra capability gets exactly that one power.
 */
export const CAPABILITIES = [
  'CAP_CHOWN',
  'CAP_DAC_OVERRIDE',
  'CAP_DAC_READ_SEARCH',
  'CAP_FOWNER',
  'CAP_FSETID',
  'CAP_SETGID',
  'CAP_SETUID',
  'CAP_SYS_ADMIN',
] as const

export type Cap = (typeof CAPABILITIES)[number]

const ALL: ReadonlySet<Cap> = new Set(CAPABILITIES)

export function asCap(value: string): Cap | null {
  return (CAPABILITIES as readonly string[]).includes(value) ? (value as Cap) : null
}

/** uid 0. Kept for display and for `/etc/passwd` checks, not for permission tests. */
export function isRoot(user: Pick<User, 'uid'>): boolean {
  return user.uid === 0
}

/** An identity's capabilities. uid 0 holds every one; anyone else holds the listed. */
type Capped = { uid: number; caps?: readonly string[] }

export function capsOf(user: Capped): ReadonlySet<Cap> {
  if (isRoot(user)) return ALL
  const held = new Set<Cap>()
  for (const name of user.caps ?? []) {
    const cap = asCap(name)
    if (cap) held.add(cap)
  }
  return held
}

export function hasCap(user: Capped, cap: Cap): boolean {
  return capsOf(user).has(cap)
}

/** `capsh --print`: one capability per line, in a stable order. */
export function formatCaps(user: Capped): string {
  const held = capsOf(user)
  return CAPABILITIES.map((cap) => `${held.has(cap) ? '+' : '-'}${cap.toLowerCase()}`).join('\n')
}
