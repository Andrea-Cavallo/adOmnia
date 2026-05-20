import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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
