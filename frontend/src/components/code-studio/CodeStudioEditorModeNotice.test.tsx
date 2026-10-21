import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeStudioEditorModeNotice } from './CodeStudioEditorModeNotice'

describe('editor keyboard mode notice', () => {
  it('explains Vim navigation and exposes a standard-editing recovery action', () => {
    const html = renderToStaticMarkup(<CodeStudioEditorModeNotice mode="vim" vimMode="normal" statusRef={{ current: null }} onStandard={() => {}} />)
    expect(html).toContain('Navigation — press i to type')
    expect(html).toContain('Use standard editing')
    expect(html).not.toContain('aria-hidden="true"')
  })
  it('distinguishes insertion from navigation', () => {
    const html = renderToStaticMarkup(<CodeStudioEditorModeNotice mode="vim" vimMode="insert" statusRef={{ current: null }} onStandard={() => {}} />)
    expect(html).toContain('Insert — Esc returns to navigation')
    expect(html).not.toContain('press i to type')
  })
})
