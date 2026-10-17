import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AppWindow, ArrowLeft, ArrowRight, Columns2, ExternalLink, Laptop, MoreHorizontal, PanelBottom, Play, Radio, RotateCw, Smartphone, Square, Tablet, Terminal, Zap, ZapOff,
  type LucideIcon,
} from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'
import {
  DEVICES, MAX_VIEWPORT, MIN_VIEWPORT, clampViewport, currentPreview, pageUrl, phaseOf, viewportFor,
  type BridgeMessage, type DeviceId, type LivePreviewPlacement, type PreviewPhase,
} from '@/lib/goide/livePreview'
import type { GoIDESession } from '@/lib/goide-api'
import { GoStudioPreviewFrame, type PreviewFrameHandle } from './GoStudioPreviewFrame'
import { GoStudioPreviewSetup } from './GoStudioPreviewSetup'
import { GoStudioPreviewDrawer } from './GoStudioPreviewDrawer'

interface LivePreviewProps {
  session: GoIDESession
  /** Nel pannello inferiore l'intestazione della tool window c'è già. */
  embedded?: boolean
}

const ICON_BUTTON = 'go-studio-icon-button h-7 w-7 shrink-0'

const PLACEMENTS: ReadonlyArray<{ id: LivePreviewPlacement; label: string; icon: LucideIcon }> = [
  { id: 'split', label: 'Split with the editor', icon: Columns2 },
  { id: 'tab', label: 'Tab next to the files', icon: AppWindow },
  { id: 'panel', label: 'Tool window panel', icon: PanelBottom },
  { id: 'window', label: 'Separate native window', icon: ExternalLink },
]

const DEVICE_ICON: Record<DeviceId, LucideIcon> = { desktop: Laptop, tablet: Tablet, mobile: Smartphone, custom: Radio }

const PHASE_DOT: Record<PreviewPhase, string> = {
  idle: 'bg-text-4', starting: 'bg-accent animate-pulse', ready: 'bg-success', stopping: 'bg-warning animate-pulse', failed: 'bg-danger',
}

const PHASE_LABEL: Record<PreviewPhase, string> = { idle: 'Stopped', starting: 'Starting', ready: 'Live', stopping: 'Stopping', failed: 'Failed' }

type MenuKind = 'device' | 'placement' | 'more'

/** Path e query di un indirizzo completo: nella barra si mostra solo la parte che cambia. */
function addressPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

/**
 * Live Preview: la pagina vera del progetto (sito statico o dev server) in un iframe isolato, con la
 * toolbar del browser integrato. Lo stesso componente vive nel pannello, nello split, nella tab o
 * nella finestra staccata: cambia solo il contenitore. La toolbar si adatta alla larghezza del
 * contenitore (container query): stretta, le azioni secondarie passano nel menu "altro".
 */
