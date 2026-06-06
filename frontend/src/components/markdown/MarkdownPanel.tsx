import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { FileText, Search, Upload } from 'lucide-react'
import {
  createMarkdownFile,
  deleteMarkdownFile,
  hasMarkdownBackend,
  importMarkdownFolderToWorkspace,
  listMarkdownFiles,
  readMarkdownFile,
  renameMarkdownFile,
  saveMarkdownFileAs,
  selectMarkdownFolder,
  writeMarkdownAgentGraph,
  writeMarkdownFile,
  type MarkdownFileEntry,
} from '@/lib/markdown-api'
import { BacklinksPanel } from '@/components/markdown/BacklinksPanel'
import { MarkdownEditor } from '@/components/markdown/MarkdownEditor'
import { MarkdownFileTree } from '@/components/markdown/MarkdownFileTree'
import { MarkdownGraphView } from '@/components/markdown/MarkdownGraphView'
import { MarkdownOutline } from '@/components/markdown/MarkdownOutline'
import { MarkdownPreview } from '@/components/markdown/MarkdownPreview'
import { MarkdownToolbar } from '@/components/markdown/MarkdownToolbar'
import { TemplatePickerModal } from '@/components/markdown/TemplatePickerModal'
import {
  EMPTY_FOLDER_NOTE,
  MARKDOWN_UI_STATE_KEY,
  RECENT_MARKDOWN_ROOT_KEY,
  buildAgentGraph,
  buildFileLookup,
  buildGraphNodes,
  buildMarkdownTree,
  extractHeadings,
  extractMarkdownEdges,
  extractTags,
  noteKey,
  renderMarkdown,
  resolveMarkdownTarget,
  welcomeNote,
} from '@/lib/markdownDoc'

interface WebkitFileEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
  file: (callback: (file: File) => void) => void
  createReader?: () => {
    readEntries: (callback: (entries: WebkitFileEntry[]) => void) => void
  }
}

