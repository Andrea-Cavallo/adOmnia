import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, CornerDownLeft, Play, Search, Server, Settings2, SquarePlus } from 'lucide-react'
import type { Collection, RequestItem, TreeNode } from '@/lib/types'
import { COMMAND_PALETTE_PANELS, fuzzyScore } from '@/lib/commandPalette'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface PaletteCommand {
  id: string
  title: string
  subtitle?: string
  group: string
  keywords: string
  icon: ElementType
  run: () => void
}

function collectionRequests(collection: Collection): RequestItem[] {
  const requests: RequestItem[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'folder') walk(node.children)
      else requests.push(node)
    }
  }
  walk(collection.children)
  return requests
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const collections = useCollectionsStore((s) => s.collections)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((s) => s.setActiveEnv)
  const tabs = useTabsStore((s) => s.tabs)
  const openTab = useTabsStore((s) => s.openTab)
  const newTab = useTabsStore((s) => s.newTab)
  const setActiveRail = useAppStore((s) => s.setActiveRail)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const commands = useMemo<PaletteCommand[]>(() => {
    const runInPanel = (rail: 'mock' | 'proxy', eventName: string) => {
      setActiveRail(rail)
      let attempts = 0
      const dispatchWhenMounted = () => {
        if (useAppStore.getState().activeRail !== rail) return
        const detail = { handled: false }
        document.dispatchEvent(new CustomEvent(eventName, { detail }))
        if (!detail.handled && attempts < 120) {
          attempts += 1
          window.requestAnimationFrame(dispatchWhenMounted)
        }
      }
      window.requestAnimationFrame(dispatchWhenMounted)
    }
    const actions: PaletteCommand[] = [
      {
        id: 'action:new-request', title: 'New Request', subtitle: 'Open a blank HTTP request',
        group: 'Actions', keywords: 'create http tab new request', icon: SquarePlus,
        run: () => { setActiveRail('collections'); newTab() },
      },
      {
        id: 'action:start-mock', title: 'Start Mock Server', subtitle: 'Run the configured local mock',
        group: 'Actions', keywords: 'run serve simulate endpoint mock', icon: Server,
        run: () => runInPanel('mock', 'adomnia:start-mock'),
      },
      {
        id: 'action:start-proxy', title: 'Start Proxy Interceptor', subtitle: 'Capture local HTTP traffic',
        group: 'Actions', keywords: 'run capture intercept traffic proxy', icon: Play,
        run: () => runInPanel('proxy', 'adomnia:start-proxy'),
      },
      {
        id: 'action:settings', title: 'Open Settings', subtitle: 'Configure adOmnia',
        group: 'Actions', keywords: 'preferences appearance configuration', icon: Settings2,
        run: () => setActiveRail('settings'),
      },
    ]
    const panels = COMMAND_PALETTE_PANELS.map<PaletteCommand>((panel) => ({
      id: `panel:${panel.id}`, title: panel.title, subtitle: panel.group,
      group: 'Panels', keywords: `${panel.keywords} ${panel.group}`, icon: ArrowRight,
      run: () => setActiveRail(panel.id),
    }))
    const recentRequests = tabs.filter((tab) => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId).reverse().map<PaletteCommand>((tab) => ({
      id: `recent:${tab.id}`, title: tab.request.name || tab.request.url || 'Untitled Request',
      subtitle: `${tab.request.method} ${tab.request.url || 'No URL'}`, group: 'Recent Requests',
      keywords: `${tab.request.method} ${tab.request.url} ${tab.request.name}`, icon: ArrowRight,
      run: () => { setActiveRail('collections'); openTab(tab.request, tab.collectionId) },
    }))
    const collectionEntries = collections.flatMap<PaletteCommand>((collection) => {
      const collectionCommand: PaletteCommand = {
        id: `collection:${collection.id}`, title: collection.name, subtitle: 'Collection',
        group: 'Collections', keywords: `collection folder ${collection.name}`, icon: ArrowRight,
        run: () => setActiveRail('collections'),
      }
      const requests = collectionRequests(collection).map<PaletteCommand>((request) => ({
        id: `request:${collection.id}:${request.id}`, title: request.name,
        subtitle: `${request.method} ${request.url || collection.name}`, group: 'Collections',
        keywords: `${collection.name} ${request.method} ${request.url} ${request.name}`, icon: ArrowRight,
        run: () => { setActiveRail('collections'); openTab(request, collection.id) },
      }))
      return [collectionCommand, ...requests]
    })
    const environmentEntries = environments.map<PaletteCommand>((environment) => ({
      id: `environment:${environment.id}`, title: environment.name,
      subtitle: environment.id === activeEnvId ? 'Active environment' : 'Switch environment',
      group: 'Environments', keywords: `environment variables switch ${environment.name}`, icon: ArrowRight,
      run: () => setActiveEnv(environment.id),
    }))
    return [...actions, ...panels, ...recentRequests, ...collectionEntries, ...environmentEntries]
  }, [activeEnvId, activeWorkspaceId, collections, environments, newTab, openTab, setActiveEnv, setActiveRail, tabs])

  const results = useMemo(() => commands
    .map((command) => ({ command, score: fuzzyScore(query, `${command.title} ${command.subtitle ?? ''} ${command.keywords}`) }))
    .filter((entry): entry is { command: PaletteCommand; score: number } => entry.score !== null)
    .sort((a, b) => query.trim() ? b.score - a.score : 0)
    .slice(0, 18)
    .map((entry) => entry.command), [commands, query])

  useEffect(() => setSelectedIndex(0), [query])

  if (!open) return null

  const execute = (command: PaletteCommand | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(results[selectedIndex])
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
        className="flex max-h-[70vh] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-border-1 bg-surface-1 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="flex h-14 items-center gap-3 border-b border-border-1 px-4">
          <Search size={16} className="shrink-0 text-text-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search panels, requests, environments and actions..."
            className="h-full flex-1 bg-transparent text-sm text-text-1 outline-none placeholder:text-text-4"
          />
          <kbd className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] text-text-3">ESC</kbd>
        </label>
        <div className="flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="px-4 py-9 text-center text-xs text-text-3">No commands match <span className="text-text-2">"{query}"</span>.</div>
          )}
          {results.map((command, index) => {
            const Icon = command.icon
            return (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => execute(command)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  selectedIndex === index ? 'bg-accent/12 text-text-1' : 'text-text-2 hover:bg-surface-2',
                )}
              >
                <Icon size={14} className={selectedIndex === index ? 'text-accent' : 'text-text-4'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{command.title}</span>
                  {command.subtitle && <span className="block truncate text-[10px] text-text-4">{command.subtitle}</span>}
                </span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-[9px] uppercase tracking-wide text-text-4">{command.group}</span>
                {selectedIndex === index && <CornerDownLeft size={12} className="text-text-4" />}
              </button>
            )
          })}
        </div>
        <footer className="flex items-center gap-4 border-t border-border-1 px-4 py-2 text-[10px] text-text-4">
          <span><kbd className="text-text-3">Up/Down</kbd> select</span>
          <span><kbd className="text-text-3">Enter</kbd> open</span>
          <span className="ml-auto">Ctrl/Cmd + K</span>
        </footer>
      </section>
    </div>
  )
}
