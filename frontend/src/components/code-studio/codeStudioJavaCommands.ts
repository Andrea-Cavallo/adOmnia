import { getRunSuggestions } from '@/lib/code-studio-api'
import { javaCounterpartPaths, javaGoalSuggestion, javaTargetAtLine } from '@/lib/code-studio/javaCommands'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { usePomStore } from '@/stores/codeStudioPom'
import { studioToast } from '@/stores/codeStudioToast'
import { isPomFile } from '@/lib/code-studio/pomInsights'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { runCodeStudioEditorCommand } from './codeStudioEditorRegistry'
import { openJavaJdkDialog } from './CodeStudioJavaJdk'
import { findJavaTargets, type CodeStudioJavaRunTarget } from './codeStudioJavaTargets'

const GOALS: Partial<Record<CodeStudioCommandId, string[]>> = {
  'java.mvnCompile': ['compile'],
  'java.mvnTest': ['test'],
  'java.mvnPackage': ['package'],
  'java.mvnCleanInstall': ['clean', 'install'],
}
const SPRING_GOALS = [['spring-boot:run'], ['bootRun']]

/** Avvia un goal Maven/Gradle con il wrapper scelto dal backend, nell'unità che contiene il file attivo. */
async function runGoal(sessionId: string, activePath: string, goalSets: string[][]): Promise<void> {
  const suggestions = await getRunSuggestions(sessionId)
  for (const goals of goalSets) {
    const found = javaGoalSuggestion(suggestions, goals, activePath)
    if (!found) continue
    useCodeStudioLspStore.getState().showToolWindow('run')
    const { target, workingDirectory, programArguments } = found.configuration
    await useCodeStudioStore.getState().startRun('command', { target, workingDirectory, programArguments: programArguments ?? [] })
    return
  }
  studioToast('No Maven or Gradle build found for this file (wrapper or mvn/gradle on PATH needed)', 'info')
}

async function openCounterpart(sessionId: string, document: GoIDEEditorDocument): Promise<void> {
  const root = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId)?.project.realPath
  const candidates = javaCounterpartPaths(document.document.relativePath)
  if (!root || candidates.length === 0) return studioToast('Open a Java file under src/main/java or src/test/java', 'info')
  const separator = root.includes('\\') ? '\\' : '/'
  for (const relative of candidates) {
    try {
      await useCodeStudioStore.getState().openDocument(`${root.replace(/[\\/]+$/, '')}${separator}${relative.split('/').join(separator)}`)
      return
    } catch { /* il candidato non esiste: si prova il prossimo */ }
  }
  studioToast('No matching test or source file found', 'info')
}

/** Comandi del menu Java. `runTarget` è il percorso del ▶ del gutter, così menu e gutter fanno la stessa cosa. */
export function runJavaCommand(
  id: CodeStudioCommandId,
  sessionId: string | null,
  document: GoIDEEditorDocument | null,
  line: number,
  runTarget: (target: CodeStudioJavaRunTarget, action: 'run' | 'debug') => void,
): boolean {
  if (!id.startsWith('java.')) return false
  if (!sessionId) return true
  const activePath = document?.document.relativePath ?? ''
  const goals = GOALS[id]
  if (goals) { void runGoal(sessionId, activePath, [goals]); return true }
  switch (id) {
    case 'java.springBootRun': void runGoal(sessionId, activePath, SPRING_GOALS); return true
    case 'java.selectJdk': openJavaJdkDialog(sessionId); return true
    case 'java.optimizeImports': runCodeStudioEditorCommand('code.organizeImports'); return true
    case 'java.generate': runCodeStudioEditorCommand('code.generate'); return true
    case 'java.goToTest': if (document) void openCounterpart(sessionId, document); return true
    case 'java.runMain':
    case 'java.debugMain':
    case 'java.runTest':
    case 'java.debugTest': {
      const kind = id.endsWith('Main') ? 'java-main' : 'java-test'
      const target = document ? javaTargetAtLine(findJavaTargets(activePath, document.buffer), kind, line) : null
      if (!target) studioToast(kind === 'java-main' ? 'No main method in this file' : 'No test method in this file', 'info')
      else runTarget(target, id.startsWith('java.debug') ? 'debug' : 'run')
      return true
    }
    case 'java.checkUpdates':
    case 'java.scanVulnerabilities': {
      if (!document || !isPomFile(activePath)) { studioToast('Open a pom.xml first', 'info'); return true }
      const pom = usePomStore.getState()
      if (id === 'java.checkUpdates') void pom.checkUpdates(document.document.id, sessionId, document.buffer)
      else void pom.scanVulnerabilities(document.document.id, sessionId, document.document.path, activePath)
      return true
    }
  }
  return true
}
