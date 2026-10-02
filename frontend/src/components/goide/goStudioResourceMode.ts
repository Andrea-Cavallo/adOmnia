/** normal: tutto attivo · low: funzioni pesanti spente · auto: low solo a batteria (portatile scollegato). */
export type GoStudioResourceMode = 'normal' | 'low' | 'auto'

/** Funzioni dell'editor che la modalità a basso consumo spegne; le preferenze dell'utente restano salvate com'erano. */
export const HEAVY_EDITOR_FEATURES = ['semanticHighlighting', 'inlayHints', 'typeHints', 'stickyScroll', 'lintOnSave'] as const
export type GoStudioHeavyFeature = (typeof HEAVY_EDITOR_FEATURES)[number]

export function isLowResource(mode: GoStudioResourceMode | undefined, onBattery: boolean): boolean {
  return mode === 'low' || (mode === 'auto' && onBattery)
}

/** Preferenza effettiva: attiva solo se l'utente la vuole e la modalità a basso consumo non è in corso. */
export function heavyFeatureEnabled(state: { preferences: Record<GoStudioHeavyFeature, boolean> & { resourceMode?: GoStudioResourceMode }; onBattery: boolean }, feature: GoStudioHeavyFeature): boolean {
  return state.preferences[feature] && !isLowResource(state.preferences.resourceMode, state.onBattery)
}

interface BatteryLike extends EventTarget {
  charging: boolean
}

/**
 * Segue lo stato dell'alimentazione con la Battery Status API (WebView2/Chromium).
 * Dove non esiste (WebKitGTK, macOS WebKit) la modalità "auto" resta semplicemente normale.
 */
export function watchBattery(onChange: (onBattery: boolean) => void): () => void {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery
  if (typeof getBattery !== 'function') return () => undefined
  let battery: BatteryLike | null = null
  let disposed = false
  const update = () => { if (battery && !disposed) onChange(!battery.charging) }
  getBattery.call(navigator).then((result) => {
    if (disposed) return
    battery = result
    battery.addEventListener('chargingchange', update)
    update()
  }).catch(() => undefined)
  return () => {
    disposed = true
    battery?.removeEventListener('chargingchange', update)
  }
}
