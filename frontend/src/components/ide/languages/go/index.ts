import { goRunTemplates } from './runTemplates'
import { GO_LANGUAGE_ID } from '@/lib/code-studio/goLanguage'
import type { IdeLanguageContribution } from '../../languages'

export { GO_LANGUAGE_ID }

export const GO_LANGUAGE: IdeLanguageContribution = {
  id: GO_LANGUAGE_ID,
  name: 'Go',
  icon: 'go',
  runTemplates: goRunTemplates,
  canDebugRun: config => config.kind === 'package' || config.kind === 'build',
  editorLanguages: ['go'],
  languageServer: 'gopls',
  menu: { id: 'go', label: 'Go' },
}
