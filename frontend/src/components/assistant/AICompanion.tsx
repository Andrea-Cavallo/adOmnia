import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, FileText, Loader2, Send, Settings2, WandSparkles } from 'lucide-react'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { buildCompanionPrompt, COMPANION_WELCOME, inferCompanionRequestAction, inferMockGenerationAction, isAICompanionAvailable, materializeCompanionRequest, parseCompanionReply, type CompanionMood, type GenerateMockAction, type HeaderSuggestion } from '@/lib/aiCompanion'
import { blankKVRow } from '@/lib/types'
import { appendMockEndpoints, generatedMockEndpointsToStored } from '@/lib/mockEndpointStore'
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

const WELCOME: ChatMessage = { id: 'welcome', role: 'assistant', mood: 'happy', text: COMPANION_WELCOME }

function prefersItalian(value: string): boolean {
  const text = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /\b(?:una|un|per|crea|creami|mockami|simula|apri|questa|questo|voglio|vorrei|ora)\b/.test(text)
}

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
  const addQuickRequest = useCollectionsStore((state) => state.addQuickRequest)
  const activeTabId = useTabsStore((state) => state.activeTabId)
  const tabs = useTabsStore((state) => state.tabs)
  const updateRequest = useTabsStore((state) => state.updateRequest)
  const openTab = useTabsStore((state) => state.openTab)
  const setActiveRail = useAppStore((state) => state.setActiveRail)
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading])

  const quickPrompts = useMemo(() => ['Create an API Flow from this collection.', 'Generate documentation for this collection.'], [])

  if (!connected) return (
    <section aria-label="AI di a0" className="flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center">
      <Bot size={24} className="mb-2 text-text-4" />
      <p className="text-[11px] font-semibold text-text-2">AI di a0 non è collegata.</p>
      <p className="mt-1 text-[9px] leading-4 text-text-4">Configura provider e modello, poi verifica la connessione.</p>
      <button type="button" onClick={() => { sessionStorage.setItem('adomnia.settings.requested-section', 'ai'); setActiveRail('settings') }} className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10px] font-semibold text-white"><Settings2 size={11} />Configura AI</button>
    </section>
  )

  const generateMock = async (action: GenerateMockAction): Promise<number> => {
    await ensureAIConfigured()
    const raw = await AIEngine.GenerateMockEndpoints('natural', action.description)
    const endpoints = generatedMockEndpointsToStored(JSON.parse(raw) as unknown)
    if (!endpoints.length) throw new Error('The AI provider did not return any valid mock endpoints.')
    await appendMockEndpoints(endpoints)
    setActiveRail('mock')
    return endpoints.length
  }

  const send = async (value = input) => {
    const text = value.trim()
    if (!text || loading) return
    setInput('')
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text }
    const localRequestAction = ai.workspaceActionsEnabled ? inferCompanionRequestAction(text) : null
    if (localRequestAction) {
      const request = materializeCompanionRequest(localRequestAction)
      const collectionId = addQuickRequest(request)
      openTab(request, collectionId)
      setActiveRail('collections')
      setMessages((current) => [...current, userMessage, {
        id: crypto.randomUUID(),
        role: 'assistant',
        mood: 'happy',
        text: prefersItalian(text)
          ? 'Ho creato la Greeting API nella radice del workspace e l’ho aperta per la revisione.'
          : 'Created the Greeting API at workspace root and opened it for review.',
      }])
      return
    }
    const localMockAction = ai.workspaceActionsEnabled ? inferMockGenerationAction(text) : null
    if (localMockAction) {
      setMessages((current) => [...current, userMessage])
      setLoading(true)
      try {
        const count = await generateMock(localMockAction)
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: 'assistant',
          mood: 'happy',
          text: prefersItalian(text)
            ? `Ho generato ${count} endpoint e li ho aperti nel Mock Server per la revisione.`
            : `Generated ${count} endpoints and opened them in Mock Server for review.`,
        }])
      } catch (error) {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: 'assistant',
          mood: 'concerned',
          text: `${prefersItalian(text) ? 'Non sono riuscito a generare il mock.' : 'I could not generate the mock.'} ${error instanceof Error ? error.message : String(error)}`,
        }])
      } finally {
        setLoading(false)
      }
      return
    }
    setMessages((current) => [...current, userMessage])
    setLoading(true)
    try {
      const prompt = buildCompanionPrompt(
        text,
        collections,
        activeTab?.request,
        ai.workspaceActionsEnabled,
        messages.filter((message) => message.id !== WELCOME.id).map(({ role, text: messageText }) => ({ role, text: messageText })),
      )
      await ensureAIConfigured()
      const raw = await AIEngine.Complete(prompt.system, prompt.user, 1800)
      const reply = parseCompanionReply(raw)
      let createdRequests = 0
      let createdMockEndpoints = 0
      if (ai.workspaceActionsEnabled) {
        for (const action of reply.workspaceActions) {
          if (action.type === 'create-request') {
            const request = materializeCompanionRequest(action)
            const collectionId = addQuickRequest(request)
            openTab(request, collectionId)
            createdRequests += 1
          } else if (action.type === 'generate-mock') {
            createdMockEndpoints += await generateMock(action)
          }
        }
      }
      if (createdRequests > 0 && createdMockEndpoints === 0) setActiveRail('collections')
      for (const action of reply.navigationActions) setActiveRail(action.panel)
      const resultParts: string[] = []
      if (createdRequests > 0) resultParts.push(prefersItalian(text) ? `${createdRequests} richieste create` : `${createdRequests} request${createdRequests === 1 ? '' : 's'} created`)
      if (createdMockEndpoints > 0) resultParts.push(prefersItalian(text) ? `${createdMockEndpoints} endpoint mock generati` : `${createdMockEndpoints} mock endpoint${createdMockEndpoints === 1 ? '' : 's'} generated`)
      const actionResult = resultParts.length ? `\n\n${resultParts.join(' · ')}.` : ''
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `${reply.reply}${actionResult}`, mood: reply.mood, headers: reply.headerSuggestions, actions: reply.actions }])
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        mood: 'concerned',
        text: `${prefersItalian(text) ? 'Non riesco a raggiungere il provider AI configurato.' : 'I couldn’t reach the configured AI provider.'} ${error instanceof Error ? error.message : String(error)}`,
      }])
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
  }

  return (
        <section aria-label="AI di a0" className="a0-companion-panel flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1">
          <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-2/80 px-2.5">
            <Sprite mood={mood} loading={loading} size={26} resting={!input.trim() && !loading} />
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
                  {message.actions?.includes('open-docs') && <button type="button" onClick={() => setActiveRail('apidocs')} className="mt-2 inline-flex items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/15"><FileText size={11} /> Open API Docs</button>}
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
  )
}
