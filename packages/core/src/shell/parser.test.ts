import { describe, expect, it } from 'vitest'
import { parse } from './parser'

function raw(command: string): string[] {
  const list = parse(command)
  return list.items.flatMap((item) => item.pipeline.segments.map((segment) => segment.argv.map((word) => word.parts.map((part) => part.raw).join('')).join(' ')))
}

describe('parser', () => {
  it('splits quotes, pipes and lists', () => {
    const list = parse(`echo "a b" && echo c | wc; echo d`)
    expect(list.items.map((item) => item.op)).toEqual([';', '&&', ';'])
    expect(list.items[1]?.pipeline.segments).toHaveLength(2)
    expect(raw(`echo 'a $HOME'`)).toEqual(['echo a $HOME'])
  })

  it('reads redirects', () => {
    const segment = parse('echo hi > out.txt 2>> err.txt < in.txt').items[0]?.pipeline.segments[0]
    expect(segment?.redirects.map((item) => `${item.fd}${item.op}${item.target.parts[0]?.raw}`)).toEqual([
      '1>out.txt',
      '2>>err.txt',
      '0<in.txt',
    ])
    expect(parse('echo hi 2>&1').items[0]?.pipeline.segments[0]?.mergeStderr).toBe(true)
  })

  it('rejects an open quote', () => {
    expect(() => parse(`echo "hi`)).toThrow(/unterminated quote/)
  })
})
