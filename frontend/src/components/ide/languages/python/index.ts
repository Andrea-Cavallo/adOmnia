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
  fileIcon: name => /^(pyproject\.toml|poetry\.lock|uv\.lock|requirements([.-].+)?\.txt|pipfile(\.lock)?)$/.test(name) || /\.(py|pyi|pyw)$/.test(name) ? { kind: 'brand', slug: 'python' } : undefined,
  runTemplates: [
    { language: 'python', kind: 'script', label: 'Python script', group: 'Python' },
    { language: 'python', kind: 'module', label: 'Python module', group: 'Python' },
  ],
  canDebugRun: config => ['script', 'module'].includes(String(config.kind)),
  editorLanguages: ['python'],
  languageServer: 'basedpyright',
  // debugpy dichiara questi due filtri DAP; i nomi vengono inviati a setExceptionBreakpoints.
  exceptionFilters: [
    { filter: 'raised', label: 'Raised Exceptions', description: 'Stop when an exception is raised, even when it is handled.' },
    { filter: 'uncaught', label: 'Uncaught Exceptions' },
  ],
  heavyFeatures: false,
  semanticTokens: true,
  providedServer: true,
  menu: { id: 'python', label: 'Python' },
}
