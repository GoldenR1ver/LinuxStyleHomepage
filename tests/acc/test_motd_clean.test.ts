// 来源 REQ-SG-06：登录屏不提 Specgate，也不指向工作区。
import { describe, expect, it } from 'vitest'
import { read } from '../_support/repo'

const files = ['content/etc/motd', 'content/etc/issue']

describe('REQ-SG-03 login screens are clean', () => {
  it.each(files)('%s mentions neither Specgate nor the workspace', (file) => {
    const text = read(file)
    expect(text.toLowerCase()).not.toContain('specgate')
    expect(text).not.toContain('/home/owner/specgate')
  })

  it('keeps a way to reach the help page', () => {
    // The exact wording is the owner's to edit; the promise is that help is named.
    expect(read('content/etc/motd')).toContain('help')
  })

  it('keeps the motd non-empty', () => {
    expect(read('content/etc/motd').trim().length).toBeGreaterThan(0)
  })
})
