import { useEffect, useState } from 'react'
import { Sparkles, CheckCircle, AlertCircle, RefreshCw, Lock, ShieldCheck, Search, Cpu, Cloud, Database, Check, Gauge, Brain, Coins, Shield } from 'lucide-react'
import { useSettingsStore, type AIModelSummary, type AIProvider, type AIUsageProfile } from '@/stores/settings'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { TextInput, PasswordInput, Toggle } from './SettingsFields'
import { isVaultRef, encryptToVaultRef } from '@/lib/vaultRefs'
import { withAIConfig } from '@/lib/aiEngine'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', desc: 'Claude API', local: false },
  { value: 'openai', label: 'OpenAI', desc: 'GPT API', local: false },
  { value: 'gemini', label: 'Google Gemini', desc: 'Gemini API', local: false },
  { value: 'huggingface', label: 'Hugging Face', desc: 'Inference Providers', local: false },
  { value: 'ollama', label: 'Ollama', desc: 'Local models', local: true },
  { value: 'openai-compatible', label: 'OpenAI-compatible', desc: 'LM Studio, vLLM, llama.cpp', local: true },
]

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra',
  gemini: 'gemini-3.5-flash',
  huggingface: 'openai/gpt-oss-120b:preferred',
  ollama: 'qwen3.5',
  'openai-compatible': '',
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: '', openai: '', gemini: '',
  huggingface: 'https://router.huggingface.co/v1',
  ollama: 'http://localhost:11434',
  'openai-compatible': 'http://localhost:1234/v1',
}

const ENVIRONMENT_VARIABLES: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ADOMNIA_AI_API_KEY'],
  openai: ['OPENAI_API_KEY', 'ADOMNIA_AI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ADOMNIA_AI_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN', 'ADOMNIA_AI_API_KEY'],
  'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY', 'ADOMNIA_AI_API_KEY'],
}

interface ModelOption { id: string; label: string; detail: string; badge?: string }
type DiscoveredModel = AIModelSummary

const USAGE_PROFILES: { id: AIUsageProfile; label: string; desc: string; icon: typeof Gauge }[] = [
  { id: 'recommended', label: 'Recommended', desc: 'Best balance for adOmnia work', icon: Gauge },
  { id: 'quality', label: 'Best quality', desc: 'Prefer deeper reasoning and coding', icon: Brain },
  { id: 'efficient', label: 'Fast & efficient', desc: 'Prefer lower latency and cost', icon: Coins },
  { id: 'local', label: 'Private local AI', desc: 'Use Ollama; nothing is sent to a cloud provider', icon: Shield },
]

