import { describe, expect, it } from 'vitest'
import { inspectablePageTargets, type DebugTarget } from './browser-debug-api'

const target = (type: string, url: string, ws = 'ws://localhost/devtools/page/1'): DebugTarget => ({
  id: `${type}:${url}`,
  type,
  title: url,
  url,
  webSocketDebuggerUrl: ws,
  devtoolsFrontendUrl: '',
  faviconUrl: '',
  attached: false,
})

describe('inspectablePageTargets', () => {
  it('keeps browser pages and rejects workers and internal DevTools targets', () => {
    expect(inspectablePageTargets([
      target('service_worker', 'chrome-extension://worker'),
      target('page', 'https://www.google.com/'),
      target('page', 'devtools://devtools/bundled/inspector.html'),
    ]).map((item) => item.url)).toEqual(['https://www.google.com/'])
  })

  it('rejects pages that cannot be connected through CDP', () => {
    expect(inspectablePageTargets([target('page', 'https://example.com', '')])).toEqual([])
  })
})
