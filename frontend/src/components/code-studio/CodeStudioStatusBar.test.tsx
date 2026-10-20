import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { languageServerLabel, localAnalysisLabel } from './CodeStudioStatusBar'
import { CodeStudioStatusMenu } from './CodeStudioStatusMenu'
import { IDE_LANGUAGES } from '@/components/ide/languages'

describe('status bar language server label', () => {
  it('names the server from the language contribution instead of hardcoding it', () => {
    expect(IDE_LANGUAGES.find((language) => language.id === 'go')?.languageServer).toBe('gopls')
    expect(languageServerLabel('ready', 'gopls', 'v0.16')).toBe('gopls v0.16')
    expect(languageServerLabel('starting', 'rust-analyzer')).toBe('rust-analyzer starting…')
    expect(languageServerLabel('crashed', 'gopls')).toBe('gopls crashed')
    expect(languageServerLabel('stopped', 'gopls')).toBe('gopls off')
  })

  it('says when the Java buffer is served by the local analysis instead of JDT LS', () => {
    // Con il server non pronto completamento e Structure arrivano dall'analisi locale (JS-14):
    // la fonte è esplicita, e con JDT pronto prevale il server senza scritte extra.
    expect(localAnalysisLabel('java', 'starting', 'Eclipse JDT LS starting…')).toBe('Local Java analysis (Eclipse JDT LS starting…)')
    expect(localAnalysisLabel('java', 'stopped', 'Eclipse JDT LS off')).toBe('Local Java analysis (Eclipse JDT LS off)')
    expect(localAnalysisLabel('java', 'ready', 'Eclipse JDT LS 1.60')).toBe('Eclipse JDT LS 1.60')
    expect(localAnalysisLabel('typescript', 'starting', 'typescript-language-server starting…')).toBe('typescript-language-server starting…')
    expect(localAnalysisLabel(undefined, 'stopped', 'gopls off')).toBe('gopls off')
  })
})

describe('CodeStudioStatusMenu', () => {
  it('renders a closed menu button that announces the popup', () => {
    const html = renderToStaticMarkup(
      <CodeStudioStatusMenu label="Tools" title="More tools" className="x" items={[{ id: 'a', label: 'Trace', title: 'Go trace', icon: null, onSelect: () => undefined }]} />,
    )
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="menu"')
  })
})
