import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'

export type DeclaredLanguageCommandId = 'php.installDebugger' | 'cpp.installDebugger'

/** Comandi dei linguaggi dichiarati: installano il debugger in modo esplicito (niente download silenziosi). */
export const DECLARED_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'php.installDebugger', menu: 'tools', label: 'Install PHP Debug Adapter…', requires: { language: 'php' } },
  { id: 'cpp.installDebugger', menu: 'tools', label: 'Install C/C++ Debugger…', requires: { language: 'cpp' } },
] satisfies ReadonlyArray<CodeStudioCommand>)
