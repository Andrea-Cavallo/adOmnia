import { makeAutoObservable } from 'mobx'
import type { Frame } from '@onlook/models'
import type { IFrameView } from './frame-view'

export interface FrameData {
  frame: Frame
  view: IFrameView | null
  selected: boolean
}

/**
 * Frames of the engine. The original keeps many frames on an infinite canvas, stored in a
 * database; the Live Preview shows one page per session, so this keeps the same read API over
 * the frame the preview registers and drops persistence.
 */
export class FramesManager {
  private frameIdToData = new Map<string, FrameData>()

  constructor() {
    makeAutoObservable(this)
  }

  get selected(): FrameData[] {
    return this.getAll().filter((data) => data.selected)
  }

  getAll(): FrameData[] {
    return Array.from(this.frameIdToData.values())
  }

  get(id: string): FrameData | null {
    return this.frameIdToData.get(id) ?? null
  }

  isSelected(id: string): boolean {
    return this.frameIdToData.get(id)?.selected ?? false
  }

  registerView(frame: Frame, view: IFrameView | null) {
    this.frameIdToData.set(frame.id, { frame, view, selected: true })
  }

  deregister(frame: Frame) {
    this.frameIdToData.delete(frame.id)
  }

  /** The single preview frame is always the selected one. */
  select(_frames: Frame[], _multiselect = false) {}

  deselectAll() {}

  clear() {
    this.frameIdToData.clear()
  }
}
