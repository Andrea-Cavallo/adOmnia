import { describe, expect, it } from 'vitest'
import { getUIFontStack } from '@/lib/uiFonts'
import { typographyVariables } from './useAppearance'

describe('typographyVariables', () => {
  it('applies the selected UI font to the monospace token used by panels and editors', () => {
    const selectedFont = getUIFontStack('fira-code')

    expect(typographyVariables('fira-code', 'medium', 'medium')).toMatchObject({
      '--font-ui': selectedFont,
      '--font-mono': selectedFont,
    })
  })
})
