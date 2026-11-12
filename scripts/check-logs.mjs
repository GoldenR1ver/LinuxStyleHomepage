#!/usr/bin/env node
/**
 * Validate every *.log under content/.
 *
 * One extension carries two shapes, so the path decides which rules apply:
 *   about.log under works/projects    a project record
 *   about.log under works/researches  a paper record
 *   any other *.log                   a dated changelog for its directory
 *   content/root/**                   skipped (the decorative access log)
 *
 * Zero dependencies, so `npm run check:logs` works on any Node 18+.
 * Exits 1 on an error. `--strict` makes warnings fail too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CONTENT = path.join(ROOT, 'content')
const TEMPLATES = path.join(HERE, 'templates')

const ARGS = new Set(process.argv.slice(2))
if (ARGS.has('--help') || ARGS.has('-h')) usage()

const STRICT = ARGS.has('--strict')

const PROJECT_KEYS = ['Link', 'Application scenarios', 'effectiveness', 'advantage', 'method']
const RESEARCH_KEYS = ['DOI', 'Published', 'Award', 'Area', 'Method']
const LANGUAGE_KEY = /^(?:C\+\+|Java|Python|JavaScript|TypeScript|Rust|Go|Kotlin|Swift)$/

const HEADER = /^\[([^\]]+)\]:(.*)$/
const ENTRY = /^\[(\d{4}-\d{2}-\d{2})\]:\s*(\S[\s\S]*)$/
const LOOSE_ENTRY = /^\[(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\]/

const problems = []
const error = (file, line, message) => problems.push({ level: 'error', file, line, message })
const warn = (file, line, message) => problems.push({ level: 'warn', file, line, message })

/* ---------- io ---------- */

function walk(dir) {
  const out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names.sort()) {
    const abs = path.join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) out.push(...walk(abs))
    else if (name.toLowerCase().endsWith('.log')) out.push(abs)
  }
  return out
}

function subdirs(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .filter((name) => statSync(path.join(dir, name)).isDirectory())
      .sort()
  } catch {
    return []
  }
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

function isFile(abs) {
  try {
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

/** CRLF is normal on a Windows checkout, so it is normalized before any rule runs. */
function read(abs) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(abs))
  } catch {
    error(rel(abs), 1, 'not valid UTF-8')
    return null
  }
  if (text.startsWith('\uFEFF')) warn(rel(abs), 1, 'starts with a UTF-8 BOM')
  if (text.includes('\u0000')) error(rel(abs), 1, 'contains a NUL byte')
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function splitLines(text) {
  return text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
}

/** A missing final newline is a warning: the file still works, git is just noisy. */
function checkTail(file, text, lines) {
  if (text && !text.endsWith('\n')) warn(file, lines.length, 'no newline at end of file')
}

/* ---------- rules ---------- */

function checkAbout(abs, keys, label) {
  const file = rel(abs)
  const text = read(abs)
  if (text === null) return
  const lines = splitLines(text)
  checkTail(file, text, lines)

  const title = lines[0] ?? ''
  if (!title.trim()) error(file, 1, 'the first line must be the title')
  else if (HEADER.test(title)) error(file, 1, 'the first line must be a title, not a section')
  if (/[ \t]+$/.test(title)) warn(file, 1, 'trailing whitespace')

  const sections = []
  let open = null
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const match = HEADER.exec(line)
    if (match) {
      const [, key, rest] = match
      if (rest !== '') {
        error(
          file,
          i + 1,
          rest.trim() === ''
            ? `[${key}]: has trailing whitespace`
            : `[${key}]: must stand on its own line; the body starts on the next line`,
        )
      }
      open = { key, line: i + 1, body: [] }
      sections.push(open)
      continue
    }
    if (/[ \t]+$/.test(line)) warn(file, i + 1, 'trailing whitespace')
    if (open) open.body.push(line)
  }

  if (!sections.length) {
    error(file, 2, `no sections. Expected ${keys.map((key) => `[${key}]:`).join(' ')}`)
    return
  }

  const seen = new Set()
  let highest = -1
  for (const section of sections) {
    const at = keys.indexOf(section.key)
    if (at < 0) {
      if (LANGUAGE_KEY.test(section.key)) {
        if (section !== sections[sections.length - 1]) {
          error(file, section.line, `[${section.key}]: the language section goes last`)
        }
      } else {
        error(file, section.line, `unknown section [${section.key}]:. ${label} keys: ${keys.join(', ')}`)
      }
    } else {
      if (seen.has(section.key)) error(file, section.line, `[${section.key}]: appears twice`)
      seen.add(section.key)
      if (at <= highest) error(file, section.line, `[${section.key}]: is out of order`)
      else highest = at
    }
    if (!section.body.some((line) => line.trim())) {
      error(file, section.line, `[${section.key}]: is empty`)
    }
  }

  for (const key of keys) {
    if (!seen.has(key)) error(file, 1, `missing section [${key}]:`)
  }

  const link = sections.find((section) => section.key === 'Link' || section.key === 'DOI')
  const first = link?.body.find((line) => line.trim()) ?? ''
  if (link && first && !/^\s*https?:\/\//.test(first)) {
    warn(file, link.line, `[${link.key}]: should start with an https:// link`)
  }
}

