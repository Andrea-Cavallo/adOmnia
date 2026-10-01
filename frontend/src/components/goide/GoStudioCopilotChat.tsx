import { Fragment, useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Code2, Copy, FileCode2, FolderTree, Plus, Send, Settings2, Square, TextSelect } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import type { CopilotChatSelection } from '@/lib/copilot-api'
import { useCopilotStore, type CopilotChatMessage } from '@/stores/copilot'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { editorModelUri } from './goStudioModelUri'
import { copilotChatIdentity } from './goStudioCopilotIdentity'

interface GoStudioCopilotChatProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

function selectedRange(document: GoIDEEditorDocument | null): CopilotChatSelection | null {
  const editor = activeGoStudioEditor()
  const selection = editor?.getSelection()
  if (!document || !editor || !selection || selection.isEmpty() || editor.getModel()?.uri.toString() !== editorModelUri(document.document)) return null
  return {
    startLine: selection.startLineNumber - 1,
    startCharacter: selection.startColumn - 1,
    endLine: selection.endLineNumber - 1,
    endCharacter: selection.endColumn - 1,
  }
}

function MessageBody({ message }: { message: CopilotChatMessage }) {
  const blocks = message.content.split(/(```[\s\S]*?```)/g).filter(Boolean)
  if (!message.content && message.role === 'assistant') return <span className="text-text-4">Thinking…</span>
  return (
    <div className="space-y-2 whitespace-pre-wrap break-words">
      {blocks.map((block, index) => {
        if (!block.startsWith('```')) return <Fragment key={index}>{block}</Fragment>
        const body = block.slice(3, -3)
        const newline = body.indexOf('\n')
        const language = newline >= 0 ? body.slice(0, newline).trim() : ''
        const code = newline >= 0 ? body.slice(newline + 1) : body
        return (
          <div key={index} className="overflow-hidden rounded-lg border border-border-1 bg-surface-0">
            <div className="flex h-7 items-center px-2 text-[9px] uppercase tracking-wide text-text-4"><Code2 size={11} className="mr-1" />{language || 'code'}<button type="button" className="ml-auto hover:text-text-1" onClick={() => void navigator.clipboard.writeText(code)} title="Copy code"><Copy size={11} /></button></div>
            <pre className="overflow-x-auto border-t border-border-1 p-2 font-mono text-[10px] leading-4 text-text-2"><code>{code}</code></pre>
          </div>
        )
      })}
      {message.stopped && <div className="text-[9px] text-warning">Stopped</div>}
    </div>
  )
}

/** Provider, host, account e modello sempre visibili: si sa a chi va il codice prima di inviarlo. */
function ChatIdentityBar({ root, model }: { root: string; model?: string }) {
  const status = useCopilotStore((state) => state.status)
  const settings = useCopilotStore((state) => state.settings)
  const identity = copilotChatIdentity({ status, settings, root, model })
  const title = [
    identity.provider && `Provider: ${identity.provider}${identity.deployment ? ` (${identity.deployment})` : ''}`,
    identity.host && `Host: ${identity.host}${identity.configuredOnly ? ' (configured, not connected)' : ''}`,
    identity.account && `Account: ${identity.account}`,
    identity.model,
  ].filter(Boolean).join('\n')
  return (
    <div aria-label="Copilot provider and model" title={title} className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-border-1 bg-surface-0/40 px-2 py-1 text-[9px] leading-4 text-text-4">
      {identity.provider && <span className="font-semibold text-text-2">{identity.provider}</span>}
      {identity.host && <span className="max-w-[12rem] truncate font-mono text-text-3">{identity.host}</span>}
      {identity.account && <span className="max-w-[8rem] truncate text-text-3">@{identity.account}</span>}
      <span className="ml-auto min-w-0 max-w-full truncate font-mono">{identity.model}</span>
    </div>
  )
}