export function GoStudioLivePreview({ session, embedded = false }: LivePreviewProps) {
  const sessionId = session.id
  const view = useLivePreviewStore((state) => selectSessionPreview(state, sessionId))
  const actions = useLivePreviewStore.getState
  const frame = useRef<PreviewFrameHandle>(null)
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState<{ kind: MenuKind; x: number; y: number } | null>(null)
  const preview = currentPreview(view.previews, view.activeId)
  const phase = phaseOf(preview)
  const live = phase === 'ready' && !!preview
  const viewport = useMemo(() => viewportFor(view.device, view.width, view.height), [view.device, view.width, view.height])

  useEffect(() => {
    if (!view.report && !view.loading) void actions().load(sessionId)
  }, [sessionId, view.report, view.loading, actions])

  const onMessage = useCallback((message: BridgeMessage) => actions().pushBridge(sessionId, message), [sessionId, actions])
  const src = live ? pageUrl(preview) : ''
  const address = view.location?.url ? addressPath(view.location.url) : live ? addressPath(src) : ''
  const port = live ? new URL(src).port : ''
  const problemCount = view.log.filter((entry) => entry.message.type === 'error' || (entry.message.type === 'console' && entry.message.level === 'error')).length
  const hmr = preview?.mode === 'devserver'

  const openMenu = (kind: MenuKind, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setMenu({ kind, x: Math.max(8, rect.right - 232), y: rect.bottom + 4 })
  }

  const deviceItems = (): ContextMenuItem[] => DEVICES.map((device) => ({ id: `device:${device.id}`, label: device.label, icon: DEVICE_ICON[device.id], checked: device.id === view.device }))
  const placementItems = (): ContextMenuItem[] => PLACEMENTS.map((placement) => ({ id: `place:${placement.id}`, label: placement.label, icon: placement.icon, checked: placement.id === view.placement }))
  const menuItems = (kind: MenuKind): ContextMenuItem[] => {
    if (kind === 'device') return deviceItems()
    if (kind === 'placement') return placementItems()
    return [
      { id: 'autoReload', label: view.autoReload ? 'Auto reload: on' : 'Auto reload: off', icon: view.autoReload ? Zap : ZapOff, disabled: hmr, disabledReason: 'The dev server hot-reloads by itself' },
      { id: 'viewport', label: 'Viewport', icon: Laptop, submenu: deviceItems(), separatorBefore: true },
      { id: 'placement', label: 'Show preview in…', icon: Columns2, submenu: placementItems() },
      { id: 'window', label: 'Open in a window', icon: AppWindow, disabled: !live, separatorBefore: true },
      { id: 'browser', label: 'Open in external browser', icon: ExternalLink, disabled: !live },
      { id: 'console', label: drawer ? 'Hide console' : 'Console and network', icon: Terminal },
      { id: 'restart', label: 'Restart server', icon: RotateCw, disabled: !preview || phase === 'stopping', separatorBefore: true },
    ]
  }

  const select = (id: string) => {
    setMenu(null)
    if (id.startsWith('device:')) return actions().setViewport(sessionId, { device: id.slice(7) as DeviceId })
    if (id.startsWith('place:')) return actions().show(sessionId, id.slice(6) as LivePreviewPlacement)
    switch (id) {
      case 'autoReload': return actions().setAutoReload(sessionId, !view.autoReload)
      case 'window': return void actions().openWindow(sessionId)
      case 'browser': return void actions().openExternal(sessionId)
      case 'console': return setDrawer((value) => !value)
      case 'restart': return void actions().restart(sessionId)
    }
  }

  const submitAddress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !live) return
    event.preventDefault()
    frame.current?.navigate(pageUrl(preview, event.currentTarget.value.trim() || '/'))
  }

  const DeviceIcon = DEVICE_ICON[view.device]
  const wide = '@[620px]:flex'

  return (
    <section aria-label="Live Preview" className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-1 px-2" role="toolbar" aria-label="Live Preview controls">
        <button type="button" className={ICON_BUTTON} disabled={!live || !preview?.bridged} onClick={() => frame.current?.back()} aria-label="Back" title="Back"><ArrowLeft size={14} /></button>
        <button type="button" className={ICON_BUTTON} disabled={!live || !preview?.bridged} onClick={() => frame.current?.forward()} aria-label="Forward" title="Forward"><ArrowRight size={14} /></button>
        <button type="button" className={ICON_BUTTON} disabled={!live} onClick={() => frame.current?.reload()} aria-label="Reload" title="Reload"><RotateCw size={13} /></button>
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-text-3" role="status" aria-live="polite" title={preview?.directUrl ?? PHASE_LABEL[phase]}>
          <span className={`h-2 w-2 rounded-full ${PHASE_DOT[phase]}`} aria-hidden="true" />
          <span className="hidden @[380px]:inline">{PHASE_LABEL[phase]}</span>
        </span>
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-[var(--gs-ground)] px-2 text-text-4 focus-within:ring-1 focus-within:ring-accent">
          <span className="shrink-0 font-mono text-[11px]">{live ? `:${port}` : '—'}</span>
          <input
            key={address}
            defaultValue={address}
            disabled={!live}
            onKeyDown={submitAddress}
            spellCheck={false}
            aria-label="Page address"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text-1 outline-none disabled:text-text-4"
          />
        </label>
        <div className={`hidden items-center gap-1 ${wide}`}>
          <button
            type="button" className={`${ICON_BUTTON} ${view.autoReload ? 'text-accent' : ''}`} aria-pressed={view.autoReload} disabled={hmr}
            onClick={() => actions().setAutoReload(sessionId, !view.autoReload)} aria-label="Auto reload"
            title={hmr ? 'The dev server hot-reloads by itself (HMR / Fast Refresh)' : view.autoReload ? 'Auto reload on: the page refreshes when files change' : 'Auto reload off: changes wait for a manual reload'}
          >{view.autoReload ? <Zap size={13} /> : <ZapOff size={13} />}</button>
          <button type="button" className={ICON_BUTTON} onClick={(event) => openMenu('device', event.currentTarget)} aria-label={`Viewport: ${view.device}`} title="Responsive viewport" aria-haspopup="menu"><DeviceIcon size={14} /></button>
          <button type="button" className={ICON_BUTTON} onClick={(event) => openMenu('placement', event.currentTarget)} aria-label="Where to show the preview" title="Show preview in…" aria-haspopup="menu"><Columns2 size={14} /></button>
          <button type="button" className={ICON_BUTTON} disabled={!live} onClick={() => void actions().openWindow(sessionId)} aria-label="Open in a separate window" title="Open in a separate window"><AppWindow size={14} /></button>
          <button type="button" className={ICON_BUTTON} disabled={!live} onClick={() => void actions().openExternal(sessionId)} aria-label="Open in external browser" title="Open in external browser"><ExternalLink size={14} /></button>
          <button type="button" className={`${ICON_BUTTON} ${drawer ? 'bg-surface-3' : ''}`} aria-pressed={drawer} onClick={() => setDrawer((value) => !value)} aria-label="Console and network" title="Console, network and build problems"><Terminal size={14} /></button>
        </div>
        {phase === 'ready' || phase === 'starting' ? (
          <button type="button" className={`${ICON_BUTTON} text-danger`} onClick={() => void actions().stop(sessionId)} aria-label="Stop server" title="Stop server"><Square size={11} fill="currentColor" /></button>
        ) : (
          <button type="button" className={`${ICON_BUTTON} text-success`} disabled={view.starting} onClick={() => void actions().goLive(sessionId, view.lastRequest ?? undefined)} aria-label="Go Live" title="Go Live"><Play size={13} fill="currentColor" /></button>
        )}
        <button type="button" className={`hidden ${ICON_BUTTON} ${wide}`} disabled={!preview || phase === 'stopping'} onClick={() => void actions().restart(sessionId)} aria-label="Restart server" title="Restart server"><RotateCw size={13} className="text-warning" /></button>
        <button type="button" className={`${ICON_BUTTON} relative @[620px]:hidden`} onClick={(event) => openMenu('more', event.currentTarget)} aria-label="More preview actions" title="More" aria-haspopup="menu">
          <MoreHorizontal size={14} />
          {problemCount > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />}
        </button>
      </div>

      {view.device === 'custom' && (
        <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-border-1 text-[11px] text-text-4">
          Viewport
          <input type="number" min={MIN_VIEWPORT} max={MAX_VIEWPORT} value={view.width} aria-label="Viewport width" onChange={(event) => actions().setViewport(sessionId, { width: clampViewport(Number(event.target.value)) })} className="h-6 w-16 rounded bg-[var(--gs-ground)] px-1.5 text-text-1 outline-none focus:ring-1 focus:ring-accent" />
          ×
          <input type="number" min={0} max={MAX_VIEWPORT} value={view.height || ''} placeholder="auto" aria-label="Viewport height" onChange={(event) => actions().setViewport(sessionId, { height: event.target.value ? clampViewport(Number(event.target.value)) : 0 })} className="h-6 w-16 rounded bg-[var(--gs-ground)] px-1.5 text-text-1 outline-none focus:ring-1 focus:ring-accent" />
          px
        </div>
      )}

      {live && preview ? (
        <>
          {!preview.bridged && (
            <p role="status" className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 text-[11px] text-text-2">The preview bridge could not start, so back/forward, console and error reporting are off. The page itself works normally.</p>
          )}
          <GoStudioPreviewFrame ref={frame} src={src} title={`Live preview of ${preview.label ?? 'the project'}`} bridged={preview.bridged} autoReload={view.autoReload} width={viewport.width} height={viewport.height} onMessage={onMessage} />
        </>
      ) : (
        <GoStudioPreviewSetup session={session} view={view} preview={preview} />
      )}

      {drawer && (
        <GoStudioPreviewDrawer
          sessionId={sessionId} log={view.log} runId={preview?.runId || null} workingDirectory={preview?.root ?? ''}
          projectDirectory={relativeDirectory(session.project.realPath, preview?.root)} onClose={() => setDrawer(false)}
        />
      )}
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={menuItems(menu.kind)} onSelect={select} onClose={() => setMenu(null)} />}
      {!embedded && <span className="sr-only" aria-live="polite">{PHASE_LABEL[phase]}</span>}
    </section>
  )
}

/** Cartella del dev server rispetto al progetto ("." per la radice), per aprire i file degli errori. */
function relativeDirectory(projectRoot: string, directory: string | undefined): string {
  if (!directory) return '.'
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const dir = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  if (dir.toLowerCase() === root.toLowerCase()) return '.'
  return dir.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? dir.slice(root.length + 1) : '.'
}
