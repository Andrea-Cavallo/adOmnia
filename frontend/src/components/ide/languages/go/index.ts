import { goRunTemplates } from './runTemplates'
import { GO_LANGUAGE_ID } from '@/lib/code-studio/goLanguage'
import type { IdeLanguageContribution } from '../../languages'

export { GO_LANGUAGE_ID }

export const GO_LANGUAGE: IdeLanguageContribution = {
  id: GO_LANGUAGE_ID,
  name: 'Go',
  icon: 'go',
  fileIcon: name => name.endsWith('.go') ? { kind: 'gopher', test: name.endsWith('_test.go') }
    : /^(go\.(mod|work|sum)|go\.work\.sum)$/.test(name) ? { kind: 'goModule', generated: name.endsWith('.sum') } : undefined,
  runTemplates: goRunTemplates,
  canDebugRun: config => config.kind === 'package' || config.kind === 'build',
  editorLanguages: ['go'],
  languageServer: 'gopls',
  implementationMarkers: true,
  menu: { id: 'go', label: 'Go' },
}
