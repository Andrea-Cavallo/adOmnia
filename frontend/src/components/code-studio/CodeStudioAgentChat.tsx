import { ProjectRulesToggle } from './ProjectRulesToggle'
import { CodeStudioAgentReviewBar } from './CodeStudioAgentReviewBar'
import { memo, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from 'react'
import { ChevronRight, Plus, Send, Settings2, Square, Paperclip, X, RefreshCw } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Browser } from '@wailsio/runtime'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import './codeStudioMilkChat.css'
import type { GoIDESession } from '@/lib/code-studio-api'
import { renderMarkdown } from '@/lib/markdownDoc'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import type { AgentChatMessage, AgentChatStore, AgentToolActivity } from '@/stores/agentChat'
import type { AgentSessionControls, MilkRouteInfo, MilkStatus } from '@/lib/milk-api'
import { readAgentAttachments, type AgentAttachment } from '@/lib/code-studio/agentAttachments'
import { useToolView } from './studioToolState'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { selectedRange } from './CodeStudioCopilotChat'
import { CodeStudioAgentSessionOptions } from './CodeStudioAgentSessionOptions'

/** One ACP agent as the chat shows it: milk and Claude Code share everything else. */
export interface ChatAgent {
  sessionControls?: (root: string) => Promise<AgentSessionControls>
  setSessionControl?: (root: string, id: string, value: unknown) => Promise<AgentSessionControls>
  tool: 'milk' | 'claude' | 'opencode'
  name: string
  store: AgentChatStore
  Logo: ComponentType<{ size?: number }>
  suggestions: string[]
  /** Under "Ask <name> about <project>". */
  intro: string
  /** Shown when the agent is not running and no status message explains why. */
  setupHint: string
  setupTitle: (status: MilkStatus | null) => string
  setupAction: (status: MilkStatus | null) => string
}

interface CodeStudioAgentChatProps {
  agent: ChatAgent
  session: GoIDESession
  document?: GoIDEEditorDocument | null
}

/**
 * Model output is untrusted: renderMarkdown escapes it, DOMPurify is the second
 * fence, and images are dropped so a reply can never fetch a remote URL.
 */
function toSafeHtml(markdown: string): string {
  return DOMPurify.sanitize(renderMarkdown(markdown), { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] })
}

/** Links in a reply open in the system browser instead of navigating the app. */
function openLinksOutside(event: MouseEvent<HTMLDivElement>) {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  event.preventDefault()
  const href = link.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void Browser.OpenURL(href)
}

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => toSafeHtml(markdown), [markdown])
  return <div className="milk-prose" data-a11y-click-exempt onClick={openLinksOutside} dangerouslySetInnerHTML={{ __html: html }} />
}

/** milk's core idea, made visible: which agent answered — the cheap primary or the deep escalation. */
function RouteChip({ route }: { route: MilkRouteInfo }) {
  const escalated = route.target === 'escalation'
  return (
    <span className={`milk-route ${escalated ? 'milk-route-deep' : 'milk-route-primary'}`} title={route.reason || undefined}>
      {escalated && <span aria-hidden="true">✦</span>}
      {route.agent || (escalated ? 'escalation' : 'primary')}
    </span>
  )
}

function ToolList({ tools }: { tools: AgentToolActivity[] }) {
  return (
    <ul className="milk-tools" aria-label="Tool calls">
      {tools.map((tool) => (
        <li key={tool.toolCallId}>
          <details>
            <summary>
              <span className={`milk-tool-dot milk-tool-${tool.status}`} aria-hidden="true" />
              <span className="milk-tool-name">{tool.name || 'tool'}</span>
              <span className="milk-tool-status">{tool.status.replace('_', ' ')}</span>
            </summary>
            {tool.rawOutput && <pre className="milk-output">{tool.rawOutput}</pre>}
          </details>
        </li>
      ))}
    </ul>
  )
}

