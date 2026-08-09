import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function getAppVersion(): string {
  // Wails 3 replaced wails.json with build/config.yml. Failing loudly here
  // matters: a silent fallback would ship a build labelled with the wrong
  // version, which looks fine until a user reports the wrong number.
  const configPath = path.resolve(import.meta.dirname, '../build/config.yml')
  const config = parseYaml(readFileSync(configPath, 'utf8')) as
    | { info?: { version?: string | number } }
    | undefined
  const version = config?.info?.version

  if (version === undefined || version === null || String(version).trim() === '') {
    throw new Error(`Missing info.version in ${configPath}`)
  }

  return String(version).trim()
}

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  // The generated Wails bindings import Call/CancellablePromise from this
  // package. Keeping all of its modules together prevents Rolldown from
  // producing a circular runtime chunk where Call is read before it exists.
  if (/[\\/]node_modules[\\/]@wailsio[\\/]runtime[\\/]/.test(id)) return 'wails-runtime'
  if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
  if (/[\\/]node_modules[\\/](ajv|ajv-formats)[\\/]/.test(id)) return 'vendor-schema'
  if (/[\\/]node_modules[\\/](zustand|yaml|clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id)) return 'vendor-misc'
  return undefined
}

// Run `VITE_ANALYZE=1 npm run build` to generate a bundle size report.
// Requires: npm install --save-dev rollup-plugin-visualizer
export default defineConfig(async () => {
  const plugins = [react()]

  if (process.env.VITE_ANALYZE === '1') {
    const { visualizer } = await import('rollup-plugin-visualizer')
    plugins.push(visualizer({ open: true, filename: 'dist/bundle-report.html' }))
  }

  return {
    plugins,
    define: {
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      __COMMIT_HASH__: JSON.stringify(getCommitHash()),
      __APP_VERSION__: JSON.stringify(getAppVersion()),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        // Monaco 0.56's export map no longer exposes its legacy worker
        // subpaths to Vite. The aliases retain our bundled worker setup and
        // also cover monaco-yaml's internal import.
        'monaco-editor/esm/vs/editor/editor.worker': path.resolve(
          import.meta.dirname,
          './node_modules/monaco-editor/esm/vs/editor/editor.worker.js'
        ),
        'monaco-editor/esm/vs/editor/editor.worker.js': path.resolve(
          import.meta.dirname,
          './node_modules/monaco-editor/esm/vs/editor/editor.worker.js'
        ),
        'monaco-editor/esm/vs/language/json/json.worker': path.resolve(
          import.meta.dirname,
          './node_modules/monaco-editor/esm/vs/language/json/json.worker.js'
        ),
        'monaco-editor/esm/vs/language/json/json.worker.js': path.resolve(
          import.meta.dirname,
          './node_modules/monaco-editor/esm/vs/language/json/json.worker.js'
        ),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
  }
})
