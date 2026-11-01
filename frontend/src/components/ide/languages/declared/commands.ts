import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'

export type DeclaredLanguageCommandId = 'php.installDebugger' | 'cpp.installDebugger' | 'dotnet.installDebugger'

/** Comandi dei linguaggi dichiarati: installano il debugger in modo esplicito (niente download silenziosi). */
export const DECLARED_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'php.installDebugger', menu: 'tools', label: 'Install PHP Debug Adapter…', requires: { language: 'php' } },
  { id: 'cpp.installDebugger', menu: 'tools', label: 'Install Native Debugger (C/C++, Swift, Zig)…', requires: { language: 'cpp' } },
  { id: 'dotnet.installDebugger', menu: 'tools', label: 'Install .NET Debugger (C#, F#)…', requires: { language: 'csharp' } },
] satisfies ReadonlyArray<CodeStudioCommand>)
