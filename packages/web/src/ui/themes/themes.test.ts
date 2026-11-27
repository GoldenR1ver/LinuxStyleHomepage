import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { asTheme, chooseTheme, THEMES } from './index'

/** Resolve a sibling file of this test, so it works from the source tree. */
function sibling(name: string): string {
  return new URL(`./${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

function cssFiles(): string[] {
  return readdirSync(new URL('.', import.meta.url))
    .filter((name) => name.endsWith('.css'))
    .map((name) => name.slice(0, -'.css'.length))
}

describe('themes', () => {
  it('has a stylesheet for every name it lists', () => {
    // A name without a file is a style that prints "style: name" and changes
    // nothing. The page loads the folder with import.meta.glob, so the file
    // existing is the whole requirement.
    for (const name of THEMES) {
      const css = readFileSync(sibling(`${name}.css`), 'utf8')
      expect(css).toContain(`[data-theme="${name}"]`)
    }
  })

  it('lists every stylesheet in the folder', () => {
    expect(new Set(cssFiles())).toEqual(new Set(THEMES))
  })

  it('gives each name a browser chrome colour pair', () => {
    for (const name of THEMES) {
      const css = readFileSync(sibling(`${name}.css`), 'utf8')
      // The first file may also style a page without an attribute; later ones
      // must not, or they would paint over every other style.
      if (name !== THEMES[0]) expect(css).not.toMatch(/^:root\s*,\s*$/m)
    }
  })

  it('carries at least one theme', () => {
    expect(THEMES.length).toBeGreaterThan(0)
  })

  it('accepts a name this build carries', () => {
    for (const name of THEMES) expect(asTheme(name)).toBe(name)
  })

  it('refuses a name it does not carry', () => {
    expect(asTheme('paper')).toBeNull()
    expect(asTheme('')).toBeNull()
    expect(asTheme(null)).toBeNull()
    expect(asTheme(undefined)).toBeNull()
    // A passed-through query string is not a theme.
    expect(asTheme('swiss ')).toBeNull()
  })

  it('opens in the style the machine asks for before anyone chooses', () => {
    expect(chooseTheme(null, true)).toBe('terminator')
    expect(chooseTheme(null, false)).toBe('swiss')
    // A name that is not a theme is not a choice.
    expect(chooseTheme('paper', true)).toBe('terminator')
  })

  it('lets an explicit choice beat the machine', () => {
    expect(chooseTheme('swiss', true)).toBe('swiss')
    expect(chooseTheme('terminator', false)).toBe('terminator')
  })
})
