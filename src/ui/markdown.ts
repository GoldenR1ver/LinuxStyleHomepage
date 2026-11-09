/** Render a subset of Markdown to HTML. Text is escaped before tags are added. */

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    if (line.startsWith('```')) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      const level = /^#+/.exec(line)?.[0].length ?? 1
      blocks.push(`<h${level}>${inline(line.replace(/^#{1,6}\s+/, ''))}</h${level}>`)
      index += 1
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push('<hr>')
      index += 1
      continue
    }
    if (line.startsWith('>')) {
      const body: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${body.map((item) => `<p>${inline(item)}</p>`).join('')}</blockquote>`)
      continue
    }
    if (isTable(lines, index)) {
      const rows: string[][] = []
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        if (!isRule(lines[index] ?? '')) rows.push(splitRow(lines[index] ?? ''))
        index += 1
      }
      const head = rows[0] ?? []
      const body = rows.slice(1)
      blocks.push(
        `<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      )
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push(inline((lines[index] ?? '').replace(/^\s*[-*]\s+/, '')))
        index += 1
      }
      blocks.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push(inline((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, '')))
        index += 1
      }
      blocks.push(`<ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`)
      continue
    }
    const para: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() && !blockStart(lines[index] ?? '')) {
      para.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(`<p>${inline(para.join(' '))}</p>`)
  }
  return `<article class="stage-doc">${blocks.join('')}</article>`
}

function blockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    /^#{1,6}\s+/.test(line) ||
    line.startsWith('>') ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^(-{3,}|\*{3,})$/.test(line.trim())
  )
}

function isTable(lines: string[], index: number): boolean {
  const next = lines[index + 1] ?? ''
  return (lines[index] ?? '').includes('|') && isRule(next)
}

function isRule(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function inline(source: string): string {
  let html = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('`', index)) {
      const end = source.indexOf('`', index + 1)
      if (end > index) {
        html += `<code>${escapeHtml(source.slice(index + 1, end))}</code>`
        index = end + 1
        continue
      }
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(source.slice(index))
    if (link) {
      const href = safeUrl(link[2] ?? '')
      html += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${inline(link[1] ?? '')}</a>` : escapeHtml(link[0])
      index += link[0].length
      continue
    }
    const bold = /^(\*\*|__)(.+?)\1/.exec(source.slice(index))
    if (bold) {
      html += `<strong>${inline(bold[2] ?? '')}</strong>`
      index += bold[0].length
      continue
    }
    const em = /^(\*|_)([^*_]+)\1/.exec(source.slice(index))
    if (em) {
      html += `<em>${inline(em[2] ?? '')}</em>`
      index += em[0].length
      continue
    }
    html += escapeHtml(source[index] ?? '')
    index += 1
  }
  return html
}

function safeUrl(url: string): string {
  if (/^(https?:|mailto:|\/)/i.test(url)) return url
  if (/^[a-z0-9./#?&=_%+-]+$/i.test(url) && !url.includes(':')) return url
  return ''
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
