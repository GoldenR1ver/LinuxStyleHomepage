/**
 * Terminal escapes this shell understands.
 * SGR is color. OSC 8 is a hyperlink: ESC ] 8 ; params ; target ESC \
 */
export const OSC8 = '\\x1b\\]8;[^;\\x1b]*;[^\\x1b]*\\x1b\\\\'
export const SGR = '\\x1b\\[[0-9;]*m'

const LINKS = new RegExp(OSC8, 'g')
const ALL = new RegExp(`(?:${SGR}|${OSC8})`, 'g')

/** Drop link targets and keep the text. Used before output leaves the screen. */
export function stripLinks(text: string): string {
  return text.replace(LINKS, '')
}

/** Drop color and links. Used when measuring columns. */
export function stripAll(text: string): string {
  return text.replace(ALL, '')
}
