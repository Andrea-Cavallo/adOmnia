import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PluginInstance, PluginSetting } from '@/stores/plugins'
import { getPluginSettings, setPluginSetting } from '@/lib/plugins-api'

interface PluginSettingsProps {
  plugin: PluginInstance
  onSaved: () => void
}

export function PluginSettings({ plugin, onSaved }: PluginSettingsProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  const loadSettings = useCallback(async () => {
    const loaded = await getPluginSettings(plugin.manifest.id)
    setValues(loaded)
    setDirty(false)
  }, [plugin.manifest.id])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    const entries = Object.entries(values)
    for (const [key, value] of entries) {
      await setPluginSetting(plugin.manifest.id, key, value)
    }
    setDirty(false)
    onSaved()
  }

  const handleReset = () => {
    const defaults: Record<string, string> = {}
    plugin.manifest.settings.forEach((s) => {
      defaults[s.key] = s.default
    })
    setValues(defaults)
    setDirty(true)
  }

  const renderField = (setting: PluginSetting) => {
    const value = values[setting.key] ?? setting.default

    switch (setting.type) {
      case 'boolean':
        return (
          <button
            type="button"
            onClick={() => handleChange(setting.key, value === 'true' ? 'false' : 'true')}
            className={cn(
              'relative w-8 h-4 rounded-full transition-colors',
              value === 'true' ? 'bg-accent' : 'bg-surface-3'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                value === 'true' ? 'left-[18px]' : 'left-0.5'
              )}
            />
          </button>
        )
      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className="w-32 px-2 py-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 focus:outline-none focus:border-accent"
          />
        )
      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className="w-40 px-2 py-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 focus:outline-none focus:border-accent"
          >
            {(setting.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      case 'string':
      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className="w-48 px-2 py-1 text-xs bg-surface-2 border border-border-1 rounded text-text-1 focus:outline-none focus:border-accent"
          />
        )
    }
  }

  return (
    <div className="space-y-3">
      <h5 className="text-[10px] font-medium uppercase tracking-wider text-text-4">Settings</h5>
      <div className="space-y-2.5">
        {plugin.manifest.settings.map((setting) => (
          <div key={setting.key} className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-text-2 font-medium block">{setting.label}</label>
              {setting.description && (
                <p className="text-[10px] text-text-4 mt-0.5">{setting.description}</p>
              )}
            </div>
            <div className="flex-shrink-0">
              {renderField(setting)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            dirty
              ? 'bg-accent text-white hover:opacity-90'
              : 'bg-surface-2 text-text-4 cursor-not-allowed'
          )}
        >
          <Save size={11} />
          Save
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-3 hover:text-text-1 transition-colors"
        >
          <RotateCcw size={11} />
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}
