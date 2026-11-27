import { describe, expect, it } from 'vitest'
import { asTheme, chooseTheme, THEMES } from './index'

describe('themes', () => {
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
