// Minimal CDP client for the real WebView2 of adOmnia (measurement only, no dependency). Needs Node 22+.
import { writeFileSync } from 'node:fs'

export const PORT = Number(process.env.CDP_PORT ?? 19402)

export async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url))
  if (!page) throw new Error('no page target: ' + JSON.stringify(targets.map((t) => t.url)))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const data = JSON.parse(m.data)
    if (data.id && pending.has(data.id)) {
      const { ok, ko } = pending.get(data.id)
      pending.delete(data.id)
      data.error ? ko(new Error(JSON.stringify(data.error))) : ok(data.result)
    }
  }
  const send = (method, params = {}) => new Promise((ok, ko) => {
    const n = ++id
    pending.set(n, { ok, ko })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const screenshot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(r.data, 'base64'))
  }
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const clickText = async (text, selector = 'button, [role=treeitem], [role=tab], a, span, div') => {
    const box = await evaluate(`(() => { const t=${JSON.stringify(text)}; const all=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.textContent.trim()===t && e.getClientRects().length); const e=all.at(-1); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    if (!box) throw new Error('not found: ' + text)
    await click(box.x, box.y)
  }
  const callBinding = (methodID, ...args) => evaluate(`(async () => {
    const url = new URL(location.origin + '/wails/runtime');
    const r = await fetch(url, { method: 'POST', headers: { 'x-wails-client-id': 'perf-driver', 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 0, method: 0, args: { call-id: 'x', methodID: ${methodID}, args: ${JSON.stringify(args)} } }) });
    return { status: r.status, body: (await r.text()).slice(0, 400) };
  })()`.replace('call-id', '"call-id"'))
  return { send, evaluate, screenshot, click, clickText, callBinding, close: () => ws.close() }
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
