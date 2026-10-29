import { useCodeStudioChatHeader } from './CodeStudioChatChrome'
import { useEffect, useRef, useState } from 'react'
import { Cpu, Paperclip, RefreshCw, Send, Square, Trash2, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Browser } from '@wailsio/runtime'
import { renderMarkdown } from '@/lib/markdownDoc'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useSettingsStore } from '@/stores/settings'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { localModels, type LocalLlmConfig } from '@/lib/localLlm'
import { applyLocalProposal, type LocalEditProposal } from '@/lib/code-studio/localLlmTools'
import { readAgentAttachments, type AgentAttachment } from '@/lib/code-studio/agentAttachments'
import { clearLocalChat, ensureLocalConversation, sendLocalChat, stopLocalChat, useLocalLlmChat } from '@/stores/localLlmChat'
import { selectedRange } from './CodeStudioCopilotChat'
import './codeStudioLocalLlmChat.css'

const CONFIG_KEY = 'adomnia.localLlm.config.v1'
function initialConfig(): LocalLlmConfig {
  const ai = useSettingsStore.getState().settings.ai
  const fallback = { endpoint: ai.provider === 'ollama' ? `${(ai.baseURL || 'http://localhost:11434').replace(/\/$/, '')}/v1` : ai.provider === 'openai-compatible' ? ai.baseURL || 'http://localhost:1234/v1' : 'http://localhost:1234/v1', model: ['ollama', 'openai-compatible'].includes(ai.provider) ? ai.model : '', vision: false, tools: true }
  try { const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null'); return saved && typeof saved.endpoint === 'string' && typeof saved.model === 'string' ? { endpoint: saved.endpoint, model: saved.model, vision: saved.vision === true, tools: saved.tools !== false } : fallback } catch { return fallback }
}

function Proposal({ session, edit }: { session: GoIDESession; edit: LocalEditProposal }) {
  const [applied, setApplied] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <details className="local-llm-proposal"><summary>Proposed edit · {edit.path}</summary><div className="local-llm-diff"><div><h4>Current</h4><pre>{edit.original}</pre></div><div><h4>Proposed</h4><pre>{edit.updated}</pre></div></div>{error && <p role="alert">{error}</p>}<button type="button" disabled={applied || busy} onClick={() => { setBusy(true); setError(''); void applyLocalProposal(session, edit).then(() => setApplied(true), reason => setError(String(reason))).finally(() => setBusy(false)) }}>{applied ? 'Applied to unsaved editor buffer' : busy ? 'Applying…' : 'Apply to editor'}</button></details>
}

export function CodeStudioLocalLlmChat({ session, document }: { session: GoIDESession; document: GoIDEEditorDocument | null }) {
  const chrome = useCodeStudioChatHeader()
  const root = session.project.realPath
  const [config, setConfig] = useState(initialConfig), [apiKey, setApiKey] = useState(''), [text, setText] = useState('')
  const [models, setModels] = useState<string[]>([]), [status, setStatus] = useState(''), [error, setError] = useState(''), [discovering, setDiscovering] = useState(false)
  const [includeFile, setIncludeFile] = useState(true), [includeIndex, setIncludeIndex] = useState(true), [paths, setPaths] = useState(''), [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const picker = useRef<HTMLInputElement>(null), discovery = useRef<AbortController | null>(null), transcript = useRef<HTMLDivElement>(null)
  const conversation = useLocalLlmChat(state => state.conversations[root])
  const draft = useCodeStudioAssistantStore(state => state.draft)
  const busy = conversation?.busy ?? false
  useEffect(() => { ensureLocalConversation(root) }, [root])
  useEffect(() => { if (draft !== null) setText(useCodeStudioAssistantStore.getState().takeDraft() ?? '') }, [draft])
  useEffect(() => () => discovery.current?.abort(), [])
  const change = (next: Partial<LocalLlmConfig>) => { const value = { ...config, ...next }; setConfig(value); safeSetItem(CONFIG_KEY, JSON.stringify(value)); setStatus('') }
  const discover = async () => {
    discovery.current?.abort()
    const controller = new AbortController(); discovery.current = controller
    setDiscovering(true); setError(''); setStatus('')
    try {
      const found = await localModels(config, apiKey, controller.signal)
      if (controller.signal.aborted) return
      setModels(found)
      if (!config.model && found[0]) change({ model: found[0] })
      setStatus(found.length ? `Server reachable · ${found.length} models` : 'Server reachable · no models listed. Load a model in the local server.')
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (discovery.current === controller) setDiscovering(false) }
  }
  const send = () => {
    if (!text.trim() || busy) return
    const question = text.trim()
    const context = { documentId: document?.document.id, selection: selectedRange(document), includeDocument: includeFile, includeWorkspace: includeIndex, includeRules: true, includeUnsaved: true, additionalPaths: paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean).slice(0, 10), attachments }
    setError(''); setText(''); setAttachments([])
    void sendLocalChat(session, config, question, context, apiKey)
    requestAnimationFrame(() => transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }))
  }
  return <section className="local-llm-chat" aria-label="Local LLM project chat">
    <header className="local-llm-heading"><div>{chrome ?? <h2><Cpu size={15} />Local LLM</h2>}<p>LM Studio · Ollama · project context</p></div><button type="button" title="New local conversation" aria-label="New local conversation" disabled={busy} onClick={() => clearLocalChat(root)}><Trash2 size={14} /></button></header>
    <details className="local-llm-connection" open={!config.model || undefined}><summary>Connection <span>{config.model || 'Choose a model'}</span></summary>
      <fieldset disabled={busy || discovering}>
        <div className="local-llm-presets"><button type="button" onClick={() => { change({ endpoint: 'http://localhost:1234/v1', model: '', vision: false }); setModels([]) }}>LM Studio</button><button type="button" onClick={() => { change({ endpoint: 'http://localhost:11434/v1', model: '', vision: false }); setModels([]) }}>Ollama</button></div>
        <label>Server endpoint<input aria-label="Local server endpoint" value={config.endpoint} onChange={event => { change({ endpoint: event.target.value }); setModels([]) }} spellCheck={false} /></label>
        <div className="local-llm-model-row"><label>Model<input aria-label="Local model" list="local-llm-model-list" placeholder="Select or enter the model ID" value={config.model} onChange={event => change({ model: event.target.value, vision: false })} /><datalist id="local-llm-model-list">{models.map(model => <option key={model} value={model} />)}</datalist></label><button type="button" onClick={() => void discover()}><RefreshCw size={13} />{discovering ? 'Connecting…' : 'List models'}</button></div>
        <label>Server API key (optional, kept in memory)<input aria-label="Local server API key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
        <label className="local-llm-check"><input type="checkbox" checked={config.vision} onChange={event => change({ vision: event.target.checked })} />This model accepts images</label>
        <p className="local-llm-hint">Start the local server first. Image input requires a vision model; tool support depends on the selected model.</p>
      </fieldset>
      {status && <p role="status">{status}</p>}
    </details>
    <div ref={transcript} className="local-llm-transcript" aria-label="Conversation" aria-busy={busy}>
      {!conversation?.turns.length && <div className="local-llm-empty"><h3>Ask about this project</h3><p>Attach the open file or let the model search files and symbols. Every proposed edit stays in preview until you apply it.</p></div>}
      {conversation?.turns.map(turn => <article key={turn.id} className="local-llm-turn"><h3>You</h3><p className="local-llm-question">{turn.question}</p>{turn.sources.length > 0 && <details className="local-llm-sources"><summary>Context supplied · {turn.sources.length} sources</summary><ul>{turn.sources.map((source, index) => <li key={index}>{source}</li>)}</ul></details>}{turn.tools.length > 0 && <p className="local-llm-tool-log">Tool requests: {turn.tools.join(' → ')}</p>}<h3>Local model</h3><div className="local-llm-answer" data-a11y-click-exempt role="presentation" onClick={event => { const link = (event.target as Element).closest('a'); if (link) { event.preventDefault(); const href = link.getAttribute('href') ?? ''; if (/^https?:\/\//i.test(href)) void Browser.OpenURL(href) } }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(turn.answer || (busy ? 'Working…' : '')), { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] }) }} />{turn.proposals.map((edit, index) => <Proposal key={index} session={session} edit={edit} />)}</article>)}
    </div>
    {(error || conversation?.error) && <p role="alert" className="local-llm-error">{error || conversation?.error}</p>}
    <div className="local-llm-composer">
      <details className="local-llm-context"><summary>Project context</summary><fieldset disabled={busy}><label className="local-llm-check"><input type="checkbox" checked={includeFile} onChange={event => setIncludeFile(event.target.checked)} />Open file and selected code</label><label className="local-llm-check"><input type="checkbox" checked={includeIndex} onChange={event => setIncludeIndex(event.target.checked)} />Project index and runtime context</label><label className="local-llm-check"><input type="checkbox" checked={config.tools} onChange={event => change({ tools: event.target.checked })} />Allow project tools (read, search, propose edits)</label><label>Additional project files, one relative path per line<textarea aria-label="Additional project files" rows={2} value={paths} onChange={event => setPaths(event.target.value)} /></label><p className="local-llm-hint">AI exclusions and redaction apply. Replies are saved locally; image bytes and edit proposals are not saved with chat history.</p></fieldset></details>
      {attachments.length > 0 && <div className="local-llm-attachments">{attachments.map((item, index) => <button key={index} type="button" onClick={() => setAttachments(current => current.filter((_, at) => at !== index))}>{item.name}<X size={12} /></button>)}</div>}
      <textarea aria-label="Message local model" placeholder="Ask about code, a problem or a screenshot…" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} rows={3} />
      <div className="local-llm-send-row"><input ref={picker} type="file" multiple className="hidden" aria-label="Attach files to local chat" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void readAgentAttachments(files, config.vision).then(items => { if (attachments.length + items.length > 6) throw new Error('Attach at most six files'); setAttachments(current => [...current, ...items]); setError('') }).catch(reason => setError(String(reason))) }} /><button type="button" aria-label="Attach files or images" disabled={busy} onClick={() => picker.current?.click()}><Paperclip size={15} /></button><span>{busy ? 'Generating locally…' : config.model || 'Configure a local model'}</span>{busy ? <button type="button" onClick={() => stopLocalChat(root)}><Square size={13} />Stop</button> : <button type="button" disabled={!text.trim() || !config.model} onClick={send}><Send size={13} />Send</button>}</div>
    </div>
  </section>
}
