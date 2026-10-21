import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/python`). */
export const PYTHON_LANGUAGE_ID = 'python'

/**
 * Python con basedpyright (installato e avviato dal backend, `lsp.ServerProvider` dell'adapter),
 * run di script e moduli, test pytest strutturati e debug con debugpy. `heavyFeatures` resta spento
 * (inlay hints e Code Vision non sono verificati con basedpyright); i colori semantici sono accesi.
 * Le configurazioni di test pytest si lanciano dal pannello Test, non dalla Run.
 */
export const PYTHON_LANGUAGE: IdeLanguageContribution = {
  id: PYTHON_LANGUAGE_ID,
  name: 'Python',
  icon: 'python',
  runTemplates: [
    { language: 'python', kind: 'script', label: 'Python script', group: 'Python' },
    { language: 'python', kind: 'module', label: 'Python module', group: 'Python' },
  ],
  canDebugRun: config => ['script', 'module'].includes(String(config.kind)),
  editorLanguages: ['python'],
  languageServer: 'basedpyright',
  heavyFeatures: false,
  semanticTokens: true,
  providedServer: true,
  menu: { id: 'python', label: 'Python' },
}
