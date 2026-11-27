/**
 * The themes this build carries, in the order `style 0`, `style 1` count.
 * Every theme is a CSS file with one selector, `:root[data-theme="<name>"]`, and
 * is imported next to app.css in main.ts. Adding a name here is the only code
 * change a new theme needs.
 */
export const THEMES = ['swiss', 'terminator'] as const
export type ThemeName = (typeof THEMES)[number]

/** Kept in step with the inline reader in index.html, which runs before first paint. */
const KEY = 'hp.theme'

interface Chrome {
  /** A literal: a meta tag is read before any stylesheet can resolve a var(). */
  color: string
  scheme: 'light' | 'dark'
}

/** What the browser paints around the page, per theme. */
const CHROME: Record<ThemeName, Chrome> = {
  swiss: { color: '#ffffff', scheme: 'light' },
  terminator: { color: '#191815', scheme: 'dark' },
}

const DARK = '(prefers-color-scheme: dark)'

/** A name a URL or a shell line may carry, or null when it names no theme. */
export function asTheme(value: string | null | undefined): ThemeName | null {
  if (!value) return null
  return (THEMES as readonly string[]).includes(value) ? (value as ThemeName) : null
}

/** The theme the document is wearing right now. */
export function currentTheme(): ThemeName {
  return asTheme(document.documentElement.dataset.theme) ?? THEMES[0]
}

/** True when the reader's machine asks for a dark page. */
function prefersDark(): boolean {
  try {
    return matchMedia(DARK).matches
  } catch {
    return false
  }
}

/**
 * Which theme a given pair of facts asks for. Pure, so the rule can be read and
 * tested without a browser: a name the reader picked wins, otherwise the machine
 * decides between the first light theme and the first dark one.
 */
export function chooseTheme(stored: string | null, dark: boolean): ThemeName {
  const chosen = asTheme(stored)
  if (chosen) return chosen
  const wanted = dark ? 'dark' : 'light'
  return THEMES.find((name) => CHROME[name].scheme === wanted) ?? THEMES[0]
}

/** The theme this browser last chose on purpose, or null when it still follows the machine. */
function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Dress the page. CSS does the work; this only flips the attribute and the chrome. */
export function applyTheme(name: ThemeName): void {
  const root = document.documentElement
  root.dataset.theme = name
  const chrome = CHROME[name]
  root.style.colorScheme = chrome.scheme
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', chrome.scheme)
  // Two theme-color tags ship for the pre-JS paint; both are kept in step here.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', chrome.color)
  })
}

/** Switch and remember. Null means the name is not a theme. */
export function setTheme(name: string): ThemeName | null {
  const next = asTheme(name)
  if (!next) return null
  applyTheme(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* private mode: the choice lasts for this page, which is better than nothing */
  }
  return next
}

/** Forget the choice, so the browser's own light/dark preference decides again. */
export function autoTheme(): ThemeName {
  try {
    localStorage.removeItem(KEY)
  } catch {}
  const next = chooseTheme(null, prefersDark())
  applyTheme(next)
  return next
}

/**
 * What to wear on load. `?style=` (or `?theme=`) is a preview and is not
 * remembered; otherwise the reader's last choice wins, and a reader who never
 * chose gets the style their machine asks for.
 */
export function initialTheme(): ThemeName {
  const query = new URLSearchParams(location.search)
  const preview = asTheme(query.get('style')) ?? asTheme(query.get('theme'))
  return preview ?? chooseTheme(stored(), prefersDark())
}

/**
 * Follow the machine while the reader has not chosen. Once they run `style`, the
 * stored name wins and this listener does nothing — which is the point of an
 * explicit choice.
 */
export function watchSystemTheme(): void {
  let media: MediaQueryList
  try {
    media = matchMedia(DARK)
  } catch {
    return
  }
  media.addEventListener('change', () => {
    if (asTheme(stored())) return
    applyTheme(chooseTheme(null, media.matches))
  })
}
