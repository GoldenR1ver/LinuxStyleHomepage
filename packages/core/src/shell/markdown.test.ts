import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('markdown', () => {
  it('renders headings, emphasis, and lists', () => {
    const html = renderMarkdown('# Title\n\nA **bold** word and `code`.\n\n- one\n- two\n')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<li>one</li>')
  })

  it('renders a table and escapes raw html', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| <i> | x |\n')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('&lt;i&gt;')
    expect(html).not.toContain('<i>')
  })

  it('keeps fenced code literal', () => {
    const html = renderMarkdown('```\n# not a heading\n```\n')
    expect(html).toContain('<pre><code># not a heading</code></pre>')
    expect(html).not.toContain('<h1>')
  })
})
