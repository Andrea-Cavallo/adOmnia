import { describe, expect, it } from 'vitest'
import {
  currentPreview, extractBuildProblems, isHtmlPath, parseBridgeMessage, pageUrl, phaseOf, pickChoice, previewChoices,
  problemRelativePath, staticRequestForFile, upsertPreview, viewportFor,
} from './livePreview'
import type { LivePreview, LivePreviewReport, LivePreviewTarget } from '../livepreview-api'

const target = (patch: Partial<LivePreviewTarget>): LivePreviewTarget => ({
  dir: '/p', relative: '.', name: 'app', manifest: '/p/package.json', kind: 'node', tool: 'vite', framework: 'react',
  packageManager: 'pnpm', packageManagerSource: 'lockfile', lockfile: true, scripts: {}, devScript: 'dev', hasTypeScript: true,
  dependenciesInstalled: true, entryHtml: 'index.html', nodeEngine: '', ...patch,
} as LivePreviewTarget)

const report = (targets: LivePreviewTarget[], config?: LivePreviewReport['config']): LivePreviewReport => ({
  targets, runtime: {}, servers: [], previews: [], trusted: true, config,
} as unknown as LivePreviewReport)

const preview = (patch: Partial<LivePreview>): LivePreview => ({
  id: 'p1', sessionId: 's', mode: 'devserver', state: 'ready', url: 'http://127.0.0.1:5500/', root: '/p', bridged: true, startedAt: '2026-10-17T10:00:00Z', ...patch,
} as unknown as LivePreview)

describe('previewChoices / pickChoice', () => {
  it('offers dev servers first, then static sites', () => {
    const choices = previewChoices(report([target({}), target({ relative: 'docs', kind: 'static', devScript: '', entryHtml: 'index.html' })]))
    expect(choices.map((choice) => choice.request.mode)).toEqual(['devserver', 'static', 'static'])
  })

  it('goes live straight away when there is a single choice', () => {
    const choice = pickChoice(report([target({})]))
    expect(choice?.request).toMatchObject({ mode: 'devserver', dir: '.', script: 'dev' })
  })

  it('asks when a monorepo has several apps and nothing is remembered', () => {
    expect(pickChoice(report([target({ relative: 'apps/web' }), target({ relative: 'apps/admin' })]))).toBeNull()
  })

  it('reuses the remembered configuration while it is still valid', () => {
    const picked = pickChoice(report([target({ relative: 'apps/web' }), target({ relative: 'apps/admin' })], { mode: 'devserver', dir: 'apps/admin', autoReload: true } as never))
    expect(picked?.request.dir).toBe('apps/admin')
  })

  it('forgets a remembered configuration whose folder is gone', () => {
    const picked = pickChoice(report([target({ relative: 'apps/web' }), target({ relative: 'apps/admin' })], { mode: 'devserver', dir: 'apps/old', autoReload: true } as never))
    expect(picked).toBeNull()
  })

  it('keeps the remembered entry page of a static site', () => {
    const picked = pickChoice(report([target({ kind: 'static', devScript: '' })], { mode: 'static', dir: '.', entry: 'about.html', autoReload: true } as never))
    expect(picked?.request).toMatchObject({ mode: 'static', entry: 'about.html' })
  })
})

describe('staticRequestForFile', () => {
  it('serves the project root when it has an index.html', () => {
    expect(staticRequestForFile('pages/about.html', true)).toEqual({ mode: 'static', dir: '.', entry: 'pages/about.html' })
  })
  it('serves the file folder otherwise', () => {
    expect(staticRequestForFile('site\\about.html', false)).toEqual({ mode: 'static', dir: 'site', entry: 'about.html' })
    expect(isHtmlPath('a/b.HTM')).toBe(true)
    expect(isHtmlPath('a/b.tsx')).toBe(false)
  })
})

describe('preview state helpers', () => {
  it('composes the page URL with the entry', () => {
    expect(pageUrl(preview({ entry: 'about.html' }))).toBe('http://127.0.0.1:5500/about.html')
    expect(pageUrl(preview({}))).toBe('http://127.0.0.1:5500/')
    expect(pageUrl(preview({}), '/docs/x')).toBe('http://127.0.0.1:5500/docs/x')
  })
  it('prefers the active, then a running, then the latest preview', () => {
    const stopped = preview({ id: 'old', state: 'stopped', startedAt: '2026-10-17T09:00:00Z' } as never)
    const running = preview({ id: 'run' })
    expect(currentPreview([stopped, running], null)?.id).toBe('run')
    expect(currentPreview([stopped, running], 'old')?.id).toBe('old')
    expect(currentPreview([stopped], null)?.id).toBe('old')
    expect(currentPreview([], null)).toBeNull()
  })
  it('upserts by id', () => {
    const next = upsertPreview([preview({ id: 'a' }), preview({ id: 'b' })], preview({ id: 'a', state: 'failed' } as never))
    expect(next.map((item) => `${item.id}:${phaseOf(item)}`)).toEqual(['a:failed', 'b:ready'])
  })
})

