import { FsError } from '../../kernel/vfs'
import { renderMarkdown } from '../../ui/markdown'
import type { CommandSpec } from './types'
import { errorMessage, resolvePath } from './helpers'

const VIM = `Modal editor for text files.

Normal
  h j k l / arrows     move
  w b e W B E          words
  0 ^ $ gg G           line edges and file edges
  f t F T ; ,          find a character
  / ? n N * #          search
  Ctrl-d Ctrl-u        half page
  Ctrl-f PageDown      page down
  PageUp               page up
  %                    matching bracket
  v V                  character or line selection
  d c y p P x X        delete, change, yank, put
  i a I A o O R        insert or replace
  u Ctrl-r .           undo, redo, repeat
  gg gu gU             go to top, or change case with a motion
  :w :q :wq :q!        write and quit
  :s/old/new/g :%s     substitute
  :set number          line numbers

Ctrl-b is still the pane prefix. A guest can write only under /tmp and the guestbook.
`

export const viewCommands: CommandSpec[] = [
  {
    name: 'vim',
    group: 'site',
    summary: 'edit a file',
    usage: 'vim [file]',
    manual: VIM,
    run(ctx, args) {
      if (args.length > 1) return { code: 1, stderr: 'vim: one file at a time\n' }
      const name = args[0]
      if (!name) return { code: 0, stage: { kind: 'vim', path: null, filename: '[No Name]', text: '' } }
      const path = resolvePath(ctx, name)
      try {
        const node = ctx.rt.fs.read(ctx.user, path)
        if (node.encoding !== 'utf8') return { code: 1, stderr: `vim: ${name}: binary file\n` }
        return { code: 0, stage: { kind: 'vim', path, filename: path, text: node.content } }
      } catch (err) {
        if (err instanceof FsError && err.code === 'ENOENT') {
          return { code: 0, stage: { kind: 'vim', path, filename: path, text: '' } }
        }
        return { code: 1, stderr: `vim: ${name}: ${errorMessage(err)}\n` }
      }
    },
  },
  {
    name: 'md',
    group: 'site',
    summary: 'view a markdown file',
    usage: 'md file.md',
    manual: 'Render a .md file in this pane. q, :q, Esc, or Ctrl-C returns to the prompt.',
    run(ctx, args) {
      if (args.length !== 1) return { code: 1, stderr: 'md: usage: md file.md\n' }
      const name = args[0] ?? ''
      if (!/\.md$|\.markdown$/i.test(name)) return { code: 1, stderr: `md: ${name}: not a markdown file\n` }
      const path = resolvePath(ctx, name)
      try {
        const node = ctx.rt.fs.read(ctx.user, path)
        if (node.encoding !== 'utf8') return { code: 1, stderr: `md: ${name}: binary file\n` }
        return { code: 0, stage: { kind: 'md', title: path, text: renderMarkdown(node.content) } }
      } catch (err) {
        return { code: 1, stderr: `md: ${name}: ${errorMessage(err)}\n` }
      }
    },
  },
  {
    name: 'pdf',
    group: 'site',
    summary: 'view a pdf file',
    usage: 'pdf file.pdf',
    manual:
      'Open a PDF in this pane with the browser viewer. q, :q, Esc, or Ctrl-C closes it. Click the bar first if the viewer has the keyboard.',
    run(ctx, args) {
      if (args.length !== 1) return { code: 1, stderr: 'pdf: usage: pdf file.pdf\n' }
      const name = args[0] ?? ''
      if (!/\.pdf$/i.test(name)) return { code: 1, stderr: `pdf: ${name}: not a pdf\n` }
      const path = resolvePath(ctx, name)
      try {
        const node = ctx.rt.fs.read(ctx.user, path)
        if (node.encoding !== 'binary' || !node.url) return { code: 1, stderr: `pdf: ${name}: no preview for this file\n` }
        return { code: 0, stage: { kind: 'pdf', title: path, url: node.url } }
      } catch (err) {
        return { code: 1, stderr: `pdf: ${name}: ${errorMessage(err)}\n` }
      }
    },
  },
]
