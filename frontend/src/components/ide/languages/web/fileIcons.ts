import type { IdeFileIcon } from '@/lib/code-studio/fileIconTypes'
import type { BrandIconSlug } from '@/lib/brandIcons.generated'

const NAMES: Record<string, BrandIconSlug> = {
  'package.json': 'npm', 'package-lock.json': 'npm', '.npmrc': 'npm',
  '.prettierrc': 'prettier', '.prettierignore': 'prettier',
  '.eslintrc': 'eslint', 'eslint.config.js': 'eslint', 'eslint.config.mjs': 'eslint',
}
const EXTENSIONS: Record<string, BrandIconSlug> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', html: 'html5', htm: 'html5', css: 'css', scss: 'css', less: 'css', json: 'json', jsonc: 'json',
}

export function webFileIcon(name: string): IdeFileIcon | undefined {
  const slug = NAMES[name] ?? EXTENSIONS[name.slice(name.lastIndexOf('.') + 1)]
  return slug ? { kind: 'brand', slug } : undefined
}
