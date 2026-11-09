/** Column padding. ANSI is ignored. Common East Asian characters count as two cells. */
export function displayWidth(text: string): number {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
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
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}
