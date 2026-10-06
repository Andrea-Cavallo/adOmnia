import { Fragment, useEffect, useRef, useState } from 'react'
import { Brain, Code2, Copy, Plus, Send, Settings2, Square, Wrench } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { useMilkStore, type MilkChatMessage, type MilkToolActivity } from '@/stores/milk'
import { MilkLogo } from './GoStudioMilkDialog'

interface GoStudioMilkChatProps {
  session: GoIDESession
  document?: unknown
}

function CodeBlocks({ content }: { content: string }) {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean)
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
            <div className="flex h-7 items-center px-2 text-[9px] uppercase tracking-wide text-text-4">
              <Code2 size={11} className="mr-1" />
              {language || 'code'}
              <button type="button" className="ml-auto hover:text-text-1" onClick={() => void navigator.clipboard.writeText(code)} title="Copy code"><Copy size={11} /></button>
            </div>
            <pre className="overflow-x-auto border-t border-border-1 p-2 font-mono text-[10px] leading-4 text-text-2"><code>{code}</code></pre>
          </div>
        )
      })}
    </div>
  )
}

function ToolActivityList({ tools }: { tools: MilkToolActivity[] }) {
  if (!tools.length) return null
  return (
    <div className="mt-2 space-y-1 border-t border-border-1 pt-2">
      {tools.map((tool, index) => (
        <div key={`${tool.toolCallId}-${index}`} className="flex items-start gap-1.5 text-[9px] text-text-4">
          <Wrench size={10} className="mt-0.5 shrink-0" />
          <span className="font-mono">{tool.name || 'tool'}</span>
          <span className="text-text-4">{tool.status}</span>
          {tool.rawOutput && <span className="block max-h-16 w-full overflow-y-auto whitespace-pre-wrap break-words font-mono text-[8px] text-text-4">{tool.rawOutput}</span>}
        </div>
      ))}
    </div>
  )
}

function AssistantMessage({ message }: { message: MilkChatMessage }) {
  const busy = message.role === 'assistant' && !message.content && !message.thought && !message.tools?.length && !message.route
  if (busy) return <span className="text-text-4">milk is thinking…</span>
  return (
    <div>
      {message.thought && (
        <details className="mb-1.5 rounded border border-border-1 bg-surface-0/60 px-1.5 py-1 text-[9px] text-text-4">
          <summary className="flex cursor-pointer items-center gap-1 select-none"><Brain size={10} />Reasoning</summary>
          <p className="mt-1 whitespace-pre-wrap break-words leading-4">{message.thought}</p>
        </details>
      )}
      {!message.content && message.thought && !message.stopped && <span className="text-text-4">milk is thinking…</span>}
      {message.route && <div className="mb-1 rounded bg-surface-0/70 px-1.5 py-0.5 text-[8px] text-text-4">→ {message.route.agent}{message.route.target ? ` (${message.route.target})` : ''}{message.route.reason ? `: ${message.route.reason}` : ''}</div>}
      {message.content && <CodeBlocks content={message.content} />}
      {message.tools && <ToolActivityList tools={message.tools} />}
      {message.stopped && <div className="mt-1 text-[9px] text-warning">Stopped</div>}
    </div>
  )
}

