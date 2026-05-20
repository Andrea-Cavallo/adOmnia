import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  getThrottleProfiles,
  setThrottling,
  clearThrottling,
  type ThrottleProfile,
} from '@/lib/browser-debug-api'
import {
  Gauge,
  Wifi,
  WifiOff,
  Signal,
  X,
} from 'lucide-react'

export type { ThrottleProfile }

const DEFAULT_PROFILES: ThrottleProfile[] = [
  { name: 'No Throttling', downloadKbps: -1, uploadKbps: -1, latencyMs: 0 },
  { name: 'Slow 3G', downloadKbps: 400, uploadKbps: 400, latencyMs: 2000 },
  { name: 'Fast 3G', downloadKbps: 1500, uploadKbps: 750, latencyMs: 563 },
  { name: 'Regular 4G', downloadKbps: 4000, uploadKbps: 3000, latencyMs: 170 },
  { name: 'WiFi', downloadKbps: 30000, uploadKbps: 15000, latencyMs: 2 },
  { name: 'Offline', downloadKbps: 0, uploadKbps: 0, latencyMs: 0 },
]

function formatSpeed(kbps: number): string {
  if (kbps < 0) return 'Unlimited'
  if (kbps === 0) return '0 Kbps'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${kbps} Kbps`
}

function getProfileIcon(name: string) {
  if (name === 'Offline') return WifiOff
  if (name === 'WiFi') return Wifi
  return Signal
}

export function ThrottlingPanel() {
  const [profiles, setProfiles] = useState<ThrottleProfile[]>(DEFAULT_PROFILES)
  const [selectedProfile, setSelectedProfile] = useState<string>('No Throttling')

  // Custom profile inputs
  const [customDownload, setCustomDownload] = useState('')
  const [customUpload, setCustomUpload] = useState('')
  const [customLatency, setCustomLatency] = useState('')

  useEffect(() => {
    const load = async () => {
      const fetched = await getThrottleProfiles()
      if (fetched.length > 0) {
        setProfiles(fetched)
      }
    }
    load()
  }, [])

  const handleSelectProfile = useCallback(
    async (profile: ThrottleProfile) => {
      setSelectedProfile(profile.name)
      if (profile.name === 'No Throttling') {
        await clearThrottling()
      } else {
        await setThrottling(
          profile.downloadKbps,
          profile.uploadKbps,
          profile.latencyMs
        )
      }
    },
    []
  )

  const handleApplyCustom = useCallback(async () => {
    const download = parseInt(customDownload, 10)
    const upload = parseInt(customUpload, 10)
    const latency = parseInt(customLatency, 10)

    if (isNaN(download) || isNaN(upload) || isNaN(latency)) return

    setSelectedProfile('Custom')
    await setThrottling(download, upload, latency)
  }, [customDownload, customUpload, customLatency])

  const handleClear = useCallback(async () => {
    setSelectedProfile('No Throttling')
    await clearThrottling()
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Toolbar */}
      <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Gauge size={12} className="text-text-3" />
        <span className="text-[10px] font-medium text-text-2 uppercase tracking-wide">
          Network Throttling
        </span>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          title="Clear throttling"
          className="h-6 px-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex items-center gap-1"
        >
          <X size={10} />
          Clear
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Preset profiles grid */}
        <div>
          <div className="text-[10px] text-text-3 uppercase tracking-wide font-medium mb-2">
            Preset Profiles
          </div>
          <div className="grid grid-cols-3 gap-2">
            {profiles.map((profile) => {
              const Icon = getProfileIcon(profile.name)
              const isSelected = selectedProfile === profile.name
              return (
                <button
                  key={profile.name}
                  onClick={() => handleSelectProfile(profile)}
                  className={cn(
                    'flex flex-col items-start p-2.5 rounded-md border transition-colors text-left',
                    isSelected
                      ? 'border-accent bg-accent/5'
                      : 'border-border-1 bg-surface-0 hover:border-text-3 hover:bg-surface-2/50'
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon
                      size={12}
                      className={cn(
                        isSelected ? 'text-accent' : 'text-text-3'
                      )}
                    />
                    <span
                      className={cn(
                        'text-[11px] font-medium',
                        isSelected ? 'text-accent' : 'text-text-1'
                      )}
                    >
                      {profile.name}
                    </span>
                  </div>
                  <div className="space-y-0.5 text-[9px] text-text-3">
                    <div>
                      Down: {formatSpeed(profile.downloadKbps)}
                    </div>
                    <div>
                      Up: {formatSpeed(profile.uploadKbps)}
                    </div>
                    <div>Latency: {profile.latencyMs}ms</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom profile */}
        <div>
          <div className="text-[10px] text-text-3 uppercase tracking-wide font-medium mb-2">
            Custom Profile
          </div>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-text-3">Download (Kbps)</label>
              <input
                type="text"
                value={customDownload}
                onChange={(e) => setCustomDownload(e.target.value)}
                placeholder="4000"
                className="h-7 w-28 px-2 rounded bg-surface-0 border border-border-1 text-xs text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-text-3">Upload (Kbps)</label>
              <input
                type="text"
                value={customUpload}
                onChange={(e) => setCustomUpload(e.target.value)}
                placeholder="3000"
                className="h-7 w-28 px-2 rounded bg-surface-0 border border-border-1 text-xs text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-text-3">Latency (ms)</label>
              <input
                type="text"
                value={customLatency}
                onChange={(e) => setCustomLatency(e.target.value)}
                placeholder="100"
                className="h-7 w-28 px-2 rounded bg-surface-0 border border-border-1 text-xs text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={handleApplyCustom}
              className="h-7 px-3 rounded bg-accent/10 border border-accent/30 text-xs text-accent font-medium hover:bg-accent/20 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
