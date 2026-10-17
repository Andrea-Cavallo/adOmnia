/**
 * Dimensioni e clamp dei pannelli di Code Studio, in un solo posto.
 *
 * Prima erano duplicati: `stores/goide.ts` (clamp al caricamento) e
 * `GoStudioPanel.tsx` (clamp durante il trascinamento) usavano gli stessi numeri
 * copiati, e il doppio click non aveva un default condiviso a cui tornare.
 */

/** Larghezza minima di un pannello laterale, in px. */
export const MIN_PANE_WIDTH = 180
/** Altezza minima della tool window in basso, in px. */
export const MIN_PANE_HEIGHT = 112

/** Spazio editor che deve restare utilizzabile qualunque sia la posizione dei pannelli. */
export const MIN_EDITOR_WIDTH = 160
export const MIN_EDITOR_HEIGHT = 180

/** Dimensioni di ripristino, usate dal doppio click sullo splitter. */
export const DEFAULT_PANE_SIZES = {
  projectWidth: 244,
  structureWidth: 220,
  bottomHeight: 190,
} as const

export type GoIDEPaneSizeKey = keyof typeof DEFAULT_PANE_SIZES

export interface PaneBounds {
  /** Larghezza della griglia del workspace che contiene i pannelli. */
  width: number
  /** Altezza della griglia del workspace che contiene i pannelli. */
  height: number
  /** Larghezza dell'altro pannello laterale quando è aperto (condividono la riga con l'editor). */
  otherWidth?: number
}

/**
 * Porta una dimensione pannello dentro i limiti validi.
 * I pannelli laterali vivono nella riga dell'editor, quello in basso nella colonna.
 */
export function clampPaneSize(key: GoIDEPaneSizeKey, value: number, bounds: PaneBounds): number {
  const horizontal = key === 'bottomHeight'
  const min = horizontal ? MIN_PANE_HEIGHT : MIN_PANE_WIDTH
  const max = horizontal
    ? Math.max(min, bounds.height - MIN_EDITOR_HEIGHT)
    : Math.max(min, bounds.width - (bounds.otherWidth ?? 0) - MIN_EDITOR_WIDTH)
  return Math.min(max, Math.max(min, value))
}
