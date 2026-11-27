/**
 * Machine settings. Accounts, groups and passwords live in `content/etc`,
 * not here: `/etc/passwd`, `/etc/group` and `/etc/shadow` are the truth.
 *
 * This file only names the machine and the one outbound address a letter uses.
 */
export interface SiteConfig {
  /** Prompt hostname. Keep it equal to content/etc/hostname. */
  hostname: string
  /** Public home directory name, matching content/home/<owner>/. */
  owner: string
  title: string
  /** Recipient label included in guestbook mail. */
  email: string
  /**
   * mail push notify URL. POST JSON. Empty means the letter stays in this browser.
   * https only, and not a GitHub host. The mail command cannot replace this URL.
   * The endpoint must allow browser CORS. A Formspree form URL works, for example
   * https://formspree.io/f/meaganpk. The form's recipient is who receives the letter,
   * and the form must be confirmed in the Formspree dashboard.
   * Free Formspree is 50 letters a month. `email` below is only a label in the body.
   */
  webhookUrl: string
  /** When true, also POST a digest of guest commands. Off by default. */
  reportVisits: boolean
}

export const site: SiteConfig = {
  hostname: 'Yujiang Adam Li\'s Homepage',
  owner: 'owner',
  title: 'Yujiang Adam Li\'s Homepage',
  email: '2529319808@qq.com',
  // Formspree endpoint, confirmed. Empty means mail push only stages the letter.
  // Guests need no account: the browser POSTs JSON here and the form's own
  // recipient address receives the letter.
  webhookUrl: 'https://formspree.io/f/meaganpk',
  reportVisits: false,
}

export function publicHome(config: Pick<SiteConfig, 'owner'> = site): string {
  return `/home/${config.owner}`
}

const TOKEN_MARK = /ghp_|github_pat_|gho_|ghu_|ghs_|ghr_/

/**
 * The only URL mail is allowed to POST to.
 * Rejects cleartext, GitHub, embedded passwords, and token-shaped values.
 */
export function mailRelay(raw: string): string | null {
  const trimmed = raw.trim()
  return mailRelayProblem(trimmed) ? null : trimmed
}

/**
 * Why a webhookUrl cannot be used. Empty when it is fine.
 * The root login notes print this, so a typo is not just "relay: off".
 */
export function mailRelayProblem(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'webhookUrl is empty'
  if (TOKEN_MARK.test(trimmed)) return 'webhookUrl looks like a token, not a relay URL'
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return 'webhookUrl needs https://. A Formspree endpoint looks like https://formspree.io/f/abcdwxyz'
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'webhookUrl is not a valid URL'
  }
  if (url.protocol !== 'https:') return 'webhookUrl must use https'
  if (url.username || url.password) return 'webhookUrl must not embed a user name or password'
  const host = url.hostname.toLowerCase()
  if (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com')) {
    return 'webhookUrl must not point at GitHub'
  }
  if (url.searchParams.has('token') || url.searchParams.has('access_token')) {
    return 'webhookUrl must not carry a token in the query string'
  }
  return ''
}
