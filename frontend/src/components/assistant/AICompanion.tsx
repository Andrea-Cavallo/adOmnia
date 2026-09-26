import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileText, Loader2, Maximize2, Minimize2, Send, WandSparkles, X } from 'lucide-react'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { buildCompanionPrompt, isAICompanionAvailable, parseCompanionReply, type CompanionMood, type HeaderSuggestion } from '@/lib/aiCompanion'
import { blankKVRow } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import spriteSheet from './assets/a0-companion-sprites.png'
import './AICompanion.css'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
  mood?: CompanionMood
  headers?: HeaderSuggestion[]
  actions?: Array<'open-flow' | 'open-docs'>
}

const WELCOME: ChatMessage = { id: 'welcome', role: 'assistant', mood: 'happy', text: 'Ciao Andrea, cosa facciamo?' }

function Sprite({ mood, loading, size, resting, greeting = false }: { mood: CompanionMood; loading: boolean; size: number; resting: boolean; greeting?: boolean }) {
  const frame = loading || mood === 'thinking' ? 1 : mood === 'concerned' ? 2 : 0
  return (
    <span className={cn('a0-companion-sprite relative block shrink-0 overflow-hidden rounded-full', loading ? 'a0-companion-thinking' : resting && 'a0-companion-idle', greeting && 'a0-companion-greeting')} style={{ height: size, width: size }}>
      <img src={spriteSheet} alt="" className="h-full max-w-none transition-transform duration-300" style={{ width: '300%', transform: `translateX(-${frame * 33.333}%)` }} />
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
  const [expanded, setExpanded] = useState(false)
  const [greeting, setGreeting] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTabId && !tab.tool)
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  const mood = assistantMessages[assistantMessages.length - 1]?.mood ?? 'happy'
  const hasUserMessage = messages.some((message) => message.role === 'user')
  const connected = isAICompanionAvailable(ai)

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading, open])

  useEffect(() => {
    if (!greeting) return
    const timeout = window.setTimeout(() => setGreeting(false), 440)
    return () => window.clearTimeout(timeout)
  }, [greeting])

  const quickPrompts = useMemo(() => ['Create an API Flow from this collection.', 'Generate documentation for this collection.'], [])

  // A configured provider is not necessarily usable. a0 appears only after the
  // user has explicitly tested this exact provider/model combination.
  if (!connected) return null

  const close = () => {
    setOpen(false)
    setExpanded(false)
    setGreeting(false)
    setModelMenuOpen(false)
  }

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
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', mood: 'concerned', text: `I couldn’t reach the configured AI provider. ${error instanceof Error ? error.message : String(error)}` }])
    } finally {
      setLoading(false)
    }
  }

  const applyHeaders = (headers: HeaderSuggestion[]) => {
    if (!activeTab) return
    const existing = new Set(activeTab.request.headers.map((header) => header.key.trim().toLowerCase()))
    const additions = headers.filter((header) => !existing.has(header.key.toLowerCase())).map((header) => ({ ...blankKVRow(), key: header.key, value: header.value, enabled: true }))
    if (!additions.length) return
    updateRequest(activeTab.id, { ...activeTab.request, headers: [...activeTab.request.headers, ...additions] })
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', mood: 'happy', text: `${additions.length} header suggestion${additions.length === 1 ? '' : 's'} added to the open request. Review and save when ready.` }])
  }

  const openFlow = (prompt: string) => {
    sessionStorage.setItem('adomnia.ai.flow-instructions', prompt)
    setActiveRail('flows')
    close()
  }

  return (
    <div className="fixed bottom-5 right-4 z-[90] flex flex-col items-end">
      {open && (
        <section aria-label="a0 AI assistant" className={cn('a0-companion-panel flex flex-col overflow-hidden rounded-xl border border-border-1 bg-surface-1 shadow-2xl', expanded ? 'h-[min(560px,calc(100vh-2rem))] w-[min(480px,calc(100vw-1.5rem))]' : 'h-[min(380px,calc(100vh-2rem))] w-[min(320px,calc(100vw-1.5rem))]')}>
          <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-2/80 px-2.5">
            <Sprite mood={mood} loading={loading} size={26} resting={!input.trim() && !loading} greeting={greeting} />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => setModelMenuOpen((value) => !value)} aria-expanded={modelMenuOpen} className="inline-flex items-center gap-1 text-xs font-semibold text-text-1 hover:text-accent">
                a0 <ChevronDown size={11} className={cn('text-text-4 transition-transform', modelMenuOpen && 'rotate-180')} />
              </button>
              {modelMenuOpen && (
                <div role="menu" className="absolute left-2 top-10 z-10 w-52 rounded-md border border-border-1 bg-surface-1 p-2 shadow-xl">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-text-4">Connected model</p>
                  <p className="mt-1 truncate text-[10px] text-text-2">{ai.provider}</p>
                  <p className="truncate font-mono text-[9px] text-text-3">{ai.model}</p>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? 'Compact a0 assistant' : 'Expand a0 assistant'} className="grid h-7 w-7 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">{expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
            <button type="button" onClick={close} title="Close a0 assistant" className="grid h-7 w-7 place-items-center rounded text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[91%] rounded-lg px-2.5 py-2 text-[11px] leading-relaxed', message.role === 'user' ? 'bg-accent text-white' : 'border border-border-1 bg-surface-2 text-text-2')}>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.id === WELCOME.id && !hasUserMessage && <div className="mt-2 flex flex-wrap gap-1.5">{quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => void send(prompt)} className="rounded border border-border-2 bg-surface-1 px-2 py-1 text-[9px] text-text-3 transition-colors hover:border-accent/35 hover:text-text-1">{prompt.replace('.', '')}</button>)}</div>}
                  {message.headers && message.headers.length > 0 && (
                    <div className="mt-2 border-t border-border-1 pt-2">
                      {message.headers.map((header) => <p key={`${header.key}:${header.value}`} className="font-mono text-[10px] text-text-3">{header.key}: {header.value}</p>)}
                      <button type="button" disabled={!activeTab} onClick={() => applyHeaders(message.headers ?? [])} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"><WandSparkles size={11} /> Apply to open request</button>
                    </div>
                  )}
                  {message.actions?.includes('open-flow') && <button type="button" onClick={() => { const userMessages = messages.filter((item) => item.role === 'user'); openFlow(userMessages[userMessages.length - 1]?.text ?? '') }} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15"><WandSparkles size={11} /> Open Flow generator</button>}
                  {message.actions?.includes('open-docs') && <button type="button" onClick={() => { setActiveRail('apidocs'); close() }} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15"><FileText size={11} /> Open API Docs</button>}
                </div>
              </div>
            ))}
            {loading && <div className="flex items-center gap-2 text-[11px] text-text-4"><Loader2 size={13} className="animate-spin text-accent" /> a0 is thinking…</div>}
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void send() }} className="flex shrink-0 gap-2 border-t border-border-1 bg-surface-1 p-2">
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a0 about this workspace…" className="h-8 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-2 px-2 text-[11px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-accent" />
            <button type="submit" disabled={!input.trim() || loading} title="Send to a0" className="grid h-8 w-8 place-items-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"><Send size={14} /></button>
          </form>
        </section>
      )}
      {!open && <button type="button" onClick={() => { setGreeting(true); setOpen(true) }} aria-label="Open a0 AI assistant" title="Ask a0" className="a0-companion-launcher grid h-12 w-12 place-items-center rounded-full border border-border-1 bg-surface-1/95 shadow-lg transition-colors hover:border-accent/45 focus-visible:border-accent focus-visible:outline-none"><Sprite mood={mood} loading={loading} size={48} resting={!loading} /></button>}
    </div>
  )
}
