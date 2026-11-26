import { describe, expect, it } from 'vitest'
import { headline, typeBlock, typewrite, fade, typeDuration, typedCount } from './ansi'
import { parseLines, TYPE_CHARS_MAX } from './ansi'

const anim = (text: string) => parseLines(text)[0]?.spans[0]?.anim

describe('motion emitters', () => {
  it('wraps short text as a typing region', () => {
    const out = typewrite('hello', 120)
    expect(anim(out)).toEqual({ mode: 'type', rate: 120 })
    expect(out).toContain('hello')
  })

  it('degrades a long region to a fade instead of holding the prompt', () => {
    const out = typewrite('x'.repeat(TYPE_CHARS_MAX + 1))
    expect(anim(out)?.mode).toBe('fade')
  })

  it('types a long block only when the caller explicitly asks for it', () => {
    const out = typeBlock('x'.repeat(TYPE_CHARS_MAX + 1), 120)
    expect(anim(out)).toEqual({ mode: 'type', rate: 120 })
  })

  it('clamps the rate it is given', () => {
    expect(anim(typewrite('x', 1))?.rate).toBe(30)
    expect(anim(typewrite('x', 10_000))?.rate).toBe(240)
  })

  it('animates only the first line of a block', () => {
    const lines = parseLines(headline('one\ntwo\nthree'))
    expect(lines).toHaveLength(3)
    expect(lines[0]?.spans[0]?.anim?.mode).toBe('type')
    expect(lines[1]?.spans.every((span) => !span.anim)).toBe(true)
  })

  it('leaves a long opening paragraph alone', () => {
    const paragraph = `${'word '.repeat(40)}\nrest`
    expect(headline(paragraph)).toBe(paragraph)
  })

  it('marks every line for a fade', () => {
    const lines = parseLines(fade('a\nb'))
    expect(lines.map((line) => line.spans[0]?.anim?.mode)).toEqual(['fade', 'fade'])
  })

  it('reveals monotonically and stops at the last character', () => {
    expect(typedCount(0, 100, 50)).toBe(0)
    expect(typedCount(100, 100, 50)).toBe(10)
    expect(typedCount(500, 100, 50)).toBe(50)
    expect(typedCount(9_999, 100, 50)).toBe(50)
    expect(typedCount(-5, 100, 50)).toBe(0)
  })

  it('clamps a rate that the caller asks for', () => {
    expect(typedCount(1_000, 1, 999)).toBe(30)
    expect(typedCount(1_000, 10_000, 999)).toBe(240)
  })

  it('bounds the duration so the prompt never waits long', () => {
    expect(typeDuration(90, 90)).toBe(1000)
    expect(typeDuration(100_000, 90)).toBe(1500)
    expect(typeDuration(10, 1)).toBeCloseTo(333.33, 1)
  })

  it('lets the intro use a longer cap without changing the default', () => {
    expect(typeDuration(100_000, 240, 10_000)).toBe(10_000)
    expect(typeDuration(90, 90, 10_000)).toBe(1000)
  })
})