// Memoizzata: durante lo streaming cambia solo l'ultimo messaggio, i precedenti non rifanno il parsing markdown.
const Reply = memo(function Reply({ agent, message, command }: { agent: ChatAgent; message: AgentChatMessage; command: boolean }) {
  const waiting = !message.content && !message.stopped
  const { Logo } = agent
  return (
    <article className="milk-reply" aria-label={agent.name}>
      <header className="milk-reply-head">
        <Logo size={14} />
        <span className="milk-reply-name">{agent.name}</span>
        {message.route && <RouteChip route={message.route} />}
      </header>
      {message.thought && (
        <details className="milk-thought">
          <summary><ChevronRight size={12} className="milk-thought-chevron" />Reasoning</summary>
          <p>{message.thought}</p>
        </details>
      )}
      {message.tools && message.tools.length > 0 && <ToolList tools={message.tools} />}
      {!!message.plan?.length && <details className="milk-thought"><summary>Task plan · {message.plan.filter(item => item.status === 'completed').length}/{message.plan.length}</summary><ol className="space-y-1 py-2">{message.plan.map((item, index) => <li key={index} className="flex gap-2 text-[11px]"><span>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '→' : '·'}</span><span>{item.content}</span></li>)}</ol></details>}
      {message.content && (command
        // Slash commands are executed by the agent itself: their output is terminal text with aligned columns.
        ? <pre className="milk-output milk-command-output">{message.content}</pre>
        : <Prose markdown={message.content} />)}
      {waiting && <p className="milk-waiting"><span className="milk-waiting-dot" aria-hidden="true" />Thinking…</p>}
      {message.stopped && <p className="milk-stopped">Stopped before finishing.</p>}
    </article>
  )
})

