import { createGoIDEDirectory, createGoIDEFiles, deleteGoIDEPath, duplicateGoIDEPath, moveGoIDEPath, revealGoIDEPath } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { javaNameError, javaPackageOfDirectory, javaSourceTemplate, type JavaEntryKind } from '@/lib/code-studio/javaCommands'

export type CodeStudioJavaEntryAction = 'newJavaClass' | 'newJavaInterface' | 'newJavaEnum' | 'newJavaRecord' | 'newJavaPackage'

export type CodeStudioPathAction = 'newGoFile' | 'newMarkdownFile' | 'newTextFile' | 'newFile' | 'newFolder' | 'rename' | 'duplicate' | CodeStudioJavaEntryAction

export type GitignoreTemplate = 'common' | 'go' | 'node' | 'python' | 'java'

const GITIGNORE_COMMON = `# OS and IDE\n.DS_Store\nThumbs.db\n.idea/\n.vscode/\n*.swp\n\n# Local configuration and logs\n.env\n.env.local\n*.log\n*.tmp\n`

export const GITIGNORE_TEMPLATES: Record<GitignoreTemplate, string> = {
  common: GITIGNORE_COMMON,
  go: `${GITIGNORE_COMMON}\n# Go binaries, tests, coverage and profiles\n/bin/\n/dist/\n*.exe\n*.test\n*.out\n*.pprof\ncoverage/\nvendor/\n`,
  node: `${GITIGNORE_COMMON}\n# Node.js\nnode_modules/\ndist/\nbuild/\ncoverage/\n.npm/\n.pnpm-store/\n*.tsbuildinfo\n`,
  python: `${GITIGNORE_COMMON}\n# Python\n__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.pytest_cache/\n.mypy_cache/\n.coverage\nhtmlcov/\ndist/\nbuild/\n*.egg-info/\n`,
  java: `${GITIGNORE_COMMON}\n# Java / Kotlin / Gradle / Maven\n*.class\n.gradle/\ntarget/\nout/\nbuild/\n*.jar\n*.war\n`,
}

export function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? '' : relativePath.slice(0, index)
}

export function baseName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1)
}

/** Percorso assoluto con il separatore della radice (\\ su Windows). */
export function absolutePath(rootPath: string, relativePath: string): string {
  if (!relativePath) return rootPath
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath.split('/').join(separator)}`
}

export function joinRelative(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name
}

/** Nome del package per un nuovo file .go: la cartella ripulita, main nella radice. */
// ponytail: non legge i file vicini; se il package differisce dalla cartella lo si corregge a mano (gopls lo segnala).
export function packageNameForDirectory(directory: string): string {
  const cleaned = baseName(directory).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!cleaned) return 'main'
  return /^[0-9]/.test(cleaned) ? `pkg${cleaned}` : cleaned
}

/** Copia suggerita per Duplicate: main.go → main_copy.go, cartella → cartella_copy. */
export function duplicateName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}_copy${name.slice(dot)}` : `${name}_copy`
}

function openUnder(sessionId: string, relativePath: string) {
  return useCodeStudioStore.getState().documents.filter((item) => item.document.sessionId === sessionId
    && (item.document.relativePath === relativePath || item.document.relativePath.startsWith(`${relativePath}/`)))
}

/** Le tab aperte sotto il percorso vengono chiuse; con modifiche non salvate l'operazione si ferma. */
async function closeDocumentsUnder(sessionId: string, relativePath: string): Promise<boolean> {
  const open = openUnder(sessionId, relativePath)
  const dirty = open.filter((item) => item.dirty)
  if (dirty.length > 0) {
    useCodeStudioStore.setState({ error: `Save or discard the changes in ${dirty.map((item) => item.document.relativePath).join(', ')} first.` })
    return false
  }
  // oxlint-disable-next-line eslint/no-await-in-loop -- tabs close one at a time: each close updates the shared tab list and active document
  for (const item of open) await useCodeStudioStore.getState().closeDocument(item.document.id)
  return true
}

async function refresh(...directories: string[]): Promise<void> {
  const load = useCodeStudioStore.getState().loadDirectory
  await Promise.all([...new Set(directories)].map((directory) => load(directory)))
}

