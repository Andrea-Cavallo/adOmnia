import {
  ArrowDown,
  ArrowDownUp,
  Clipboard,
  Copy,
  Download,
  FileText,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useState } from 'react'
import { generatePassword, uuidv4 } from './utilsCore'

const copy = (value: string) => navigator.clipboard.writeText(value).catch(() => {})

export function Base64Tool({
  input,
  output,
  onInput,
  onOutput,
  onRun,
}: {
  input: string
  output: string
  onInput: (value: string) => void
  onOutput: (value: string) => void
  onRun: (mode: 'encode' | 'decode') => void
}) {
  const inputChars = input.length
  const outputChars = output.length

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 pb-3">
        <button onClick={() => onRun('encode')} className="inline-flex h-9 items-center gap-2 rounded-md border border-accent/40 bg-accent px-4 text-xs font-semibold text-white shadow-[0_0_24px_rgba(139,92,246,.28)] hover:bg-accent-light">
          <FileText size={14} /> Encode
        </button>
        <button onClick={() => onRun('decode')} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-4 text-xs font-semibold text-text-2 hover:border-accent/40 hover:text-text-1">
          <ArrowDown size={14} /> Decode
        </button>
        <div className="mx-1 h-6 w-px bg-border-1" />
        <button onClick={() => { onInput(output); onOutput(input) }} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <ArrowDownUp size={14} /> Swap
        </button>
        <button onClick={() => onInput(input.trim())} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <Wand2 size={14} /> Beautify
        </button>
        <button onClick={() => copy(output)} disabled={!output} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-45">
          <Copy size={14} /> Copy Result
        </button>
        <button onClick={() => onOutput('')} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <Trash2 size={14} /> Clear Output
        </button>
      </div>

      <div className="grid min-h-[360px] grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-1 bg-surface-0/80">
          <div className="flex h-10 items-center justify-between border-b border-border-1 bg-surface-1/70 px-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Input</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-text-4">UTF-8 <span className="h-1.5 w-1.5 rounded-full bg-success" /></span>
          </div>
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            placeholder="Enter text or Base64..."
            spellCheck={false}
            className="min-h-[300px] flex-1 resize-none bg-transparent px-4 py-3 font-mono text-xs leading-6 text-text-1 outline-none placeholder:text-text-4"
          />
          <div className="flex h-8 items-center justify-between border-t border-border-1 bg-surface-1/60 px-3 font-mono text-[10px] text-text-4">
            <span>Line 1, Col 1</span>
            <span>{inputChars} chars · {new Blob([input]).size} bytes</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-1 bg-surface-0/80">
          <div className="flex h-10 items-center justify-between border-b border-border-1 bg-surface-1/70 px-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Output</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-text-4">Base64 <span className="h-1.5 w-1.5 rounded-full bg-success" /></span>
          </div>
          <pre className="min-h-[300px] flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-6 text-accent-light">
            {output || 'Run Encode or Decode to generate output.'}
          </pre>
          <div className="flex h-8 items-center justify-between border-t border-border-1 bg-surface-1/60 px-3 font-mono text-[10px] text-text-4">
            <span>Line 1, Col 1</span>
            <span>{outputChars} chars · {new Blob([output]).size} bytes</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 pb-3">
        <button onClick={() => navigator.clipboard.readText().then(onInput).catch(() => {})} className="inline-flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <Clipboard size={13} /> Paste
        </button>
        <button onClick={() => onInput('')} className="inline-flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <Trash2 size={13} /> Clear
        </button>
        <button onClick={() => onInput('Authorization: Bearer demo-token\nUser: alice@example.com\nRole: admin\nEnvironment: production')} className="inline-flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 text-xs text-text-3 hover:text-text-1">
          <Download size={13} /> Load Sample
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {[
          ['JWT Header', 'eyJhbGciOiJIUzI1NiIs...'],
          ['JWT Payload', 'eyJzdWIiOiJkZW1v...'],
          ['Basic Auth', 'user:password'],
          ['JSON Sample', '{"service":"api"}'],
          ['More Samples', 'View all examples'],
        ].map(([title, detail]) => (
          <button key={title} onClick={() => onInput(detail)} className="min-w-0 rounded-md border border-border-1 bg-surface-1 px-3 py-2 text-left hover:border-accent/40 hover:bg-surface-2">
            <span className="block truncate text-xs font-semibold text-text-2">{title}</span>
            <span className="mt-1 block truncate font-mono text-[10px] text-text-4">{detail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function HashTool({
  input,
  output,
  algo,
  onInput,
  onOutput,
  onAlgo,
}: {
  input: string
  output: string
  algo: string
  onInput: (value: string) => void
  onOutput: (value: string) => void
  onAlgo: (value: string) => void
}) {
  const hash = async () => {
    try {
      const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(input))
      onOutput(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''))
    } catch {
      onOutput('Hash not available')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <select value={algo} onChange={(e) => onAlgo(e.target.value)} className="w-32 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
        <option>MD5</option>
        <option>SHA-1</option>
        <option>SHA-256</option>
        <option>SHA-512</option>
      </select>
      <textarea value={input} onChange={(e) => onInput(e.target.value)} placeholder="Enter text to hash..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
      <button onClick={() => void hash()} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Hash</button>
      {output && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{output}</pre>}
    </div>
  )
}

export function JwtTool({
  input,
  output,
  onInput,
  onOutput,
}: {
  input: string
  output: object | null
  onInput: (value: string) => void
  onOutput: (value: object | null) => void
}) {
  const decodeJWT = (token: string) => {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return { error: 'Not a valid JWT (expected 3 parts)' }
      const decode = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')))
      return { header: decode(parts[0]), payload: decode(parts[1]), signature: parts[2] }
    } catch {
      return { error: 'Failed to decode JWT' }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea value={input} onChange={(e) => onInput(e.target.value)} placeholder="Paste a JWT token..." rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
      <button onClick={() => onOutput(decodeJWT(input.trim()))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Decode</button>
      {output && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-64">{JSON.stringify(output, null, 2)}</pre>}
    </div>
  )
}

export function PasswordTool() {
  const [length, setLength] = useState(16)
  const [upper, setUpper] = useState(true)
  const [num, setNum] = useState(true)
  const [sym, setSym] = useState(true)
  const [output, setOutput] = useState('')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-text-3">
          Length <input type="number" value={length} min={4} max={128} onChange={(e) => setLength(Number(e.target.value))} className="w-14 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> A-Z</label>
        <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={num} onChange={(e) => setNum(e.target.checked)} /> 0-9</label>
        <label className="flex items-center gap-1 text-xs text-text-3"><input type="checkbox" checked={sym} onChange={(e) => setSym(e.target.checked)} /> !@#$</label>
      </div>
      <button onClick={() => setOutput(generatePassword(length, upper, num, sym))} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
      {output && (
        <div className="relative group">
          <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{output}</pre>
          <button onClick={() => copy(output)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-text-1"><Copy size={12} /></button>
        </div>
      )}
    </div>
  )
}

export function UuidTool({
  ids,
  count,
  onIds,
  onCount,
}: {
  ids: string[]
  count: number
  onIds: (value: string[]) => void
  onCount: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text-3">
          Count <input type="number" value={count} min={1} max={50} onChange={(e) => onCount(Math.max(1, Math.min(50, Number(e.target.value))))} className="w-16 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none" />
        </label>
        <button onClick={() => onIds(Array.from({ length: count }, uuidv4))} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate</button>
        <button onClick={() => copy(ids.join('\n'))} className="flex items-center gap-1 px-3 py-1.5 bg-surface-2 text-text-2 border border-border-2 rounded text-xs"><Copy size={11} /> Copy All</button>
      </div>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-2 group">
          <span className="flex-1 font-mono text-xs text-text-1 bg-surface-1 border border-border-1 px-3 py-1.5 rounded">{id}</span>
          <button onClick={() => copy(id)} className="opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-text-1"><Copy size={12} /></button>
        </div>
      ))}
    </div>
  )
}
