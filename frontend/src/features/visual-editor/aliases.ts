// Module aliases of the Visual Editor. The transplanted sources keep their original import
// specifiers; these aliases point them at the vendored copies or at adOmnia adapters.
// Shared by vite.config.ts and scripts/build-design-bridge.mjs. Mirror any change in
// tsconfig.json "paths".
import path from 'path'

const root = path.resolve(import.meta.dirname)
const vendor = (...parts: string[]) => path.join(root, 'vendor', ...parts)
const adapter = (...parts: string[]) => path.join(root, 'adapters', ...parts)

export const visualEditorAliases = [
  { find: /^@onlook\/models\/(.+)$/, replacement: `${vendor('packages/models/src')}/$1/index.ts` },
  { find: /^@onlook\/models$/, replacement: adapter('packages/models.ts') },
  { find: /^@onlook\/utility$/, replacement: adapter('packages/utility.ts') },
  { find: /^@onlook\/file-system$/, replacement: adapter('packages/file-system.ts') },
  { find: /^@onlook\/constants$/, replacement: vendor('packages/constants/src/index.ts') },
  { find: /^@onlook\/parser$/, replacement: vendor('packages/parser/src/index.ts') },
  { find: /^@onlook\/penpal$/, replacement: vendor('packages/penpal/src/index.ts') },
  { find: /^@onlook\/web-preload\/(.+)$/, replacement: `${vendor('apps/web/preload')}/$1` },
  { find: /^@onlook\/ui\/tokens$/, replacement: vendor('packages/ui/tokens.ts') },
  { find: /^@onlook\/ui\/(.+)$/, replacement: `${adapter('ui')}/$1.ts` },
  { find: /^@ve-client\/(.+)$/, replacement: `${vendor('apps/web/client/src')}/$1` },
]
