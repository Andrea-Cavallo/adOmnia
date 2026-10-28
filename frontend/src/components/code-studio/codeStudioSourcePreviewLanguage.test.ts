import { describe, expect, it } from 'vitest'
import { previewLanguage } from './codeStudioSourcePreviewLanguage'
const languages = [
  { id: 'go', extensions: ['.go'] },
  { id: 'java', extensions: ['.java'] },
  { id: 'typescript', extensions: ['.ts', '.tsx'] },
  { id: 'declaration', extensions: ['.d.ts'] },
  { id: 'dockerfile', filenames: ['Dockerfile'] },
]
describe('source preview language', () => {
  it('uses the target path for Go, Java and TypeScript, including SDK paths', () => {
    expect(
      previewLanguage('C:\\Program Files\\Go\\src\\os\\env.go', languages),
    ).toBe('go')
    expect(previewLanguage('/repo/Order.java', languages)).toBe('java')
    expect(previewLanguage('/repo/Order.tsx', languages)).toBe('typescript')
  })
  it('matches exact filenames and the most specific registered suffix', () => {
    expect(previewLanguage('/repo/Dockerfile', languages)).toBe('dockerfile')
    expect(previewLanguage('/repo/types.d.ts', languages)).toBe('declaration')
  })
  it('falls back to escaped plain text for unregistered source types', () => {
    expect(previewLanguage('/repo/custom.unknown', languages)).toBe('plaintext')
  })
})
