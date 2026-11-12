import { parse } from './parser'

/** A function body may call another function at most this many levels down. */
export const MAX_FUNCTION_DEPTH = 6
/** One definition is one line, so the body stays short enough to read. */
export const MAX_FUNCTION_BODY = 512
/** A body with more commands than this is a script, not a one-liner. */
export const MAX_FUNCTION_ITEMS = 20
/** Definitions live in the pane, not on disk, so the list stays small. */
export const MAX_FUNCTIONS = 32

/** Names the parser or this shell already reserves. */
export const RESERVED = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'select',
  'in',
  'time',
  'function',
  'return',
  'local',
  'break',
  'continue',
])

export interface Definition {
  name: string
  body: string
}

export interface DefinitionProblem {
  error: string
}

const BRACED = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/
const KEYWORD = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{/
const USAGE = 'usage: name() { commands; } — the whole definition goes on one line'

/**
 * A definition is recognised before alias expansion and before parsing, because
 * `name()` is not a command and `{` is not a word this shell can run.
 * Returns null when the line is an ordinary command.
 */
export function readDefinition(line: string): Definition | DefinitionProblem | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (trimmed.startsWith('}')) return { error: 'syntax error: unexpected }' }

  const match = KEYWORD.exec(line) ?? BRACED.exec(line)
  if (!match) {
    const looksLikeCall = /^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(line)
    if (looksLikeCall || /^\s*function\b/.test(line)) return { error: USAGE }
    return null
  }

  const name = match[1] ?? ''
  const open = match.index + match[0].length - 1
  const close = closingBrace(line, open)
  if (close < 0) return { error: `${name}: missing } — ${USAGE}` }

  const rest = line.slice(close + 1)
  if (!/^[ \t]*;?[ \t]*(?:#.*)?$/.test(rest)) {
    return { error: `${name}: only a trailing ; or a comment may follow the closing }` }
  }

  const body = trimTrailing(line.slice(open + 1, close))
  if (!body) return { error: `${name}: empty function body` }

  const problem = checkBody(body)
  if (problem) return { error: `${name}: ${problem}` }
  return { name, body }
}

/** The body is one line, so a closing ; before } is punctuation, not a command. */
function trimTrailing(text: string): string {
  let body = text.trim()
  while (body.endsWith(';')) body = body.slice(0, -1).trimEnd()
  return body
}

/** Reject a body that is too long, too large, malformed, or defines another function. */
export function checkBody(body: string): string | null {
  if ([...body].length > MAX_FUNCTION_BODY) {
    return `the body is longer than ${MAX_FUNCTION_BODY} characters`
  }
  if (readDefinition(body)) return 'a function body cannot define another function'
  let parsed
  try {
    parsed = parse(body)
  } catch (err) {
    return `syntax error in the body (${err instanceof Error ? err.message : String(err)})`
  }
  if (!parsed.items.length) return 'empty function body'
  if (parsed.items.length > MAX_FUNCTION_ITEMS) {
    return `the body has ${parsed.items.length} commands; the limit is ${MAX_FUNCTION_ITEMS}`
  }
  return null
}

/**
 * Find the } that matches the { at `open`, honouring quotes and backslashes.
 * Returns -1 when the brace never closes.
 */
function closingBrace(line: string, open: number): number {
  let depth = 1
  let quote: string | null = null
  for (let i = open + 1; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '\'' || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}
