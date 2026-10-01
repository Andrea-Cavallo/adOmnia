import { useEffect, useRef, useState } from 'react'
import { CheckCircle, AlertCircle, RefreshCw, Lock, ShieldCheck, Search, Cpu, Gauge, Brain, Coins, Shield, Radio, Copy, ChevronDown, ArrowLeft } from 'lucide-react'
import { useSettingsStore, type AIModelSummary, type AIProvider, type AIUsageProfile } from '@/stores/settings'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { TextInput, PasswordInput, Toggle } from './SettingsFields'
import { ClaudeCodeSettingsNotice } from './ClaudeCodeSettingsNotice'
import { isVaultRef, encryptToVaultRef } from '@/lib/vaultRefs'
import { withAIConfig } from '@/lib/aiEngine'
import { useEnvironmentsStore } from '@/stores/environments'
import { findAIWorkspaceCredential, providerCredentialKeys } from '@/lib/aiCredentials'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', desc: 'Claude API', local: false },
  { value: 'amazon-bedrock', label: 'Amazon Bedrock', desc: 'Claude via AWS IAM / SSO', local: false },
  { value: 'openai', label: 'OpenAI', desc: 'GPT API', local: false },
  { value: 'gemini', label: 'Google Gemini', desc: 'Gemini API', local: false },
  { value: 'deepseek', label: 'DeepSeek', desc: 'V4 API', local: false },
  { value: 'huggingface', label: 'Hugging Face', desc: 'Inference Providers', local: false },
  { value: 'ollama', label: 'Ollama', desc: 'Local models', local: true },
  { value: 'openai-compatible', label: 'OpenAI-compatible', desc: 'LM Studio, vLLM, llama.cpp', local: true },
]

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-5-5',
  'amazon-bedrock': 'anthropic.claude-opus-5-5',
  openai: 'gpt-6-sol',
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-flash',
  huggingface: 'openai/gpt-oss-120b:preferred',
  ollama: 'qwen3.5',
  'openai-compatible': '',
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: '', 'amazon-bedrock': '', openai: '', gemini: '',
  deepseek: 'https://api.deepseek.com',
  huggingface: 'https://router.huggingface.co/v1',
  ollama: 'http://localhost:11434',
  'openai-compatible': 'http://localhost:1234/v1',
}

interface ModelOption { id: string; label: string; detail: string; badge?: string }
type DiscoveredModel = AIModelSummary

interface GatewayStatus {
  running: boolean
  endpoint?: string
  port?: number
  provider?: string
  token?: string
}

const USAGE_PROFILES: { id: AIUsageProfile; label: string; desc: string; icon: typeof Gauge }[] = [
  { id: 'recommended', label: 'Recommended', desc: 'Best balance for adOmnia work', icon: Gauge },
  { id: 'quality', label: 'Best quality', desc: 'Prefer deeper reasoning and coding', icon: Brain },
  { id: 'efficient', label: 'Fast & efficient', desc: 'Prefer lower latency and cost', icon: Coins },
  { id: 'local', label: 'Private local AI', desc: 'Use Ollama; nothing is sent to a cloud provider', icon: Shield },
]

