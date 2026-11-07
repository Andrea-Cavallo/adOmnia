import { installDebugger, installTestRunner, previewDebuggerInstall, previewTestRunnerInstall } from '@/lib/code-studio-debug-api'
import { runVisibleInstall } from './codeStudioVisibleInstall'
import type { CodeStudioCommandId } from './codeStudioCommands'

type DeclaredDebugger = { language: string; confirmLabel: string; done: string }

const DEBUGGERS = new Map<CodeStudioCommandId, DeclaredDebugger>([
  ['php.installDebugger', { language: 'php', confirmLabel: 'Install PHP debug adapter', done: 'PHP debug adapter installed. Debug is now available.' }],
  ['cpp.installDebugger', { language: 'cpp', confirmLabel: 'Install native debugger', done: 'Native debugger installed. Debug is now available.' }],
  ['dotnet.installDebugger', { language: 'csharp', confirmLabel: 'Install .NET debugger', done: '.NET debugger installed. Debug is now available.' }],
])

/** Installa il debugger di un linguaggio dichiarato: comando esatto nella conferma, output in console. */
function installDeclaredDebugger(sessionId: string, target: DeclaredDebugger): Promise<void> {
  return runVisibleInstall(sessionId, {
    preview: () => previewDebuggerInstall(sessionId, target.language),
    install: () => installDebugger(sessionId, target.language),
    confirmLabel: target.confirmLabel,
    done: target.done,
  })
}

/** Comandi dei linguaggi dichiarati. Restituisce false se il comando non appartiene a questo modulo. */
export function runDeclaredDebuggerCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (id === 'java.installTestLauncher') {
    if (sessionId) void runVisibleInstall(sessionId, {
      preview: () => previewTestRunnerInstall(sessionId, 'java'),
      install: () => installTestRunner(sessionId, 'java'),
      confirmLabel: 'Install JUnit launcher',
      done: 'JUnit Console Launcher installed. Run the tests of Ant and Eclipse projects from the Test panel.',
    })
    return true
  }
  const target = DEBUGGERS.get(id)
  if (!target) return false
  if (sessionId) void installDeclaredDebugger(sessionId, target)
  return true
}
