import * as GitSync from '@/wailsjs/go/main/GitSync'

export interface ChangedFile {
  status: string
  path: string
  oldPath: string
}

export async function compareRefs(
  repoPath: string,
  refA: string,
  refB: string,
): Promise<ChangedFile[]> {
  const raw = await GitSync.CompareRefs(repoPath, refA, refB)
  return JSON.parse(raw) as ChangedFile[]
}

export async function getFileDiff(
  repoPath: string,
  refA: string,
  refB: string,
  filePath: string,
): Promise<string> {
  return GitSync.GetFileDiff(repoPath, refA, refB, filePath)
}
