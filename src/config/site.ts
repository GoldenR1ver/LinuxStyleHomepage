/**
 * Machine settings. Keep the about page, projects, and notes in content/.
 *
 * The root password is only a local gate and is shipped in the frontend bundle.
 * Publishing files requires a GitHub token, stored in this browser by `github auth`.
 */
export interface SiteConfig {
  /** Prompt hostname. Keep it equal to content/etc/hostname. */
  hostname: string
  /** Public home directory name, matching content/home/<owner>/. */
  owner: string
  title: string
  /** Default root password. passwd changes only this browser, not this file. */
  rootPassword: string
  /** Recipient label included in guestbook mail. */
  email: string
  github: {
    owner: string
    repo: string
    branch: string
    /** Directory in the repo that holds the public file tree. */
    contentRoot: string
  }
  /**
   * mail push notify URL. POST JSON. Empty means the letter stays in this browser.
   * https only, and not a GitHub host. The mail command cannot replace this URL.
   * The endpoint must allow browser CORS. A Formspree form URL works.
   * The form's recipient is who receives the letter. `email` below is only a label in the body.
   */
  webhookUrl: string
  /** When true, also POST a digest of guest commands. Off by default. */
  reportVisits: boolean
  /** How many days of log and rollback to keep. */
  journalDays: number
}

export const site: SiteConfig = {
  hostname: 'Yujiang Adam Li\'s Homepage',
  owner: 'owner',
  title: 'Yujiang Adam Li\'s Homepage',
  rootPassword: 'lyj050910!',
  email: '25293198088@qq.com',
  github: {
    owner: '',
    repo: '',
    branch: 'main',
    contentRoot: 'content',
  },
  webhookUrl: '',
  reportVisits: false,
  journalDays: 7,
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
  if (!trimmed || TOKEN_MARK.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  if (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com')) return null
  if (url.searchParams.has('token') || url.searchParams.has('access_token')) return null
  return trimmed
}
