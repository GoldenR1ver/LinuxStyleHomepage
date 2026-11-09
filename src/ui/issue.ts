import type { Runtime } from '../app/runtime'
import type { User } from '../kernel/types'

const ROOT: User = { name: 'root', role: 'root' }

/** Same identity `uname` prints. `\m` is this browser, which `uname -a` does not name. */
const SYSNAME = 'Linux'
const RELEASE = '6.1-home'
const VERSION = '#1 SMP Home'
const MACHINE = 'web'
const TTY = 'tty1'

export interface IssueFacts {
  hostname: string
  sysname: string
  release: string
  version: string
  machine: string
  tty: string
  osRelease: Record<string, string>
  date: Date
  users: number
}

/**
 * Expand `/etc/issue` the way agetty does.
 * A backslash starts a code. A newline in the file is a real line break.
 */
export function expandIssue(text: string, facts: IssueFacts): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '\\') {
      out += text[i]
      i += 1
      continue
    }
    const next = text[i + 1]
    if (next === undefined) {
      out += '\\'
      break
    }
    if (next === '0') {
      let digits = ''
      let j = i + 1
      while (digits.length < 3 && j < text.length && text[j] >= '0' && text[j] <= '7') {
        digits += text[j]
        j += 1
      }
      out += String.fromCharCode(Number.parseInt(digits, 8))
      i = j
      continue
    }
    const braced = next === 'S' || next === '4' || next === '6' ? takeBrace(text, i + 2) : null
    out += expandCode(next, braced?.key ?? '', facts)
    i = braced ? braced.end : i + 2
  }
  return out
}

/** Text printed before the login prompt. A missing file keeps the previous banner. */
export function readIssue(rt: Runtime, hostname: string, now = new Date()): string {
  const raw = readText(rt, '/etc/issue')
  const source = raw ?? `${hostname} Linux ${TTY}\n\n`
  return expandIssue(source, {
    hostname,
    sysname: SYSNAME,
    release: RELEASE,
    version: VERSION,
    machine: MACHINE,
    tty: TTY,
    osRelease: parseOsRelease(readText(rt, '/etc/os-release') ?? ''),
    date: now,
    users: 0,
  })
}

function expandCode(code: string, key: string, facts: IssueFacts): string {
  switch (code) {
    case '\\':
      return '\\'
    case 'e':
      return '\x1b'
    case 'b':
    case 'o':
    case 'O':
    case '4':
    case '6':
      return ''
    case 'd':
      return formatDate(facts.date)
    case 't':
      return formatTime(facts.date)
    case 's':
      return facts.sysname
    case 'S':
      if (!key) return facts.osRelease.PRETTY_NAME || facts.sysname
      return facts.osRelease[key] ?? ''
    case 'l':
      return facts.tty
    case 'm':
      return facts.machine
    case 'n':
      return facts.hostname
    case 'r':
      return facts.release
    case 'v':
      return facts.version
    case 'u':
      return String(facts.users)
    case 'U':
      return facts.users === 1 ? '1 user' : `${facts.users} users`
    default:
      return code
  }
}

function takeBrace(text: string, start: number): { key: string; end: number } | null {
  if (text[start] !== '{') return null
  const close = text.indexOf('}', start + 1)
  if (close < 0) return null
  return { key: text.slice(start + 1, close), end: close + 1 }
}

function formatDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(date.getDate()).padStart(2, ' ')
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${day} ${date.getFullYear()}`
}

function formatTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function readText(rt: Runtime, path: string): string | null {
  try {
    const file = rt.fs.read(ROOT, path)
    return file.encoding === 'utf8' ? file.content : null
  } catch {
    return null
  }
}
