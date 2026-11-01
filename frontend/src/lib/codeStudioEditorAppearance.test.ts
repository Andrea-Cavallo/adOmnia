import { describe, expect, it } from 'vitest'
import { codeStudioGutterColors, codeStudioSyntaxRules } from './codeStudioEditorAppearance'

function luminance(hex: string) {
  const value = hex.replace('#', '')
  const rgb = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}

describe('Code Studio editor readability', () => {
  for (const light of [false, true]) {
    it(`keeps syntax and line numbers readable on ${light ? 'light' : 'dark'} default surfaces`, () => {
      const backgrounds = light ? ['FFFFFF', 'FAFBFC'] : ['000000', '11171D']
      for (const background of backgrounds) {
        for (const rule of codeStudioSyntaxRules(light)) expect(contrast(rule.foreground!, background), rule.token).toBeGreaterThanOrEqual(4.5)
        expect(contrast(codeStudioGutterColors(light)['editorLineNumber.foreground'], background)).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
