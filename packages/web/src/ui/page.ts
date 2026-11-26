import type { TermView } from './term'

/** One run of lines that share a face: a page in Roboto, or a block in Consolas. */
export interface PageGroup {
  text: string
  block: boolean
}

const BOX = /[│├└┌┐┘─]/
const INDENT = /^\s{4,}\S/
/** A tree prefix, a table row, or the lone / that starts the file map. */
const TREE = /^\s*(?:\||`--|\+--|\/ *$)/

/**
 * Split a page into prose and preformatted runs. Trees, fenced code, tables and
 * indented code keep the monospace grid; paragraphs do not. A blank line stays
 * in the run it follows, so a code block with blank lines does not fragment.
 */
export function pageGroups(source: string): PageGroup[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const groups: PageGroup[] = []
  let fence = false
  let previous: boolean | null = null
  let block = false
  let current: string[] = []

  const flush = () => {
    if (!current.length) return
    groups.push({ text: current.join('\n'), block })
    current = []
  }
  const push = (line: string, next: boolean) => {
    if (current.length && next !== block) flush()
    block = next
    current.push(line)
  }

  for (const line of lines) {
    const fenceLine = /^\s*```/.test(line)
    if (fenceLine) fence = !fence
    let next: boolean
    if (fenceLine || fence) next = true
    else if (line.trim() === '') next = previous ?? false
    else next = TREE.test(line) || INDENT.test(line) || BOX.test(line)
    push(line, next)
    previous = next
  }
  flush()
  return groups.filter((group) => group.text.length > 0)
}

/**
 * Print a page split by pageGroups. A file that carries ANSI color is printed in
 * one run: the parser keeps color state within a call, so splitting would lose it.
 */
export async function printPage(view: TermView, text: string): Promise<void> {
  if (text.includes('\x1b')) {
    await view.print(text, 'prose')
    return
  }
  for (const group of pageGroups(text)) {
    await view.print(group.text, group.block ? 'out' : 'prose')
  }
}
