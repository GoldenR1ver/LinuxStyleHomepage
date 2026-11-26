import { describe, expect, it } from 'vitest'
import { stripAll, stripLinks } from './text'
import { displayWidth, padEndDisplay } from './text'

const ESC = '\x1b'
const LINK = `${ESC}]8;;cmd:ls${ESC}\\dir${ESC}]8;;${ESC}\\`

describe('escape', () => {
  it('drops a link target and keeps the text', () => {
    expect(stripLinks(LINK)).toBe('dir')
    expect(stripLinks(`${ESC}[31mred${ESC}[0m`)).toBe(`${ESC}[31mred${ESC}[0m`)
  })

  it('drops color too', () => {
    expect(stripAll(`${ESC}[31m${LINK}${ESC}[0m`)).toBe('dir')
  })
})

describe('width', () => {
  it('ignores color and links', () => {
    expect(displayWidth(LINK)).toBe(3)
    expect(displayWidth(`${ESC}[34m${LINK}${ESC}[0m`)).toBe(3)
    expect(padEndDisplay(LINK, 6)).toBe(`${LINK}   `)
  })

  it('counts a wide character as two cells', () => {
    expect(displayWidth('中文')).toBe(4)
    expect(displayWidth('📚')).toBe(2)
  })
})
