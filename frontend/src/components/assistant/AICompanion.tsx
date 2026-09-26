import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileText, Loader2, Send, Sparkles, WandSparkles, X } from 'lucide-react'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { buildCompanionPrompt, parseCompanionReply, type CompanionMood, type HeaderSuggestion } from '@/lib/aiCompanion'
import { blankKVRow } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import spriteSheet from './assets/a0-companion-sprites.png'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
  mood?: CompanionMood
  headers?: HeaderSuggestion[]
  actions?: Array<'open-flow' | 'open-docs'>
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  mood: 'happy',
  text: 'Hi, I’m a0. Ask me to draft a Flow, explain your collection, generate API documentation, or suggest headers for the request you have open.',
}

function Sprite({ mood, loading }: { mood: CompanionMood; loading: boolean }) {
  const frame = loading || mood === 'thinking' ? 1 : mood === 'concerned' ? 2 : 0
  return (
    <span className={cn('relative block h-[76px] w-[76px] overflow-hidden rounded-full', loading && 'animate-pulse')}>
      <img
        src={spriteSheet}
        alt="a0"
        className="h-full max-w-none transition-transform duration-300"
        style={{ width: '300%', transform: `translateX(-${frame * 33.333}%)` }}
      />
    </span>
  )
}

export function AICompanion() {
  const ai = useSettingsStore((state) => state.settings.ai)
  const collections = useCollectionsStore((state) => state.collections)
  const activeTabId = useTabsStore((state) => state.activeTabId)
  const tabs = useTabsStore((state) => state.tabs)
  const updateRequest = useTabsStore((state) => state.updateRequest)
  const setActiveRail = useAppStore((state) => state.setActiveRail)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTabId && !tab.tool)
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  const mood = assistantMessages[assistantMessages.length - 1]?.mood ?? 'happy'

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading, open])

  const quickPrompts = useMemo(() => [
    'Create an API Flow from this collection.',
    'Generate documentation for this collection.',
    'Suggest headers for the active request.',
  ], [])

  if (!ai.enabled) return null

  const send = async (value = input) => {
    const text = value.trim()
    if (!text || loading) return
    setInput('')
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }])
    setLoading(true)
    try {
      const prompt = buildCompanionPrompt(text, collections, activeTab?.request)
      await ensureAIConfigured()
      const raw = await AIEngine.Complete(prompt.system, prompt.user, 1800)
      const reply = parseCompanionReply(raw)
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: reply.reply, mood: reply.mood, headers: reply.headerSuggestions, actions: reply.actions }])
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        mood: 'concerned',
        text: `I couldn’t reach the configured AI provider. ${error instanceof Error ? error.message : String(error)}`,
      }])
    } finally {
      setLoading(false)
    }
  }

  const applyHeaders = (headers: HeaderSuggestion[]) => {
    if (!activeTab) return
    const existing = new Set(activeTab.request.headers.map((header) => header.key.trim().toLowerCase()))
    const additions = headers
      .filter((header) => !existing.has(header.key.toLowerCase()))
      .map((header) => ({ ...blankKVRow(), key: header.key, value: header.value, enabled: true }))
    if (!additions.length) return
    updateRequest(activeTab.id, { ...activeTab.request, headers: [...activeTab.request.headers, ...additions] })
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', mood: 'happy', text: `${additions.length} header suggestion${additions.length === 1 ? '' : 's'} added to the open request. Review and save when ready.` }])
  }

  const openFlow = (prompt: string) => {
    sessionStorage.setItem('adomnia.ai.flow-instructions', prompt)
    setActiveRail('flows')
    setOpen(false)
  }

  return (
    <div className="fixed bottom-7 right-3 z-[90] flex flex-col items-end gap-2">
      {open && (
        <section aria-label="a0 AI assistant" className="flex h-[min(520px,calc(100vh-7rem))] w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-accent/35 bg-surface-1 shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border-1 bg-surface-2/80 px-3 py-2">
            <Sprite mood={mood} loading={loading} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-1"><Sparkles size={13} className="text-accent" /> a0 assistant</div>
              <p className="mt-0.5 text-[10px] text-text-4">{ai.model ? `${ai.provider} · ${ai.model}` : 'Configure a model in Settings → AI'}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} title="Close a0 assistant" className="grid h-7 w-7 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[88%] rounded-lg px-3 py-2 text-[11px] leading-relaxed', message.role === 'user' ? 'bg-accent text-white' : 'border border-border-1 bg-surface-2 text-text-2')}>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.headers && message.headers.length > 0 && (
                    <div className="mt-2 border-t border-border-1 pt-2">
                      {message.headers.map((header) => <p key={`${header.key}:${header.value}`} className="font-mono text-[10px] text-text-3">{header.key}: {header.value}</p>)}
                      <button type="button" disabled={!activeTab} onClick={() => applyHeaders(message.headers ?? [])} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"><WandSparkles size={11} /> Apply to open request</button>
                    </div>
                  )}
                  {message.actions?.includes('open-flow') && <button type="button" onClick={() => { const userMessages = messages.filter((item) => item.role === 'user'); openFlow(userMessages[userMessages.length - 1]?.text ?? '') }} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15"><WandSparkles size={11} /> Open Flow generator</button>}
                  {message.actions?.includes('open-docs') && <button type="button" onClick={() => { setActiveRail('apidocs'); setOpen(false) }} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15"><FileText size={11} /> Open API Docs</button>}
                </div>
              </div>
            ))}
            {loading && <div className="flex items-center gap-2 text-[11px] text-text-4"><Loader2 size={13} className="animate-spin text-accent" /> a0 is thinking…</div>}
          </div>

          <div className="border-t border-border-1 bg-surface-1 p-2">
            <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5">
              {quickPrompts.map((prompt) => <button key={prompt} type="button" disabled={loading} onClick={() => void send(prompt)} className="shrink-0 rounded border border-border-2 bg-surface-2 px-2 py-1 text-[9px] text-text-3 transition-colors hover:border-accent/40 hover:text-text-1 disabled:opacity-45">{prompt.replace('.', '')}</button>)}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void send() }} className="flex gap-2">
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a0 about this workspace…" className="h-8 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-accent" />
              <button type="submit" disabled={!input.trim() || loading} title="Send to a0" className="grid h-8 w-8 place-items-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"><Send size={14} /></button>
            </form>
          </div>
        </section>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Close a0 AI assistant' : 'Open a0 AI assistant'} className="group flex items-center gap-2 rounded-full border border-accent/40 bg-surface-1 py-1 pl-1 pr-3 shadow-xl transition-transform hover:-translate-y-0.5 hover:border-accent">
        <Sprite mood={mood} loading={loading} />
        <span className="text-xs font-semibold text-text-1">Ask a0</span>
        <ChevronDown size={14} className={cn('text-text-4 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  )
}
