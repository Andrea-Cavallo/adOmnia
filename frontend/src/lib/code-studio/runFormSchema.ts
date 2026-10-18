import { IDE_LANGUAGES } from '@/components/ide/languages'
import { field, templateKey, type RunTemplate } from './runFormTypes'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'

export const runTemplates: RunTemplate[] = [
  { language: '', kind: 'command', label: 'Command / executable', group: 'Generic', fields: [field('target', 'Executable', 'path', 'Program on PATH or script in the project')] },
  { language: '', kind: 'binary', label: 'Compiled binary', group: 'Generic', fields: [field('binaryPath', 'Binary path', 'path')] },
  { language: '', kind: 'make', label: 'Make target', group: 'Generic', target: 'Makefile', fields: [field('target', 'Makefile', 'path')] },
  ...['docker-build', 'docker-run', 'docker-compose'].map(kind => ({ language: '', kind, label: kind === 'docker-build' ? 'Docker build' : kind === 'docker-run' ? 'Docker build & run' : 'Docker Compose', group: 'Generic', target: kind === 'docker-compose' ? 'docker-compose.yml' : 'Dockerfile', fields: [field('target', kind === 'docker-compose' ? 'Compose file' : 'Dockerfile', 'path')] })),
  { language: '', kind: 'compound', label: 'Compound', group: 'Generic' },
  ...IDE_LANGUAGES.flatMap(language => language.runTemplates ?? []),
]
export function templateFor(draft: GoIDERunConfiguration): RunTemplate {
  return runTemplates.find(item => templateKey(item) === `${draft.language ?? ''}:${draft.kind}`)
    ?? runTemplates.find(item => item.kind === draft.kind)
    ?? { language: draft.language ?? '', kind: draft.kind, label: draft.kind, group: draft.language || 'Generic', fields: [field('target', 'Target')] }
}
export function commonRunFields(draft: GoIDERunConfiguration) {
  const template = templateFor(draft)
  return [...(template.fields ?? []), field('workingDirectory', 'Working directory', 'path', 'Project root'),
    ...(draft.kind === 'docker-build' || draft.kind === 'compound' ? [] : [field('programArguments', 'Arguments', 'list', 'One argument per line; spaces inside an argument are preserved')])]
}
