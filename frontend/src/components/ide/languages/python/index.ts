import type { IdeLanguageContribution } from '../../languages'

/** Initial Python adapter: explicit interpreter and Run, without LSP/test/debug yet. */
export const PYTHON_LANGUAGE: IdeLanguageContribution = {
  id: 'python',
  name: 'Python',
  icon: 'python',
  editorLanguages: [],
  heavyFeatures: false,
  canDebugRun: () => false,
  runTemplates: [
    { language: 'python', kind: 'script', label: 'Python script', group: 'Python' },
    { language: 'python', kind: 'module', label: 'Python module', group: 'Python' },
  ],
}
