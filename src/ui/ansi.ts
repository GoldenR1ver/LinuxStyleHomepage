export interface Span {
  text: string
  className: string
}

const FG = ['fg-black', 'fg-red', 'fg-green', 'fg-yellow', 'fg-blue', 'fg-magenta', 'fg-cyan', 'fg-white']

/** Only SGR colors are interpreted. Other escapes stay as text. */
export function parseAnsi(input: string): Span[] {
  const pattern = /\x1b\[([0-9;]*)m/g
  const spans: Span[] = []
  let className = ''
  let bold = false
  let dim = false
  let color = ''
  let last = 0
  const paint = () => [bold ? 'bold' : '', dim ? 'dim' : '', color].filter(Boolean).join(' ')
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) spans.push({ text: input.slice(last, index), className })
    const codes = match[1] ? match[1].split(';').map((item) => Number(item)) : [0]
    for (const code of codes) {
      if (code === 0) {
        bold = false
        dim = false
        color = ''
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 22) {
        bold = false
        dim = false
      } else if (code >= 30 && code <= 37) color = FG[code - 30] ?? ''
      else if (code >= 90 && code <= 97) color = FG[code - 90] ?? ''
      else if (code === 39) color = ''
    }
    className = paint()
    last = index + match[0].length
  }
  if (last < input.length) spans.push({ text: input.slice(last), className })
  return spans.length ? spans : [{ text: input, className: '' }]
}
