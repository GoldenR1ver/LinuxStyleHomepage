import { describe, expect, it } from 'vitest'
import { parseAnsi, parseLines } from './ansi'

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

  it('reads a motion region and clamps its rate', () => {
    const spans = parseAnsi(`${ESC}]5522;type;90${ESC}\\hi${ESC}]5522${ESC}\\!`)
    expect(spans[0]).toMatchObject({ text: 'hi', anim: { mode: 'type', rate: 90 } })
    expect(spans[1]?.anim).toBeUndefined()

    const slow = parseAnsi(`${ESC}]5522;type;1${ESC}\\x`) // slower is clamped up
    expect(slow[0]?.anim?.rate).toBe(30)
    const fast = parseAnsi(`${ESC}]5522;type;9999${ESC}\\x`)
    expect(fast[0]?.anim?.rate).toBe(240)
    const fade = parseAnsi(`${ESC}]5522;fade;5${ESC}\\x`)
    expect(fade[0]?.anim).toEqual({ mode: 'fade', rate: 20 })
  })

  it('reads a ground and pairs it with a foreground', () => {
    const yellow = parseAnsi(`${ESC}[43mWARN${ESC}[0m`)
    expect(yellow[0]).toEqual({ text: 'WARN', className: 'bg-yellow' })

    const both = parseAnsi(`${ESC}[30;47mok${ESC}[49m end`)
    expect(both[0]).toEqual({ text: 'ok', className: 'fg-black bg-white' })
    expect(both[1]).toEqual({ text: ' end', className: 'fg-black' })

    const bright = parseAnsi(`${ESC}[104mx`)
    expect(bright[0]?.className).toBe('bg-blue')
  })

  it('reads slots 38 and 39 as purple and brown', () => {
    expect(parseAnsi(`${ESC}[38mx`)[0]?.className).toBe('fg-purple')
    expect(parseAnsi(`${ESC}[39mx`)[0]?.className).toBe('fg-brown')
    // 0 still clears everything, including the extra inks.
    expect(parseAnsi(`${ESC}[38;43mx${ESC}[0my`)[1]?.className).toBe('')
  })

  it('drops a ground on reset', () => {
    const spans = parseAnsi(`${ESC}[41mred${ESC}[0m plain`)
    expect(spans[0]?.className).toBe('bg-red')
    expect(spans[1]?.className).toBe('')
  })

  it('carries color, links and motion across a newline', () => {    const text = `${ESC}[33ma${ESC}]8;;cmd:ls${ESC}\\b\nc${ESC}]8;;${ESC}\\!${ESC}[0m`
    const lines = parseLines(text)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.spans.map((span) => span.text).join('')).toBe('ab')
    expect(lines[1]?.spans.map((span) => span.text).join('')).toBe('c!')
    expect(lines[1]?.spans[0]).toMatchObject({ className: 'fg-yellow', href: 'cmd:ls' })
    expect(lines[1]?.spans[1]?.href).toBeUndefined()
  })

  it('closes a motion region that never ends', () => {
    const lines = parseLines(`${ESC}]5522;type;90${ESC}\\open`)
    expect(lines[0]?.spans[0]?.anim).toEqual({ mode: 'type', rate: 90 })
  })
})
