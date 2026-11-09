export type Quote = 'none' | 'single' | 'double'

export interface WordPart {
  raw: string
  quote: Quote
}

export interface Word {
  parts: WordPart[]
}

export interface Redirect {
  fd: 0 | 1 | 2
  op: '<' | '>' | '>>'
  target: Word
}

export interface Segment {
  argv: Word[]
  redirects: Redirect[]
  mergeStderr: boolean
}

export interface Pipeline {
  segments: Segment[]
}

export interface ListItem {
  op: ';' | '&&' | '||'
  pipeline: Pipeline
}

export interface CommandList {
  items: ListItem[]
}

/**
 * Supports quotes, pipes, && || ;, and > >> < 2> 2>> &> 2>&1.
 * Background jobs, command substitution, and subshells are disabled.
 */
export function parse(input: string): CommandList {
  return new Parser(input).parseList()
}

class Parser {
  private i = 0

  constructor(private readonly source: string) {}

  parseList(): CommandList {
    const items: ListItem[] = []
    this.skipSpace()
    if (this.done() || this.peek() === '#') return { items }
    let op: ListItem['op'] = ';'
    while (!this.done()) {
      items.push({ op, pipeline: this.parsePipeline() })
      this.skipSpace()
      if (this.done() || this.peek() === '#') break
      op = this.parseOp()
      this.skipSpace()
      if (this.done() || this.peek() === '#') throw new Error('syntax error')
    }
    return { items }
  }

  private parsePipeline(): Pipeline {
    const segments = [this.parseSegment()]
    for (;;) {
      this.skipSpace()
      if (this.source.startsWith('||', this.i) || this.peek() !== '|') break
      this.i += 1
      this.skipSpace()
      if (this.done()) throw new Error('syntax error')
      segments.push(this.parseSegment())
    }
    return { segments }
  }

  private parseSegment(): Segment {
    const argv: Word[] = []
    const redirects: Redirect[] = []
    let mergeStderr = false
    for (;;) {
      this.skipSpace()
      if (this.done() || this.peek() === '#') break
      if (this.peek() === ';' || this.source.startsWith('||', this.i) || this.source.startsWith('&&', this.i)) break
      if (this.peek() === '|' ) break
      if (this.peek() === '&' && this.source[this.i + 1] !== '>') throw new Error('background jobs are disabled')
      if (this.looksLikeRedirect()) {
        const read = this.readRedirect()
        if (read === 'merge') mergeStderr = true
        else redirects.push(...read)
        continue
      }
      argv.push(this.parseWord())
    }
    if (!argv.length) throw new Error('syntax error')
    return { argv, redirects, mergeStderr }
  }

  private parseOp(): ListItem['op'] {
    if (this.source.startsWith('&&', this.i)) {
      this.i += 2
      return '&&'
    }
    if (this.source.startsWith('||', this.i)) {
      this.i += 2
      return '||'
    }
    if (this.peek() === ';') {
      this.i += 1
      return ';'
    }
    throw new Error('syntax error')
  }

  private parseWord(): Word {
    const parts: WordPart[] = []
    while (!this.done()) {
      const ch = this.peek()
      if (/[\s;&|<>]/.test(ch)) break
      if (parts.length && this.looksLikeRedirect()) break
      if (ch === '\'' || ch === '"') {
        parts.push(this.quoted(ch))
        continue
      }
      const raw = this.plain()
      if (!raw) break
      parts.push({ raw, quote: 'none' })
    }
    if (!parts.length) throw new Error('syntax error')
    return { parts }
  }

  private quoted(quote: '"' | '\''): WordPart {
    this.i += 1
    let raw = ''
    while (!this.done() && this.peek() !== quote) {
      raw += this.source[this.i]
      this.i += 1
    }
    if (this.done()) throw new Error('unterminated quote')
    this.i += 1
    return { raw, quote: quote === '\'' ? 'single' : 'double' }
  }

  private plain(): string {
    let raw = ''
    while (!this.done()) {
      const ch = this.peek()
      if (ch === '\\') {
        raw += ch
        this.i += 1
        if (!this.done()) {
          raw += this.source[this.i]
          this.i += 1
        }
        continue
      }
      if (ch === '\'' || ch === '"' || /[\s;&|<>]/.test(ch)) break
      raw += ch
      this.i += 1
    }
    return raw
  }

  private looksLikeRedirect(): boolean {
    return /^(?:&>|\d*>&|\d*>>|\d*>|<)/.test(this.source.slice(this.i))
  }

  private readRedirect(): Redirect[] | 'merge' {
    const rest = this.source.slice(this.i)
    const dup = /^(\d*)>&(\d)/.exec(rest)
    if (dup) {
      this.i += dup[0].length
      if ((dup[1] === '' || dup[1] === '2') && dup[2] === '1') return 'merge'
      throw new Error('unsupported redirect')
    }
    if (rest.startsWith('&>')) {
      this.i += 2
      const target = this.readTarget()
      return [
        { fd: 1, op: '>', target },
        { fd: 2, op: '>', target },
      ]
    }
    const out = /^(\d*)(>>|>)/.exec(rest)
    if (out) {
      this.i += out[0].length
      const fd = out[1] === '' ? 1 : Number(out[1])
      if (fd !== 1 && fd !== 2) throw new Error('unsupported redirect')
      return [{ fd, op: out[2] as '>' | '>>', target: this.readTarget() }]
    }
    if (rest.startsWith('<')) {
      this.i += 1
      return [{ fd: 0, op: '<', target: this.readTarget() }]
    }
    throw new Error('syntax error')
  }

  private readTarget(): Word {
    this.skipSpace()
    if (this.done()) throw new Error('syntax error')
    return this.parseWord()
  }

  private skipSpace() {
    while (!this.done() && /\s/.test(this.peek())) this.i += 1
  }

  private peek(): string {
    return this.source[this.i] ?? ''
  }

  private done(): boolean {
    return this.i >= this.source.length
  }
}
