import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useCollectionsStore, migrateCollections } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { ReadDroppedFiles } from '@/wailsjs/go/main/App'
import { importCollectionsFromText } from '@/lib/collectionTransfer'
import { routeGlobalDropFile } from '@/lib/globalFileRouter'
import { parseInteropFile } from '@/lib/interopHub'
import { saveFlowDefinitions } from '@/lib/flowStorage'
import { safeSetItem } from '@/lib/safeLocalStorage'
import type { Tab } from '@/lib/types'

export interface DropFeedback {
  msg: string
  ok: boolean
}

export interface DropPreview {
  name: string
  kind: string
  target: string
  supported: boolean
}

export interface FileDropHandlers {
  onDragEnter: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
}

export interface FileDropResult {
  dragOver: boolean
  dropPreview: DropPreview | null
  dropFeedback: DropFeedback | null
  handlers: FileDropHandlers
}

interface DroppedFileData {
  name: string
  path: string
  text?: string
  bytesBase64?: string
}

function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? [])
  if (files.length > 0) return files

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function fileFromDroppedData(entry: DroppedFileData): File {
  const payload = entry.bytesBase64 ? base64ToArrayBuffer(entry.bytesBase64) : entry.text ?? ''
  return new File([payload], entry.name || entry.path.split(/[\\/]/).pop() || 'dropped-file')
}

function describeDropFile(name: string): DropPreview {
  const lower = name.toLowerCase()
  if (lower.endsWith('.har')) return { name, kind: 'HAR', target: 'HAR Viewer', supported: true }
  if (lower.endsWith('.wsdl')) return { name, kind: 'WSDL', target: 'SOAP Studio', supported: true }
  if (/\.(mmd|mermaid)$/i.test(lower)) return { name, kind: 'Mermaid', target: 'Mermaid Studio', supported: true }
  if (lower.endsWith('.tex')) return { name, kind: 'LaTeX', target: 'LaTeX Studio', supported: true }
  if (lower.endsWith('.pdf')) return { name, kind: 'PDF', target: 'PDF Editor', supported: true }
  if (lower.endsWith('.proto')) return { name, kind: 'Proto', target: 'gRPC Client', supported: true }
  if (lower.endsWith('.sql')) return { name, kind: 'SQL', target: 'Database Studio', supported: true }
  if (lower.endsWith('.class')) return { name, kind: 'Java Class', target: 'Class File Inspector', supported: true }
  if (lower === 'env.yaml') return { name, kind: 'Environment YAML', target: 'Environments', supported: true }
  if (lower.endsWith('.adomnia')) return { name, kind: 'Workspace', target: 'Collections', supported: true }
  if (/\.(json|ya?ml|bru)$/i.test(lower)) return { name, kind: 'Collection', target: 'Collections', supported: true }
  return { name, kind: 'Unknown', target: 'Unsupported file', supported: false }
}

function previewFromDataTransfer(dataTransfer: DataTransfer): DropPreview | null {
  const file = filesFromDataTransfer(dataTransfer)[0]
  if (file) return describeDropFile(file.name)
  const uri = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain')
  const name = uri.split(/[\\/]/).pop()?.trim()
  return name ? describeDropFile(name) : null
}

