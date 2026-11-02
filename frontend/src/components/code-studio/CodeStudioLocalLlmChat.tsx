import { useCodeStudioChatHeader } from './CodeStudioChatChrome'
import { useEffect, useRef, useState } from 'react'
import { Cpu, Download, Paperclip, RefreshCw, Send, Square, Trash2, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Browser } from '@wailsio/runtime'
import { renderMarkdown } from '@/lib/markdownDoc'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useSettingsStore } from '@/stores/settings'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { ensureOllama, isOllamaEndpoint, localCompletion, localModels, pullOllamaModel, type LocalLlmConfig } from '@/lib/localLlm'
import { applyLocalProposal, type LocalEditProposal } from '@/lib/code-studio/localLlmTools'
import { readAgentAttachments, type AgentAttachment } from '@/lib/code-studio/agentAttachments'
import { clearLocalChat, ensureLocalConversation, sendLocalChat, stopLocalChat, useLocalLlmChat } from '@/stores/localLlmChat'
import { selectedRange } from './CodeStudioCopilotChat'
import './codeStudioLocalLlmChat.css'
import { LocalModelGuide, type LocalRuntime } from './LocalModelGuide'

const CONFIG_KEY = 'adomnia.localLlm.config.v1'
function initialConfig(): LocalLlmConfig {
  const ai = useSettingsStore.getState().settings.ai
  const fallback = { endpoint: ai.provider === 'ollama' ? `${(ai.baseURL || 'http://localhost:11434').replace(/\/$/, '')}/v1` : ai.provider === 'openai-compatible' ? ai.baseURL || 'http://localhost:1234/v1' : 'http://localhost:1234/v1', model: ['ollama', 'openai-compatible'].includes(ai.provider) ? ai.model : '', vision: false, tools: true }
  try { const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null'); return saved && typeof saved.endpoint === 'string' && typeof saved.model === 'string' ? { endpoint: saved.endpoint, model: saved.model, vision: saved.vision === true, tools: saved.tools !== false } : fallback } catch { return fallback }
}

function Proposal({ session, edit }: { session: GoIDESession; edit: LocalEditProposal }) {
  const [applied, setApplied] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <details className="local-llm-proposal"><summary>{edit.create ? 'New file' : 'Proposed edit'} · {edit.path}</summary><div className="local-llm-diff">{!edit.create && <div><h4>Current</h4><pre>{edit.original}</pre></div>}<div><h4>{edit.create ? 'Content' : 'Proposed'}</h4><pre>{edit.updated}</pre></div></div>{error && <p role="alert">{error}</p>}<button type="button" disabled={applied || busy} onClick={() => { setBusy(true); setError(''); void applyLocalProposal(session, edit).then(() => setApplied(true), reason => setError(String(reason))).finally(() => setBusy(false)) }}>{edit.create ? (applied ? 'File created' : busy ? 'Creating…' : 'Create file') : applied ? 'Applied to unsaved editor buffer' : busy ? 'Applying…' : 'Apply to editor'}</button></details>
}

export function CodeStudioLocalLlmChat({ session, document }: { session: GoIDESession; document: GoIDEEditorDocument | null }) {
  const chrome = useCodeStudioChatHeader()
  const root = session.project.realPath
  const [config, setConfig] = useState(initialConfig), [apiKey, setApiKey] = useState(''), [text, setText] = useState('')
  const [testing, setTesting] = useState(false), [verified, setVerified] = useState('')
  const [setupOpen, setSetupOpen] = useState(!config.model)
  const [setupStep, setSetupStep] = useState(1)
  const [runtime, setRuntime] = useState<LocalRuntime>(() => { try { const saved = localStorage.getItem('adomnia.localLlm.runtime'); if (['unsloth', 'ollama', 'lmstudio', 'custom'].includes(saved ?? '')) return saved as LocalRuntime } catch {} return /:(8000|8888)\/v1\/?$/.test(config.endpoint) ? 'unsloth' : isOllamaEndpoint(config.endpoint) ? 'ollama' : config.endpoint.includes(':1234/') ? 'lmstudio' : 'custom' })
  const [models, setModels] = useState<string[]>([]), [status, setStatus] = useState(''), [error, setError] = useState(''), [discovering, setDiscovering] = useState(false), [pulling, setPulling] = useState('')
  const [includeFile, setIncludeFile] = useState(true), [includeIndex, setIncludeIndex] = useState(true), [paths, setPaths] = useState(''), [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const picker = useRef<HTMLInputElement>(null), discovery = useRef<AbortController | null>(null), transcript = useRef<HTMLDivElement>(null)
  const conversation = useLocalLlmChat(state => state.conversations[root])
  const draft = useCodeStudioAssistantStore(state => state.draft)
  const busy = conversation?.busy ?? false
  useEffect(() => { ensureLocalConversation(root) }, [root])
  useEffect(() => { if (draft !== null) setText(useCodeStudioAssistantStore.getState().takeDraft() ?? '') }, [draft])
  useEffect(() => () => discovery.current?.abort(), [])
  const change = (next: Partial<LocalLlmConfig>) => { const value = { ...config, ...next }; setConfig(value); safeSetItem(CONFIG_KEY, JSON.stringify(value)); setStatus(''); setVerified('') }
  const discover = async (endpoint = config.endpoint) => {
    discovery.current?.abort()
    const controller = new AbortController(); discovery.current = controller
    setDiscovering(true); setError(''); setStatus(''); setVerified('')
    try {
      if (isOllamaEndpoint(endpoint)) { setStatus('Starting Ollama…'); await ensureOllama(endpoint, controller.signal) }
      const found = await localModels({ ...config, endpoint }, apiKey, controller.signal)
      if (controller.signal.aborted) return
      setModels(found); setSetupStep(3)
      if (!config.model && found[0]) change({ model: found[0] })
      setStatus(found.length ? `Server reachable · ${found.length} models` : isOllamaEndpoint(endpoint) ? 'Ollama is running · no models yet. Type a model name (e.g. qwen3.5) and download it.' : 'Server reachable · no models listed. Load a model in the local server.')
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (discovery.current === controller) setDiscovering(false) }
  }
  const pull = async () => {
    const model = config.model.trim(), controller = new AbortController(); discovery.current = controller
    setPulling('Starting download…'); setError('')
    try {
      await ensureOllama(config.endpoint, controller.signal)
      await pullOllamaModel(config.endpoint, model, (step, percent) => setPulling(percent === undefined ? step : `${step} · ${percent}%`), controller.signal)
      setPulling(''); await discover()
    } catch (reason) { setPulling(''); if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const testModel = async () => {
    discovery.current?.abort()
    const controller = new AbortController(); discovery.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 60000)
    setTesting(true); setVerified(''); setError(''); setStatus('Testing a short reply without project files…')
    try {
      const result = await localCompletion(config, [{ role: 'user', content: 'Reply with a short greeting.' }], [], controller.signal, () => {}, apiKey)
      if (!result.text.trim()) throw new Error('No text returned. Load a chat model and retry.')
      if (!controller.signal.aborted) { setVerified(config.endpoint + '\n' + config.model); setStatus('Model responded · ready for project chat') }
    } catch (reason) {
      setStatus('')
      setError(controller.signal.aborted ? 'Test stopped. Check whether the model is still loading and retry.' : reason instanceof Error ? reason.message : String(reason))
    } finally { window.clearTimeout(timeout); setTesting(false) }
  }
  const ready = verified === config.endpoint + '\n' + config.model
  const canPull = isOllamaEndpoint(config.endpoint) && /^[A-Za-z0-9][\w.:/-]*$/.test(config.model.trim()) && !models.includes(config.model.trim()) && !models.includes(`${config.model.trim()}:latest`)
  const send = () => {
    if (!text.trim() || busy || testing) return
    const question = text.trim()
    const context = { documentId: document?.document.id, selection: selectedRange(document), includeDocument: includeFile, includeWorkspace: includeIndex, includeRules: true, includeUnsaved: true, additionalPaths: paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean).slice(0, 10), attachments }
    setError(''); setText(''); setAttachments([])
    void sendLocalChat(session, config, question, context, apiKey)
    requestAnimationFrame(() => transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }))
  }
  return <section className="local-llm-chat" aria-label="Local LLM project chat">
    <header className="local-llm-heading"><div>{chrome ?? <h2><Cpu size={15} />Local LLM</h2>}<p>Unsloth · Ollama · LM Studio</p></div><button type="button" title="New local conversation" aria-label="New local conversation" disabled={busy} onClick={() => clearLocalChat(root)}><Trash2 size={14} /></button></header>
    <details className="local-llm-connection" open={setupOpen} onToggle={event => setSetupOpen(event.currentTarget.open)}><summary>Local model setup <span>{ready ? 'Ready · ' + config.model : config.model || 'Start here'}</span></summary>
      <nav className="local-model-steps" aria-label="Local model setup steps">{['Runtime', 'Connect', 'Model', 'Verify'].map((label, index) => <button key={label} type="button" aria-current={setupStep === index + 1 ? 'step' : undefined} disabled={busy || discovering || testing || Boolean(pulling)} onClick={() => setSetupStep(index + 1)}><span>{String(index + 1).padStart(2, '0')}</span>{label}</button>)}</nav>
      <fieldset disabled={busy || discovering || testing || Boolean(pulling)}>
        {setupStep === 1 && <><LocalModelGuide runtime={runtime} onChoose={value => {
          setRuntime(value); safeSetItem('adomnia.localLlm.runtime', value); setApiKey(''); setModels([])
          change({ endpoint: ({ unsloth: 'http://localhost:8888/v1', ollama: 'http://localhost:11434/v1', lmstudio: 'http://localhost:1234/v1', custom: config.endpoint })[value], model: '', vision: false })
        }} /><button type="button" className="local-model-primary" onClick={() => setSetupStep(2)}>Continue to connection →</button></>}
        {setupStep === 2 && <>
          <h3 className="local-model-title">Connect to {runtime === 'unsloth' ? 'Unsloth' : 'your local server'}</h3>
          {runtime === 'unsloth' && <div className="local-llm-presets">{[8888, 8000].map(port => <button key={port} type="button" aria-pressed={config.endpoint === `http://localhost:${port}/v1`} onClick={() => { change({ endpoint: `http://localhost:${port}/v1` }); setModels([]) }}>Port {port}</button>)}</div>}
          <label>Server endpoint<input aria-label="Local server endpoint" value={config.endpoint} onChange={event => { change({ endpoint: event.target.value }); setModels([]) }} onBlur={() => { try { const url = new URL(config.endpoint); if (url.pathname === '/' || !url.pathname) change({ endpoint: config.endpoint.replace(/\/$/, '') + '/v1' }) } catch {} }} spellCheck={false} /></label>
          <label>Server API key<input aria-label="Local server API key" type="password" autoComplete="off" placeholder={runtime === 'unsloth' ? 'Paste the key from Settings → API' : 'Optional, if required by your server'} value={apiKey} onChange={event => { setApiKey(event.target.value); setVerified(''); setStatus('') }} /></label>
          <p className="local-llm-hint">The key stays in memory for this session. Connect lists available models without sending project files.</p>
          <button type="button" className="local-model-primary" onClick={() => void discover()}><RefreshCw size={13} />{discovering ? 'Connecting…' : 'Connect and find models'}</button>
        </>}
        {setupStep === 3 && <>
          <h3 className="local-model-title">Choose a chat model</h3>
          {models.length > 0 ? <label>Available models<select aria-label="Available local models" value={models.includes(config.model) ? config.model : ''} onChange={event => change({ model: event.target.value, vision: false })}><option value="" disabled>Select a model</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></label> : <p className="local-llm-hint">No models discovered yet. Connect first, or enter the exact model ID below.</p>}
          <label>Model ID<input aria-label="Local model" placeholder="Exact model ID" value={config.model} onChange={event => change({ model: event.target.value, vision: false })} /></label>
          {canPull && <button type="button" onClick={() => void pull()}><Download size={13} />Download with Ollama</button>}
          {runtime === 'unsloth' && <p className="local-llm-hint">Download and load the model in Unsloth before testing it here. Prefer a smaller quantized model if memory is limited.</p>}
          <label className="local-llm-check"><input type="checkbox" checked={config.vision} onChange={event => change({ vision: event.target.checked })} />This model accepts images</label>
          <button type="button" className="local-model-primary" disabled={!config.model.trim()} onClick={() => setSetupStep(4)}>Continue to verification →</button>
        </>}
      </fieldset>
      {setupStep === 4 && <div className="local-model-guide"><h3>{ready ? 'Ready for project chat' : 'Check that the model responds'}</h3><p className="local-model-selected">{config.model || 'Choose a model first'}</p><p>The test sends a short greeting request without project files. Vision and project tools depend on the selected model.</p><button className="local-model-primary" type="button" disabled={busy || discovering || Boolean(pulling) || !config.model.trim() || testing} onClick={() => void testModel()}>{testing ? 'Waiting for the model…' : ready ? 'Test again' : 'Test model'}</button>{testing && <button type="button" onClick={() => discovery.current?.abort()}>Cancel test</button>}{ready && <button type="button" onClick={() => { setSetupOpen(false); requestAnimationFrame(() => window.document.querySelector<HTMLTextAreaElement>('[aria-label="Message local model"]')?.focus()) }}>Start chatting →</button>}</div>}
      {pulling ? <p role="status">Downloading {config.model.trim()} · {pulling}</p> : status && <p role="status">{status}</p>}
    </details>
    <div ref={transcript} className="local-llm-transcript" aria-label="Conversation" aria-busy={busy}>
      {!conversation?.turns.length && <div className="local-llm-empty"><h3>Ask about this project</h3><p>Attach the open file or let the model search files and symbols. Every proposed edit stays in preview until you apply it.</p></div>}
      {conversation?.turns.map(turn => <article key={turn.id} className="local-llm-turn"><h3>You</h3><p className="local-llm-question">{turn.question}</p>{turn.sources.length > 0 && <details className="local-llm-sources"><summary>Context supplied · {turn.sources.length} sources</summary><ul>{turn.sources.map((source, index) => <li key={index}>{source}</li>)}</ul></details>}{turn.tools.length > 0 && <p className="local-llm-tool-log">Tool requests: {turn.tools.join(' → ')}</p>}<h3>Local model</h3><div className="local-llm-answer" data-a11y-click-exempt role="presentation" onClick={event => { const link = (event.target as Element).closest('a'); if (link) { event.preventDefault(); const href = link.getAttribute('href') ?? ''; if (/^https?:\/\//i.test(href)) void Browser.OpenURL(href) } }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(turn.answer || (busy ? 'Working…' : '')), { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] }) }} />{turn.proposals.map((edit, index) => <Proposal key={index} session={session} edit={edit} />)}</article>)}
    </div>
    {(error || conversation?.error) && <div role="alert" className="local-llm-error">{error || conversation?.error}{error && <p>{/401|403|unauthorized/i.test(error) ? 'Check your API key. In Unsloth, create one in Settings → API, then reconnect.' : /fetch|connect|refused|network/i.test(error) ? 'Start the local server and check its port. Unsloth commonly uses 8000 or 8888.' : /model|404|memory|load/i.test(error) ? 'Load a chat model in your runtime and copy its exact ID. If memory is exhausted, choose a smaller quantization.' : 'Check the runtime’s API monitor, then retry the connection or model test.'}</p>}</div>}
    <div className="local-llm-composer">
      <details className="local-llm-context"><summary>Project context</summary><fieldset disabled={busy}><label className="local-llm-check"><input type="checkbox" checked={includeFile} onChange={event => setIncludeFile(event.target.checked)} />Open file and selected code</label><label className="local-llm-check"><input type="checkbox" checked={includeIndex} onChange={event => setIncludeIndex(event.target.checked)} />Project index and runtime context</label><label className="local-llm-check"><input type="checkbox" checked={config.tools} onChange={event => change({ tools: event.target.checked })} />Allow project tools (read, search, propose edits and new files)</label><label>Additional project files, one relative path per line<textarea aria-label="Additional project files" rows={2} value={paths} onChange={event => setPaths(event.target.value)} /></label><p className="local-llm-hint">AI exclusions and redaction apply. Replies are saved locally; image bytes and edit proposals are not saved with chat history.</p></fieldset></details>
      {attachments.length > 0 && <div className="local-llm-attachments">{attachments.map((item, index) => <button key={index} type="button" onClick={() => setAttachments(current => current.filter((_, at) => at !== index))}>{item.name}<X size={12} /></button>)}</div>}
      <textarea aria-label="Message local model" placeholder="Ask about code, a problem or a screenshot…" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} rows={3} />
      <div className="local-llm-send-row"><input ref={picker} type="file" multiple className="hidden" aria-label="Attach files to local chat" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void readAgentAttachments(files, config.vision).then(items => { if (attachments.length + items.length > 6) throw new Error('Attach at most six files'); setAttachments(current => [...current, ...items]); setError('') }).catch(reason => setError(String(reason))) }} /><button type="button" aria-label="Attach files or images" disabled={busy} onClick={() => picker.current?.click()}><Paperclip size={15} /></button><span>{busy ? 'Generating locally…' : config.model || 'Configure a local model'}</span>{busy ? <button type="button" onClick={() => stopLocalChat(root)}><Square size={13} />Stop</button> : <button type="button" disabled={!text.trim() || !config.model || testing} onClick={send}><Send size={13} />Send</button>}</div>
    </div>
  </section>
}
