import type { PromisifiedPendpalChildMethods } from '@onlook/penpal'

/**
 * The preview iframe plus the in-page editing API. Same shape as the frame view of the
 * transplanted canvas, so the managers use it unchanged; built by adapters/preview-bridge.ts
 * on top of the Live Preview iframe instead of a canvas-owned iframe.
 */
export type IFrameView = HTMLIFrameElement & {
  setZoomLevel: (level: number) => void
  supportsOpenDevTools: () => boolean
  reload: () => void
  isLoading: () => boolean
} & PromisifiedPendpalChildMethods