export function useFileDrop(): FileDropResult {
  const [dragOver, setDragOver] = useState(false)
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null)
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null)
  const dragCounter = useRef(0)
  const noFileTimer = useRef<number | null>(null)
  const suppressNativeDropUntil = useRef(0)
  const suppressBrowserDropUntil = useRef(0)

  const importCollection = useCollectionsStore((s) => s.importCollection)
  const setActiveRail    = useAppStore((s) => s.setActiveRail)

  const showFeedback = useCallback((msg: string, ok: boolean) => {
    setDropFeedback({ msg, ok })
    setTimeout(() => setDropFeedback(null), 3500)
  }, [])

  const clearNoFileTimer = useCallback(() => {
    if (noFileTimer.current !== null) {
      window.clearTimeout(noFileTimer.current)
      noFileTimer.current = null
    }
  }, [])

  const importDroppedFiles = useCallback(async (files: File[]) => {
    let totalImported = 0; let totalEnvironments = 0; let workspaceImported = false
    const errors: string[] = []; let routedTool = false

    for (const file of files) {
      try {
        const routed = await routeGlobalDropFile(file)
        if (routed.kind === 'environment') {
          const bundle = parseInteropFile(routed.name, routed.text)
          if (!bundle.environments.length) throw new Error('No environments found in env.yaml.')
          let added = 0
          useEnvironmentsStore.setState((state) => {
            const existingNames = new Set(state.environments.map((environment) => environment.name))
            const environments = bundle.environments.map((environment) => {
              const baseName = environment.name || 'Imported environment'
              let name = baseName
              let suffix = 2
              while (existingNames.has(name)) name = `${baseName} ${suffix++}`
              existingNames.add(name)
              added++
              return { ...environment, name }
            })
            return {
              environments: [...state.environments, ...environments],
              activeEnvId: state.activeEnvId ?? environments[0]?.id ?? null,
              loaded: true,
            }
          })
          useEnvironmentsStore.getState().save()
          totalEnvironments += added
          continue
        }
        if (routed.kind !== 'collection') {
          if (routedTool || totalImported > 0) { errors.push(`${file.name}: drop tool files one at a time.`); continue }
          useAppStore.getState().queueFileImport(routed)
          const target = routed.kind === 'har' ? 'har' : routed.kind === 'wsdl' ? 'soap' : routed.kind === 'mermaid' ? 'mermaid' : routed.kind === 'latex' ? 'latex' : routed.kind === 'pdf' ? 'pdfeditor' : routed.kind === 'proto' ? 'grpc' : routed.kind === 'sql' ? 'database' : 'powertools'
          const label = routed.kind === 'har' ? 'HAR Viewer' : routed.kind === 'wsdl' ? 'SOAP Studio' : routed.kind === 'mermaid' ? 'Mermaid Studio' : routed.kind === 'latex' ? 'LaTeX Studio' : routed.kind === 'pdf' ? 'PDF Editor' : routed.kind === 'proto' ? 'gRPC Client' : routed.kind === 'sql' ? 'Database Studio' : 'Class File Inspector'
          setActiveRail(target)
          showFeedback(`${file.name} opened in ${label}.`, true)
          routedTool = true; continue
        }
        const text = routed.text
        let parsed: Record<string, unknown> | null = null
        try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
        const isWorkspace = parsed !== null && Array.isArray(parsed.collections) &&
          (parsed.version === 2 || parsed.format === 'adomnia-workspace')
        if (isWorkspace && parsed) {
          if (Array.isArray(parsed.openTabs)) {
            const workspaceId = useCollectionsStore.getState().activeWorkspaceId
            const incomingTabs: Tab[] = (parsed.openTabs as Tab[]).map((tab) => ({ ...tab, workspaceId }))
            const otherTabs = useTabsStore.getState().tabs.filter((tab) => tab.workspaceId !== workspaceId)
            const importedActiveTabId = incomingTabs.some((tab) => tab.id === parsed.activeTabId)
              ? parsed.activeTabId as string
              : incomingTabs[0]?.id ?? null
            useTabsStore.setState({ tabs: [...otherTabs, ...incomingTabs], activeTabId: importedActiveTabId })
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useCollectionsStore.getState().replaceCollections(migrateCollections(parsed.collections as any[]))
          if (Array.isArray(parsed.environments)) {
            useEnvironmentsStore.setState({ environments: parsed.environments as never, activeEnvId: (parsed.activeEnvId as string | null) ?? null, loaded: true })
            useEnvironmentsStore.getState().save()
          }
          if (parsed.settings) { useSettingsStore.setState({ settings: parsed.settings as never, loaded: true }); useSettingsStore.getState().save() }
          if (Array.isArray(parsed.flows)) await saveFlowDefinitions(parsed.flows)
          if (parsed.dockerLab) safeSetItem('adomnia.dockerlab.last', JSON.stringify(parsed.dockerLab))
          if (parsed.websocket) safeSetItem('adomnia.websocket', JSON.stringify(parsed.websocket))
          totalImported += (parsed.collections as unknown[]).length; workspaceImported = true
        } else {
          const result = importCollectionsFromText(text)
          result.collections.forEach((c) => importCollection(c))
          totalImported += result.collections.length
        }
      } catch (err: unknown) { errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Import failed'}`) }
    }
    if (!routedTool) {
      if (totalImported > 0 || totalEnvironments > 0) {
        if (totalImported > 0) setActiveRail('collections')
        const label = workspaceImported
          ? 'Workspace imported'
          : [
              totalImported > 0 ? `${totalImported} collection${totalImported > 1 ? 's' : ''}` : '',
              totalEnvironments > 0 ? `${totalEnvironments} environment${totalEnvironments > 1 ? 's' : ''}` : '',
            ].filter(Boolean).join(', ') + ' imported'
        showFeedback(`${label} successfully.`, true)
      } else { showFeedback(errors[0] ?? 'Import failed.', false) }
    }
  }, [importCollection, setActiveRail, showFeedback])

  const importDroppedPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return
    clearNoFileTimer()
    suppressBrowserDropUntil.current = Date.now() + 1200
    setDragOver(false); setDropPreview(null); dragCounter.current = 0
    try {
      const raw = await ReadDroppedFiles(paths)
      const entries = JSON.parse(raw) as DroppedFileData[]
      const files = entries.map(fileFromDroppedData)
      if (!files.length) { showFeedback('No file detected.', false); return }
      await importDroppedFiles(files)
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Drop import failed.', false)
    }
  }, [clearNoFileTimer, importDroppedFiles, showFeedback])

  // Native OS file drops. Wails 3 replaced the v2 `runtime.OnFileDrop` callback
  // with the `common:WindowFilesDropped` event, and only delivers it when the
  // drop lands on an element carrying `data-file-drop-target` (set on the app
  // root in App.tsx). The window must also be created with EnableFileDrop.
  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false

    void import('@wailsio/runtime').then(({ Events }) => {
      if (cancelled) return
      off = Events.On('common:WindowFilesDropped', (event: { data?: unknown }) => {
        if (Date.now() < suppressNativeDropUntil.current) return
        const payload = Array.isArray(event?.data) ? event.data[0] : event?.data
        const filenames = (payload as { filenames?: unknown })?.filenames
        if (!Array.isArray(filenames) || filenames.length === 0) return
        void importDroppedPaths(filenames.filter((p): p is string => typeof p === 'string'))
      })
    }).catch(() => {
      // Running outside the desktop shell (plain browser dev): the in-page
      // HTML5 drag handlers below still work.
    })

    return () => {
      cancelled = true
      off?.()
    }
  }, [importDroppedPaths])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragCounter.current++
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      setDropPreview(previewFromDataTransfer(e.dataTransfer))
      setDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); setDropPreview(null) }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (Array.from(e.dataTransfer.types).includes('Files')) setDropPreview(previewFromDataTransfer(e.dataTransfer))
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false); setDropPreview(null); dragCounter.current = 0

      const files = filesFromDataTransfer(e.dataTransfer)
      if (!files.length) {
        clearNoFileTimer()
        noFileTimer.current = window.setTimeout(() => {
          showFeedback('No file detected.', false)
          noFileTimer.current = null
        }, 700)
        return
      }
      if (Date.now() < suppressBrowserDropUntil.current) return
      suppressNativeDropUntil.current = Date.now() + 1200
      clearNoFileTimer()
      await importDroppedFiles(files)
    },
    [clearNoFileTimer, importDroppedFiles, showFeedback],
  )

  return { dragOver, dropPreview, dropFeedback, handlers: { onDragEnter: handleDragEnter, onDragLeave: handleDragLeave, onDragOver: handleDragOver, onDrop: handleDrop } }
}