export function CodeStudioAgentChat({ agent, session, document }: CodeStudioAgentChatProps) {
  const { store, Logo, name, tool } = agent
  const root = session.project.realPath
  const activeRoot = useRef(root)
  activeRoot.current = root
  const status = store((state) => state.status)
  const thread = store((state) => state.chatThreads[root])
  const permissions = store((state) => state.permissions)
  const [draft, setDraft] = useToolView(session.id, tool, 'draft', '')
  const [includeFile, setIncludeFile] = useToolView(session.id, tool, 'includeFile', true)
  const [includeWorkspace, setIncludeWorkspace] = useToolView(session.id, tool, 'includeWorkspace', true)
  const [includeRules, setIncludeRules] = useToolView(session.id, tool, 'includeRules', true)
  const [includeSelection, setIncludeSelection] = useToolView(session.id, tool, 'includeSelection', true)
  const [controls, setControls] = useState<AgentSessionControls | null>(null)
  const [controlsError, setControlsError] = useState('')
  const [controlsBusy, setControlsBusy] = useState(false)
  const [controlsRetry, setControlsRetry] = useState(0)
  const [attachmentsByRoot, setAttachmentsByRoot] = useState<Record<string, AgentAttachment[]>>({})
  const [attachmentError, setAttachmentError] = useState('')
  const [readingFiles, setReadingFiles] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingDraft = useCodeStudioAssistantStore((state) => state.draft)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingDraft === null) return
    const next = useCodeStudioAssistantStore.getState().takeDraft()
    if (next !== null) setDraft(next)
  }, [pendingDraft])

  useEffect(() => {
    void store.getState().ensure()
    void store.getState().setWorkspace(root)
  }, [store, root])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread?.messages, permissions])

  const busy = !!thread?.busyToken
  const ready = status?.state === 'ready'
  const messages = thread?.messages ?? []
  const attachments = attachmentsByRoot[root] ?? []
  const currentControls = controls?.root === root ? controls : null
  useEffect(() => { setControls(null); setControlsError(''); setAttachmentError('') }, [root, tool])
  useEffect(() => {
    if (!ready || busy || !agent.sessionControls) return
    let live = true
    setControlsBusy(true)
    agent.sessionControls(root).then(result => { if (live) { setControls(result); setControlsError('') } }, error => { if (live) setControlsError(error instanceof Error ? error.message : String(error)) }).finally(() => { if (live) setControlsBusy(false) })
    return () => { live = false }
  }, [agent, root, ready, busy, controlsRetry])

  const changeControl = async (id: string, value: unknown) => {
    if (!agent.setSessionControl || busy || controlsBusy) return
    setControlsBusy(true); setControlsError('')
    try {
      const result = await agent.setSessionControl(root, id, value)
      if (id === '_milk_agent') await store.getState().newChat(root, false)
      if (activeRoot.current === root) setControls(result)
    } catch (error) { if (activeRoot.current === root) setControlsError(error instanceof Error ? error.message : String(error)) }
    finally { if (activeRoot.current === root) setControlsBusy(false) }
  }

  const send = async () => {
    if (!ready || busy || controlsBusy || readingFiles || (!draft.trim() && !attachments.length)) return
    const message = draft.trim() || 'Review the attached files.'
    const sent = await store.getState().sendChat(root, message, {
      documentId: document?.document.id,
      selection: includeSelection ? selectedRange(document ?? null) : null,
      includeDocument: includeFile,
      includeWorkspace,
      includeRules,
      attachments,
    })
    if (sent) {
      if (activeRoot.current === root) setDraft('')
      setAttachmentsByRoot(current => ({ ...current, [root]: [] }))
    }
  }

  const openSettings = () => store.getState().setDialogOpen(true)

  return (
    <section aria-label={`${name} chat`} className="milk-chat">
      <header className="milk-bar">
        <Logo size={16} />
        <span className="milk-bar-title">{name}</span>
        {status?.version && <span className="milk-bar-version">{status.version}</span>}
        {/* Who serves the turns (Claude Code: plan, API key, AWS Bedrock, Vertex AI, gateway) and with which model. */}
        {(status?.backend || status?.model) && <span className="milk-bar-version min-w-0 truncate" title={[status.backend, status.model].filter(Boolean).join(' · ')}>{[status.backend, status.model].filter(Boolean).join(' · ')}</span>}
        <span className="flex-1" />
        <CodeStudioAgentSessionOptions controls={currentControls} disabled={busy || controlsBusy} onChange={changeControl} />
        <button type="button" onClick={openSettings} className="code-studio-icon-button h-7 w-7" title={`${name} settings`} aria-label={`${name} settings`}><Settings2 size={14} /></button>
        <button type="button" disabled={busy || controlsBusy} onClick={() => { void store.getState().newChat(root).then(() => { setControls(null); setControlsRetry(value => value + 1) }) }} className="code-studio-icon-button h-7 w-7" title="New chat" aria-label="New chat"><Plus size={15} /></button>
      </header>
      {controlsError && <div role="alert" className="milk-error">{controlsError}<button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" disabled={controlsBusy} onClick={() => setControlsRetry(value => value + 1)}><RefreshCw size={12} />Retry</button></div>}
      {tool === 'milk' && (currentControls?.controls ?? []).some(item => item.id === '_milk_agent') && <p className="px-2 py-1 text-[10px] text-text-4">Changing the primary agent updates milk’s global config and opens a new chat for this project.</p>}
      {tool === 'milk' && ready && !(currentControls?.controls ?? []).some(item => item.id === '_milk_agent') && <p className="px-2 py-1 text-[10px] text-text-4">Primary-agent selection requires milk 0.7+ and configured agents. <button type="button" className="underline" onClick={openSettings}>Configure / update milk</button></p>}

      <div ref={scrollRef} className="milk-scroll">
        {!ready ? (
          <div className="milk-empty">
            <Logo size={44} />
            <h2>{agent.setupTitle(status)}</h2>
            <p>{status?.message || agent.setupHint}</p>
            <button type="button" onClick={openSettings} className="gs-btn gs-btn-primary gs-btn-sm"><Settings2 size={13} />{agent.setupAction(status)}</button>
          </div>
        ) : messages.length === 0 ? (
          <div className="milk-empty">
            <Logo size={44} />
            <h2>Ask {name} about {session.project.name}</h2>
            <p>{agent.intro}</p>
            <div className="milk-suggestions">
              {agent.suggestions.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)}>{prompt}</button>)}
            </div>
          </div>
        ) : (
          <div className="milk-thread">
            {messages.map((message, index) => message.role === 'user'
              ? <div key={message.id}><p className="milk-ask">{message.content}</p>{!!message.context?.length && <p className="break-words px-2 text-[10px] text-text-4">Attached: {message.context.join(' · ')}</p>}</div>
              : <Reply key={message.id} agent={agent} message={message} command={messages[index - 1]?.content.trimStart().startsWith('/') ?? false} />)}
            {thread?.error && <div role="alert" className="milk-error">{thread.error}</div>}
          </div>
        )}
        {permissions.map((permission) => (
          <div key={permission.requestId} className="milk-permission" role="alertdialog" aria-label="Tool permission">
            <p className="milk-permission-title">{permission.title || `${name} wants to run a tool`}</p>
            {permission.description && <p className="milk-permission-detail">{permission.description}</p>}
            <div className="milk-permission-actions">
              <button type="button" onClick={() => void store.getState().respondPermission(permission.requestId, true)} className="gs-btn gs-btn-primary gs-btn-sm">Allow</button>
              <button type="button" onClick={() => void store.getState().respondPermission(permission.requestId, false)} className="gs-btn gs-btn-secondary gs-btn-sm">Deny</button>
            </div>
          </div>
        ))}
      </div>

      <div className="milk-composer">
        <CodeStudioAgentReviewBar root={root} busy={busy} />
        <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-text-3" aria-label={`${name} context`}>
          <ProjectRulesToggle included={includeRules} onChange={setIncludeRules} />
          <button type="button" disabled={!document} aria-pressed={includeFile && !!document} onClick={() => setIncludeFile(!includeFile)} title={document?.document.relativePath || 'No active file'} className="max-w-full truncate rounded border border-border-1 px-2 py-1">{includeFile ? '✓ ' : ''}{document?.document.relativePath || 'No active file'}</button>
          <button type="button" disabled={!document} aria-pressed={includeSelection} onClick={() => setIncludeSelection(!includeSelection)} className="rounded border border-border-1 px-2 py-1">{includeSelection ? '✓ ' : ''}Selection</button>
          <button type="button" aria-pressed={includeWorkspace} onClick={() => setIncludeWorkspace(!includeWorkspace)} title={session.project.name} className="max-w-full truncate rounded border border-border-1 px-2 py-1">{includeWorkspace ? '✓ ' : ''}{session.project.name}</button>
        </div>
        <p className="mb-2 text-[10px] text-text-4">Enabled context and selected attachments are sent to {name}. Unsaved editor changes are included; excluded paths and text secrets are filtered.</p>
        {!!attachments.length && <div className="mb-2 flex flex-wrap gap-1">{attachments.map((item, index) => <span key={`${item.name}-${index}`} className="flex items-center gap-1 rounded border border-border-1 px-2 py-1 text-[11px] text-text-2"><Paperclip size={11} />{item.name}<button type="button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => setAttachmentsByRoot(current => ({ ...current, [root]: attachments.filter((_, position) => position !== index) }))}><X size={11} /></button></span>)}</div>}
        {attachmentError && <p role="alert" className="milk-error">{attachmentError}</p>}
        <input ref={fileInput} type="file" multiple className="hidden" aria-label="Attach external files" onChange={async event => {
          const files = Array.from(event.target.files ?? []); event.target.value = ''
          setReadingFiles(true); setAttachmentError('')
          try {
            const found = await readAgentAttachments(files, currentControls?.images === true)
            if (attachments.length + found.length > 6) throw new Error('Attach at most six files.')
            if ([...attachments, ...found].filter(item => item.kind === 'image').length > 4) throw new Error('Attach at most four images.')
            setAttachmentsByRoot(current => ({ ...current, [root]: [...(current[root] ?? []), ...found] }))
          } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)) }
          finally { setReadingFiles(false) }
        }} />
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}
          disabled={!ready || busy}
          rows={3}
          placeholder={ready ? (busy ? `${name} is answering…` : `Ask ${name}, or type / for a command`) : `Enable ${name} to chat`}
          aria-label={`Message ${name}`}
        />
        <div className="milk-composer-bar">
          <button type="button" disabled={!ready || busy || controlsBusy || readingFiles} onClick={() => fileInput.current?.click()} title={currentControls?.images ? 'Attach text files or PNG/JPEG/GIF/WebP images' : 'Attach UTF-8 files. This agent does not advertise image input through ACP.'} aria-label="Add attachments" className="code-studio-icon-button h-7 w-7"><Paperclip size={14} /></button>
          <span>Enter to send, Shift+Enter for a new line</span>
          {busy
            ? <button type="button" onClick={() => void store.getState().stopChat(root)} className="milk-stop"><Square size={10} fill="currentColor" />Stop</button>
            : <button type="button" onClick={() => void send()} disabled={!ready || controlsBusy || readingFiles || (!draft.trim() && !attachments.length)} className="milk-send" title="Send" aria-label="Send"><Send size={14} /></button>}
        </div>
      </div>
    </section>
  )
}
