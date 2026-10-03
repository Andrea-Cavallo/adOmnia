import { GO_LANGUAGE_ID } from '@/lib/goide/goLanguage'
import type { IdeLanguageContribution } from '../../languages'

export { GO_LANGUAGE_ID }

export const GO_LANGUAGE: IdeLanguageContribution = {
  id: GO_LANGUAGE_ID,
  name: 'Go',
  icon: 'go',
  editorLanguages: ['go'],
  menu: { id: 'go', label: 'Go' },
}
