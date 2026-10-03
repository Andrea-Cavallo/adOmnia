/** Payload dell'evento `files.changed` (goide.FilesChanged). */
export interface GoIDEDiskChange {
  path: string
  relativePath: string
  /** 1 creato, 2 modificato, 3 eliminato (come workspace/didChangeWatchedFiles). */
  kind: 1 | 2 | 3
}

export interface GoIDEFilesChanged {
  changes: GoIDEDiskChange[]
  overflow: boolean
  limited: boolean
}

const DELETED = 3
const MODIFIED = 2

function parentOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? '' : relativePath.slice(0, slash)
}

/** Documenti aperti da ricontrollare: quelli toccati, o tutti in caso di overflow. */
export function documentsToCheck<T extends { relativePath: string }>(documents: T[], batch: GoIDEFilesChanged): T[] {
  if (batch.overflow) return documents
  const touched = new Set(batch.changes.map((change) => change.relativePath))
  return documents.filter((document) => touched.has(document.relativePath))
}

/** Cartelle già caricate nell'albero da rileggere: solo creazioni ed eliminazioni cambiano un elenco. */
export function directoriesToRefresh(loaded: string[], batch: GoIDEFilesChanged): string[] {
  if (batch.overflow) return loaded
  const parents = new Set(batch.changes.filter((change) => change.kind !== MODIFIED).map((change) => parentOf(change.relativePath)))
  return loaded.filter((directory) => parents.has(directory))
}

/** Vero se un documento aperto è stato eliminato su disco. */
export function wasDeleted(relativePath: string, batch: GoIDEFilesChanged): boolean {
  return batch.changes.some((change) => change.relativePath === relativePath && change.kind === DELETED)
}
