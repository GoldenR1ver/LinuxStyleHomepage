export interface Span {
  text: string
  className: string
  /** OSC 8 target. A `cmd:` prefix means run it in this shell; anything else opens a page. */
  href?: string
}

const FG = ['fg-black', 'fg-red', 'fg-green', 'fg-yellow', 'fg-blue', 'fg-magenta', 'fg-cyan', 'fg-white']

const SGR = /^\x1b\[([0-9;]*)m/
const OSC8 = /^\x1b\]8;[^;]*;([^\x1b]*)\x1b\\/

/** Only SGR colors and OSC 8 links are interpreted. Other escapes stay as text. */
export function parseAnsi(input: string): Span[] {
  const spans: Span[] = []
  let className = ''
  let bold = false
  let dim = false
  let color = ''
  let href: string | undefined
  let plain = ''
  let i = 0

  const flush = () => {
    if (!plain) return
    spans.push(href === undefined ? { text: plain, className } : { text: plain, className, href })
    plain = ''
  }

  while (i < input.length) {
    const ch = input[i]
    if (ch === '\x1b') {
      const rest = input.slice(i)
      const sgr = SGR.exec(rest)
      if (sgr) {
        flush()
        for (const code of sgr[1] ? sgr[1].split(';').map(Number) : [0]) {
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
        className = [bold ? 'bold' : '', dim ? 'dim' : '', color].filter(Boolean).join(' ')
        i += sgr[0].length
        continue
      }
      const osc = OSC8.exec(rest)
      if (osc) {
        flush()
        href = osc[1] ? osc[1] : undefined
        i += osc[0].length
        continue
      }
    }
    plain += ch
    i += 1
  }
  flush()
  return spans.length ? spans : [{ text: input, className: '' }]
}
