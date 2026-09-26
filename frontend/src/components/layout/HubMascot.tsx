import { useEffect, useState, type CSSProperties } from 'react'
import { Code2, FileText, GitBranch, Settings2 } from 'lucide-react'
import { isAICompanionAvailable } from '@/lib/aiCompanion'
import { useUiTranslation } from '@/lib/uiI18n'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import hubMascot from './assets/a0-hub-mascot.png'
import hubMascot01 from './assets/a0-hub-mascot-01.png'
import hubMascot02 from './assets/a0-hub-mascot-02.png'
import hubMascot03 from './assets/a0-hub-mascot-03.png'
import hubMascot04 from './assets/a0-hub-mascot-04.png'

const REACTIONS = {
  '01': { x: -1, y: -1, tilt: -1.5, asset: hubMascot01, Icon: Code2 },
  '02': { x: 1, y: -1, tilt: 1, asset: hubMascot02, Icon: FileText },
  '03': { x: -1, y: 1, tilt: -1, asset: hubMascot03, Icon: GitBranch },
  '04': { x: 1, y: 1, tilt: 1.5, asset: hubMascot04, Icon: Settings2 },
}

const POSES = [
  { id: 'rest', asset: hubMascot },
  ...Object.entries(REACTIONS).map(([id, reaction]) => ({ id, asset: reaction.asset })),
]

/** A dedicated full-body render. Do not crop the assistant sprite sheet or
 * rebuild limbs in SVG: both approaches break a0's silhouette at Hub scale. */
export function HubMascot({ target }: { target: string | null }) {
  const tr = useUiTranslation()
  const ai = useSettingsStore((state) => state.settings.ai)
  const setActiveRail = useAppStore((state) => state.setActiveRail)
  const [lookAt, setLookAt] = useState(target)
  const [showConnectNotice, setShowConnectNotice] = useState(false)
  const connected = isAICompanionAvailable(ai)
  useEffect(() => {
    if (target) { setLookAt(target); return }
    const timeout = window.setTimeout(() => setLookAt(null), 140)
    return () => window.clearTimeout(timeout)
  }, [target])
  const reaction = lookAt ? REACTIONS[lookAt as keyof typeof REACTIONS] : undefined
  const style = {
    '--mascot-x': `${(reaction?.x ?? 0) * 2}px`,
    '--mascot-y': `${reaction?.y ?? 0}px`,
    '--mascot-tilt': `${reaction?.tilt ?? 0}deg`,
  } as CSSProperties

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
    <aside data-hub-mascot data-hub-mascot-target={lookAt ?? 'rest'}
      className="relative col-start-2 row-span-2 row-start-1 flex min-h-[300px] items-center justify-center max-xl:col-span-2 max-xl:col-start-auto max-xl:row-auto max-xl:min-h-[230px] max-md:col-span-1">
      <button
        type="button"
        data-hub-mascot-trigger
        aria-label={tr('Open a0 assistant')}
        title={connected ? tr('Open a0 assistant') : tr('Connect AI to use a0')}
        onClick={openAssistant}
      >
        <div data-hub-mascot-stage style={style}>
          <div data-hub-mascot-halo />
          <div data-hub-mascot-rig>
            {POSES.map((pose) => (
              <img
                key={pose.id}
                src={pose.asset}
                alt=""
                draggable={false}
                data-hub-mascot-sprite={pose.id}
                data-visible={(lookAt ?? 'rest') === pose.id ? 'true' : undefined}
              />
            ))}
          </div>
          {/* Persistent layers cross-fade without sliding through other poses. */}
          {Object.entries(REACTIONS).map(([id, { Icon }]) => (
            <span key={id} data-hub-mascot-cue={id} data-visible={lookAt === id ? 'true' : undefined}>
              <Icon size={23} strokeWidth={1.5} />
            </span>
          ))}
        </div>
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
