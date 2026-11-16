/**
 * Minimal parser for the flow style this round's YAML uses:
 *   { id: C1, name: "text", domain: [true, false] }
 *   [A1, A2]
 * Zero dependencies, so a gate script runs on plain Node.
 */

export function parseFlow(text) {
  let i = 0
  const s = String(text)

  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i += 1
  }

  function quoted(quote) {
    i += 1
    let out = ''
    while (i < s.length) {
      const ch = s[i]
      if (ch === '\\' && i + 1 < s.length) {
        out += s[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        i += 1
        return out
      }
      out += ch
      i += 1
    }
    throw new Error(`unterminated string in ${s}`)
  }

  function bare(stops) {
    const start = i
    while (i < s.length && !stops.includes(s[i])) i += 1
    return s.slice(start, i).trim()
  }

  function scalar(raw) {
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
    return raw
  }

  function object() {
    i += 1
    const out = {}
    for (;;) {
      ws()
      if (s[i] === '}') {
        i += 1
        return out
      }
      const key = s[i] === '"' || s[i] === "'" ? quoted(s[i]) : bare([':', ',', '}'])
      ws()
      if (s[i] !== ':') throw new Error(`expected ":" at ${i} in ${s}`)
      i += 1
      out[key] = value()
      ws()
      if (s[i] === ',') {
        i += 1
        continue
      }
      if (s[i] === '}') {
        i += 1
        return out
      }
      if (i >= s.length) throw new Error(`unterminated object in ${s}`)
      throw new Error(`expected "," or "}" at ${i} in ${s}`)
    }
  }

  function array() {
    i += 1
    const out = []
    for (;;) {
      ws()
      if (s[i] === ']') {
        i += 1
        return out
      }
      out.push(value())
      ws()
      if (s[i] === ',') {
        i += 1
        continue
      }
      if (s[i] === ']') {
        i += 1
        return out
      }
      if (i >= s.length) throw new Error(`unterminated array in ${s}`)
      throw new Error(`expected "," or "]" at ${i} in ${s}`)
    }
  }

  function value() {
    ws()
    const ch = s[i]
    if (ch === '{') return object()
    if (ch === '[') return array()
    if (ch === '"' || ch === "'") return quoted(ch)
    return scalar(bare([',', '}', ']']))
  }

  const result = value()
  return result
}

/** Strip a YAML comment that is not inside quotes. */
export function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#') return line.slice(0, i)
  }
  return line
}

export function readLines(text) {
  return String(text).replace(/\r\n/g, '\n').split('\n')
}