export function GoStudioMilkChat({ session }: GoStudioMilkChatProps) {
  const root = session.project.realPath
  const status = useMilkStore((state) => state.status)
  const thread = useMilkStore((state) => state.chatThreads[root])
  const permissions = useMilkStore((state) => state.permissions)
  const [draft, setDraft] = useState('')
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

  const send = () => {
    if (!ready || busy || !draft.trim()) return
    const message = draft
    setDraft('')
    void useMilkStore.getState().sendChat(root, message)
  }

  return (
    <section aria-label="milk chat" className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-border-1 px-2">
        <MilkLogo size={16} />
        <div className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-1">milk</div>
        {status?.version && <span className="font-mono text-[8px] text-text-4">{status.version}</span>}
        <button type="button" onClick={() => useMilkStore.getState().setDialogOpen(true)} className="go-studio-icon-button h-6 w-6" title="milk settings" aria-label="milk settings"><Settings2 size={13} /></button>
        <button type="button" onClick={() => void useMilkStore.getState().newChat(root)} className="go-studio-icon-button h-6 w-6" title="New chat" aria-label="New chat"><Plus size={13} /></button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {!ready ? (
          <div className="mt-6 rounded-xl border border-border-1 bg-surface-0 p-3 text-center">
            <MilkLogo size={36} className="mx-auto mb-2" />
            <p className="text-[11px] font-medium text-text-2">{status?.state === 'installing' ? 'Installing milk…' : status?.state === 'outdated' ? 'This milk is too old for gO Studio.' : status?.state === 'not-installed' ? 'milk is not installed yet.' : 'milk needs a working agent host.'}</p>
            <p className="mt-1 text-[9px] leading-4 text-text-4">{status?.message || 'Install milk (milk serve --acp) and enable it, then configure its agents in milk.'}</p>
            <button type="button" onClick={() => useMilkStore.getState().setDialogOpen(true)} className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10px] font-semibold text-white"><Settings2 size={11} />{status?.state === 'not-installed' ? 'Install milk' : status?.state === 'outdated' ? 'Update milk' : 'Open settings'}</button>
          </div>
        ) : !thread?.messages.length ? (
          <div className="mt-4 text-center">
            <MilkLogo size={40} className="mx-auto" />
            <p className="mt-2 text-[11px] font-semibold text-text-2">Ask milk about your project</p>
            <p className="mt-1 text-[9px] leading-4 text-text-4">milk routes between a cheap primary and a deep escalation agent, with tools and memory. It works on this folder directly.</p>
            <div className="mt-3 space-y-1">
              {['List the Go files in this project', 'Explain the selected code', '/agent list'].map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="block w-full rounded-lg border border-border-1 bg-surface-0 px-2 py-1.5 text-left text-[10px] text-text-3 hover:border-accent/30 hover:text-text-1">{prompt}</button>)}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {thread.messages.map((message) => (
              <article key={message.id} className={message.role === 'user' ? 'ml-4 rounded-xl rounded-br-sm bg-accent/12 p-2.5' : 'mr-1'}>
                <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">{message.role === 'user' ? 'You' : <><MilkLogo size={11} />milk</>}</div>
                <div className="text-[10.5px] leading-[1.55] text-text-2"><AssistantMessage message={message} /></div>
              </article>
            ))}
            {thread.error && <div role="alert" className="rounded-lg border border-danger/25 bg-danger/10 p-2 text-[9px] leading-4 text-danger">{thread.error}</div>}
          </div>
        )}
        {permissions.map((permission) => (
          <div key={permission.requestId} className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-2">
            <p className="text-[10px] font-semibold text-text-2">{permission.title || 'Allow tool call?'}</p>
            {permission.description && <p className="mt-0.5 break-words text-[9px] leading-4 text-text-4">{permission.description}</p>}
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={() => void useMilkStore.getState().respondPermission(permission.requestId, true)} className="inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[9px] font-semibold text-white">Allow</button>
              <button type="button" onClick={() => void useMilkStore.getState().respondPermission(permission.requestId, false)} className="inline-flex h-6 items-center rounded-md border border-border-2 px-2 text-[9px] text-text-2 hover:bg-surface-2">Deny</button>
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border-1 p-2">
        <div className="rounded-xl border border-border-2 bg-surface-0 focus-within:border-accent/50">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} disabled={!ready || busy} rows={3} placeholder={ready ? 'Ask milk…' : 'Enable milk to chat'} className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[11px] leading-4 text-text-1 outline-none placeholder:text-text-4 disabled:opacity-50" />
          <div className="flex h-8 items-center px-2 text-[8px] text-text-4"><span>Enter send · Shift+Enter newline</span><span className="flex-1" />{busy ? <button type="button" onClick={() => void useMilkStore.getState().stopChat(root)} className="flex h-6 items-center gap-1 rounded-md bg-danger/10 px-2 text-danger hover:bg-danger/20"><Square size={9} fill="currentColor" />Stop</button> : <button type="button" onClick={send} disabled={!ready || !draft.trim()} className="go-studio-icon-button h-6 w-6 disabled:opacity-35" title="Send" aria-label="Send"><Send size={12} /></button>}</div>
        </div>
      </div>
    </section>
  )
}
