import { useState } from 'react'
import { Sparkles, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { Select, TextInput, PasswordInput, Toggle } from './SettingsFields'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai',    label: 'OpenAI' },
  { value: 'gemini',    label: 'Google Gemini' },
  { value: 'ollama',    label: 'Ollama (local)' },
]

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-4o',
  gemini:    'gemini-2.0-flash',
  ollama:    'llama3',
}

export function AISettings() {
  const ai = useSettingsStore((s) => s.settings.ai)
  const updateAi = useSettingsStore((s) => s.updateAi)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleProviderChange = (provider: string) => {
    updateAi({
      provider: provider as typeof ai.provider,
      model: DEFAULT_MODELS[provider] ?? '',
    })
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const config = JSON.stringify({
        provider: ai.provider,
        model: ai.model,
        api_key: ai.apiKey,
        base_url: ai.baseURL,
      })
      const msg = await AIEngine.TestConnection(config)
      setTestResult({ ok: true, msg })
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const config = JSON.stringify({
      provider: ai.provider,
      model: ai.model,
      api_key: ai.apiKey,
      base_url: ai.baseURL,
    })
    await AIEngine.Configure(config).catch(() => { /* non-fatal */ })
  }

  const needsApiKey = ai.provider !== 'ollama'
  const needsBaseURL = ai.provider === 'ollama'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-1">AI Engine</h2>
      </div>

      <div className="flex flex-col gap-4">
        <Toggle
          label="Enable AI features"
          desc="AI-powered mock generation, completions, and assistant features"
          checked={ai.enabled}
          onChange={v => updateAi({ enabled: v })}
        />

        <Select
          label="Provider"
          desc="Choose your AI provider"
          value={ai.provider}
          onChange={handleProviderChange}
          options={PROVIDERS}
        />

        <TextInput
          label="Model"
          desc="Model identifier (e.g. claude-sonnet-4-6, gpt-4o, llama3)"
          value={ai.model}
          onChange={v => updateAi({ model: v })}
          placeholder={DEFAULT_MODELS[ai.provider] ?? 'model-name'}
        />

        {needsApiKey && (
          <PasswordInput
            label="API Key"
            desc="Your API key — stored locally, never sent anywhere except the provider"
            value={ai.apiKey}
            onChange={v => updateAi({ apiKey: v })}
            placeholder="sk-…"
          />
        )}

        {needsBaseURL && (
          <TextInput
            label="Base URL"
            desc="Ollama API base URL"
            value={ai.baseURL}
            onChange={v => updateAi({ baseURL: v })}
            placeholder="http://localhost:11434"
          />
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleTestConnection}
            disabled={testing || !ai.enabled}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-2 border border-border-1 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            {testing ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={!ai.enabled}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
          >
            Save
          </button>
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 px-3 py-2 rounded text-xs border ${
            testResult.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {testResult.ok
              ? <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
              : <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            }
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>
    </div>
  )
}
