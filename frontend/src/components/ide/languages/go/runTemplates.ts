import { field, type RunTemplate } from '@/lib/code-studio/runFormTypes'
export const goRunTemplates: RunTemplate[] = [
  ...['package', 'build', 'test'].map(kind => ({ language: 'go', kind, label: kind === 'package' ? 'Package' : kind === 'build' ? 'Build' : 'Test', group: 'Go', target: '.', fields: [field('target', 'Target package', 'path', '.')] })),
  { language: 'go', kind: 'files', label: 'File list', group: 'Go', fields: [field('files', 'Go files', 'list', 'One file per line')] },
  { language: 'go', kind: 'go-tool', label: 'Go tool', group: 'Go', target: 'generate' },
]
