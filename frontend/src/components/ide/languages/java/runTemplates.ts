import type { RunTemplate } from '@/lib/code-studio/runFormTypes'
export const javaRunTemplates: RunTemplate[] = [
  { language: 'java', kind: 'main', label: 'Main class', group: 'Java' },
  { language: 'java', kind: 'attach', run: false, label: 'Remote JVM', group: 'Java' },
]
