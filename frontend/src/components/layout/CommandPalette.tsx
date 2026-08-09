import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, CornerDownLeft, Play, Search, Server, Settings2, SquarePlus } from 'lucide-react'
import type { Collection, RequestItem, TreeNode } from '@/lib/types'
import { COMMAND_PALETTE_PANELS, COMMAND_PALETTE_DEEP_LINKS, fuzzyScore } from '@/lib/commandPalette'
import { isFeatureVisible } from '@/lib/featureRegistry'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import type { RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { useSettingsStore } from '@/stores/settings'
import { useNavigationTranslation, useUiTranslation } from '@/lib/uiI18n'

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
  const tr = useUiTranslation()
  const nav = useNavigationTranslation()
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
  const featureFlags = useSettingsStore((s) => s.settings.features)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const commands = useMemo<PaletteCommand[]>(() => {
    const runInPanel = (rail: RailItem, eventName: string, extra: Record<string, unknown> = {}) => {
      setActiveRail(rail)
      let attempts = 0
      const dispatchWhenMounted = () => {
        if (useAppStore.getState().activeRail !== rail) return
        const detail = { ...extra, handled: false }
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
        id: 'action:new-request', title: tr('New Request'), subtitle: tr('Open a blank HTTP request'),
        group: tr('Actions'), keywords: 'create http tab new request nuova richiesta', icon: SquarePlus,
        run: () => { setActiveRail('collections'); newTab() },
      },
      {
        id: 'action:start-mock', title: tr('Start Mock Server'), subtitle: tr('Run the configured local mock'),
        group: tr('Actions'), keywords: 'run serve simulate endpoint mock avvia esegui', icon: Server,
        run: () => runInPanel('mock', 'adomnia:start-mock'),
      },
      {
        id: 'action:start-proxy', title: tr('Start Proxy Interceptor'), subtitle: tr('Capture local HTTP traffic'),
        group: tr('Actions'), keywords: 'run capture intercept traffic proxy avvia acquisisci', icon: Play,
        run: () => runInPanel('proxy', 'adomnia:start-proxy'),
      },
      {
        id: 'action:settings', title: tr('Open Settings'), subtitle: tr('Configure adOmnia'),
        group: tr('Actions'), keywords: 'preferences appearance configuration impostazioni configura', icon: Settings2,
        run: () => setActiveRail('settings'),
      },
    ]
    const panels = COMMAND_PALETTE_PANELS
      .filter((panel) => isFeatureVisible(panel.id, featureFlags))
      .map<PaletteCommand>((panel) => ({
      id: `panel:${panel.id}`, title: nav(panel.title), subtitle: nav(panel.group),
      group: tr('Panels'), keywords: `${panel.keywords} ${panel.group} ${nav(panel.title)} ${nav(panel.group)}`, icon: ArrowRight,
      run: () => setActiveRail(panel.id),
    }))
    const deepLinks = COMMAND_PALETTE_DEEP_LINKS.map<PaletteCommand>((link) => ({
      id: `deep:${link.rail}:${JSON.stringify(link.detail)}`, title: nav(link.title), subtitle: nav(link.group),
      group: tr('Panels'), keywords: `${link.keywords} ${link.group} ${nav(link.title)} ${nav(link.group)}`, icon: ArrowRight,
      run: () => runInPanel(link.rail, link.event, link.detail),
    }))
    const recentRequests = tabs.filter((tab) => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId).reverse().map<PaletteCommand>((tab) => ({
      id: `recent:${tab.id}`, title: tab.request.name || tab.request.url || tr('Untitled Request'),
      subtitle: `${tab.request.method} ${tab.request.url || tr('No URL')}`, group: tr('Recent Requests'),
      keywords: `${tab.request.method} ${tab.request.url} ${tab.request.name}`, icon: ArrowRight,
      run: () => { setActiveRail('collections'); openTab(tab.request, tab.collectionId) },
    }))
    const collectionEntries = collections.flatMap<PaletteCommand>((collection) => {
      const collectionCommand: PaletteCommand = {
        id: `collection:${collection.id}`, title: collection.name, subtitle: tr('Collection'),
        group: tr('Collections'), keywords: `collection folder raccolta cartella ${collection.name}`, icon: ArrowRight,
        run: () => setActiveRail('collections'),
      }
      const requests = collectionRequests(collection).map<PaletteCommand>((request) => ({
        id: `request:${collection.id}:${request.id}`, title: request.name,
        subtitle: `${request.method} ${request.url || collection.name}`, group: tr('Collections'),
        keywords: `${collection.name} ${request.method} ${request.url} ${request.name}`, icon: ArrowRight,
        run: () => { setActiveRail('collections'); openTab(request, collection.id) },
      }))
      return [collectionCommand, ...requests]
    })
    const environmentEntries = environments.map<PaletteCommand>((environment) => ({
      id: `environment:${environment.id}`, title: environment.name,
      subtitle: environment.id === activeEnvId ? tr('Active environment') : tr('Switch environment'),
      group: tr('Environments'), keywords: `environment variables switch ambiente variabili cambia ${environment.name}`, icon: ArrowRight,
      run: () => setActiveEnv(environment.id),
    }))
    return [...actions, ...deepLinks, ...panels, ...recentRequests, ...collectionEntries, ...environmentEntries]
  }, [activeEnvId, activeWorkspaceId, collections, environments, featureFlags, nav, newTab, openTab, setActiveEnv, setActiveRail, tabs, tr])

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
    <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/[0.62] pt-[12vh] palette-backdrop-enter" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-label={tr('Command palette')}
        data-testid="command-palette"
        className="glass-panel palette-surface-enter flex max-h-[70vh] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-2 shadow-2xl shadow-black/50 ring-1 ring-white/5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="flex h-14 items-center gap-3 border-b border-border-1 bg-surface-2/60 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-border-2 bg-surface-1">
            <Search size={15} className="shrink-0 text-accent" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tr('Search panels, requests, environments and actions...')}
            className="h-full flex-1 border-0 bg-transparent text-sm text-text-1 shadow-none outline-none placeholder:text-text-4 focus:shadow-none"
          />
          <kbd className="rounded border border-border-2 bg-surface-1 px-2 py-1 text-[10px] text-text-3">ESC</kbd>
        </label>
        <div className="flex-1 overflow-y-auto bg-surface-1 p-2">
          {results.length === 0 && (
            <div className="px-4 py-9 text-center text-xs text-text-3">{tr('No commands match')} <span className="text-text-2">"{query}"</span>.</div>
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
                  'group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left',
                  selectedIndex === index
                    ? 'border-accent/35 bg-accent/12 text-text-1 shadow-[inset_3px_0_0_var(--color-accent)]'
                    : 'border-transparent text-text-2 hover:border-border-2 hover:bg-surface-2',
                )}
              >
                <span className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-md border',
                  selectedIndex === index ? 'border-accent/35 bg-accent/12' : 'border-border-1 bg-surface-2 group-hover:border-border-2',
                )}>
                  <Icon size={14} className={selectedIndex === index ? 'text-accent' : 'text-text-4'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{command.title}</span>
                  {command.subtitle && <span className="block truncate text-[10px] text-text-4">{command.subtitle}</span>}
                </span>
                <span className="rounded border border-border-1 bg-surface-2 px-2 py-0.5 text-[9px] uppercase tracking-wide text-text-4">{command.group}</span>
                <CornerDownLeft size={12} className={selectedIndex === index ? 'text-text-3 opacity-100' : 'text-text-4 opacity-0'} />
              </button>
            )
          })}
        </div>
        <footer className="flex items-center gap-4 border-t border-border-1 bg-surface-2/50 px-4 py-2 text-[10px] text-text-4">
          <span><kbd className="text-text-3">Up/Down</kbd> {tr('select')}</span>
          <span><kbd className="text-text-3">Enter</kbd> {tr('open')}</span>
          <span className="ml-auto">Ctrl/Cmd + K or P</span>
        </footer>
      </section>
    </div>
  )
}
