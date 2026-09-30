import { useState } from 'react'
import type { LiveSession } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'

const SOURCE_LABEL: Record<string, string> = {
  env: 'from the run configuration',
  output: 'printed by the service',
  listening: 'detected from the open sockets',
  manual: 'set by hand',
}

/** `:8080` with its origin; click to fix it when detection guessed wrong or found nothing. */
export function PortEditor({ session }: { session: LiveSession }) {
  const setPort = useDevSessionStore((s) => s.setPort)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  if (editing) {
    const commit = () => {
      const port = Number(value)
      if (Number.isInteger(port) && port > 0 && port < 65536) void setPort(session.id, port)
      setEditing(false)
    }
    return (
      <input
        autoFocus
        aria-label="Service port"
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setEditing(false) }}
        className="h-5 w-16 rounded border border-accent bg-surface-2 px-1 font-mono text-[11px] text-text-1 outline-none"
      />
    )
  }
  const title = session.port ? `localhost:${session.port} · ${SOURCE_LABEL[session.portSource ?? ''] ?? ''} · click to change` : 'Port not detected yet · click to set it'
  return (
    <button type="button" title={title} onClick={() => { setValue(session.port ? String(session.port) : ''); setEditing(true) }}
      className={session.port ? 'font-mono text-text-2 hover:text-accent' : 'font-mono text-warning hover:text-accent'}>
      {session.port ? `:${session.port}` : ':????'}
    </button>
  )
}