function checkChangelog(abs, options = {}) {
  const file = rel(abs)
  const text = read(abs)
  if (text === null) return
  const lines = splitLines(text)
  checkTail(file, text, lines)

  if (!options.bareName) {
    const dir = path.basename(path.dirname(abs))
    const base = path.basename(abs, path.extname(abs))
    if (base !== dir) {
      warn(file, 1, `file name does not match its directory; ${dir} expects ${dir}.log`)
    }
  }

  let latest = ''
  let entries = 0
  const seen = new Map()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const at = i + 1
    if (/[ \t]+$/.test(line)) warn(file, at, 'trailing whitespace')

    const strict = ENTRY.exec(line)
    if (!strict) {
      if (LOOSE_ENTRY.test(line)) {
        error(file, at, 'a dated entry must be [YYYY-MM-DD]: text, with a zero-padded month and day')
      } else if (/^\s*\[(?!\^)[^\]]+\]/.test(line)) {
        warn(
          file,
          at,
          'bracketed line is neither a dated entry nor a footnote; use [YYYY-MM-DD]: for an entry and [^1] for a footnote',
        )
      }
      continue
    }

    entries += 1
    const date = strict[1]
    const body = strict[2].trim()
    const [year, month, day] = date.split('-').map(Number)
    const when = new Date(Date.UTC(year, month - 1, day))
    if (when.getUTCFullYear() !== year || when.getUTCMonth() !== month - 1 || when.getUTCDate() !== day) {
      error(file, at, `${date} is not a real date`)
    }
    if (when.getTime() > Date.now() + 86_400_000) {
      warn(file, at, `entry dated ${date} is in the future`)
    }
    if (latest && date < latest) {
      error(file, at, `entry dated ${date} is earlier than the previous entry (${latest}); keep entries in time order`)
    }
    if (date > latest) latest = date

    const key = `${date} ${body}`
    const firstAt = seen.get(key)
    if (firstAt) warn(file, at, `duplicate of the entry on line ${firstAt}`)
    else seen.set(key, at)
  }

  if (!entries) warn(file, 1, 'no dated entries; the directory log should record what changed')
}

/* ---------- coverage ---------- */

function checkCoverage() {
  const owner = path.join(CONTENT, 'home', 'owner')
  for (const group of ['works/projects', 'works/researches']) {
    const dir = path.join(owner, ...group.split('/'))
    for (const name of subdirs(dir)) {
      const abs = path.join(dir, name, 'about.log')
      if (!isFile(abs)) error(rel(path.join(dir, name)), 1, 'missing about.log')
    }
  }
  const notes = path.join(owner, 'notes')
  for (const name of subdirs(notes)) {
    const abs = path.join(notes, name, `${name}.log`)
    if (!isFile(abs)) warn(rel(path.join(notes, name)), 1, `no ${name}.log to introduce this topic`)
  }
}

function checkTemplates() {
  const cases = [
    ['about-project.log', () => checkAbout(path.join(TEMPLATES, 'about-project.log'), PROJECT_KEYS, 'project')],
    ['about-research.log', () => checkAbout(path.join(TEMPLATES, 'about-research.log'), RESEARCH_KEYS, 'paper')],
    ['directory.log', () => checkChangelog(path.join(TEMPLATES, 'directory.log'), { bareName: true })],
  ]
  for (const [name, run] of cases) {
    if (isFile(path.join(TEMPLATES, name))) run()
    else warn('scripts/templates', 1, `missing template ${name}`)
  }
}

/* ---------- main ---------- */

const files = walk(CONTENT)
for (const abs of files) {
  const file = rel(abs)
  if (file.startsWith('content/root/')) continue
  if (path.basename(abs) === 'about.log') {
    const research = file.includes('/works/researches/')
    checkAbout(abs, research ? RESEARCH_KEYS : PROJECT_KEYS, research ? 'paper' : 'project')
  } else {
    checkChangelog(abs)
  }
}
checkCoverage()
checkTemplates()

report(files.length)
process.exitCode = problems.some((item) => item.level === 'error') ? 1 : STRICT && problems.length ? 1 : 0

/* ---------- output ---------- */

function report(scanned) {
  console.log(`check-logs  ${scanned} logs under content/`)

  const order = { error: 0, warn: 1 }
  problems.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || order[a.level] - order[b.level],
  )

  let current = ''
  for (const item of problems) {
    if (item.file !== current) {
      current = item.file
      console.log(`\n${item.file}`)
    }
    console.log(`  ${item.level === 'error' ? 'error' : 'warn '}  ${String(item.line).padStart(4)}  ${item.message}`)
  }

  const errors = problems.filter((item) => item.level === 'error').length
  const warns = problems.length - errors
  if (!problems.length) {
    console.log('\nok. Every log matches its schema.')
    return
  }
  console.log(`\n${errors} error(s), ${warns} warning(s)`)
  if (errors) {
    console.log('Copy the matching shape from scripts/templates/ and keep the existing prose.')
  }
}

function usage() {
  console.log(`check-logs: validate content/**/*.log

  npm run check:logs             report errors and warnings
  npm run check:logs --strict    warnings fail too

Shapes (copy one from scripts/templates/):
  about.log in works/projects    [Link] [Application scenarios] [effectiveness] [advantage] [method]
                                 and one optional trailing language section, e.g. [C++]: or [Java]:
  about.log in works/researches  [DOI] [Published] [Award] [Area] [Method]
  any other *.log                prose first, then one line per change: [YYYY-MM-DD]: what changed
                                 entries stay in time order; footnotes use [^1], not [1]

content/root/** is skipped: that log is part of the terminal scene, not a record.`)
  process.exit(0)
}
