/**
 * Terminal escapes this shell understands.
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
