import { field, type RunTemplate } from '@/lib/code-studio/runFormTypes'
export const webRunTemplates: RunTemplate[] = [
  { language: 'typescript', kind: 'command', label: 'Package script / Node', group: 'Web', target: 'npm', fields: [field('target', 'Executable', 'path', 'npm · pnpm · yarn · node')] },
]
