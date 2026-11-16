import { connect, WindowMessenger } from 'penpal'
import type { Frame, LayerNode } from '@onlook/models'
import type { PenpalChildMethods, PenpalParentMethods, PromisifiedPendpalChildMethods } from '@onlook/penpal'
import type { EditorEngine } from '@ve-client/components/store/editor/engine'
import type { IFrameView } from './frame-view'

const CONNECT_TIMEOUT_MS = 8000

/** What an in-page call answers while the page is not connected, by method name. Same rule as the transplanted frame view. */
function fallback(method: string): unknown {
  if (method.startsWith('get') || method.includes('capture') || method.includes('build')) return null
  if (method.includes('Count')) return 0
  if (method.includes('Editable') || method.includes('supports')) return false
  return undefined
}

/** The in-page API, by name. The type makes this list fail to compile when the page API changes. */
const PAGE_METHODS: Record<keyof PenpalChildMethods, true> = {
  processDom: true, setFrameId: true, setBranchId: true, getComputedStyleByDomId: true, updateElementInstance: true,
  getFirstOnlookElement: true, captureScreenshot: true, buildLayerTree: true, getElementAtLoc: true, getElementByDomId: true,
  getElementIndex: true, setElementType: true, getElementType: true, getParentElement: true, getChildrenCount: true,
  getOffsetParent: true, getActionLocation: true, getActionElement: true, getInsertLocation: true, getRemoveAction: true,
  getTheme: true, setTheme: true, startDrag: true, drag: true, dragAbsolute: true, endDrag: true, endDragAbsolute: true,
  endAllDrag: true, startEditingText: true, editText: true, stopEditingText: true, isChildTextEditable: true, updateStyle: true,
  insertElement: true, removeElement: true, moveElement: true, groupElements: true, ungroupElements: true, insertImage: true,
  removeImage: true, handleBodyReady: true,
}

export interface PreviewBridge {
  /** Resolves when the page answered; rejects on timeout or when the bridge was closed first. */
  ready: Promise<void>
  close: () => void
}

/**
 * PreviewBridgeAdapter: connects the engine to the page inside the Live Preview iframe.
 *
 * Security: the channel is bound to the iframe window and to the preview origin on both sides
 * (the page only accepts the IDE origin, see vendor/.../preload/script/index.ts). The page can
 * call exactly the five notifications below; it gets no access to the Wails bindings, which
 * live on a different origin.
 */
export function connectPreview(engine: EditorEngine, iframe: HTMLIFrameElement, frame: Frame, origin: string, reload: () => void): PreviewBridge {
  const target = iframe.contentWindow
  if (!target || !origin) return { ready: Promise.reject(new Error('The preview page is not available.')), close: () => {} }

  let child: PenpalChildMethods | null = null
  let closed = false

  const methods: PenpalParentMethods = {
    getFrameId: () => frame.id,
    getBranchId: () => frame.branchId,
    onWindowMutated: () => { void engine.frameEvent.handleWindowMutated() },
    onWindowResized: () => { void engine.frameEvent.handleWindowResized() },
    onDomProcessed: (data: { layerMap: Record<string, LayerNode>; rootNode: LayerNode }) => {
      if (isLayerPayload(data)) void engine.frameEvent.handleDomProcessed(frame.id, data)
    },
  }

  const connection = connect<Record<string, never>>({
    messenger: new WindowMessenger({ remoteWindow: target, allowedOrigins: [origin] }),
    methods,
    timeout: CONNECT_TIMEOUT_MS,
  })

  // Every in-page method, promisified; a call made while disconnected answers the safe fallback.
  const remote: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const name of Object.keys(PAGE_METHODS)) {
    remote[name] = async (...args: unknown[]) => {
      const method = child?.[name as keyof PenpalChildMethods] as ((...rest: unknown[]) => unknown) | undefined
      if (!method || closed) return fallback(name)
      try {
        return await method(...args)
      } catch {
        return fallback(name)
      }
    }
  }

  // The view is the iframe element itself (the managers measure it) with the page API on top,
  // as in the transplanted frame view.
  const view = Object.assign(iframe, {
    setZoomLevel: () => {},
    supportsOpenDevTools: () => false,
    reload,
    isLoading: () => child === null,
  }, remote as unknown as PromisifiedPendpalChildMethods) satisfies IFrameView

  engine.frames.registerView(frame, view)

  const ready = connection.promise.then(async (remoteChild) => {
    if (closed) return
    child = remoteChild as unknown as PenpalChildMethods
    await view.setFrameId(frame.id)
    await view.setBranchId(frame.branchId)
    await view.handleBodyReady()
    await view.processDom()
  })

  return {
    ready,
    close: () => {
      closed = true
      child = null
      connection.destroy()
      engine.frames.deregister(frame)
    },
  }
}

/** Shape check of the only structured payload the page sends. */
function isLayerPayload(data: unknown): data is { layerMap: Record<string, LayerNode>; rootNode: LayerNode } {
  if (!data || typeof data !== 'object') return false
  const { layerMap, rootNode } = data as { layerMap?: unknown; rootNode?: unknown }
  return !!layerMap && typeof layerMap === 'object' && !!rootNode && typeof rootNode === 'object' && typeof (rootNode as { domId?: unknown }).domId === 'string'
}
