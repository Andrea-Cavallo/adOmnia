import { build } from 'vite'

// Inspect the real production graph without overwriting frontend/dist.
// Dynamic imports are deliberately excluded from the boot-time budget.
const result = await build({ logLevel: 'silent', build: { write: false } })
const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
const chunks = new Map(outputs.filter((item) => item.type === 'chunk').map((item) => [item.fileName, item]))
const initial = new Set()
function visit(name) {
  if (initial.has(name)) return
  const chunk = chunks.get(name)
  if (!chunk) return
  initial.add(name)
  chunk.imports.forEach(visit)
}
for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName)
const initialChunks = [...initial].map((name) => chunks.get(name))
const initialModules = initialChunks.flatMap((chunk) => Object.entries(chunk.modules).map(([id, value]) => ({
  id: id.replaceAll('\\', '/'),
  bytes: value.renderedLength,
})))
const deferredAppModule = /\/(?:components\/(?:goide\/[^/]+|collections\/CollectionTree|layout\/(?:Sidebar|CommandPalette)|assistant\/AICompanion|environment\/EnvModal|hosts\/HostModal)|stores\/goide\w*|lib\/(?:goide-[\w-]+|aiEngine|collectionTransfer|interopHub|openapiImport))\.[jt]sx?$/
const deferredVendor = /\/node_modules\/(?:yaml|monaco-editor|monaco-yaml|mermaid|pdf-lib|pdfjs-dist)\//
const report = {
  initialJavaScriptBytes: initialChunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
  initialChunks: initialChunks.map((chunk) => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code) })).sort((a, b) => b.bytes - a.bytes),
  largestAppModules: initialModules.filter((item) => item.id.includes('/src/')).sort((a, b) => b.bytes - a.bytes).slice(0, 25),
  deferredModulesStillOnStartup: initialModules.filter((item) => deferredAppModule.test(item.id) || deferredVendor.test(item.id)).map((item) => item.id),
}
console.log(JSON.stringify(report, null, 2))
if (!process.argv.includes('--report-only')) {
  if (report.initialJavaScriptBytes > 650_000 || report.deferredModulesStillOnStartup.length) {
    console.error('Startup budget failed: keep initial JavaScript below 650 kB and optional tools outside the static entry graph.')
    process.exitCode = 1
  }
}
