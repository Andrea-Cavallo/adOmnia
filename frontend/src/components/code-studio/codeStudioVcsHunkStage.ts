import * as GitSync from '@/wailsjs/go/main/GitSync'
import { buildPatch, hunksOverlapping, parseFileDiff, type HunkRange } from '@/lib/git/hunks'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { gitPathFromAbsolute } from './codeStudioGitPaths'

export type CodeStudioHunkStageMode = 'stage' | 'unstage'

/**
 * Porta sull'index i blocchi di un file che toccano le righe indicate: `stage` prende dal
 * worktree (git diff senza --cached, applicato in avanti), `unstage` dall'index (--cached,
 * applicato al contrario). Il file deve essere salvato: `git apply --cached` lavora su disco.
 * Restituisce quanti blocchi sono stati applicati; 0 significa che non c'era nulla da portare.
 */
export async function applyCodeStudioHunkToIndex(sessionId: string, absolutePath: string, target: HunkRange, mode: CodeStudioHunkStageMode): Promise<number> {
  const repoRoot = useCodeStudioVCSStore.getState().status[sessionId]?.repoRoot
  if (!repoRoot) throw new Error('this file is not inside a Git repository')
  const reverse = mode === 'unstage'
  const path = gitPathFromAbsolute(repoRoot, absolutePath)
  const parsed = parseFileDiff(await GitSync.FileDiff(repoRoot, path, reverse))
  const chosen = hunksOverlapping(parsed.hunks, target)
  const patch = buildPatch(parsed.fileHeader, chosen)
  if (!patch) return 0
  await GitSync.ApplyHunk(repoRoot, patch, reverse)
  return chosen.length
}
