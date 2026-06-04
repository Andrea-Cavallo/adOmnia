export interface MarkdownFileEntry {
  name: string
  path: string
  relPath: string
  dir: string
  size: number
  modifiedAt: string
}

export interface MarkdownWorkspaceInfo {
  root: string
  name: string
  files: number
}

function getAppBinding() {
  return (window as any)?.go?.main?.App
}

export function hasMarkdownBackend(): boolean {
  return Boolean(getAppBinding()?.ListMarkdownFiles)
}

export async function selectMarkdownFolder(): Promise<string> {
  const app = getAppBinding()
  if (!app?.SelectFolder) throw new Error('Folder picker is not available')
  return await app.SelectFolder('Open Markdown folder')
}

export async function listMarkdownFiles(root: string): Promise<MarkdownFileEntry[]> {
  const app = getAppBinding()
  if (!app?.ListMarkdownFiles) return []
  return await app.ListMarkdownFiles(root)
}

export async function readMarkdownFile(path: string): Promise<string> {
  const app = getAppBinding()
  if (!app?.ReadMarkdownFile) throw new Error('Markdown reader is not available')
  return await app.ReadMarkdownFile(path)
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  const app = getAppBinding()
  if (!app?.WriteMarkdownFile) throw new Error('Markdown writer is not available')
  await app.WriteMarkdownFile(path, content)
}

export async function saveMarkdownFileAs(defaultName: string, content: string): Promise<MarkdownFileEntry> {
  const app = getAppBinding()
  if (!app?.SaveMarkdownFileAs) throw new Error('Markdown save as is not available')
  return await app.SaveMarkdownFileAs(defaultName, content)
}

export async function createMarkdownFile(
  root: string,
  relPath: string,
  content: string,
): Promise<MarkdownFileEntry> {
  const app = getAppBinding()
  if (!app?.CreateMarkdownFile) throw new Error('Markdown creator is not available')
  return await app.CreateMarkdownFile(root, relPath, content)
}

export async function renameMarkdownFile(
  root: string,
  oldRelPath: string,
  newRelPath: string,
): Promise<MarkdownFileEntry> {
  const app = getAppBinding()
  if (!app?.RenameMarkdownFile) throw new Error('Markdown rename is not available')
  return await app.RenameMarkdownFile(root, oldRelPath, newRelPath)
}

export async function deleteMarkdownFile(root: string, relPath: string): Promise<void> {
  const app = getAppBinding()
  if (!app?.DeleteMarkdownFile) throw new Error('Markdown delete is not available')
  await app.DeleteMarkdownFile(root, relPath)
}

export async function writeMarkdownAgentGraph(root: string, content: string): Promise<string> {
  const app = getAppBinding()
  if (!app?.WriteMarkdownAgentGraph) throw new Error('Markdown graph writer is not available')
  return await app.WriteMarkdownAgentGraph(root, content)
}

export async function importMarkdownFolderToWorkspace(sourceRoot: string): Promise<MarkdownWorkspaceInfo> {
  const app = getAppBinding()
  if (!app?.ImportMarkdownFolderToWorkspace) throw new Error('Markdown workspace import is not available')
  return await app.ImportMarkdownFolderToWorkspace(sourceRoot)
}
