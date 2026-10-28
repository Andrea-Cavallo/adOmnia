// PERF-3.1 / 3.4: RAM of N Go projects with one gopls per project (adOmnia today) versus one
// shared gopls daemon (`gopls serve -listen` + one `-remote` forwarder per project).
// Usage: node scripts/measure-gopls-multi.mjs <gopls.exe> <runs> <project1> <project2> ...
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [gopls, runsArg, ...projects] = process.argv.slice(2);
const runs = Number(runsArg);
const ENV = { ...process.env, GOMEMLIMIT: '768MiB', GOTOOLCHAIN: 'local' };
const PORT = 37391;
const SETTLE_MS = 30000, SAMPLES = 5, SAMPLE_GAP_MS = 2000, LOAD_TIMEOUT_MS = 180000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firstGoFile(dir, depth = 0) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'vendor', 'testdata', 'frontend'].includes(name)) continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isFile() && name.endsWith('.go') && !name.endsWith('_test.go')) return full;
    if (st.isDirectory() && depth < 3) { const f = firstGoFile(full, depth + 1); if (f) return f; }
  }
  return null;
}

// One LSP client on stdio. Resolves `ready` when "Setting up workspace" ends (or initialize, if no progress comes).
function client(args, root) {
  const child = spawn(gopls, args, { cwd: root, env: ENV, windowsHide: true });
  const t0 = Date.now();
  let buf = Buffer.alloc(0), id = 1, setupToken = null;
  const send = (msg) => { const j = JSON.stringify(msg); child.stdin.write(`Content-Length: ${Buffer.byteLength(j)}\r\n\r\n${j}`); };
  let resolveReady; const ready = new Promise((r) => { resolveReady = r; });
  const timer = setTimeout(() => resolveReady({ timeout: true, ms: Date.now() - t0 }), LOAD_TIMEOUT_MS);
  child.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n'); if (sep < 0) return;
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())[1]);
      if (buf.length < sep + 4 + len) return;
      const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString()); buf = buf.subarray(sep + 4 + len);
      if (msg.method && msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params.items || []).map(() => ({})) : null });
      if (msg.method === '$/progress') {
        const v = msg.params.value || {};
        if (v.kind === 'begin' && /Setting up workspace/i.test(v.title || '')) setupToken = msg.params.token;
        if (v.kind === 'end' && setupToken !== null && msg.params.token === setupToken) { clearTimeout(timer); resolveReady({ ms: Date.now() - t0 }); }
      }
    }
  });
  child.stderr.on('data', () => {});
  const uri = pathToFileURL(root).href;
  send({ jsonrpc: '2.0', id: id++, method: 'initialize', params: { processId: process.pid, rootUri: uri, workspaceFolders: [{ uri, name: 'p' }],
    capabilities: { window: { workDoneProgress: true }, workspace: { configuration: true, workspaceFolders: true } } } });
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  const open = () => { const f = firstGoFile(root); if (f) send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: pathToFileURL(f).href, languageId: 'go', version: 1, text: readFileSync(f, 'utf8') } } }); };
  return { child, ready, open };
}

function memory(pids) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.WorkingSet64) $($_.PrivateMemorySize64)" }`], { encoding: 'utf8' });
  let ws = 0, priv = 0; for (const line of out.trim().split(/\r?\n/)) { const [, w, p] = line.split(' ').map(Number); ws += w || 0; priv += p || 0; }
  return { wsMiB: +(ws / 1048576).toFixed(1), privMiB: +(priv / 1048576).toFixed(1) };
}

async function once(mode, n) {
  const roots = projects.slice(0, n);
  const pids = []; const kill = [];
  let daemon = null;
  if (mode === 'shared') {
    daemon = spawn(gopls, ['serve', `-listen=127.0.0.1:${PORT}`], { env: ENV, windowsHide: true });
    pids.push(daemon.pid); kill.push(daemon); await sleep(1500);
  }
  const clients = roots.map((root) => client(mode === 'shared' ? [`-remote=127.0.0.1:${PORT}`] : [], root));
  for (const c of clients) { pids.push(c.child.pid); kill.push(c.child); }
  const loads = await Promise.all(clients.map((c) => c.ready));
  clients.forEach((c) => c.open());
  await sleep(SETTLE_MS);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) { samples.push(memory(pids)); if (i < SAMPLES - 1) await sleep(SAMPLE_GAP_MS); }
  for (const p of kill) { try { p.kill(); } catch {} }
  await sleep(3000);
  const med = (k) => { const v = samples.map((s) => s[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  return { mode, n, wsMiB: med('wsMiB'), privMiB: med('privMiB'), processes: pids.length, loadMs: loads.map((l) => l.ms), timeouts: loads.filter((l) => l.timeout).length };
}

const results = [];
for (const n of [1, 3, 5]) for (const mode of ['separate', 'shared']) for (let r = 0; r < runs; r++) {
  const res = await once(mode, n); results.push(res); console.error(JSON.stringify(res));
}
console.log(JSON.stringify({ gopls, projects, runs, settleMs: SETTLE_MS, results }, null, 2));
