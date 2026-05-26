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
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-icons': ['lucide-react'],
            'vendor-schema': ['ajv', 'ajv-formats'],
            'vendor-misc': ['zustand', 'yaml', 'clsx', 'tailwind-merge', 'class-variance-authority'],
          },
        },
      },
    },
  }
})
