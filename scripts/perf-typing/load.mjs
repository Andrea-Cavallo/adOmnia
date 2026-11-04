// Run through run.ps1. node load.mjs <label> [scenarios]: types at the end of medium.go while real work runs in the app and
// reports keypress-to-paint latency. A scenario is valid only if every key reached the editor.
import { connect, sleep } from './cdp.mjs'
import { writeFileSync, appendFileSync, readFileSync, writeFile } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = process.env.PERF_WORK ?? join(tmpdir(), 'adomnia-perf-typing')
const project = join(work, 'project')
const label = process.argv[2] ?? 'run'
const scenarios = (process.argv[3] ?? 'idle,run-flood,tests,debug,indexing').split(',')
const KEYS = 300, INTERVAL_MS = 60
const ID = { startRun: 39043755, stopRun: 51057931, startTests: 224644795, startDebug: 1614658301, stopDebug: 3344693341, list: 1758091587 }

const c = await connect()
await c.send('Page.enable'); await c.send('Performance.enable'); await c.send('Profiler.enable')
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await c.send('Page.bringToFront')
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 : null }
const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const key = async (k, code, vk, modifiers = 0, text) => {
  await c.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
}
const call = async (id, ...args) => { const r = await c.callBinding(id, ...args); if (r.status >= 300) throw new Error(`binding ${id}: ${r.status} ${r.body}`); return { id: /"id":"([^"]+)"/.exec(r.body ?? '')?.[1], body: r.body } }
const cursor = () => c.evaluate(`(() => { const m = document.body.innerText.match(/\\b(\\d+):(\\d+)\\s*\\n?\\s*UTF-8/); return m ? Number(m[2]) : -1 })()`)
const focusEditor = async () => {
  await c.evaluate(`(() => { const e = document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea, .monaco-editor textarea'); e?.focus() })()`)
  await sleep(150)
  await key('End', 'End', 35, 2)
  await sleep(250)
}
// Opens the generated project in Code Studio.
await c.callBinding(1300673995, project)
await sleep(1500)
const studio = await c.evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||b.title||b.textContent).trim()==='Code Studio'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
await c.click(studio.x, studio.y)
await sleep(3000)
if (await c.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim()==='Trust Folder')`)) { await c.clickText('Trust Folder', 'button'); await sleep(2500) }
await c.evaluate(`(() => { if (window.__perf) return; window.__perf = { lat: [], long: [] }
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.long.push(e.duration) }).observe({ type: 'longtask', buffered: false })
  window.addEventListener('keydown', () => { const t = performance.now(); requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => window.__perf.lat.push(performance.now() - t); ch.port2.postMessage(0) }) }, true) })()`)
await c.clickText('medium.go', '[role=treeitem] *, button, span')
await sleep(20000) // gopls has loaded the workspace: the same state on every build
await focusEditor()
for (const ch of '// ') await key(ch, ch === '/' ? 'Slash' : 'Space', ch === '/' ? 191 : 32, 0, ch)
await sleep(300)
const { id: sessionId } = await call(ID.list)
const base = { sessionId, workingDirectory: '', goArguments: [], programArguments: [], buildTags: [], environment: {}, docker: {} }
const touchAll = () => { for (let i = 0; i < 150; i++) { const f = join(project, `pkgs/p${i}/f.go`); writeFile(f, readFileSync(f, 'utf8') + `\n// touch ${Date.now()}\n`, () => {}) } }
const load = {
  idle: async () => null,
  'run-flood': async () => { const e = await call(ID.startRun, { ...base, kind: 'command', target: 'go', programArguments: ['run', './flood'] }); return () => call(ID.stopRun, e.id) },
  tests: async () => {
    await call(ID.startTests, { sessionId, workingDirectory: '', packages: ['./slowtests'] })
    await sleep(3000)
    await key('8', 'Digit8', 56, 1)
    return null
  },
  debug: async () => {
    const d = await call(ID.startDebug, { sessionId, mode: 'debug', workingDirectory: '', target: './debugloop' })
    await sleep(3000)
    await key('5', 'Digit5', 53, 1)
    return () => call(ID.stopDebug, d.id)
  },
  indexing: async () => { appendFileSync(join(project, 'go.mod'), `\n// reload ${Date.now()}\n`); touchAll(); const t = setInterval(touchAll, 3000); return () => clearInterval(t) },
}
const results = []
for (const name of scenarios) {
  const stop = await load[name]()
  await sleep(name === 'idle' ? 500 : 7000)
  await focusEditor()
  await c.evaluate(`window.__perf.lat = []; window.__perf.long = []`)
  const start = await cursor()
  await c.send('Profiler.setSamplingInterval', { interval: 500 }); await c.send('Profiler.start')
  const before = await metrics(); const t0 = Date.now()
  for (let i = 0; i < KEYS; i++) { await key('a', 'KeyA', 65, 0, 'a'); await sleep(INTERVAL_MS) }
  const elapsed = Date.now() - t0; await sleep(800)
  const after = await metrics(); const { profile } = await c.send('Profiler.stop'); const perf = await c.evaluate(`window.__perf`)
  const typed = (await cursor()) - start
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame; const n = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`; self.set(n, (self.get(n) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000) })
  const top = [...self].filter(([n]) => !/^\((idle|program|root)\)/.test(n)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, ms]) => [n, Math.round(ms)])
  const panel = await c.evaluate(`(() => { const t = document.body.innerText; return { run: /earlier lines not shown|request handled/.test(t), tests: /case_\\d+/.test(t), debugTicks: /tick \\d+/.test(t), diagnostics: (t.match(/\\d+ errors?/)||[''])[0] } })()`)
  const row = { scenario: name, valid: typed === KEYS, typed, panel, p50: pct(perf.lat, .5), p95: pct(perf.lat, .95), p99: pct(perf.lat, .99), max: pct(perf.lat, 1), longTasks: perf.long.length, longMax: pct(perf.long, 1), busyPct: Math.round((after.TaskDuration - before.TaskDuration) * 1000 / elapsed * 100), heapMB: Math.round(after.JSHeapUsedSize / 1048576), dom: after.Nodes, top }
  results.push(row); const { top: _t, ...printable } = row; console.log(JSON.stringify(printable))
  await c.screenshot(join(work, `shot-${label}-${name}.png`))
  await stop?.()
  await sleep(4000)
}
writeFileSync(join(work, `result-${label}.json`), JSON.stringify(results, null, 2)); c.close()
