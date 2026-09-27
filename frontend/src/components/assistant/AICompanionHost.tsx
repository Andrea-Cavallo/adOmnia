import { lazy, Suspense, useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { isAICompanionAvailable } from '@/lib/aiAvailability'

const AICompanion = lazy(() => import('./AICompanion').then((module) => ({ default: module.AICompanion })))

/** Mount a verified assistant after the first frame, or immediately on demand.
 * Capture early Hub clicks while its chunk is loading so that none are lost. */
export function AICompanionHost({ ready }: { ready: boolean }) {
  const available = useSettingsStore((state) => isAICompanionAvailable(state.settings.ai))
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (!available) {
      setRequested(false)
      return
    }
    const open = () => setRequested(true)
    document.addEventListener('adomnia:open-ai-companion', open)
    return () => document.removeEventListener('adomnia:open-ai-companion', open)
  }, [available])

  if (!available || (!ready && !requested)) return null
  return <Suspense fallback={null}><AICompanion initiallyOpen={requested} /></Suspense>
}
