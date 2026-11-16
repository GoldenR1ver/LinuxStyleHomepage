// 来源 REQ-SG-03 / REQ-SG-09 / FORB-03：文档写明 chmod 不是访问控制。
import { describe, expect, it } from 'vitest'
import { read } from '../_support/repo'

const README = 'README.md'
const DRAFTS = 'drafts/README.txt'

/** The four facts a reader needs to stop trusting a mode bit. */
const FACTS = ['overlay', 'commit', '0644', 'static asset']

describe('REQ-SG-03 the limitation is written down', () => {
  it('says it in the README, in those words', () => {
    const text = read(README)
    expect(text).toContain('not access control')
    expect(text).toContain('Permissions are not access control')
  })

  it('covers all four facts in the README', () => {
    const text = read(README).toLowerCase()
    for (const fact of FACTS) {
      expect({ fact, present: text.includes(fact.toLowerCase()) }).toEqual({ fact, present: true })
    }
  })

  it('says it in drafts/README.txt too', () => {
    const text = read(DRAFTS)
    expect(text).toContain('chmod is not access control')
    expect(text.toLowerCase()).toContain('overlay')
    expect(text.toLowerCase()).toContain('public asset')
  })

  it('tells the reader to check the manifest, not ls -l', () => {
    const text = read(README)
    expect(text).toContain('dist/fs/manifest.json')
    expect(text.toLowerCase()).toContain('rather than with `ls -l`')
  })
})

describe('REQ-SG-09 no doc promises a mode bit hides a file', () => {
  it('never pairs chmod with a promise of invisibility', () => {
    // A doc may discuss chmod, but then it must also carry the limitation.
    for (const file of [README, DRAFTS]) {
      const text = read(file)
      if (!text.includes('chmod')) continue
      const lowered = text.toLowerCase()
      const disclaims = lowered.includes('not access control')
      expect({ file, disclaims }).toEqual({ file, disclaims: true })
    }
  })

  it('never claims another visitor cannot read a chmod-ed file', () => {
    for (const file of [README, DRAFTS]) {
      const text = read(file)
      expect(text).not.toContain('other visitors cannot open')
      expect(text).not.toContain('other visitors cannot read it')
      expect(text).not.toContain('hides the file from guests')
    }
  })
})
