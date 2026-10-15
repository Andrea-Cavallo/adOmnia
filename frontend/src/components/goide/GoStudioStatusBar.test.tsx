import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { languageServerLabel } from './GoStudioStatusBar'
import { GoStudioStatusMenu } from './GoStudioStatusMenu'
import { IDE_LANGUAGES } from '@/components/ide/languages'

describe('status bar language server label', () => {
  it('names the server from the language contribution instead of hardcoding it', () => {
    expect(IDE_LANGUAGES.find((language) => language.id === 'go')?.languageServer).toBe('gopls')
    expect(languageServerLabel('ready', 'gopls', 'v0.16')).toBe('gopls v0.16')
    expect(languageServerLabel('starting', 'rust-analyzer')).toBe('rust-analyzer starting…')
    expect(languageServerLabel('crashed', 'gopls')).toBe('gopls crashed')
    expect(languageServerLabel('stopped', 'gopls')).toBe('gopls off')
  })
})

describe('GoStudioStatusMenu', () => {
  it('renders a closed menu button that announces the popup', () => {
    const html = renderToStaticMarkup(
      <GoStudioStatusMenu label="Tools" title="More tools" className="x" items={[{ id: 'a', label: 'Trace', title: 'Go trace', icon: null, onSelect: () => undefined }]} />,
    )
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="menu"')
  })
})
