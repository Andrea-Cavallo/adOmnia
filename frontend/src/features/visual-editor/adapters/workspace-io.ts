import {
  closeGoIDEDocument, listGoIDEDirectory, openGoIDEDocument, readGoIDETextFile, saveGoIDEDocument, subscribeGoIDEEvents,
} from '@/lib/code-studio-api'
import type { GoIDEFilesChanged } from '@/lib/code-studio/codeStudioDiskChanges'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { isJsxFile, type WorkspaceIO } from './file-system'

/** Folders that never hold editable sources, even when the project does not ignore them. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.turbo', '.cache', '.vite'])
const MAX_SOURCE_FILES = 1500
const MAX_DEPTH = 12

export interface WorkspaceIOOptions {
  sessionId: string
  /** Folder of the previewed app, relative to the project ("." for the root). */
  root: string
  /** true: every visual edit is saved at once (the dev server hot-reloads it). false: it stays an unsaved editor change. */
  autoSave: () => boolean
}

const slash = (path: string) => path.replace(/\\/g, '/')

function openDocument(sessionId: string, path: string): GoIDEEditorDocument | undefined {
  return useCodeStudioStore.getState().documents.find((item) => item.document.sessionId === sessionId && slash(item.document.relativePath) === path)
}

async function listSources(sessionId: string, directory: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_DEPTH || found.length >= MAX_SOURCE_FILES) return
  const entries = await listGoIDEDirectory(sessionId, directory, false)
  for (const entry of entries) {
    if (found.length >= MAX_SOURCE_FILES) return
    const path = slash(entry.relativePath)
    if (!entry.directory) {
      if (isJsxFile(path)) found.push(path)
    } else if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one directory at a time: the listing is lazy on the backend
      await listSources(sessionId, path, depth + 1, found)
    }
  }
}

/**
 * The workspace as the Visual Editor sees it, on top of the Code Studio document APIs: paths are
 * confined by the backend, saves are atomic and checked against the disk version, and a file
 * that is open in Monaco is edited through its buffer so the two never diverge.
 */
export function createWorkspaceIO({ sessionId, root, autoSave }: WorkspaceIOOptions): WorkspaceIO {
  const requireActive = () => {
    if (useCodeStudioStore.getState().activeSessionId !== sessionId) throw new Error('The project of this preview is not the active one.')
  }

  const saveOpen = async (documentId: string, path: string) => {
    if (await useCodeStudioStore.getState().saveDocument(documentId)) return
    const failed = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
    throw new Error(failed?.saveError ?? `${path} changed on disk: review it in the editor, then try again.`)
  }

  return {
    list: async () => {
      const found: string[] = []
      await listSources(sessionId, root === '.' ? '' : slash(root), 0, found)
      return found
    },

    read: async (path) => openDocument(sessionId, path)?.buffer ?? readGoIDETextFile(sessionId, path),

    write: async (path, content) => {
      requireActive()
      const store = useCodeStudioStore.getState()
      const open = openDocument(sessionId, path)
      if (open) {
        if (open.buffer !== content) store.updateDocument(open.document.id, content)
        if (autoSave()) await saveOpen(open.document.id, path)
        return
      }
      if (!autoSave()) {
        // Review mode: the change becomes an unsaved editor tab the user can inspect and save.
        const loaded = await store.ensureDocumentLoaded(path)
        if (!loaded) throw new Error(`${path} could not be opened.`)
        if (loaded.buffer !== content) useCodeStudioStore.getState().updateDocument(loaded.document.id, content)
        return
      }
      // Not open in the editor: save through the document API without creating a tab. The disk
      // token of the open call makes the save fail if the file changed in between.
      const opened = await openGoIDEDocument(sessionId, path)
      try {
        if (opened.content !== content) await saveGoIDEDocument(sessionId, opened.document.id, content, opened.diskToken)
      } finally {
        if (!openDocument(sessionId, path)) await closeGoIDEDocument(sessionId, opened.document.id).catch(() => {})
      }
    },

    onChange: (listener) => {
      const buffers = new Map<string, string>()
      const stopStore = useCodeStudioStore.subscribe((state) => {
        for (const item of state.documents) {
          if (item.document.sessionId !== sessionId) continue
          if (buffers.get(item.document.id) === item.buffer) continue
          buffers.set(item.document.id, item.buffer)
          listener(slash(item.document.relativePath))
        }
      })
      const stopEvents = subscribeGoIDEEvents((event) => {
        if (event.type !== 'files.changed' || event.sessionId !== sessionId) return
        for (const change of (event.payload as GoIDEFilesChanged | undefined)?.changes ?? []) listener(slash(change.relativePath))
      })
      return () => {
        stopStore()
        stopEvents()
      }
    },
  }
}
