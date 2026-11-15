// Builds the in-page half of the Visual Editor (Design Mode): one self-contained script the
// Live Preview server embeds and serves at /__adomnia/design.js. The Go binary embeds the
// output, so it is committed: run `npm run build:design-bridge` after changing anything under
// src/features/visual-editor/vendor/apps/web/preload.
import { defineConfig } from 'vite'
import path from 'path'
import { visualEditorAliases } from './src/features/visual-editor/aliases.ts'

export default defineConfig({
  resolve: { alias: visualEditorAliases },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: path.resolve(import.meta.dirname, '../internal/ide/preview'),
    // The output folder is a Go package: never empty it.
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(import.meta.dirname, './src/features/visual-editor/vendor/apps/web/preload/script/index.ts'),
      formats: ['iife'],
      name: '__adomniaDesign',
      fileName: () => 'design.js',
    },
  },
})
