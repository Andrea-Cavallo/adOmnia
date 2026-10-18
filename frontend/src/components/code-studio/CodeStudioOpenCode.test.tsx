import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

const fixture = vi.hoisted(() => ({ state: { dialogOpen: true, settings: null as unknown, status: null, busy: false, error: 'OpenCode.Settings is unavailable' }, ensure: vi.fn(), close: vi.fn() }))
vi.mock('@/stores/opencode', () => ({
  useOpenCodeStore: Object.assign((selector: (state: typeof fixture.state) => unknown) => selector(fixture.state), { getState: () => ({ ensure: fixture.ensure, setDialogOpen: fixture.close }) }),
  checkOllamaModel: vi.fn(), listOllamaModels: vi.fn(),
}))
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }))
vi.mock('./CodeStudioAgentChat', () => ({ CodeStudioAgentChat: () => null }))
vi.mock('./CodeStudioModal', () => ({
  CodeStudioModal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => <section role="dialog" aria-label={title}>{children}{footer}</section>,
  CodeStudioAlert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  CodeStudioButton: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  CodeStudioField: ({ label, children }: { label: string; children: ReactNode }) => <label>{label}{children}</label>,
}))
import { CodeStudioOpenCodeDialog } from './CodeStudioOpenCode'

beforeEach(() => { fixture.state.dialogOpen = true; fixture.state.settings = null; fixture.state.error = 'OpenCode.Settings is unavailable' })
describe('OpenCode settings availability', () => {
  it('opens the dialog and exposes errors even when settings fail to load', () => {
    const html = renderToStaticMarkup(<CodeStudioOpenCodeDialog />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('OpenCode.Settings is unavailable')
    expect(html).toContain('Retry')
  })
  it('shows a loading state while initial settings are still pending', () => {
    fixture.state.error = ''
    const html = renderToStaticMarkup(<CodeStudioOpenCodeDialog />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Loading OpenCode settings')
  })
  it('stays hidden only when the user closes it', () => {
    fixture.state.dialogOpen = false
    expect(renderToStaticMarkup(<CodeStudioOpenCodeDialog />)).toBe('')
  })
})
