import { describe, expect, it } from 'vitest'
import { headline, typeBlock, typewrite, fade, typeDuration, typedCount } from './ansi'
import {
  charPause,
  pauseScale,
  revealDuration,
  revealSchedule,
  revealTimes,
  typedIndex,
  PAUSE_COMMA_MS,
  PAUSE_PARA_MS,
  PAUSE_STOP_MS,
  PAUSE_STYLE_MS,
} from './ansi'
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

describe('typing cadence', () => {
  it('keeps the pause constants at the reference rate', () => {
    expect(pauseScale(90)).toBe(1)
    expect(charPause(',', 'x', 90)).toBe(PAUSE_COMMA_MS)
    expect(charPause('.', 'x', 90)).toBe(PAUSE_STOP_MS)
    expect(charPause('。', 'x', 90)).toBe(PAUSE_STOP_MS)
    expect(charPause('\n', '\n', 90)).toBe(PAUSE_PARA_MS)
    expect(charPause('a', 'b', 90)).toBe(0)
  })

  it('stretches a pause when the reveal is slower and shortens it when faster', () => {
    expect(pauseScale(240)).toBeCloseTo(0.555, 3)
    expect(pauseScale(30)).toBe(1.8)
    expect(charPause(',', 'x', 240)).toBeCloseTo(PAUSE_COMMA_MS * 0.555, 1)
    // Even at the fastest rate a full stop stays visible.
    expect(charPause('.', 'x', 240)).toBeGreaterThanOrEqual(75)
  })

  it('holds a comma, then a full stop', () => {
    const times = revealTimes([{ text: 'a,b.' }], 90)
    const step = 1000 / 90
    expect(times[0]).toBeCloseTo(step, 1)
    expect(times[1]).toBeCloseTo(step * 2, 1)
    // The next character waits for the comma pause.
    expect(times[2] ?? 0).toBeCloseTo(step * 3 + PAUSE_COMMA_MS, 1)
  })

  it('holds longer across a blank line than after a full stop', () => {
    const paragraph = revealTimes([{ text: 'a\n\nb' }], 90)
    const sentence = revealTimes([{ text: 'a.\nb' }], 90)
    const gapOf = (times: number[]) => (times[2] ?? 0) - (times[1] ?? 0)
    expect(gapOf(paragraph)).toBeGreaterThan(gapOf(sentence))
  })

  it('pauses when the class changes, and not inside one style', () => {
    const plain = revealTimes([{ text: 'ab' }, { text: 'cd' }], 90)
    const colored = revealTimes([{ text: 'ab', className: '' }, { text: 'cd', className: 'bold fg-yellow' }], 90)
    const step = 1000 / 90
    expect(colored[2] ?? 0).toBeCloseTo((plain[2] ?? 0) + PAUSE_STYLE_MS, 1)
    expect((plain[2] ?? 0) - (plain[1] ?? 0)).toBeCloseTo(step, 1)
  })

  it('counts characters by the schedule and stops at the last one', () => {
    const times = revealTimes([{ text: 'a,b' }], 90)
    expect(typedIndex(times, 0)).toBe(0)
    expect(typedIndex(times, (times[1] ?? 0) + 1)).toBe(2)
    expect(typedIndex(times, 9_999)).toBe(3)
  })

  it('bounds a schedule with many pauses', () => {
    expect(revealDuration([{ text: ', '.repeat(200) }], 90)).toBe(1500)
    expect(revealDuration([{ text: 'ab' }], 90, 10_000)).toBeCloseTo(2000 / 90, 1)
  })

  it('compresses a long block to the cap instead of jumping at the deadline', () => {
    const runs = [{ text: 'word, '.repeat(60) }]
    const natural = revealTimes(runs, 90)
    const schedule = revealSchedule(runs, 90, 1500)
    expect(schedule.duration).toBe(1500)
    expect(schedule.times).toHaveLength(natural.length)
    expect(schedule.times[schedule.times.length - 1]).toBeCloseTo(1500, 6)
    // Order and pauses survive the compression.
    for (let i = 1; i < schedule.times.length; i++) {
      expect(schedule.times[i] ?? 0).toBeGreaterThan(schedule.times[i - 1] ?? 0)
    }
    const short = revealSchedule([{ text: 'ab' }], 90, 10_000)
    expect(short.duration).toBeCloseTo(short.times[1] ?? 0, 6)
  })
})