export function MarkdownPanel() {
  const [content, setContent] = useState(welcomeNote)
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')
  const [root, setRoot] = useState('')
  const [files, setFiles] = useState<MarkdownFileEntry[]>([])
  const [activeFile, setActiveFile] = useState<MarkdownFileEntry | null>(null)
  const [contentsByPath, setContentsByPath] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [folderFilter, setFolderFilter] = useState('')
  const [newNoteName, setNewNoteName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [renamingPath, setRenamingPath] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['']))
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')
  const [graphScale, setGraphScale] = useState(1)
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 })
  const [graphPositions, setGraphPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [showUnresolved, setShowUnresolved] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)
  const [agentGraphPath, setAgentGraphPath] = useState('')
  const [graphOpen, setGraphOpen] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const syncLock = useRef(false)

  const html = useMemo(() => renderMarkdown(content, activeFile?.path), [activeFile?.path, content])
  const effectiveContentsByPath = useMemo(() => {
    if (!activeFile) return contentsByPath
    return { ...contentsByPath, [activeFile.path]: content }
  }, [activeFile, content, contentsByPath])
  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? files.filter((file) => file.relPath.toLowerCase().includes(q) || (effectiveContentsByPath[file.path] || '').toLowerCase().includes(q))
      : files
  }, [effectiveContentsByPath, files, query])
  const tree = useMemo(() => buildMarkdownTree(filteredFiles), [filteredFiles])
  const folderOptions = useMemo(() => {
    return Array.from(new Set(files.map((file) => file.dir).filter((dir) => dir && dir !== '.'))).sort((a, b) => a.localeCompare(b))
  }, [files])
  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return []
    return files.flatMap((file) => {
      const contentText = effectiveContentsByPath[file.path] || ''
      const lines = contentText.split('\n')
      const matches = lines.flatMap((line, index) => {
        const pathHit = file.relPath.toLowerCase().includes(q)
        const lineHit = line.toLowerCase().includes(q)
        if (!pathHit && !lineHit) return []
        return [{
          file,
          line: index + 1,
          snippet: line.trim() || file.relPath,
        }]
      })
      return matches.slice(0, 8)
    }).slice(0, 80)
  }, [effectiveContentsByPath, files, globalSearch])
  const lookup = useMemo(() => buildFileLookup(files), [files])
  const edges = useMemo(
    () => files.flatMap((file) => extractMarkdownEdges(file, effectiveContentsByPath[file.path] || '', lookup)),
    [effectiveContentsByPath, files, lookup],
  )
  const baseGraphNodes = useMemo(() => buildGraphNodes(files, edges, activeFile), [activeFile, edges, files])
  const visibleGraphIds = useMemo(() => {
    const connected = new Set<string>()
    edges.forEach((edge) => {
      connected.add(edge.from)
      connected.add(edge.to)
    })
    return new Set(baseGraphNodes
      .filter((node) => showUnresolved || !node.unresolved)
      .filter((node) => !folderFilter || node.file?.dir === folderFilter || node.file?.relPath.startsWith(`${folderFilter}/`))
      .filter((node) => showOrphans || connected.has(node.id) || activeFile?.relPath === node.id)
      .map((node) => node.id))
  }, [activeFile, baseGraphNodes, edges, folderFilter, showOrphans, showUnresolved])
  const graphNodes = useMemo(() => {
    return baseGraphNodes
      .filter((node) => visibleGraphIds.has(node.id))
      .map((node) => ({ ...node, ...(graphPositions[node.id] || {}) }))
  }, [baseGraphNodes, graphPositions, visibleGraphIds])
  const unresolvedCount = useMemo(() => new Set(edges.filter((edge) => !edge.resolved).map((edge) => edge.to)).size, [edges])
  const visibleEdges = useMemo(() => {
    return edges.filter((edge) => visibleGraphIds.has(edge.from) && visibleGraphIds.has(edge.to))
  }, [edges, visibleGraphIds])
  const backlinks = useMemo(() => {
    if (!activeFile) return []
    return edges.filter((edge) => edge.resolved && noteKey(edge.to) === noteKey(activeFile.relPath))
  }, [activeFile, edges])
  const headings = useMemo(() => extractHeadings(content), [content])
  const tags = useMemo(() => extractTags(content), [content])

  const onEditorScroll = useCallback(() => {
    if (syncLock.current || !editorRef.current || !previewRef.current) return
    const ed = editorRef.current
    const pr = previewRef.current
    const pct = ed.scrollTop / Math.max(1, ed.scrollHeight - ed.clientHeight)
    syncLock.current = true
    pr.scrollTop = pct * (pr.scrollHeight - pr.clientHeight)
    requestAnimationFrame(() => { syncLock.current = false })
  }, [])

  const onPreviewScroll = useCallback(() => {
    if (syncLock.current || !editorRef.current || !previewRef.current) return
    const ed = editorRef.current
    const pr = previewRef.current
    const pct = pr.scrollTop / Math.max(1, pr.scrollHeight - pr.clientHeight)
    syncLock.current = true
    ed.scrollTop = pct * (ed.scrollHeight - ed.clientHeight)
    requestAnimationFrame(() => { syncLock.current = false })
  }, [])

  const loadFolderIndex = useCallback(async (folderPath: string) => {
    const nextFiles = await listMarkdownFiles(folderPath)
    const pairs = await Promise.all(nextFiles.map(async (file) => {
      try {
        return [file.path, await readMarkdownFile(file.path)] as const
      } catch {
        return [file.path, ''] as const
      }
    }))
    setFiles(nextFiles)
    setContentsByPath(Object.fromEntries(pairs))
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      next.add('')
      nextFiles.forEach((file) => {
        const parts = file.relPath.split('/').slice(0, -1)
        parts.forEach((_, index) => next.add(parts.slice(0, index + 1).join('/')))
      })
      return next
    })
    return nextFiles
  }, [])

  const openFile = useCallback(async (file: MarkdownFileEntry, force = false) => {
    if (!force && dirty && activeFile && !window.confirm('This note has unsaved changes. Open another note anyway?')) return
    setError('')
    try {
      const text = contentsByPath[file.path] ?? await readMarkdownFile(file.path)
      setActiveFile(file)
      setContent(text)
      setDirty(false)
      setStatus(`Opened ${file.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Markdown file')
    }
  }, [activeFile, contentsByPath, dirty])

  const openFolder = useCallback(async () => {
    setError('')
    try {
      const folderPath = await selectMarkdownFolder()
      if (!folderPath) return
      const nextFiles = await loadFolderIndex(folderPath)
      setRoot(folderPath)
      window.localStorage.setItem(RECENT_MARKDOWN_ROOT_KEY, folderPath)
      setStatus(`${nextFiles.length} markdown files`)
      if (nextFiles[0]) {
        setActiveFile(nextFiles[0])
        setContent(await readMarkdownFile(nextFiles[0].path))
        setDirty(false)
      } else {
        setActiveFile(null)
        setContent(EMPTY_FOLDER_NOTE)
        setDirty(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Markdown folder')
    }
  }, [loadFolderIndex])

  const openFolderPath = useCallback(async (folderPath: string) => {
    const nextFiles = await loadFolderIndex(folderPath)
    setRoot(folderPath)
    window.localStorage.setItem(RECENT_MARKDOWN_ROOT_KEY, folderPath)
    setStatus(`${nextFiles.length} markdown files`)
    if (nextFiles[0]) {
      setActiveFile(nextFiles[0])
      setContent(await readMarkdownFile(nextFiles[0].path))
      setDirty(false)
    } else {
      setActiveFile(null)
      setContent('# Empty Markdown Folder\n\nCreate a new note to start.')
      setDirty(false)
    }
  }, [loadFolderIndex])

  const importCopyToWorkspace = useCallback(async () => {
    setError('')
    try {
      const source = await selectMarkdownFolder()
      if (!source) return
      const imported = await importMarkdownFolderToWorkspace(source)
      await openFolderPath(imported.root)
      setStatus(`Imported ${imported.files} notes into adOmnia workspace`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import Markdown folder')
    }
  }, [openFolderPath])

  const saveActive = useCallback(async () => {
    if (!activeFile) {
      setError('Create or open a Markdown note before saving.')
      return
    }
    setError('')
    try {
      await writeMarkdownFile(activeFile.path, content)
      setContentsByPath((prev) => ({ ...prev, [activeFile.path]: content }))
      if (root) {
        const nextFiles = await listMarkdownFiles(root)
        setFiles(nextFiles)
        const refreshed = nextFiles.find((file) => file.path === activeFile.path)
        if (refreshed) setActiveFile(refreshed)
      }
      setDirty(false)
      setStatus(`Saved ${activeFile.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Markdown file')
    }
  }, [activeFile, content, root])

  const saveAs = useCallback(async () => {
    setError('')
    try {
      const defaultName = activeFile?.name || 'Untitled.md'
      const saved = await saveMarkdownFileAs(defaultName, content)
      setActiveFile(saved)
      setDirty(false)
      setStatus(`Saved as ${saved.path}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save Markdown file'
      if (!message.toLowerCase().includes('cancel')) setError(message)
    }
  }, [activeFile, content])

  const createNote = useCallback(async () => {
    const name = newNoteName.trim()
    if (!name) return
    setError('')
    try {
      let folderPath = root
      if (!folderPath) {
        folderPath = await selectMarkdownFolder()
        if (!folderPath) return
        setRoot(folderPath)
        window.localStorage.setItem(RECENT_MARKDOWN_ROOT_KEY, folderPath)
      }
      const title = name.replace(/\.(md|markdown)$/i, '').split(/[\\/]/).pop() || 'Untitled'
      const initial = `# ${title}\n\n`
      const created = await createMarkdownFile(folderPath, name, initial)
      await loadFolderIndex(folderPath)
      setActiveFile(created)
      setContent(initial)
      setDirty(false)
      setNewNoteName('')
      setIsCreating(false)
      setStatus(`Created ${created.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Markdown note')
    }
  }, [loadFolderIndex, newNoteName, root])

  const startRename = useCallback((file: MarkdownFileEntry) => {
    setRenamingPath(file.relPath)
    setRenameValue(file.relPath)
  }, [])

  const commitRename = useCallback(async () => {
    if (!root || !renamingPath || !renameValue.trim()) return
    if (dirty && activeFile?.relPath === renamingPath) {
      await saveActive()
    }
    setError('')
    try {
      const renamed = await renameMarkdownFile(root, renamingPath, renameValue.trim())
      const nextFiles = await loadFolderIndex(root)
      const nextActive = nextFiles.find((file) => file.relPath === renamed.relPath) || renamed
      setActiveFile(nextActive)
      setContent(await readMarkdownFile(nextActive.path))
      setDirty(false)
      setRenamingPath('')
      setRenameValue('')
      setStatus(`Renamed ${renamingPath} to ${renamed.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename Markdown note')
    }
  }, [activeFile, dirty, loadFolderIndex, renameValue, renamingPath, root, saveActive])

  const deleteNote = useCallback(async (file: MarkdownFileEntry) => {
    if (!root) return
    if (!window.confirm(`Delete ${file.relPath}? This removes the file from disk.`)) return
    setError('')
    try {
      await deleteMarkdownFile(root, file.relPath)
      const nextFiles = await loadFolderIndex(root)
      if (activeFile?.relPath === file.relPath) {
        const next = nextFiles[0] || null
        setActiveFile(next)
        setContent(next ? await readMarkdownFile(next.path) : EMPTY_FOLDER_NOTE)
        setDirty(false)
      }
      setStatus(`Deleted ${file.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete Markdown note')
    }
  }, [activeFile, loadFolderIndex, root])

  const toggleDir = useCallback((relPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])

  const jumpToLine = useCallback((lineNumber: number) => {
    const editor = editorRef.current
    if (!editor) return
    const lines = content.split('\n')
    const position = lines.slice(0, Math.max(0, lineNumber - 1)).join('\n').length + (lineNumber > 1 ? 1 : 0)
    editor.focus()
    editor.selectionStart = position
    editor.selectionEnd = position
    const pct = lineNumber / Math.max(1, lines.length)
    editor.scrollTop = pct * (editor.scrollHeight - editor.clientHeight)
  }, [content])

  const resetGraphLayout = useCallback(() => {
    setGraphPositions({})
    setGraphScale(1)
    setGraphOffset({ x: 0, y: 0 })
  }, [])

  const readDroppedEntry = useCallback(async (entry: WebkitFileEntry, prefix = ''): Promise<Array<{ relPath: string; content: string }>> => {
    if (entry.isFile) {
      if (!/\.(md|markdown)$/i.test(entry.name)) return []
      const file = await new Promise<File>((resolve) => entry.file(resolve))
      return [{ relPath: `${prefix}${entry.name}`, content: await file.text() }]
    }
    if (!entry.isDirectory || !entry.createReader) return []
    const reader = entry.createReader()
    const entries = await new Promise<WebkitFileEntry[]>((resolve) => reader.readEntries(resolve))
    const nested = await Promise.all(entries.map((child) => readDroppedEntry(child, `${prefix}${entry.name}/`)))
    return nested.flat()
  }, [])

  const handleMarkdownDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    setError('')
    try {
      let folderPath = root
      if (!folderPath) {
        folderPath = await selectMarkdownFolder()
        if (!folderPath) return
        setRoot(folderPath)
        window.localStorage.setItem(RECENT_MARKDOWN_ROOT_KEY, folderPath)
      }

      const items = Array.from(event.dataTransfer.items || [])
      const droppedFromEntries = await Promise.all(items.map(async (item) => {
        const entry = (item as unknown as { webkitGetAsEntry?: () => WebkitFileEntry | null }).webkitGetAsEntry?.()
        return entry ? readDroppedEntry(entry) : []
      }))
      let dropped = droppedFromEntries.flat(2)

      if (dropped.length === 0) {
        const filesFromDrop = Array.from(event.dataTransfer.files || [])
        dropped = await Promise.all(filesFromDrop
          .filter((file) => /\.(md|markdown)$/i.test(file.name))
          .map(async (file) => ({ relPath: file.name, content: await file.text() })))
      }

      if (dropped.length === 0) {
        setError('Drop .md files or a folder containing Markdown notes.')
        return
      }
      let imported = 0
      for (const file of dropped) {
        await createMarkdownFile(folderPath, file.relPath, file.content)
        imported += 1
      }
      await openFolderPath(folderPath)
      setStatus(`Imported ${imported} dropped markdown notes`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import dropped Markdown files')
    }
  }, [openFolderPath, readDroppedEntry, root])

  const openInternalLink = useCallback((href: string) => {
    if (!activeFile) return
    const target = href.startsWith('adomnia-md:') ? href.slice('adomnia-md:'.length) : href
    const resolved = resolveMarkdownTarget(target, activeFile, lookup)
    if (resolved) void openFile(resolved)
  }, [activeFile, lookup, openFile])

  const handleCreateFromTemplate = useCallback(async (templateContent: string, filename: string) => {
    setShowTemplatePicker(false)
    setError('')
    try {
      let folderPath = root
      if (!folderPath) {
        folderPath = await selectMarkdownFolder()
        if (!folderPath) return
        setRoot(folderPath)
        window.localStorage.setItem(RECENT_MARKDOWN_ROOT_KEY, folderPath)
      }
      const created = await createMarkdownFile(folderPath, filename, templateContent)
      await loadFolderIndex(folderPath)
      setActiveFile(created)
      setContent(templateContent)
      setDirty(false)
      setStatus(`Created ${created.relPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create file from template')
    }
  }, [loadFolderIndex, root])

  const insertAtCursor = (wrapper: (s: string) => string) => {
    const ta = editorRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.slice(start, end)
    const replacement = wrapper(selected)
    setContent(content.slice(0, start) + replacement + content.slice(end))
    if (activeFile) setDirty(true)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + replacement.length
      ta.selectionEnd = start + replacement.length
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveActive()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setIsCreating(true)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void openFolder()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setGlobalSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openFolder, saveActive])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MARKDOWN_UI_STATE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        mode?: 'split' | 'edit' | 'preview'
        query?: string
        globalSearch?: string
        activeRelPath?: string
        expandedDirs?: string[]
        graphScale?: number
        graphOffset?: { x: number; y: number }
        showUnresolved?: boolean
        showOrphans?: boolean
        folderFilter?: string
      }
      if (parsed.mode) setMode(parsed.mode)
      if (parsed.query) setQuery(parsed.query)
      if (parsed.globalSearch) setGlobalSearch(parsed.globalSearch)
      if (parsed.expandedDirs) setExpandedDirs(new Set(parsed.expandedDirs))
      if (typeof parsed.graphScale === 'number') setGraphScale(parsed.graphScale)
      if (parsed.graphOffset) setGraphOffset(parsed.graphOffset)
      if (typeof parsed.showUnresolved === 'boolean') setShowUnresolved(parsed.showUnresolved)
      if (typeof parsed.showOrphans === 'boolean') setShowOrphans(parsed.showOrphans)
      if (parsed.folderFilter) setFolderFilter(parsed.folderFilter)
    } catch {
      window.localStorage.removeItem(MARKDOWN_UI_STATE_KEY)
    }
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      window.localStorage.setItem(MARKDOWN_UI_STATE_KEY, JSON.stringify({
        mode,
        query,
        globalSearch,
        activeRelPath: activeFile?.relPath,
        expandedDirs: Array.from(expandedDirs),
        graphScale,
        graphOffset,
        showUnresolved,
        showOrphans,
        folderFilter,
      }))
    }, 250)
    return () => window.clearTimeout(handle)
  }, [activeFile, expandedDirs, folderFilter, globalSearch, graphOffset, graphScale, mode, query, showOrphans, showUnresolved])

  useEffect(() => {
    if (!hasMarkdownBackend()) return
    const recentRoot = window.localStorage.getItem(RECENT_MARKDOWN_ROOT_KEY)
    if (!recentRoot) return
    let cancelled = false
    void (async () => {
      try {
        const nextFiles = await loadFolderIndex(recentRoot)
        if (cancelled) return
        setRoot(recentRoot)
        setStatus(`${nextFiles.length} markdown files`)
        const savedUi = JSON.parse(window.localStorage.getItem(MARKDOWN_UI_STATE_KEY) || '{}') as { activeRelPath?: string }
        const initialFile = nextFiles.find((file) => file.relPath === savedUi.activeRelPath) || nextFiles[0]
        if (initialFile) {
          setActiveFile(initialFile)
          setContent(await readMarkdownFile(initialFile.path))
          setDirty(false)
        }
      } catch {
        window.localStorage.removeItem(RECENT_MARKDOWN_ROOT_KEY)
      }
    })()
    return () => { cancelled = true }
  }, [loadFolderIndex])

  useEffect(() => {
    if (!root || !hasMarkdownBackend()) return
    const handle = window.setTimeout(() => {
      const graph = buildAgentGraph(root, files, effectiveContentsByPath, edges)
      void writeMarkdownAgentGraph(root, JSON.stringify(graph, null, 2))
        .then((path) => setAgentGraphPath(path))
        .catch(() => setAgentGraphPath(''))
    }, 600)
    return () => window.clearTimeout(handle)
  }, [effectiveContentsByPath, edges, files, root])

  return (
    <div
      className="relative flex-1 flex flex-col overflow-hidden"
      onDragEnter={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragOver(false)
      }}
      onDrop={(event) => void handleMarkdownDrop(event)}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/45 backdrop-blur-sm">
          <div className="rounded-md border border-accent/60 bg-surface-1 px-5 py-4 text-center shadow-xl">
            <Upload size={22} className="mx-auto mb-2 text-accent" />
            <div className="text-sm font-semibold text-text-1">Drop Markdown files or folders</div>
            <div className="mt-1 text-[11px] text-text-4">Files stay local and are copied into the current Markdown folder.</div>
          </div>
        </div>
      )}
      <MarkdownToolbar
        activeFile={activeFile}
        contentStatus={activeFile?.relPath || root || status}
        dirty={dirty}
        mode={mode}
        onOpenFolder={() => void openFolder()}
        onImportFolder={() => void importCopyToWorkspace()}
        onToggleCreate={() => setIsCreating((value) => !value)}
        onSave={() => void saveActive()}
        onSaveAs={() => void saveAs()}
        onInsert={insertAtCursor}
        onModeChange={setMode}
        onOpenGraph={() => setGraphOpen(true)}
        onOpenTemplates={() => setShowTemplatePicker(true)}
      />

      {(isCreating || error || !hasMarkdownBackend()) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-1 bg-surface-0 text-[11px] flex-shrink-0">
          {isCreating && (
            <>
              <input
                value={newNoteName}
                onChange={(event) => setNewNoteName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createNote()
                  if (event.key === 'Escape') setIsCreating(false)
                }}
                className="h-7 w-64 rounded border border-border-2 bg-surface-1 px-2 text-text-1 outline-none focus:border-accent"
                placeholder="folder/note-name.md"
                autoFocus
              />
              <button onClick={() => void createNote()} className="h-7 rounded bg-accent px-3 text-[11px] font-semibold text-black hover:brightness-110">Create</button>
            </>
          )}
          {error && <span className="text-danger">{error}</span>}
          {!hasMarkdownBackend() && <span className="ml-auto text-warning">Desktop backend not available in browser preview.</span>}
        </div>
      )}

      {globalSearchOpen && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/45 pt-16 backdrop-blur-sm" onMouseDown={() => setGlobalSearchOpen(false)}>
          <div className="w-[min(760px,calc(100vw-80px))] rounded-md border border-border-2 bg-surface-1 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
              <Search size={14} className="text-accent" />
              <input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setGlobalSearchOpen(false)
                }}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text-1 outline-none placeholder:text-text-4"
                placeholder="Search all Markdown notes..."
                autoFocus
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {globalSearch.trim() && globalSearchResults.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-text-4">No results.</div>
              )}
              {!globalSearch.trim() && (
                <div className="px-3 py-8 text-center text-xs text-text-4">Type to search across note names and content.</div>
              )}
              {globalSearchResults.map((result, index) => (
                <button
                  key={`${result.file.path}-${result.line}-${index}`}
                  onClick={async () => {
                    await openFile(result.file, true)
                    setGlobalSearchOpen(false)
                    window.setTimeout(() => jumpToLine(result.line), 30)
                  }}
                  className="mb-1 w-full rounded border border-transparent px-3 py-2 text-left hover:border-border-2 hover:bg-surface-2"
                >
                  <div className="flex items-center gap-2 text-[11px] text-text-2">
                    <FileText size={12} className="text-accent" />
                    <span className="font-mono">{result.file.relPath}</span>
                    <span className="text-text-4">line {result.line}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-text-3">{result.snippet}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <MarkdownFileTree
          ref={searchRef}
          activeFile={activeFile}
          expandedDirs={expandedDirs}
          query={query}
          renamingPath={renamingPath}
          renameValue={renameValue}
          root={root}
          tree={tree}
          onCommitRename={() => void commitRename()}
          onDeleteNote={(file) => void deleteNote(file)}
          onOpenFile={(file) => void openFile(file)}
          onQueryChange={setQuery}
          onRenameValueChange={setRenameValue}
          onStartRename={startRename}
          onToggleDir={toggleDir}
          onCancelRename={() => {
            setRenamingPath('')
            setRenameValue('')
          }}
        />

        {mode !== 'preview' && (
          <MarkdownEditor
            ref={editorRef}
            content={content}
            mode={mode}
            onChange={(value) => {
              setContent(value)
              if (activeFile) setDirty(true)
            }}
            onScroll={mode === 'split' ? onEditorScroll : undefined}
          />
        )}
        {mode !== 'edit' && (
          <MarkdownPreview
            ref={previewRef}
            html={html}
            onInternalLink={openInternalLink}
            onScroll={mode === 'split' ? onPreviewScroll : undefined}
          />
        )}

        <MarkdownGraphView
          activeFile={activeFile}
          agentGraphPath={agentGraphPath}
          edgesCount={edges.length}
          filesCount={files.length}
          folderFilter={folderFilter}
          folderOptions={folderOptions}
          graphNodes={graphNodes}
          graphOffset={graphOffset}
          graphScale={graphScale}
          open={graphOpen}
          showOrphans={showOrphans}
          showUnresolved={showUnresolved}
          unresolvedCount={unresolvedCount}
          visibleEdges={visibleEdges}
          onFolderFilterChange={setFolderFilter}
          onOpenChange={setGraphOpen}
          onOpenFile={(file) => void openFile(file)}
          onResetLayout={resetGraphLayout}
          setGraphOffset={setGraphOffset}
          setGraphPositions={setGraphPositions}
          setGraphScale={setGraphScale}
          setShowOrphans={setShowOrphans}
          setShowUnresolved={setShowUnresolved}
        />

        <aside className="w-52 shrink-0 border-l border-border-1 bg-surface-0 flex flex-col min-h-0 lg:w-60 xl:w-64">
          <div className="border-b border-border-1 p-2">
            <div className="mb-1.5 text-xs font-semibold text-text-2">Tags</div>
            {tags.length === 0 ? (
              <div className="text-[11px] text-text-4">No tags in this note.</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setQuery(tag)}
                    className="rounded border border-border-2 bg-surface-1 px-1.5 py-0.5 text-[10px] text-text-3 hover:border-accent/50 hover:text-text-1"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          <MarkdownOutline headings={headings} onJumpToLine={jumpToLine} />
          <BacklinksPanel backlinks={backlinks} files={files} onOpenFile={(file) => void openFile(file)} />
        </aside>
      </div>

      {showTemplatePicker && (
        <TemplatePickerModal
          onSelect={(templateContent, filename) => void handleCreateFromTemplate(templateContent, filename)}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  )
}