function ContextToggle({ active, disabled, icon: Icon, label, onClick }: { active: boolean; disabled?: boolean; icon: typeof FileCode2; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-[9px] ${active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border-1 text-text-4 hover:text-text-2'} disabled:cursor-not-allowed disabled:opacity-40`}><Icon size={10} />{label}</button>
}

export function GoStudioCopilotChat({ session, document }: GoStudioCopilotChatProps) {
  const root = session.project.realPath
  const status = useCopilotStore((state) => state.status)
  const thread = useCopilotStore((state) => state.chatThreads[root])
  const chatModels = useCopilotStore((state) => state.chatModels)
  const chatModelsError = useCopilotStore((state) => state.chatModelsError)
  const [draft, setDraft] = useState('')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [includeFile, setIncludeFile] = useState(true)
  const [includeSelection, setIncludeSelection] = useState(true)
  const [includeWorkspace, setIncludeWorkspace] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = !!thread?.busyToken
  const ready = status?.state === 'ready'
  const selectedModel = thread?.model || chatModels.find((model) => model.isChatDefault)?.id || chatModels[0]?.id || ''

  useEffect(() => {
    if (ready) void useCopilotStore.getState().loadChatModels()
  }, [ready])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread?.messages])

  const send = () => {
    if (!ready || busy || !draft.trim()) return
    const selection = includeSelection ? selectedRange(document) : null
    const labels = [
      ...(includeFile && document ? [document.document.relativePath] : []),
      ...(selection ? [`selection L${selection.startLine + 1}–${selection.endLine + 1}`] : []),
      ...(includeWorkspace ? [session.project.name] : []),
    ]
    const message = draft
    setDraft('')
    void useCopilotStore.getState().sendChat(root, message, {
      documentId: document?.document.id,
      selection,
      includeDocument: includeFile,
      includeWorkspace,
      labels,
    })
  }

  return (
    <section aria-label="GitHub Copilot Chat" className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-border-1 px-2">
        <Bot size={14} className="text-accent" />
        <div className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-1">{thread?.title || 'Copilot Chat'}</div>
        <button type="button" disabled={!ready || busy} onClick={() => setModelMenuOpen((open) => !open)} aria-expanded={modelMenuOpen} title="Change model (starts a new chat)" className="flex max-w-28 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[8px] text-text-3 hover:text-text-1 disabled:opacity-45">
          <span className="truncate">{selectedModel || 'Model'}</span><ChevronDown size={9} />
        </button>
        {modelMenuOpen && (
          <div role="menu" className="absolute right-9 top-8 z-20 w-60 overflow-hidden rounded-lg border border-border-2 bg-surface-1 p-1.5 shadow-xl">
            <p className="px-1.5 pb-1 text-[8px] font-semibold uppercase tracking-wide text-text-4">Copilot model · new chat</p>
            {chatModels.map((model) => <button key={model.id} type="button" role="menuitemradio" aria-checked={selectedModel === model.id} onClick={() => { setModelMenuOpen(false); void useCopilotStore.getState().selectChatModel(root, model.id) }} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${selectedModel === model.id ? 'bg-accent/12 text-accent' : 'text-text-2 hover:bg-surface-2'}`}><Check size={10} className={selectedModel === model.id ? 'opacity-100' : 'opacity-0'} /><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium">{model.name || model.id}</span>{model.name && model.name !== model.id && <span className="block truncate font-mono text-[8px] text-text-4">{model.id}</span>}</span>{model.isChatDefault && <span className="text-[8px] text-text-4">default</span>}</button>)}
            {!chatModels.length && <p className="px-2 py-2 text-[9px] leading-4 text-text-4">{chatModelsError || 'Loading models…'}</p>}
          </div>
        )}
        <button type="button" onClick={() => void useCopilotStore.getState().newChat(root)} className="go-studio-icon-button h-6 w-6" title="New chat" aria-label="New chat"><Plus size={13} /></button>
      </div>
      <ChatIdentityBar root={root} model={thread?.model} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {!ready ? (
          <div className="mt-6 rounded-xl border border-border-1 bg-surface-0 p-3 text-center">
            <Bot size={22} className="mx-auto mb-2 text-text-4" />
            <p className="text-[11px] font-medium text-text-2">Copilot Chat needs an active Copilot account.</p>
            <p className="mt-1 text-[9px] leading-4 text-text-4">Enable Copilot, install its language server, then sign in. gopls and Go Studio keep working independently.</p>
            <button type="button" onClick={() => useCopilotStore.getState().setDialogOpen(true)} className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10px] font-semibold text-white"><Settings2 size={11} />Open settings</button>
          </div>
        ) : !thread?.messages.length ? (
          <div className="mt-4 text-center">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent"><Bot size={18} /></div>
            <p className="mt-2 text-[11px] font-semibold text-text-2">Ask about your Go project</p>
            <p className="mt-1 text-[9px] leading-4 text-text-4">Only context enabled below is attached. Secrets and <code className="font-mono">.adomnia/aiignore</code> paths stay local.</p>
            <div className="mt-3 space-y-1">
              {['Explain the selected code', 'Find likely bugs in this file', 'How does this project fit together?'].map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="block w-full rounded-lg border border-border-1 bg-surface-0 px-2 py-1.5 text-left text-[10px] text-text-3 hover:border-accent/30 hover:text-text-1">{prompt}</button>)}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {thread.messages.map((message) => (
              <article key={message.id} className={message.role === 'user' ? 'ml-4 rounded-xl rounded-br-sm bg-accent/12 p-2.5' : 'mr-1'}>
                <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">{message.role === 'user' ? 'You' : <><Bot size={10} />Copilot</>}</div>
                <div className="text-[10.5px] leading-[1.55] text-text-2"><MessageBody message={message} /></div>
                {!!message.context?.length && <div className="mt-2 flex flex-wrap gap-1">{message.context.map((item) => <span key={item} className="rounded bg-surface-0/60 px-1.5 py-0.5 text-[8px] text-text-4">{item}</span>)}</div>}
              </article>
            ))}
            {thread.error && <div role="alert" className="rounded-lg border border-danger/25 bg-danger/10 p-2 text-[9px] leading-4 text-danger">{thread.error}</div>}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border-1 p-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          <ContextToggle icon={FileCode2} label={document?.document.relativePath || 'No file'} active={includeFile && !!document} disabled={!document} onClick={() => setIncludeFile((value) => !value)} />
          <ContextToggle icon={TextSelect} label="Selection" active={includeSelection} disabled={!document} onClick={() => setIncludeSelection((value) => !value)} />
          <ContextToggle icon={FolderTree} label="Workspace" active={includeWorkspace} onClick={() => setIncludeWorkspace((value) => !value)} />
        </div>
        <div className="rounded-xl border border-border-2 bg-surface-0 focus-within:border-accent/50">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} disabled={!ready || busy} rows={3} placeholder={ready ? 'Ask Copilot…' : 'Set up Copilot to chat'} className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[11px] leading-4 text-text-1 outline-none placeholder:text-text-4 disabled:opacity-50" />
          <div className="flex h-8 items-center px-2 text-[8px] text-text-4"><span>Enter send · Shift+Enter newline</span><span className="flex-1" />{busy ? <button type="button" onClick={() => void useCopilotStore.getState().stopChat(root)} className="flex h-6 items-center gap-1 rounded-md bg-danger/10 px-2 text-danger hover:bg-danger/20"><Square size={9} fill="currentColor" />Stop</button> : <button type="button" onClick={send} disabled={!ready || !draft.trim()} className="go-studio-icon-button h-6 w-6 disabled:opacity-35" title="Send" aria-label="Send"><Send size={12} /></button>}</div>
        </div>
      </div>
    </section>
  )
}