const CURATED_MODELS: Record<string, ModelOption[]> = {
  anthropic: [
    { id: 'claude-fable-5', label: 'Claude Fable 5', detail: 'Most capable widely available Claude for demanding, long-horizon work', badge: 'Frontier' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', detail: 'Complex agentic coding and enterprise work' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', detail: 'Best speed and intelligence balance for coding and agents', badge: 'Recommended' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', detail: 'Fastest and most cost-efficient Claude' },
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: 'Flagship model for complex reasoning and coding', badge: 'Frontier' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', detail: 'Balances intelligence and cost for professional work', badge: 'Recommended' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', detail: 'Cost-sensitive, high-volume workloads' },
  ],
  gemini: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', detail: 'Latest stable balance of speed and intelligence', badge: 'Frontier' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', detail: 'Most intelligent stable model for agentic and coding work', badge: 'Recommended' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', detail: 'Fastest, lowest-cost Gemini 3.5 model' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', detail: 'Advanced reasoning and complex tasks', badge: 'Preview' },
  ],
  huggingface: [
    { id: 'openai/gpt-oss-120b:preferred', label: 'GPT-OSS 120B', detail: 'Strong open model with tool calling', badge: 'Recommended' },
    { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct:preferred', label: 'Qwen3 Coder 480B', detail: 'Large coding model' },
    { id: 'deepseek-ai/DeepSeek-V3-0324:preferred', label: 'DeepSeek V3', detail: 'Current open model available through Inference Providers' },
  ],
  ollama: [
    { id: 'qwen3.5', label: 'Qwen 3.5', detail: 'Current multimodal local family for tools and reasoning', badge: 'Recommended' },
    { id: 'qwen3.6', label: 'Qwen 3.6', detail: 'Recent agentic coding and thinking improvements' },
    { id: 'gpt-oss:20b', label: 'GPT-OSS 20B', detail: 'Strong general-purpose local model' },
    { id: 'gemma4', label: 'Gemma 4', detail: 'Frontier-level local reasoning, coding and multimodal family' },
  ],
  'openai-compatible': [],
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M ctx` : `${Math.round(tokens / 1000)}k ctx`
}

function readableDiscoveryError(error: unknown, provider: string): string {
  const message = String(error)
  if (message.includes('AI environment credential is missing')) {
    return `No ${provider} credential was found. Use the system environment setting below or save a key in the Vault.`
  }
  if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
    return `adOmnia reached ${provider}, but the key cannot list models for this account. Check the key and its permissions.`
  }
  if (message.includes('model discovery failed')) {
    return `Could not reach ${provider}. Check the network or the configured local endpoint.`
  }
  return message
}

function suggestedModel(profile: Exclude<AIUsageProfile, 'local'>, models: ModelOption[]): string | undefined {
  const score = (model: ModelOption) => {
    const text = `${model.id} ${model.label} ${model.detail}`.toLowerCase()
    if (profile === 'quality') return /(frontier|opus|sol|pro|fable)/.test(text) ? 2 : 0
    if (profile === 'efficient') return /(haiku|luna|lite|nano|mini|fast)/.test(text) ? 2 : 0
    return model.badge === 'Recommended' ? 2 : 0
  }
  return [...models].sort((a, b) => score(b) - score(a))[0]?.id
}

export function AISettings() {
  const ai = useSettingsStore((s) => s.settings.ai)
  const updateAi = useSettingsStore((s) => s.updateAi)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [securing, setSecuring] = useState(false)
  const [secureError, setSecureError] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [autoCheckedProvider, setAutoCheckedProvider] = useState<AIProvider | null>(null)

  const usesEnvironmentCredentials = ai.credentialMode !== 'vault'
  const usesAutomaticEnvironmentCredentials = ai.credentialMode === 'auto'
  const keyIsSecured = !usesEnvironmentCredentials && isVaultRef(ai.apiKey)

  const handleProviderChange = (provider: string) => {
    updateAi({
      provider: provider as AIProvider,
      model: DEFAULT_MODELS[provider] ?? '',
      baseURL: DEFAULT_BASE_URLS[provider] ?? '',
    })
    setModelQuery('')
    setDiscoverError('')
    setTestResult(null)
  }

  const discoverModels = async () => {
    setDiscovering(true)
    setDiscoverError('')
    try {
      const raw = await withAIConfig((config) => AIEngine.ListModels(config, modelQuery.trim()))
      const models = JSON.parse(raw) as DiscoveredModel[]
      const previous = ai.modelCatalogs[ai.provider]?.models ?? []
      const cachedModels = modelQuery.trim()
        ? [...previous, ...models].filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index)
        : models
      updateAi({
        modelCatalogs: {
          ...ai.modelCatalogs,
          [ai.provider]: { checkedAt: new Date().toISOString(), models: cachedModels },
        },
      })
    } catch (e) {
      setDiscoverError(readableDiscoveryError(e, providerInfo?.label ?? 'the provider'))
    } finally {
      setDiscovering(false)
    }
  }

  const handleProfileChange = (profile: AIUsageProfile) => {
    if (profile === 'local') {
      updateAi({
        usageProfile: profile,
        provider: 'ollama',
        model: ai.provider === 'ollama' ? ai.model : '',
        baseURL: ai.provider === 'ollama' ? ai.baseURL : DEFAULT_BASE_URLS.ollama,
      })
      setModelQuery('')
      setDiscoverError('')
      return
    }
    const available = ai.modelCatalogs[ai.provider]?.models ?? []
    const choices: ModelOption[] = [
      ...available.map((model) => ({ id: model.id, label: model.name || model.id, detail: model.owner ?? '', badge: model.local ? 'Installed' : 'Live' })),
      ...(CURATED_MODELS[ai.provider] ?? []),
    ].filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index)
    updateAi({ usageProfile: profile, model: suggestedModel(profile, choices) ?? ai.model })
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const msg = await withAIConfig((config) => AIEngine.TestConnection(config))
      setTestResult({ ok: true, msg })
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    try {
      await withAIConfig((config) => AIEngine.Configure(config))
      setTestResult({ ok: true, msg: 'AI engine configured.' })
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) })
    }
  }

  // Encrypt the currently-entered plaintext key with the vault passphrase and
  // replace it in settings with a vault: reference, so it is never stored
  // in plaintext localStorage.
  const handleSecureKey = async () => {
    setSecureError('')
    setSecuring(true)
    try {
      const ref = await encryptToVaultRef(ai.apiKey, vaultPassphrase)
      updateAi({ apiKey: ref })
      setVaultPassphrase('')
    } catch (e) {
      setSecureError(String(e))
    } finally {
      setSecuring(false)
    }
  }

  const handleReplaceKey = () => {
    updateAi({ apiKey: '' })
    setTestResult(null)
  }

  const needsApiKey = ai.provider !== 'ollama'
  const apiKeyOptional = ai.provider === 'openai-compatible'
  const needsBaseURL = ['ollama', 'huggingface', 'openai-compatible'].includes(ai.provider)
  const supportsDiscovery = true
  const providerInfo = PROVIDERS.find((provider) => provider.value === ai.provider)
  const catalog = ai.modelCatalogs[ai.provider]
  const discoveredModels = catalog?.models ?? []
  const curatedModels = (CURATED_MODELS[ai.provider] ?? []).filter((model) => {
    const query = modelQuery.trim().toLowerCase()
    return !query || `${model.label} ${model.id} ${model.detail}`.toLowerCase().includes(query)
  })

  useEffect(() => {
    if (!ai.enabled || ai.modelUpdatePolicy !== 'when-open' || autoCheckedProvider === ai.provider) return
    setAutoCheckedProvider(ai.provider)
    void discoverModels()
  }, [ai.enabled, ai.modelUpdatePolicy, ai.provider, autoCheckedProvider])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-1">AI Engine</h2>
      </div>

      <div className="flex flex-col gap-4">
        <Toggle
          label="Enable AI features"
          desc="AI-powered mock generation, scripts, OpenAPI, flows, and Git assistance."
          checked={ai.enabled}
          onChange={v => updateAi({ enabled: v })}
        />

        <div className="rounded-xl border border-border-2 bg-surface-1 p-3">
          <div className="mb-3 px-1">
            <div className="text-xs font-semibold text-text-1">Choose how adOmnia should optimize AI</div>
            <div className="mt-1 text-[10px] text-text-4">You can still select any exact model below. adOmnia never switches it in the background.</div>
          </div>
          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            {USAGE_PROFILES.map((profile) => {
              const selected = ai.usageProfile === profile.id
              const Icon = profile.icon
              return (
                <button
                  key={profile.id}
                  onClick={() => handleProfileChange(profile.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${selected ? 'border-accent/60 bg-accent/10' : 'border-border-2 bg-surface-2 hover:border-accent/35'}`}
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${profile.id === 'local' ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}><Icon size={14} /></span>
                  <span className="min-w-0"><span className="block text-[11px] font-semibold text-text-1">{profile.label}</span><span className="block text-[9px] text-text-4">{profile.desc}</span></span>
                  {selected && <Check size={13} className="ml-auto shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 px-1">
            <div className="text-xs text-text-1">Provider</div>
            <div className="text-[10px] text-text-4">Cloud APIs, private runtimes and local-first engines.</div>
          </div>
          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            {PROVIDERS.map((provider) => {
              const selected = ai.provider === provider.value
              return (
                <button
                  key={provider.value}
                  onClick={() => handleProviderChange(provider.value)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${selected ? 'border-accent/60 bg-accent/10 shadow-[0_0_0_1px_var(--color-accent-glow)]' : 'border-border-2 bg-surface-1 hover:border-accent/30 hover:bg-surface-2'}`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${provider.local ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}>
                    {provider.local ? <Cpu size={15} /> : <Cloud size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-text-1">{provider.label}</span>
                    <span className="block truncate text-[9px] text-text-4">{provider.desc}</span>
                  </span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? 'bg-accent shadow-[0_0_8px_var(--color-accent-glow)]' : 'bg-border-3'}`} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border-2 bg-surface-1">
          <div className="flex items-start justify-between gap-3 border-b border-border-1 bg-surface-0/70 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-text-1">
                {providerInfo?.local ? <Cpu size={14} className="text-success" /> : <Cloud size={14} className="text-accent" />}
                Model Library
              </div>
              <p className="mt-1 text-[10px] text-text-4">Live models from this provider, saved locally with their last verification time.</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wider ${providerInfo?.local ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}>
              {providerInfo?.local ? 'Local' : 'Cloud'}
            </span>
          </div>

          <div className="p-3">
            <div className="flex gap-2">
              <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-2 bg-surface-2 px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10">
                <Search size={13} className="shrink-0 text-text-4" />
                <input
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && supportsDiscovery) void discoverModels() }}
                  placeholder={ai.provider === 'huggingface' ? 'Search live Hugging Face chat models…' : 'Filter models…'}
                  className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-text-1 outline-none placeholder:text-text-4"
                />
              </div>
              {supportsDiscovery && (
                <button
                  onClick={() => void discoverModels()}
                  disabled={discovering}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-2 bg-surface-2 px-3 text-[11px] font-medium text-text-2 transition-colors hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
                >
                  {discovering ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
                  {ai.provider === 'huggingface' ? 'Search Hub' : 'Refresh models'}
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-text-4">
              <span>{catalog?.checkedAt ? `Last checked ${new Date(catalog.checkedAt).toLocaleString()}` : 'Models have not been checked from this provider yet.'}</span>
              <button
                onClick={() => updateAi({ modelUpdatePolicy: ai.modelUpdatePolicy === 'when-open' ? 'manual' : 'when-open' })}
                className={`rounded px-1.5 py-1 transition-colors ${ai.modelUpdatePolicy === 'when-open' ? 'bg-success/10 text-success hover:bg-success/15' : 'hover:bg-surface-3 hover:text-text-2'}`}
                title="This is opt-in and contacts only the provider you selected when the AI Engine screen opens."
              >
                {ai.modelUpdatePolicy === 'when-open' ? 'Auto-check on open: on' : 'Auto-check on open: off'}
              </button>
            </div>

            {discoverError && <p className="mt-2 rounded border border-error/30 bg-error/8 px-2 py-1.5 text-[10px] text-error">{discoverError}</p>}
            {catalog && ai.model.trim() && !discoveredModels.some((model) => model.id === ai.model) && (
              <p className="mt-2 rounded border border-warning/30 bg-warning/8 px-2 py-1.5 text-[10px] text-text-3">The selected model was not found in the last provider check. It may be a custom ID, unavailable to this account, or retired; test the connection before relying on it.</p>
            )}

            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {[...discoveredModels.map((model) => ({
                id: model.id,
                label: model.name || model.id,
                detail: [model.owner, formatContext(model.context), model.local ? 'installed' : 'live'].filter(Boolean).join(' · '),
                badge: model.local ? 'Installed' : 'Live',
              })), ...curatedModels]
                .filter((model, index, models) => models.findIndex((candidate) => candidate.id === model.id) === index)
                .map((model) => {
                  const selected = ai.model === model.id
                  return (
                    <button
                      key={model.id}
                      onClick={() => updateAi({ model: model.id })}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:border-border-2 hover:bg-surface-2'}`}
                    >
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-accent bg-accent text-white' : 'border-border-3 text-transparent'}`}><Check size={11} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[11px] font-medium text-text-1">{model.label}</span>
                          {model.badge && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-text-3">{model.badge}</span>}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] text-text-4">{model.id}</span>
                        {model.detail && <span className="mt-0.5 block text-[9px] text-text-3">{model.detail}</span>}
                      </span>
                    </button>
                  )
                })}
              {curatedModels.length === 0 && discoveredModels.length === 0 && (
                <p className="py-5 text-center text-[11px] text-text-4">{supportsDiscovery ? 'Search or discover models from the active provider.' : 'Enter a custom model ID below.'}</p>
              )}
            </div>

            <div className="mt-3 border-t border-border-1 pt-3">
              <label className="mb-1.5 block text-[10px] font-medium text-text-3">Selected / custom model ID</label>
              <input
                value={ai.model}
                onChange={(event) => updateAi({ model: event.target.value })}
                placeholder={DEFAULT_MODELS[ai.provider] ?? 'organization/model-name'}
                className="h-9 w-full rounded-lg border border-border-2 bg-surface-2 px-3 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
            </div>
          </div>
        </div>

        {needsApiKey && keyIsSecured && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-green-500/30 bg-green-500/10">
              <div className="flex items-center gap-2 text-xs text-green-400">
                <ShieldCheck size={14} className="flex-shrink-0" />
                <span>API key is encrypted in the Vault. Unlock the Vault to use AI features.</span>
              </div>
              <button
                onClick={handleReplaceKey}
                className="px-2.5 py-1 text-[11px] rounded border border-border-1 text-text-2 hover:text-text-1 hover:bg-surface-3 transition-colors flex-shrink-0"
              >
                Replace
              </button>
            </div>
          </div>
        )}

        {needsApiKey && (
          <div className="rounded-lg border border-border-2 bg-surface-1 px-3 py-1">
            <Toggle
              label="Automatically use system environment credentials"
              desc="Use the machine key first; the Vault is only a fallback when no environment key exists."
              checked={usesEnvironmentCredentials}
              onChange={(enabled) => updateAi({ credentialMode: enabled ? 'auto' : 'vault' })}
            />
            {usesEnvironmentCredentials && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-success/30 bg-success/8 px-2.5 py-2 text-[10px] text-text-3">
                <Database size={13} className="mt-0.5 shrink-0 text-success" />
                <span>
                  {usesAutomaticEnvironmentCredentials ? 'adOmnia checks ' : 'Vault is bypassed. Set '}<code className="font-mono text-success">{(ENVIRONMENT_VARIABLES[ai.provider] ?? ['ADOMNIA_AI_API_KEY']).join(' or ')}</code>{usesAutomaticEnvironmentCredentials ? ' first. If no key is found, it uses the saved Vault key instead. The environment value is never shown or saved in Settings.' : ' in the system environment, then restart adOmnia. The value is never shown or saved in Settings.'}
                </span>
              </div>
            )}
          </div>
        )}

        {needsApiKey && !usesEnvironmentCredentials && !keyIsSecured && (
          <div className="flex flex-col gap-3">
            <PasswordInput
              label="API Key"
              desc={apiKeyOptional ? 'Optional token for secured OpenAI-compatible servers.' : 'Encrypt it into the Vault below — avoid leaving it in plaintext settings.'}
              value={ai.apiKey}
              onChange={v => updateAi({ apiKey: v })}
              placeholder="sk-…"
            />
            {ai.apiKey.trim() !== '' && (
              <div className="flex flex-col gap-2 px-3 py-3 rounded border border-border-1 bg-surface-2">
                <div className="flex items-center gap-2 text-[11px] text-text-2">
                  <Lock size={12} className="text-accent flex-shrink-0" />
                  <span>Secure this key in the Vault (stored encrypted as a <code className="text-accent">vault:</code> reference)</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={e => setVaultPassphrase(e.target.value)}
                    placeholder="Vault passphrase…"
                    className="flex-1 h-7 px-2 bg-surface-0 border border-border-1 rounded text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent"
                  />
                  <button
                    onClick={handleSecureKey}
                    disabled={securing || !vaultPassphrase}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    {securing ? <RefreshCw size={12} className="animate-spin" /> : <Lock size={12} />}
                    Secure in Vault
                  </button>
                </div>
                {secureError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-red-400">
                    <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>{secureError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {needsBaseURL && (
          <TextInput
            label="Base URL"
            desc={ai.provider === 'ollama' ? 'Ollama API base URL' : ai.provider === 'huggingface' ? 'Hugging Face OpenAI-compatible router' : 'OpenAI-compatible API base URL'}
            value={ai.baseURL}
            onChange={v => updateAi({ baseURL: v })}
            placeholder={DEFAULT_BASE_URLS[ai.provider] ?? 'http://localhost:1234/v1'}
          />
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleTestConnection}
            disabled={testing || !ai.enabled || !ai.model.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-2 border border-border-1 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            {testing ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={!ai.enabled || !ai.model.trim()}
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