const CURATED_MODELS: Record<string, ModelOption[]> = {
  anthropic: [
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', detail: 'Most capable Claude for the hardest, long-horizon work', badge: 'Frontier' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', detail: 'Anthropic-recommended model for most workloads', badge: 'Recommended' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', detail: 'High intelligence with faster responses' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', detail: 'Fastest and most cost-efficient Claude' },
  ],
  'amazon-bedrock': [
    { id: 'anthropic.claude-fable-5-1', label: 'Claude Fable 5.1', detail: 'Bedrock base model ID; an inference profile ID or ARN is also accepted', badge: 'Frontier' },
    { id: 'anthropic.claude-opus-5-5', label: 'Claude Opus 5.5', detail: 'Anthropic-recommended Claude through Bedrock Converse', badge: 'Recommended' },
    { id: 'anthropic.claude-sonnet-5', label: 'Claude Sonnet 5', detail: 'Faster Claude for coding and agentic work' },
    { id: 'anthropic.claude-haiku-4-5', label: 'Claude Haiku 4.5', detail: 'Fast, efficient Claude through Bedrock' },
  ],
  openai: [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', detail: 'OpenAI’s most capable model for the hardest end-to-end work', badge: 'Frontier' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', detail: 'Strong reasoning for demanding coding and agentic workflows', badge: 'Recommended' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', detail: 'Efficient, repeatable work at high volume' },
  ],
  gemini: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', detail: 'Latest stable balance of speed and intelligence', badge: 'Frontier' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', detail: 'Most intelligent stable model for agentic and coding work', badge: 'Recommended' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', detail: 'Fastest, lowest-cost Gemini 3.5 model' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', detail: 'Advanced reasoning and complex tasks', badge: 'Preview' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', detail: 'Highest-capability DeepSeek model for complex agentic work', badge: 'Quality' },
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', detail: 'Fast 1M-context model for coding, tools and daily work', badge: 'Recommended' },
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
    return `No ${provider} credential was found in process variables, adOmnia Environments, standard .env files, or the Vault.`
  }
  if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
    return `adOmnia reached ${provider}, but the key cannot list models for this account. Check the key and its permissions.`
  }
  if (provider === 'Amazon Bedrock' && /(credential|SSO|profile|AccessDenied|Unauthorized)/i.test(message)) {
    return 'AWS could not authorize this request. Check the profile/SSO session, region, model access, and bedrock:ListFoundationModels permission.'
  }
  if (message.includes('model discovery failed')) {
    return `Could not reach ${provider}. Check the network or the configured local endpoint.`
  }
  return message
}

function suggestedModel(profile: Exclude<AIUsageProfile, 'local'>, models: ModelOption[]): string | undefined {
  const score = (model: ModelOption) => {
    const text = `${model.id} ${model.label} ${model.detail}`.toLowerCase()
    if (profile === 'quality') return /(frontier|opus|astra|pro|fable)/.test(text) ? 2 : 0
    if (profile === 'efficient') return /(haiku|luna|lite|nano|mini|fast)/.test(text) ? 2 : 0
    return model.badge === 'Recommended' ? 2 : 0
  }
  return [...models].sort((a, b) => score(b) - score(a))[0]?.id
}

