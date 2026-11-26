/**
 * Text measurement and terminal escapes, in one place: the column count needs
 * the same escape grammar the renderer uses.
 *
 * SGR is color:        ESC [ ... m
 * OSC 8 is a link:     ESC ] 8 ; params ; target ST
 * OSC 5522 is motion:  ESC ] 5522 ; mode ; rate ST, closed by ESC ] 5522 ST
 *
 * Any OSC is stripped before output leaves the screen: a pipe, a redirect, the
 * pager and the column count see plain text. A link or a motion that came from a
 * file is therefore inert, which is the point.
 */
export const SGR = '\\x1b\\[[0-9;]*m'
export const OSC = '\\x1b\\][^\\x1b]*\\x1b\\\\'

const OSC_ALL = new RegExp(OSC, 'g')
const ALL = new RegExp(`(?:${SGR}|${OSC})`, 'g')

/** Drop links and motion, keep color. Used for pipes, redirects and file text. */
export function stripLinks(text: string): string {
  return text.replace(OSC_ALL, '')
}

/** Drop color too. Used when measuring columns. */
export function stripAll(text: string): string {
  return text.replace(ALL, '')
}

/** Column padding. ANSI color and OSC 8 links are ignored. Common East Asian characters count as two cells. */
export function displayWidth(text: string): number {
  const plain = stripAll(text)
  let width = 0
  for (const char of plain) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
    width += isWide(code) ? 2 : 1
  }
  return width
}

export function padEndDisplay(text: string, width: number): string {
  const gap = width - displayWidth(text)
  return gap > 0 ? text + ' '.repeat(gap) : text
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}
