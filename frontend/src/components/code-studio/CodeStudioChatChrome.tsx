import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, Info, Layers } from 'lucide-react'
import './codeStudioChatChrome.css'

export const CodeStudioChatHeader = createContext<ReactNode>(null)
export const useCodeStudioChatHeader = () => useContext(CodeStudioChatHeader)

function ChatDisclosure({ className, summary, label, title, children }: { className: string; summary: ReactNode; label?: string; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open') }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return <details ref={ref} className={className} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus() } }}>
    <summary aria-label={label} title={title}>{summary}</summary>{children}
  </details>
}

export function ChatConnectionDetails({ title, children }: { title?: string; children: ReactNode }) {
  return <ChatDisclosure className="studio-chat-identity" label="Connection details" title={title} summary={<Info size={14} />}><div className="studio-chat-identity-content">{children}</div></ChatDisclosure>
}

export function ChatContext({ summary, children }: { summary?: string; children: ReactNode }) {
  return <ChatDisclosure className="studio-chat-context" summary={<><Layers size={13} /><span>Context</span>{summary && <span className="studio-chat-context-summary">{summary}</span>}<ChevronDown size={11} /></>}><div className="studio-chat-context-options">{children}</div></ChatDisclosure>
}

export function ChatSessionOptions({ label, children }: { label: string; children: ReactNode }) {
  return <ChatDisclosure className="studio-chat-session-options" label="Model and reasoning" title={label} summary={<><span>{label}</span><ChevronDown size={11} /></>}><div className="studio-chat-session-content">{children}</div></ChatDisclosure>
}