async function guarded(action: () => Promise<void>): Promise<boolean> {
  try {
    await action()
    return true
  } catch (error) {
    useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

const JAVA_ENTRY_KIND: Record<Exclude<CodeStudioJavaEntryAction, 'newJavaPackage'>, JavaEntryKind> = {
  newJavaClass: 'class', newJavaInterface: 'interface', newJavaEnum: 'enum', newJavaRecord: 'record',
}

export function isJavaEntryAction(action: CodeStudioPathAction): action is CodeStudioJavaEntryAction {
  return action in JAVA_ENTRY_KIND || action === 'newJavaPackage'
}

/** Errore di validazione del nome per le azioni Java, vuoto per ogni altra azione. */
export function javaEntryNameError(action: CodeStudioPathAction, name: string): string {
  if (!isJavaEntryAction(action)) return ''
  return javaNameError(action === 'newJavaPackage' ? 'package' : JAVA_ENTRY_KIND[action], name)
}

/** Crea una classe/interfaccia/enum/record con il package della cartella, o un package (cartelle annidate). */
async function createJavaEntry(sessionId: string, action: CodeStudioJavaEntryAction, target: string, name: string): Promise<boolean> {
  const store = useCodeStudioStore.getState()
  if (javaEntryNameError(action, name)) return false
  if (action === 'newJavaPackage') {
    const path = joinRelative(target, name.trim().split('.').join('/'))
    const ok = await guarded(() => createGoIDEDirectory(sessionId, path))
    if (ok) await refresh(target)
    return ok
  }
  const kind = JAVA_ENTRY_KIND[action]
  const className = name.trim()
  const path = joinRelative(target, `${className}.java`)
  const ok = await guarded(() => createGoIDEFiles(sessionId, [{ relativePath: path, content: javaSourceTemplate(kind, className, javaPackageOfDirectory(target)) }]))
  if (ok) { await refresh(target); await store.openDocument(path) }
  return ok
}

/** Esegue l'azione del dialog: target è la cartella (new*) o l'elemento (rename/duplicate). */
export async function runPathAction(sessionId: string, action: CodeStudioPathAction, target: string, name: string): Promise<boolean> {
  const trimmed = name.trim().replace(/\\/g, '/')
  if (!trimmed) return false
  const store = useCodeStudioStore.getState()
  if (isJavaEntryAction(action)) return createJavaEntry(sessionId, action, target, trimmed)
  switch (action) {
    case 'newGoFile':
    case 'newMarkdownFile':
    case 'newTextFile':
    case 'newFile': {
      const extension = action === 'newGoFile' ? '.go' : action === 'newMarkdownFile' ? '.md' : action === 'newTextFile' ? '.txt' : ''
      const file = extension && !trimmed.toLowerCase().endsWith(extension) ? `${trimmed}${extension}` : trimmed
      const path = joinRelative(target, file)
      const content = path.endsWith('.go') ? `package ${packageNameForDirectory(parentOf(path))}\n` : ''
      const ok = await guarded(() => createGoIDEFiles(sessionId, [{ relativePath: path, content }]))
      if (ok) { await refresh(target, parentOf(path)); await store.openDocument(path) }
      return ok
    }
    case 'newFolder': {
      const path = joinRelative(target, trimmed)
      const ok = await guarded(() => createGoIDEDirectory(sessionId, path))
      if (ok) await refresh(target)
      return ok
    }
    case 'rename': {
      const destination = trimmed.includes('/') ? trimmed : joinRelative(parentOf(target), trimmed)
      if (destination === target) return true
      const wasOpen = openUnder(sessionId, target).some((item) => item.document.relativePath === target)
      if (!await closeDocumentsUnder(sessionId, target)) return false
      const ok = await guarded(() => moveGoIDEPath(sessionId, target, destination))
      if (ok) {
        await refresh(parentOf(target), parentOf(destination))
        if (wasOpen) await store.openDocument(destination)
      }
      return ok
    }
    case 'duplicate': {
      const destination = joinRelative(parentOf(target), trimmed)
      const ok = await guarded(() => duplicateGoIDEPath(sessionId, target, destination))
      if (ok) await refresh(parentOf(target))
      return ok
    }
  }
}

export async function createGitignore(sessionId: string, target: string, template: GitignoreTemplate): Promise<boolean> {
  const relativePath = joinRelative(target, '.gitignore')
  const ok = await guarded(() => createGoIDEFiles(sessionId, [{ relativePath, content: GITIGNORE_TEMPLATES[template] }]))
  if (ok) {
    await refresh(target)
    await useCodeStudioStore.getState().openDocument(relativePath)
  }
  return ok
}

export async function deletePathWithConfirm(sessionId: string, relativePath: string, directory: boolean): Promise<void> {
  const ok = await confirm({
    title: `Delete ${directory ? 'folder' : 'file'}?`,
    message: directory ? 'The folder and everything inside it will be deleted from disk.' : 'The file will be deleted from disk.',
    details: [{ label: 'Path', value: relativePath, mono: true }, { label: 'Recovery', value: 'Text files are kept in Local History' }],
    confirmLabel: 'Delete',
    variant: 'danger',
  })
  if (!ok || !await closeDocumentsUnder(sessionId, relativePath)) return
  if (await guarded(() => deleteGoIDEPath(sessionId, relativePath))) await refresh(parentOf(relativePath))
}

export function revealPath(sessionId: string, relativePath: string): void {
  void guarded(() => revealGoIDEPath(sessionId, relativePath))
}
