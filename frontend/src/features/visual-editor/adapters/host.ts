import { makeAutoObservable } from 'mobx'
import type { RectPosition } from '@onlook/models'

/** Telemetry sink of the transplanted managers. adOmnia has no telemetry: events are dropped. */
export interface Analytics {
  capture: (event: string, properties?: Record<string, unknown>) => void
}

export const noAnalytics: Analytics = { capture: () => {} }

/**
 * Canvas transform of the engine. The Live Preview is not a pan/zoom canvas: the page sits at
 * the origin at scale 1, so overlay rectangles map 1:1 onto the iframe.
 */
export class CanvasManager {
  scale = 1
  position: RectPosition = { x: 0, y: 0 }

  constructor() {
    makeAutoObservable(this)
  }

  getDefaultPanPosition(): RectPosition {
    return { x: 0, y: 0 }
  }

  clear() {
    this.scale = 1
    this.position = { x: 0, y: 0 }
  }
}

/** Brand colour lookup of the original theme manager. No design-token registry yet: no match. */
export class ThemeManager {
  getColorByName(_name: string): string | undefined {
    return undefined
  }

  clear() {}
}