export function AISettings() {
  const ai = useSettingsStore((s) => s.settings.ai)
  const updateAi = useSettingsStore((s) => s.updateAi)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const savedAIRef = useRef(ai)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [securing, setSecuring] = useState(false)
  const [secureError, setSecureError] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [autoCheckedProvider, setAutoCheckedProvider] = useState<AIProvider | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({ running: false })
  const [gatewayBusy, setGatewayBusy] = useState(false)
  const [gatewayError, setGatewayError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const usesEnvironmentCredentials = ai.credentialMode !== 'vault'
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
      updateAi({
        connectionVerifiedAt: new Date().toISOString(),
        connectionProvider: ai.provider,
        connectionModel: ai.model,
      })
      setTestResult({ ok: true, msg })
    } catch (e) {
      updateAi({ connectionVerifiedAt: '', connectionProvider: '', connectionModel: '' })
      setTestResult({ ok: false, msg: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    try {
      await withAIConfig(async (config) => {
        await AIEngine.Configure(config)
        if (ai.gatewayEnabled) {
          const raw = await AIEngine.StartGateway(config, ai.gatewayPort)
          setGatewayStatus(JSON.parse(raw) as GatewayStatus)
        } else {
          await AIEngine.StopGateway()
          setGatewayStatus({ running: false })
        }
      })
      setTestResult({ ok: true, msg: ai.gatewayEnabled ? 'AI engine and local agent gateway configured.' : 'AI engine configured.' })
      savedAIRef.current = ai
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) })
    }
  }

  const handleGatewayStart = async () => {
    setGatewayBusy(true)
    setGatewayError('')
    try {
      const raw = await withAIConfig((config) => AIEngine.StartGateway(config, ai.gatewayPort))
      setGatewayStatus(JSON.parse(raw) as GatewayStatus)
      updateAi({ gatewayEnabled: true })
    } catch (error) {
      setGatewayError(String(error))
    } finally {
      setGatewayBusy(false)
    }
  }

  const handleGatewayStop = async () => {
    setGatewayBusy(true)
    setGatewayError('')
    try {
      await AIEngine.StopGateway()
      setGatewayStatus({ running: false })
      updateAi({ gatewayEnabled: false })
    } catch (error) {
      setGatewayError(String(error))
    } finally {
      setGatewayBusy(false)
    }
  }

  const copyGatewayValue = async (kind: 'endpoint' | 'token' | 'pi' | 'opencode') => {
    const endpoint = gatewayStatus.endpoint ?? `http://127.0.0.1:${ai.gatewayPort}/v1`
    const token = gatewayStatus.token ?? ''
    const model = ai.model || 'your-model-id'
    const values = {
      endpoint,
      token,
      pi: JSON.stringify({ providers: { adomnia: { baseUrl: endpoint, api: 'openai-completions', apiKey: token, models: [{ id: model }] } } }, null, 2),
      opencode: JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { adomnia: { npm: '@ai-sdk/openai-compatible', name: 'adOmnia', options: { baseURL: endpoint, apiKey: token }, models: { [model]: { name: model } } } } }, null, 2),
    }
    await navigator.clipboard.writeText(values[kind])
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

  const isBedrock = ai.provider === 'amazon-bedrock'
  const needsApiKey = ai.provider !== 'ollama' && !isBedrock
  const apiKeyOptional = ai.provider === 'openai-compatible'
  const needsBaseURL = ['amazon-bedrock', 'deepseek', 'ollama', 'huggingface', 'openai-compatible'].includes(ai.provider)
  const gatewaySupported = ['ollama', 'openai', 'deepseek', 'huggingface', 'openai-compatible'].includes(ai.provider)
  const providerInfo = PROVIDERS.find((provider) => provider.value === ai.provider)
  const catalog = ai.modelCatalogs[ai.provider]
  const discoveredModels = catalog?.models ?? []
  const curatedModels = (CURATED_MODELS[ai.provider] ?? []).filter((model) => {
    const query = modelQuery.trim().toLowerCase()
    return !query || `${model.label} ${model.id} ${model.detail}`.toLowerCase().includes(query)
  })
  const workspaceCredential = findAIWorkspaceCredential(ai.provider, environments, activeEnvId)
  const modelOptions = [...discoveredModels.map((model) => ({
    id: model.id,
    label: model.name || model.id,
    detail: model.owner ?? '',
    context: formatContext(model.context),
    badge: model.local ? 'Installed' : 'Live',
  })), ...curatedModels.map((model) => ({ ...model, context: '' }))]
    .filter((model, index, models) => models.findIndex((candidate) => candidate.id === model.id) === index)

  useEffect(() => {
    if (!ai.enabled || ai.modelUpdatePolicy !== 'when-open' || autoCheckedProvider === ai.provider) return
    setAutoCheckedProvider(ai.provider)
    void discoverModels()
  }, [ai.enabled, ai.modelUpdatePolicy, ai.provider, autoCheckedProvider])

  useEffect(() => {
    AIEngine.GatewayStatus()
      .then((raw) => setGatewayStatus(JSON.parse(raw) as GatewayStatus))
      .catch(() => setGatewayStatus({ running: false }))
  }, [])

  return (
    <div data-ai-settings className="-mx-8 -mb-16 -mt-6 flex min-h-[720px] flex-col max-lg:-mx-5 max-md:-mx-4">
      <header className="border-b border-border-1 px-8 py-6 max-lg:px-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <button type="button" onClick={() => document.dispatchEvent(new CustomEvent('adomnia:open-settings-section', { detail: 'general' }))} className="mb-4 inline-flex items-center gap-2 text-[11px] text-text-4 hover:text-text-1">
              <ArrowLeft size={13} /> Settings <span>/</span> Intelligence
            </button>
            <h2 className="text-2xl font-semibold tracking-tight text-text-1">AI Engine</h2>
            <p className="mt-1 text-xs text-text-3">Configure how AI works in adOmnia.</p>
          </div>
          <div className="flex items-center gap-3 pt-8">
            <span className="text-xs font-medium text-text-2">Enabled</span>
            <button type="button" role="switch" aria-checked={ai.enabled} onClick={() => updateAi({ enabled: !ai.enabled })} className={`relative h-6 w-11 rounded-full border transition-colors ${ai.enabled ? 'border-accent bg-accent' : 'border-border-3 bg-surface-3'}`}>
              <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${ai.enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-[minmax(220px,1fr)_minmax(520px,2fr)] items-center border-b border-border-1 px-8 py-5 max-lg:grid-cols-1 max-lg:gap-3 max-lg:px-5">
        <div><h3 className="text-sm font-semibold text-text-1">Optimization</h3><p className="mt-1 text-[11px] text-text-4">Choose how adOmnia should optimize AI usage.</p></div>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border-2 max-md:grid-cols-2">
          {USAGE_PROFILES.map((profile) => <button key={profile.id} type="button" onClick={() => handleProfileChange(profile.id)} className={`h-10 border-r border-border-2 px-3 text-[11px] font-medium last:border-r-0 ${ai.usageProfile === profile.id ? 'bg-accent/15 text-text-1 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-surface-1 text-text-3 hover:bg-surface-2 hover:text-text-1'}`}>{profile.id === 'recommended' ? 'Balanced' : profile.id === 'efficient' ? 'Fast' : profile.id === 'local' ? 'Local only' : 'Quality'}</button>)}
        </div>
      </section>

      <section className="grid grid-cols-[minmax(220px,1fr)_minmax(520px,2fr)] items-center border-b border-border-1 px-8 py-4 max-lg:grid-cols-1 max-lg:gap-3 max-lg:px-5">
        <div><h3 className="text-sm font-semibold text-text-1">Agent actions</h3><p className="mt-1 text-[11px] text-text-4">Choose whether a0 may act on explicit workspace requests.</p></div>
        <div className="rounded-lg border border-border-2 bg-surface-1 px-4">
          <Toggle label="Allow a0 to create and update workspace items" desc="When enabled, explicit chat requests can create root API requests and open them for review. Credentials and secret values remain protected." checked={ai.workspaceActionsEnabled} onChange={(workspaceActionsEnabled) => updateAi({ workspaceActionsEnabled })} />
        </div>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-[290px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="border-r border-border-1 px-6 py-6 max-lg:border-b max-lg:border-r-0">
          <h3 className="text-base font-semibold text-text-1">Providers</h3><p className="mt-1 text-[11px] text-text-4">Choose a provider to configure.</p>
          {(['cloud', 'local'] as const).map((group) => <div key={group} className="mt-6">
            <div className="mb-2 border-b border-border-1 pb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-4">{group}</div>
            <div className="space-y-1">
              {PROVIDERS.filter((provider) => provider.local === (group === 'local')).map((provider) => {
                const selected = ai.provider === provider.value
                return <button key={provider.value} type="button" onClick={() => handleProviderChange(provider.value)} className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                  {selected && <span className="absolute inset-y-0 left-0 w-1 rounded-r bg-accent" />}
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${provider.local ? 'bg-success/10 text-success' : 'bg-surface-3 text-text-1'}`}>{provider.value === 'deepseek' ? 'DS' : provider.local ? <Cpu size={16} /> : provider.label.slice(0, 1)}</span>
                  <span className="min-w-0"><span className="block text-[11px] font-semibold">{provider.label}</span><span className="block truncate text-[9px] text-text-4">{provider.desc}</span></span>
                </button>
              })}
            </div>
          </div>)}
        </aside>

        <main className="min-w-0 px-8 py-7 max-lg:px-5">
          <div className="flex items-start gap-4">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold ${providerInfo?.local ? 'bg-success/10 text-success' : 'bg-surface-3 text-text-1'}`}>{ai.provider === 'deepseek' ? 'DS' : providerInfo?.local ? <Cpu size={21} /> : providerInfo?.label.slice(0, 1)}</span>
            <div><h3 className="text-xl font-semibold text-text-1">{providerInfo?.label}</h3><p className="text-xs text-text-4">{providerInfo?.local ? 'Local provider' : 'Cloud provider'}</p></div>
          </div>
          <p className="mt-5 max-w-3xl text-[11px] leading-relaxed text-text-3">Configure {providerInfo?.label}. Credentials stay local and are only sent to the selected provider when you run an AI action.</p>

          {needsApiKey && <section className="mt-6 border-b border-border-1 pb-6">
            <label className="mb-2 block text-xs font-semibold text-text-1">API key</label>
            <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 max-md:grid-cols-1">
              <div className="flex h-10 items-center gap-3 rounded-md border border-border-2 bg-surface-1 px-3">
                <Lock size={13} className={workspaceCredential || keyIsSecured ? 'text-success' : 'text-text-4'} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2">{usesEnvironmentCredentials ? (workspaceCredential ? `••••••••  ${workspaceCredential.key}` : 'Automatic credential discovery') : keyIsSecured ? '••••••••  encrypted in Vault' : 'No Vault key configured'}</span>
                {workspaceCredential && <span className="rounded bg-success/10 px-2 py-1 text-[8px] uppercase tracking-wider text-success">{workspaceCredential.environmentName}</span>}
              </div>
              <button type="button" onClick={handleTestConnection} disabled={testing || !ai.enabled || !ai.model.trim()} className="h-10 rounded-md border border-border-2 bg-surface-1 px-4 text-[11px] font-semibold text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40">{testing ? 'Testing…' : 'Test connection'}</button>
            </div>
            <p className="mt-2 text-[9px] text-text-4">Automatic order: process variables → active adOmnia Environment → other saved/imported `.env` environments → standard `.env` files → encrypted Vault fallback.</p>
          </section>}

          {(ai.provider === 'anthropic' || isBedrock) && <ClaudeCodeSettingsNotice provider={ai.provider} />}

          <section className="mt-6">
            <div className="flex items-end justify-between gap-4"><div><h4 className="text-base font-semibold text-text-1">Models</h4><p className="mt-1 text-[11px] text-text-4">Select a model from this provider. Results are saved locally.</p></div><button type="button" onClick={() => updateAi({ modelUpdatePolicy: ai.modelUpdatePolicy === 'when-open' ? 'manual' : 'when-open' })} className={`rounded px-2 py-1 text-[9px] ${ai.modelUpdatePolicy === 'when-open' ? 'bg-success/10 text-success' : 'text-text-4 hover:bg-surface-2'}`}>Auto refresh {ai.modelUpdatePolicy === 'when-open' ? 'on' : 'off'}</button></div>
            <div className="mt-4 flex gap-3"><div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-3 focus-within:border-accent"><Search size={14} className="text-text-4" /><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void discoverModels() }} placeholder="Search models…" className="h-full min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" /></div><button type="button" onClick={() => void discoverModels()} disabled={discovering} aria-label="Refresh models" className="grid h-10 w-11 place-items-center rounded-md border border-border-2 bg-surface-1 text-text-3 hover:text-text-1 disabled:opacity-40"><RefreshCw size={14} className={discovering ? 'animate-spin' : ''} /></button></div>
            {discoverError && <p className="mt-3 rounded border border-error/30 bg-error/8 px-3 py-2 text-[10px] text-error">{discoverError}</p>}
            <div className="mt-3 overflow-hidden rounded-md border border-border-2">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_90px] bg-surface-2 px-4 py-2 text-[9px] font-semibold text-text-3"><span>Model</span><span>Context</span><span>Selection</span></div>
              <div className="max-h-72 overflow-y-auto">
                {modelOptions.map((model) => { const selected = ai.model === model.id; return <button key={model.id} type="button" onClick={() => updateAi({ model: model.id })} className={`grid w-full grid-cols-[minmax(0,1fr)_110px_90px] items-center border-t border-border-1 px-4 py-3 text-left ${selected ? 'bg-accent/12' : 'bg-surface-1 hover:bg-surface-2'}`}>
                  <span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-[11px] font-semibold text-text-1">{model.label}</span>{model.badge && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[8px] text-text-3">{model.badge}</span>}</span><span className="mt-1 block truncate font-mono text-[9px] text-text-4">{model.id}</span></span>
                  <span className="text-[10px] text-text-3">{model.context || '—'}</span><span className="grid h-5 w-5 place-items-center rounded-full border border-border-3">{selected && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}</span>
                </button> })}
                {modelOptions.length === 0 && <p className="p-8 text-center text-[11px] text-text-4">Refresh models or enter a custom model ID below.</p>}
              </div>
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-md border border-border-2">
            <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex h-11 w-full items-center gap-3 bg-surface-1 px-4 text-left text-[11px] font-medium text-text-2 hover:bg-surface-2"><ChevronDown size={13} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} /> Advanced settings</button>
            {advancedOpen && <div className="space-y-5 border-t border-border-1 bg-surface-0/40 p-4">
              <TextInput label="Selected / custom model ID" desc="Use an exact provider model ID." value={ai.model} onChange={(model) => updateAi({ model })} placeholder={DEFAULT_MODELS[ai.provider] ?? 'organization/model-name'} />
              {needsApiKey && <div className="rounded-md border border-border-2 bg-surface-1 px-3"><Toggle label="Automatic credential discovery" desc={`Checks ${providerCredentialKeys(ai.provider).join(', ') || 'provider-native credentials'}, adOmnia Environments and standard .env files before the Vault.`} checked={usesEnvironmentCredentials} onChange={(enabled) => updateAi({ credentialMode: enabled ? 'auto' : 'vault' })} /></div>}
              {needsApiKey && !usesEnvironmentCredentials && !keyIsSecured && <div className="space-y-3"><PasswordInput label="API key" desc={apiKeyOptional ? 'Optional for secured compatible servers.' : 'Encrypt this key into the local Vault.'} value={ai.apiKey} onChange={(apiKey) => updateAi({ apiKey })} placeholder="sk-…" />{ai.apiKey.trim() && <div className="flex gap-2"><input type="password" value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} placeholder="Vault passphrase…" className="h-9 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-3 text-xs text-text-1 outline-none focus:border-accent" /><button type="button" onClick={handleSecureKey} disabled={securing || !vaultPassphrase} className="rounded bg-accent px-3 text-[10px] font-semibold text-white disabled:opacity-40">Secure in Vault</button></div>}{secureError && <p className="text-[10px] text-error">{secureError}</p>}</div>}
              {keyIsSecured && <div className="flex items-center justify-between rounded border border-success/25 bg-success/5 px-3 py-2 text-[10px] text-success"><span className="flex items-center gap-2"><ShieldCheck size={13} /> API key encrypted in the Vault</span><button type="button" onClick={handleReplaceKey} className="text-text-2 hover:text-text-1">Replace</button></div>}
              {isBedrock && <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1"><TextInput label="AWS Region" desc="Bedrock region." value={ai.awsRegion} onChange={(awsRegion) => updateAi({ awsRegion })} placeholder="us-east-1" /><TextInput label="AWS Profile" desc="Optional shared/SSO profile." value={ai.awsProfile} onChange={(awsProfile) => updateAi({ awsProfile })} placeholder="company-sso" /></div>}
              {needsBaseURL && <TextInput label={isBedrock ? 'Bedrock runtime endpoint' : 'Base URL'} desc="Override the provider endpoint only when needed." value={ai.baseURL} onChange={(baseURL) => updateAi({ baseURL })} placeholder={DEFAULT_BASE_URLS[ai.provider] ?? ''} />}
              <div className="rounded-md border border-border-2 bg-surface-1 p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Radio size={14} className={gatewayStatus.running ? 'text-success' : 'text-text-4'} /><div><div className="text-[11px] font-semibold text-text-1">Local agent gateway</div><div className="text-[9px] text-text-4">OpenAI-compatible endpoint on 127.0.0.1.</div></div></div><span className={`text-[9px] ${gatewayStatus.running ? 'text-success' : 'text-text-4'}`}>{gatewayStatus.running ? 'Running' : 'Stopped'}</span></div>
                {gatewaySupported ? <><div className="mt-3 grid grid-cols-[1fr_120px] items-center gap-3"><Toggle label="Enable gateway" desc="Protected by a generated local token." checked={ai.gatewayEnabled} onChange={(gatewayEnabled) => updateAi({ gatewayEnabled })} /><input type="number" min={1024} max={65535} value={ai.gatewayPort} onChange={(event) => updateAi({ gatewayPort: Math.max(1024, Math.min(65535, Number(event.target.value) || 11435)) })} className="h-9 rounded border border-border-2 bg-surface-2 px-3 font-mono text-xs text-text-1" /></div><div className="mt-3 flex items-center gap-2">{gatewayStatus.running ? <button type="button" onClick={() => void handleGatewayStop()} className="rounded border border-error/30 px-3 py-1.5 text-[10px] text-error">Stop gateway</button> : <button type="button" onClick={() => void handleGatewayStart()} disabled={gatewayBusy || !ai.enabled || !ai.model.trim()} className="rounded bg-accent px-3 py-1.5 text-[10px] text-white disabled:opacity-40">Start gateway</button>}{gatewayStatus.endpoint && <><code className="min-w-0 flex-1 truncate text-[9px] text-success">{gatewayStatus.endpoint}</code><button type="button" onClick={() => void copyGatewayValue('endpoint')} className="text-text-3"><Copy size={12} /></button></>}</div></> : <p className="mt-3 text-[9px] text-warning">This provider uses a protocol that cannot be proxied through the local gateway.</p>}
                {gatewayError && <p className="mt-2 text-[10px] text-error">{gatewayError}</p>}
              </div>
            </div>}
          </section>

          {testResult && <div className={`mt-4 flex items-start gap-2 rounded border px-3 py-2 text-[10px] ${testResult.ok ? 'border-success/30 bg-success/8 text-success' : 'border-error/30 bg-error/8 text-error'}`}>{testResult.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}<span>{testResult.msg}</span></div>}
        </main>
      </div>

      <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border-1 bg-surface-0/95 px-8 py-4 backdrop-blur max-lg:px-5">
        <div><div className="text-[9px] text-text-4">Active configuration</div><div className="mt-1 text-[11px] text-text-1">{providerInfo?.label} <span className="mx-2 text-text-4">/</span> <span className="font-mono">{ai.model || 'No model selected'}</span></div></div>
        <div className="flex gap-2"><button type="button" onClick={() => { updateAi(savedAIRef.current); setTestResult(null) }} className="h-9 rounded-md border border-border-2 px-5 text-[11px] text-text-2 hover:bg-surface-2">Cancel</button><button type="button" onClick={handleSave} disabled={!ai.enabled || !ai.model.trim()} className="h-9 rounded-md bg-accent px-5 text-[11px] font-semibold text-white hover:bg-accent-light disabled:opacity-40">Save changes</button></div>
      </footer>
    </div>
  )
}
