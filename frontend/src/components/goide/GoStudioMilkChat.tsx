import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { ChevronRight, Plus, Send, Settings2, Square } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Browser } from '@wailsio/runtime'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import './goStudioMilkChat.css'
import type { GoIDESession } from '@/lib/goide-api'
import { renderMarkdown } from '@/lib/markdownDoc'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { useMilkStore, type MilkChatMessage, type MilkToolActivity } from '@/stores/milk'
import type { MilkRouteInfo } from '@/lib/milk-api'
import { MilkLogo } from './GoStudioMilkDialog'
import { useToolView } from './studioToolState'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { selectedRange } from './GoStudioCopilotChat'

interface GoStudioMilkChatProps {
  session: GoIDESession
  document?: GoIDEEditorDocument | null
}

const SUGGESTIONS = ['What does this project do?', 'Find possible bugs in the open file', '/agent list']

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

function ToolList({ tools }: { tools: MilkToolActivity[] }) {
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

function Reply({ message, command }: { message: MilkChatMessage; command: boolean }) {
  const waiting = !message.content && !message.stopped
  return (
    <article className="milk-reply" aria-label="milk">
      <header className="milk-reply-head">
        <MilkLogo size={14} />
        <span className="milk-reply-name">milk</span>
        {message.route && <RouteChip route={message.route} />}
      </header>
      {message.thought && (
        <details className="milk-thought">
          <summary><ChevronRight size={12} className="milk-thought-chevron" />Reasoning</summary>
          <p>{message.thought}</p>
        </details>
      )}
      {message.tools && message.tools.length > 0 && <ToolList tools={message.tools} />}
      {message.content && (command
        // Slash commands are executed by milk itself: their output is terminal text with aligned columns.
        ? <pre className="milk-output milk-command-output">{message.content}</pre>
        : <Prose markdown={message.content} />)}
      {waiting && <p className="milk-waiting"><span className="milk-waiting-dot" aria-hidden="true" />Thinking…</p>}
      {message.stopped && <p className="milk-stopped">Stopped before finishing.</p>}
    </article>
  )
}

export function GoStudioMilkChat({ session, document }: GoStudioMilkChatProps) {
  const root = session.project.realPath
  const status = useMilkStore((state) => state.status)
  const thread = useMilkStore((state) => state.chatThreads[root])
  const permissions = useMilkStore((state) => state.permissions)
  const [draft, setDraft] = useToolView(session.id, 'milk', 'draft', '')
  const [includeFile, setIncludeFile] = useToolView(session.id, 'milk', 'includeFile', true)
  const [includeWorkspace, setIncludeWorkspace] = useToolView(session.id, 'milk', 'includeWorkspace', true)
  const pendingDraft = useGoStudioAssistantStore((state) => state.draft)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingDraft === null) return
    const next = useGoStudioAssistantStore.getState().takeDraft()
    if (next !== null) setDraft(next)
  }, [pendingDraft])

  useEffect(() => {
    void useMilkStore.getState().ensure()
    void useMilkStore.getState().setWorkspace(root)
  }, [root])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread?.messages, permissions])

  const busy = !!thread?.busyToken
  const ready = status?.state === 'ready'
  const messages = thread?.messages ?? []

  const send = () => {
    if (!ready || busy || !draft.trim()) return
    const message = draft
    setDraft('')
    void useMilkStore.getState().sendChat(root, message, {
      documentId: document?.document.id,
      selection: includeFile ? selectedRange(document ?? null) : null,
      includeDocument: includeFile,
      includeWorkspace,
    })
  }

  const setupTitle = status?.state === 'installing' ? 'Installing milk…'
    : status?.state === 'outdated' ? 'This milk is too old for gO Studio'
      : status?.state === 'not-installed' ? 'milk is not installed yet'
        : 'milk is not running'
  const setupAction = status?.state === 'not-installed' ? 'Install milk' : status?.state === 'outdated' ? 'Update milk' : 'Open milk settings'

  return (
    <section aria-label="milk chat" className="milk-chat">
      <header className="milk-bar">
        <MilkLogo size={16} />
        <span className="milk-bar-title">milk</span>
        {status?.version && <span className="milk-bar-version">{status.version}</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => useMilkStore.getState().setDialogOpen(true)} className="go-studio-icon-button h-7 w-7" title="milk settings" aria-label="milk settings"><Settings2 size={14} /></button>
        <button type="button" onClick={() => void useMilkStore.getState().newChat(root)} className="go-studio-icon-button h-7 w-7" title="New chat" aria-label="New chat"><Plus size={15} /></button>
      </header>

      <div ref={scrollRef} className="milk-scroll">
        {!ready ? (
          <div className="milk-empty">
            <MilkLogo size={44} />
            <h2>{setupTitle}</h2>
            <p>{status?.message || 'Enable milk in its settings to chat with your agents about this project.'}</p>
            <button type="button" onClick={() => useMilkStore.getState().setDialogOpen(true)} className="gs-btn gs-btn-primary gs-btn-sm"><Settings2 size={13} />{setupAction}</button>
          </div>
        ) : messages.length === 0 ? (
          <div className="milk-empty">
            <MilkLogo size={44} />
            <h2>Ask milk about {session.project.name}</h2>
            <p>A cheap agent answers first; milk hands the hard questions to the deep one. Both work in this folder.</p>
            <div className="milk-suggestions">
              {SUGGESTIONS.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)}>{prompt}</button>)}
            </div>
          </div>
        ) : (
          <div className="milk-thread">
            {messages.map((message, index) => message.role === 'user'
              ? <div key={message.id}><p className="milk-ask">{message.content}</p>{!!message.context?.length && <p className="break-words px-2 text-[10px] text-text-4">Attached: {message.context.join(' · ')}</p>}</div>
              : <Reply key={message.id} message={message} command={messages[index - 1]?.content.trimStart().startsWith('/') ?? false} />)}
            {thread?.error && <div role="alert" className="milk-error">{thread.error}</div>}
          </div>
        )}
        {permissions.map((permission) => (
          <div key={permission.requestId} className="milk-permission" role="alertdialog" aria-label="Tool permission">
            <p className="milk-permission-title">{permission.title || 'milk wants to run a tool'}</p>
            {permission.description && <p className="milk-permission-detail">{permission.description}</p>}
            <div className="milk-permission-actions">
              <button type="button" onClick={() => void useMilkStore.getState().respondPermission(permission.requestId, true)} className="gs-btn gs-btn-primary gs-btn-sm">Allow</button>
              <button type="button" onClick={() => void useMilkStore.getState().respondPermission(permission.requestId, false)} className="gs-btn gs-btn-secondary gs-btn-sm">Deny</button>
            </div>
          </div>
        ))}
      </div>

      <div className="milk-composer">
        <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-text-3" aria-label="milk context">
          <button type="button" aria-pressed={includeFile} onClick={() => setIncludeFile(!includeFile)} title={document?.document.relativePath || 'No active file'} className="max-w-full truncate rounded border border-border-1 px-2 py-1">{includeFile ? '✓ ' : ''}{document?.document.relativePath || 'No active file'}</button>
          <button type="button" aria-pressed={includeWorkspace} onClick={() => setIncludeWorkspace(!includeWorkspace)} title={session.project.name} className="max-w-full truncate rounded border border-border-1 px-2 py-1">{includeWorkspace ? '✓ ' : ''}{session.project.name}</button>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }}
          disabled={!ready || busy}
          rows={3}
          placeholder={ready ? (busy ? 'milk is answering…' : 'Ask milk, or type / for a command') : 'Enable milk to chat'}
          aria-label="Message milk"
        />
        <div className="milk-composer-bar">
          <span>Enter to send, Shift+Enter for a new line</span>
          {busy
            ? <button type="button" onClick={() => void useMilkStore.getState().stopChat(root)} className="milk-stop"><Square size={10} fill="currentColor" />Stop</button>
            : <button type="button" onClick={send} disabled={!ready || !draft.trim()} className="milk-send" title="Send" aria-label="Send"><Send size={14} /></button>}
        </div>
      </div>
    </section>
  )
}
