import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/stores/goide', () => ({ useGoIDEStore: Object.assign(() => undefined, { getState: () => ({ sessions: [], documents: [], setToolAuthorization: vi.fn() }), subscribe: () => () => undefined }) }))
vi.mock('@/stores/goideLsp', () => ({ useGoIDELspStore: Object.assign(() => undefined, { getState: () => ({ showToolWindow: vi.fn() }) }) }))
vi.mock('@/lib/goide-api', () => ({ subscribeGoIDEEvents: () => () => undefined }))
vi.mock('@/lib/livepreview-api', () => ({}))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }))

import { GoStudioPreviewSetup } from './GoStudioPreviewSetup'
import type { SessionPreview } from '@/stores/livePreview'

const session = (authorization = 'tooling-permitted') => ({ id: 's1', project: { authorization, realPath: '/p' } }) as never

const base: SessionPreview = {
  report: null, loading: false, starting: false, previews: [], activeId: null, placement: 'split', visible: true, tabActive: false, device: 'desktop',
  width: 600, height: 0, autoReload: true, error: null, install: null, chooserOpen: false, lastRequest: null, log: [], location: null, hydrated: true,
}

const target = (patch: Record<string, unknown> = {}) => ({
  dir: '/p', relative: '.', name: 'app', kind: 'node', tool: 'vite', framework: 'react', packageManager: 'pnpm', lockfile: true,
  devScript: 'dev', dependenciesInstalled: true, entryHtml: 'index.html', installCommand: ['pnpm', 'install', '--frozen-lockfile'], ...patch,
})

const report = (patch: Record<string, unknown> = {}) => ({ targets: [target()], runtime: { nodeAvailable: true, nodeVersion: '22.14.0', packageManagerAvailable: true, packageManagerVersion: '11.1.1' }, servers: [], previews: [], trusted: true, ...patch }) as never

const render = (view: Partial<SessionPreview>, preview: unknown = null, authorization?: string) =>
  renderToStaticMarkup(<GoStudioPreviewSetup session={session(authorization)} view={{ ...base, ...view }} preview={preview as never} />)

describe('GoStudioPreviewSetup', () => {
  it('asks for trust instead of starting anything in a restricted project', () => {
    const html = render({ report: report() }, null, 'restricted')
    expect(html).toContain('Trust this project to preview it')
    expect(html).toContain('never starts either of them until you trust')
  })

  it('shows what was detected and offers Go Live', () => {
    const html = render({ report: report() })
    expect(html).toContain('Go Live')
    expect(html).toContain('react · vite · pnpm')
    expect(html).toContain('Node.js 22.14.0')
  })

  it('explains a missing Node.js up front, with the ways to fix it', () => {
    const html = render({ report: report({ runtime: { nodeAvailable: false, packageManagerAvailable: false, problem: 'Node.js was not found on this machine', remedies: ['Install the current LTS from https://nodejs.org'] } }) })
    expect(html).toContain('Node.js was not found on this machine')
    expect(html).toContain('Install the current LTS')
  })

  it('offers dependency installation but never starts it by itself', () => {
    const html = render({ report: report(), lastRequest: { mode: 'devserver', dir: '.', script: 'dev' } as never }, { id: 'dev:.:dev', state: 'failed', failureKind: 'missing-dependencies', error: 'The project dependencies are not installed.', mode: 'devserver' })
    expect(html).toContain('Dependencies are not installed')
    expect(html).toContain('Install dependencies…')
    expect(html).not.toContain('role="alertdialog"')
  })

  it('shows runtime failures with their hints and a re-check button', () => {
    const html = render({ report: report() }, { id: 'dev:.:dev', state: 'failed', failureKind: 'runtime', error: 'pnpm was not found on this machine', hints: ['Run `corepack enable`'], mode: 'devserver' })
    expect(html).toContain('Node.js is not available')
    expect(html).toContain('corepack enable')
    expect(html).toContain('Check again')
  })

  it('explains a busy port in plain words', () => {
    const html = render({ report: report() }, { id: 'dev:.:dev', state: 'failed', failureKind: 'port-in-use', error: 'The port the dev server needs is already in use.', mode: 'devserver', runId: 'r1' })
    expect(html).toContain('The port is already in use')
    expect(html).toContain('Try again')
    expect(html).toContain('Run console')
  })

  it('lists every previewable target when there is more than one and nothing remembered', () => {
    const html = render({ report: report({ targets: [target({ relative: 'apps/web', packageManager: 'npm' }), target({ relative: 'apps/admin' })] }), chooserOpen: true })
    expect(html).toContain('What do you want to preview?')
    expect(html).toContain('apps/web · npm run dev')
    expect(html).toContain('apps/admin · pnpm run dev')
  })

  it('says it is starting while the dev server prints its address', () => {
    const html = render({ report: report() }, { id: 'dev:.:dev', state: 'starting', mode: 'devserver', command: 'pnpm run dev --host 127.0.0.1' })
    expect(html).toContain('Starting the dev server…')
    expect(html).toContain('pnpm run dev --host 127.0.0.1')
  })

  it('offers to install the editor language servers without pushing it', () => {
    const html = render({ report: report({ servers: [{ language: 'typescript', available: false, error: 'not found' }] }) })
    expect(html).toContain('uses the built-in Monaco features')
    expect(html).toContain('Install them…')
  })
})