describe('viewportFor', () => {
  it('fills the width on desktop and clamps custom sizes', () => {
    expect(viewportFor('desktop', 600, 0)).toEqual({ width: null, height: null })
    expect(viewportFor('mobile', 0, 0)).toEqual({ width: 390, height: 844 })
    expect(viewportFor('custom', 99999, 0).width).toBe(4000)
    expect(viewportFor('custom', 10, 0).width).toBe(240)
  })
})

describe('parseBridgeMessage', () => {
  it('accepts well-formed messages and rejects anything else', () => {
    expect(parseBridgeMessage({ source: 'adomnia-preview', type: 'navigated', detail: { url: 'http://x/a', title: 'A' } })).toEqual({ type: 'navigated', url: 'http://x/a', title: 'A' })
    expect(parseBridgeMessage({ source: 'adomnia-preview', type: 'network', detail: { method: 'POST', url: '/api', status: 500, ok: false, ms: 12 } })).toMatchObject({ type: 'network', status: 500, ok: false })
    expect(parseBridgeMessage({ source: 'someone-else', type: 'console' })).toBeNull()
    expect(parseBridgeMessage({ source: 'adomnia-preview', type: 'launch-missiles' })).toBeNull()
    expect(parseBridgeMessage('string')).toBeNull()
  })
  it('tolerates a malformed detail', () => {
    expect(parseBridgeMessage({ source: 'adomnia-preview', type: 'console', detail: null })).toEqual({ type: 'console', level: 'log', text: '' })
  })
})

describe('extractBuildProblems', () => {
  it('finds Vite, esbuild and tsc style locations and skips noise', () => {
    const output = [
      '\x1b[31m[vite] Internal server error: Failed to resolve import "./Missing" from "src/App.tsx". Does the file exist?\x1b[39m',
      '  Plugin: vite:import-analysis',
      '  File: /work/app/src/App.tsx:3:18',
      'src/main.tsx(12,5): error TS2322: Type string is not assignable to type number.',
      '✘ [ERROR] Unexpected "}" [plugin] src/styles/app.css:8:1',
      'at node_modules/react-dom/index.js:10:5 error',
      'ready in 300 ms',
    ].join('\n')
    const problems = extractBuildProblems(output)
    expect(problems.map((problem) => `${problem.path}:${problem.line}:${problem.column}`)).toEqual(['/work/app/src/App.tsx:3:18', 'src/main.tsx:12:5', 'src/styles/app.css:8:1'])
  })
  it('attributes the position line of Vite/oxc errors to the message above it', () => {
    const output = [
      '11:33:07 [vite] Internal server error: Transform failed with 1 error:',
      "[PARSE_ERROR] Expected corresponding JSX closing tag for 'h1'.",
      '    ╭─[ src/App.tsx:19:28 ]',
      '    │',
      ' 19 │           <h1>Get started</h2>',
      '  Plugin: vite:oxc',
      '  File: C:/adomnia-webtest/react-app/src/App.tsx',
    ].join('\n')
    expect(extractBuildProblems(output)).toEqual([{ path: 'src/App.tsx', line: 19, column: 28, message: "[PARSE_ERROR] Expected corresponding JSX closing tag for 'h1'." }])
  })
  it('does not invent a message for a bare location', () => {
    expect(extractBuildProblems('ready in 200 ms\n  src/App.tsx:3:4')).toEqual([])
  })
  it('maps a problem path to the project tree', () => {
    expect(problemRelativePath('C:/Work/app/src/App.tsx', 'C:\\Work\\app', 'apps/web')).toBe('apps/web/src/App.tsx')
    expect(problemRelativePath('/src/App.tsx', 'C:\\Work\\app', '.')).toBe('src/App.tsx')
    expect(problemRelativePath('./src/App.tsx', '/w', 'apps/web')).toBe('apps/web/src/App.tsx')
  })
})
