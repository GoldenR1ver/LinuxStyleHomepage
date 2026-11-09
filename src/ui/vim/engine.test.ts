import { describe, expect, it } from 'vitest'
import { VimEngine } from './engine'

function editor(text = 'one two\nthree\n') {
  return new VimEngine(text, 't.txt', 10)
}

function type(ed: VimEngine, keys: string) {
  for (const key of keys) {
    if (key === '\n') ed.press({ key: 'Enter', ctrl: false })
    else ed.press({ key, ctrl: false })
  }
}

describe('vim', () => {
  it('moves within the line', () => {
    const ed = editor()
    type(ed, 'l')
    expect(ed.model().status).toContain('1,2')
    type(ed, 'h')
    expect(ed.model().status).toContain('1,1')
  })

  it('deletes a word and undoes it', () => {
    const ed = editor()
    type(ed, 'dw')
    expect(ed.text()).toBe('two\nthree\n')
    type(ed, 'u')
    expect(ed.text()).toBe('one two\nthree\n')
  })

  it('deletes a line and puts it back', () => {
    const ed = editor()
    type(ed, 'ddp')
    expect(ed.text()).toBe('three\none two\n')
  })

  it('inserts and leaves the cursor on the new text', () => {
    const ed = editor()
    type(ed, 'i')
    ed.insertText('X')
    ed.press({ key: 'Escape', ctrl: false })
    expect(ed.text()).toBe('Xone two\nthree\n')
  })

  it('searches forward', () => {
    const ed = editor()
    type(ed, '/two\n')
    expect(ed.model().status).toContain('1,5')
  })

  it('substitutes on the current line', () => {
    const ed = editor()
    type(ed, ':s/one/ONE\n')
    expect(ed.text()).toBe('ONE two\nthree\n')
  })

  it('asks for a force quit after an edit', () => {
    const ed = editor()
    type(ed, 'x:q\n')
    expect(ed.quit).toBe(false)
    expect(ed.model().prompt).toContain('!')
    type(ed, ':q!\n')
    expect(ed.quit).toBe(true)
  })

  it('deletes a visually selected line', () => {
    const ed = editor()
    type(ed, 'Vd')
    expect(ed.text()).toBe('three\n')
  })

  it('repeats the last deletion', () => {
    const ed = editor('aa bb cc\n')
    type(ed, 'dw.')
    expect(ed.text()).toBe('cc\n')
  })

  it('writes through the save request', () => {
    const ed = editor()
    type(ed, ':w\n')
    expect(ed.writeRequest?.quit).toBe(false)
    ed.acknowledgeWrite(null)
    expect(ed.dirty()).toBe(false)
    expect(ed.model().prompt).toContain('written')
  })
})
