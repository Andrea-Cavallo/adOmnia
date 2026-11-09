import { decompileJavaJar } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { studioToast } from '@/stores/codeStudioToast'
import { entryFileOf, openDependencySourceFile } from './codeStudioDependencySource'
import { runJavaToolCommand } from './codeStudioJavaToolCommands'

/** Decompiles a .jar of the project with Vineflower and opens its first source, read-only. */
export async function decompileJarInTree(sessionId: string, jar: string): Promise<void> {
  studioToast(`Decompiling ${jar.split('/').pop() ?? jar}…`, 'info')
  try {
    const source = await decompileJavaJar(sessionId, jar)
    if (!source.files.length || !openDependencySourceFile(source, sessionId, entryFileOf(source))) {
      studioToast('The decompiler found no class to show in this jar.', 'info')
      return
    }
    useCodeStudioStore.getState().updateLayout({ projectOpen: true })
    studioToast(`${source.files.length} decompiled files, read-only.`, 'success')
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (/not installed/i.test(message)) {
      runJavaToolCommand('java.installDecompiler', sessionId)
      return
    }
    studioToast(message, 'info')
  }
}
