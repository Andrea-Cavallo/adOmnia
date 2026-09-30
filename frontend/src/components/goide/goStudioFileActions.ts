import { createGoIDEDirectory, createGoIDEFiles, deleteGoIDEPath, duplicateGoIDEPath, moveGoIDEPath, revealGoIDEPath } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'

export type GoStudioPathAction = 'newGoFile' | 'newFile' | 'newFolder' | 'rename' | 'duplicate'

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
  return useGoIDEStore.getState().documents.filter((item) => item.document.sessionId === sessionId
    && (item.document.relativePath === relativePath || item.document.relativePath.startsWith(`${relativePath}/`)))
}

/** Le tab aperte sotto il percorso vengono chiuse; con modifiche non salvate l'operazione si ferma. */
async function closeDocumentsUnder(sessionId: string, relativePath: string): Promise<boolean> {
  const open = openUnder(sessionId, relativePath)
  const dirty = open.filter((item) => item.dirty)
  if (dirty.length > 0) {
    useGoIDEStore.setState({ error: `Save or discard the changes in ${dirty.map((item) => item.document.relativePath).join(', ')} first.` })
    return false
  }
  for (const item of open) await useGoIDEStore.getState().closeDocument(item.document.id)
  return true
}

async function refresh(...directories: string[]): Promise<void> {
  const load = useGoIDEStore.getState().loadDirectory
  await Promise.all([...new Set(directories)].map((directory) => load(directory)))
}

async function guarded(action: () => Promise<void>): Promise<boolean> {
  try {
    await action()
    return true
  } catch (error) {
    useGoIDEStore.setState({ error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/** Esegue l'azione del dialog: target è la cartella (new*) o l'elemento (rename/duplicate). */
export async function runPathAction(sessionId: string, action: GoStudioPathAction, target: string, name: string): Promise<boolean> {
  const trimmed = name.trim().replace(/\\/g, '/')
  if (!trimmed) return false
  const store = useGoIDEStore.getState()
  switch (action) {
    case 'newGoFile':
    case 'newFile': {
      const file = action === 'newGoFile' && !trimmed.endsWith('.go') ? `${trimmed}.go` : trimmed
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
