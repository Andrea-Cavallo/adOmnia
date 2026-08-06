import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function getAppVersion(): string {
  try {
    const wailsJson = JSON.parse(
      readFileSync(path.resolve(__dirname, '../wails.json'), 'utf8')
    )
    return (wailsJson?.info?.productVersion as string | undefined) ?? '1.0.0'
  } catch {
    return '1.0.0'
  }
}

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
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
        '@': path.resolve(__dirname, './src'),
        // Monaco 0.56's export map no longer exposes its legacy worker
        // subpaths to Vite. The aliases retain our bundled worker setup and
        // also cover monaco-yaml's internal import.
        'monaco-editor/esm/vs/editor/editor.worker': path.resolve(
          __dirname,
          './node_modules/monaco-editor/esm/vs/editor/editor.worker.js'
        ),
        'monaco-editor/esm/vs/editor/editor.worker.js': path.resolve(
          __dirname,
          './node_modules/monaco-editor/esm/vs/editor/editor.worker.js'
        ),
        'monaco-editor/esm/vs/language/json/json.worker': path.resolve(
          __dirname,
          './node_modules/monaco-editor/esm/vs/language/json/json.worker.js'
        ),
        'monaco-editor/esm/vs/language/json/json.worker.js': path.resolve(
          __dirname,
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
