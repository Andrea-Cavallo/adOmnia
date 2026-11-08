import { installJavaDecompiler, previewJavaDecompilerInstall } from '@/lib/code-studio-api'
import { installTestRunner, previewTestRunnerInstall } from '@/lib/code-studio-debug-api'
import { runVisibleInstall, type VisibleInstall } from './codeStudioVisibleInstall'
import type { CodeStudioCommandId } from './codeStudioCommands'

/** The Java tools installed on request, each with its exact command confirmed and its output in the Run console. */
const JAVA_TOOLS = new Map<CodeStudioCommandId, (sessionId: string) => VisibleInstall>([
  ['java.installTestLauncher', (sessionId) => ({
    preview: () => previewTestRunnerInstall(sessionId, 'java'),
    install: () => installTestRunner(sessionId, 'java'),
    confirmLabel: 'Install JUnit launcher',
    done: 'JUnit Console Launcher installed. Run the tests of Ant and Eclipse projects from the Test panel.',
  })],
  ['java.installDecompiler', (sessionId) => ({
    preview: () => previewJavaDecompilerInstall(sessionId),
    install: () => installJavaDecompiler(sessionId),
    confirmLabel: 'Install decompiler',
    done: 'Java decompiler installed. Right-click a .jar and choose Decompile; libraries without sources open decompiled.',
  })],
])

/** Java tool install commands; false when the command belongs to another module. */
export function runJavaToolCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  const tool = JAVA_TOOLS.get(id)
  if (!tool) return false
  if (sessionId) void runVisibleInstall(sessionId, tool(sessionId))
  return true
}
