import { useState } from 'react'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useUiTranslation } from '@/lib/uiI18n'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import heroDark from './assets/hub/hero-dark-stickers.webp'
import heroLight from './assets/hub/hero-light-stickers.webp'
import heroSketch from './assets/hub/hero-sketch-stickers.webp'
import heroBrick from './assets/hub/hero-brick.webp'

/** a0 at the laptop, the Hub's key art. One scene per skin (dark / light / sketch / brick),
 *  picked by CSS from the <html> class and data-skin. Clicking it opens the assistant. */
export function HubMascot() {
  const tr = useUiTranslation()
  const ai = useSettingsStore((state) => state.settings.ai)
  const setActiveRail = useAppStore((state) => state.setActiveRail)
  const [showConnectNotice, setShowConnectNotice] = useState(false)
  const connected = isAICompanionAvailable(ai)

  const openAssistant = () => {
    if (connected) {
      setShowConnectNotice(false)
      document.dispatchEvent(new CustomEvent('adomnia:open-ai-companion'))
      return
    }
    setShowConnectNotice(true)
  }

  const openAISettings = () => {
    setShowConnectNotice(false)
    sessionStorage.setItem('adomnia.settings.requested-section', 'ai')
    setActiveRail('settings')
    window.requestAnimationFrame(() => {
      document.dispatchEvent(new CustomEvent('adomnia:open-settings-section', { detail: 'ai' }))
    })
  }

  return (
    <aside data-hub-mascot className="relative">
      <button
        type="button"
        data-hub-mascot-trigger
        aria-label={tr('Open a0 assistant')}
        title={connected ? tr('Open a0 assistant') : tr('Connect AI to use a0')}
        onClick={openAssistant}
      >
        <img src={heroDark} alt="" draggable={false} data-hub-mascot-scene data-hub-art="dark" />
        <img src={heroLight} alt="" draggable={false} data-hub-mascot-scene data-hub-art="light" />
        <img src={heroSketch} alt="" draggable={false} data-hub-mascot-scene data-hub-art="sketch" />
        <img src={heroBrick} alt="" draggable={false} data-hub-mascot-scene data-hub-art="brick" />
      </button>

      {showConnectNotice && (
        <div role="dialog" aria-label={tr('Connect AI to use a0')} data-hub-mascot-notice
          className="absolute bottom-1 left-1/2 z-20 w-[270px] -translate-x-1/2 rounded-xl border border-accent/40 bg-surface-1/95 p-3 text-left shadow-2xl backdrop-blur">
          <p className="m-0 text-[12px] font-semibold text-text-1">{tr('Connect AI to use a0')}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-3">
            {tr('Choose a provider and model, then verify the connection. a0 will open from the Hub after that.')}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={openAISettings}
              className="flex-1 rounded-md bg-accent px-3 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-light">
              {tr('Configure AI')}
            </button>
            <button type="button" onClick={() => setShowConnectNotice(false)}
              className="rounded-md border border-border-2 px-3 py-1.5 text-[10px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              {tr('Not now')}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
