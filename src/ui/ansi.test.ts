import { describe, expect, it } from 'vitest'
import { parseAnsi } from './ansi'

const ESC = '\x1b'

describe('ansi', () => {
  it('reads color', () => {
    const spans = parseAnsi(`${ESC}[1;33mhi${ESC}[0m there`)
    expect(spans[0]).toEqual({ text: 'hi', className: 'bold fg-yellow' })
    expect(spans[1]).toEqual({ text: ' there', className: '' })
  })

  it('reads an OSC 8 link and closes it', () => {
    const link = `${ESC}]8;;cmd:ls%20%2Fhome${ESC}\\ls${ESC}]8;;${ESC}\\ tail`
    const spans = parseAnsi(link)
    expect(spans[0]).toEqual({ text: 'ls', className: '', href: 'cmd:ls%20%2Fhome' })
    expect(spans[1]).toEqual({ text: ' tail', className: '' })
  })

  it('keeps color inside a link', () => {
    const link = `${ESC}]8;;https://example.test${ESC}\\${ESC}[34mweb${ESC}[0m${ESC}]8;;${ESC}\\`
    const spans = parseAnsi(link)
    expect(spans[0]?.href).toBe('https://example.test')
    expect(spans[0]?.className).toBe('fg-blue')
  })

  it('leaves an unknown escape as text', () => {
    const spans = parseAnsi(`${ESC}[2Jx`)
    expect(spans.map((span) => span.text).join('')).toBe(`${ESC}[2Jx`)
  })
})
