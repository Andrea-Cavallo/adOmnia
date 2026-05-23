import { useState, useRef, useEffect } from 'react'
import { Send, Save, FileCode, Gauge, X, Plus, Check, CornerDownRight, Clock, Code, Copy, CheckCheck } from 'lucide-react'
import type { RequestItem, HttpMethod } from '@/lib/types'
import { uid, blankBody, blankAuth } from '@/lib/types'
import { cn } from '@/lib/utils'
import { KVEditor } from './KVEditor'
import { BodyEditor } from './BodyEditor'
import { AuthEditor } from './AuthEditor'
import { ScriptsEditor } from './ScriptsEditor'
import { AssertionsEditor } from './AssertionsEditor'
import { parseCurl, applyParsedCurl } from '@/lib/parseCurl'
import { Prompt } from '@/components/ui/prompt'
import { generateCode, LANGUAGES, copyToClipboard } from '@/lib/codegen'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { useEnvironmentsStore } from '@/stores/environments'

interface ComposerProps {
  request: RequestItem
  onChange: (request: RequestItem) => void
  onSend: () => void
  onSave: () => void
  onLoadTest?: () => void
  loading?: boolean
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-head',
  CONNECT: 'text-warning',
  TRACE: 'text-info',
}

type TabId = 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'tests'

function CurlImportModal({ onClose, onImport }: { onClose: () => void; onImport: (curl: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const handleImport = () => {
    const parsed = parseCurl(value.trim())
    if (!parsed) { setError('Could not parse cURL command. Make sure it starts with "curl".'); return }
    onImport(value.trim())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[560px] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <span className="text-sm font-semibold text-text-1 flex-1">Import from cURL</span>
          <button onClick={onClose} className="text-text-4 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <textarea
            autoFocus
            className="h-40 px-3 py-2 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-none focus:border-accent outline-none"
            placeholder={"curl 'https://api.your-domain.com/v1/users' \\\n  -H 'Authorization: Bearer TOKEN' \\\n  -H 'Content-Type: application/json'"}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError('') }}
          />
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-3 hover:text-text-1 border border-border-2 rounded">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!value.trim()}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded disabled:opacity-50"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CopyAsDropdown({ request }: { request: RequestItem }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleCopy = async (langId: string) => {
    const code = generateCode(request, langId as typeof LANGUAGES[number]['id'])
    const ok = await copyToClipboard(code)
    if (ok) {
      setCopied(langId)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Copy as code snippet"
        className="h-8 w-8 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors"
      >
        <Code size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface-1 border border-border-1 rounded-md shadow-xl z-50 py-1 w-52 max-h-80 overflow-y-auto">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => handleCopy(lang.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors text-left"
            >
              {copied === lang.id ? <CheckCheck size={12} className="text-success" /> : <Copy size={12} />}
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Composer({ request, onChange, onSend, onSave, onLoadTest, loading }: ComposerProps) {
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const resolvedVars = getResolvedVars()
  const hasActiveEnv = activeEnvId !== null

  const [activeTab, setActiveTab] = useState<TabId>('params')
  const [showCurlImport, setShowCurlImport] = useState(false)
  const [renameBodyPrompt, setRenameBodyPrompt] = useState<{ show: boolean; index: number } | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const isWriteMethod = ['POST', 'PUT', 'PATCH'].includes(request.method)

  const scripts = request.scripts ?? { pre: '', post: '', tests: '' }

  const bodies = request.bodies ?? []
  const bodyCount = bodies.filter((b) => b.type !== 'none').length
  const commonTabs = [
    { id: 'auth' as TabId, label: 'Auth', count: request.auth?.type !== 'none' ? 1 : 0 },
    { id: 'headers' as TabId, label: 'Headers', count: (request.headers ?? []).filter((h) => h.enabled && h.key).length },
    { id: 'params' as TabId, label: 'Params', count: (request.params ?? []).filter((p) => p.enabled && p.key).length },
    { id: 'scripts' as TabId, label: 'Scripts', count: (scripts.pre || scripts.post || scripts.tests) ? 1 : 0 },
    { id: 'tests' as TabId, label: 'Tests', count: (request.assertions ?? []).length },
    { id: 'body' as TabId, label: 'Body', count: bodyCount },
  ]

  const tabs = isWriteMethod
    ? [{ id: 'body' as TabId, label: 'Body', count: bodyCount }, ...commonTabs.filter((t) => t.id !== 'body')]
    : commonTabs

  const bodyIndex = bodies.length
    ? Math.min(Math.max(request.activeBodyIdx, 0), bodies.length - 1)
    : 0
  const activeBody = bodies[bodyIndex]

  const handleCurlImport = (curlStr: string) => {
    const parsed = parseCurl(curlStr)
    if (parsed) onChange(applyParsedCurl(parsed, request))
  }

  useEffect(() => {
    const focusUrl = () => urlInputRef.current?.focus()
    document.addEventListener('adomnia:focus-url', focusUrl)
    return () => document.removeEventListener('adomnia:focus-url', focusUrl)
  }, [])

  return (
    <>
      <div className="flex flex-col border-b border-border-1">
        {/* Request name */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
          <input
            className="flex-1 text-xs text-text-3 bg-transparent outline-none placeholder:text-text-4 hover:text-text-1 focus:text-text-1"
            value={request.name}
            onChange={(e) => onChange({ ...request, name: e.target.value })}
            placeholder="Request name..."
          />
        </div>

        {/* URL Bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          <select
            value={request.method}
            onChange={(e) => onChange({ ...request, method: e.target.value as HttpMethod })}
            className={cn(
              'h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs font-semibold focus:border-accent outline-none',
              METHOD_COLORS[request.method] ?? 'text-text-1'
            )}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <div className="flex-1 h-8 bg-surface-2 border border-border-2 rounded focus-within:border-accent transition-colors overflow-hidden">
            <VarHighlightInput
              value={request.url}
              onChange={(url) => onChange({ ...request, url })}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend() }}
              resolvedVars={resolvedVars}
              hasActiveEnv={hasActiveEnv}
              placeholder="https://api.your-domain.com/v1/users"
              className="h-full"
              inputRef={urlInputRef}
            />
          </div>

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 px-1.5 h-8 bg-surface-2 border border-border-2 rounded">
              <Clock size={11} className="text-text-4" />
              <input
                type="number"
                min="0"
                max="300000"
                step="1000"
                value={request.timeout ?? 0}
                onChange={(e) => onChange({ ...request, timeout: Number(e.target.value) || 0 })}
                className="w-12 bg-transparent text-xs text-text-1 outline-none font-mono placeholder:text-text-4"
                placeholder="ms"
                title="Request timeout (ms, 0 = no timeout)"
              />
            </div>
            <button
              onClick={() => onChange({ ...request, followRedirects: !(request.followRedirects ?? true) })}
              title={request.followRedirects ?? true ? 'Follow redirects (on)' : 'Follow redirects (off)'}
              className={cn(
                'flex items-center gap-1 h-8 px-2 border border-border-2 rounded text-xs transition-colors',
                (request.followRedirects ?? true)
                  ? 'bg-surface-2 text-text-3 hover:text-text-1'
                  : 'bg-error/10 border-error/30 text-error'
              )}
            >
              <CornerDownRight size={11} />
            </button>
          </div>

          <button
            onClick={onSend}
            disabled={!request.url || loading}
            className={cn(
              'h-8 px-4 flex items-center gap-1.5 rounded text-xs font-medium transition-colors',
              'bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <Send size={13} />
            {loading ? 'Sending...' : 'Send'}
          </button>

          <button
            onClick={() => {
              onSave()
              setSavedFlash(true)
              setTimeout(() => setSavedFlash(false), 1000)
            }}
            title="Save to collection (Ctrl+S)"
            className={cn(
              'h-8 w-8 flex items-center justify-center rounded transition-all',
              savedFlash
                ? 'text-success bg-success/10'
                : 'text-text-3 hover:text-text-1 hover:bg-surface-2'
            )}
          >
            {savedFlash ? <Check size={14} /> : <Save size={14} />}
          </button>

          <button
            onClick={() => setShowCurlImport(true)}
            title="Import from cURL"
            className="h-8 w-8 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors"
          >
            <FileCode size={14} />
          </button>

          <CopyAsDropdown request={request} />

          {onLoadTest && (
            <button
              onClick={onLoadTest}
              title="Load Test"
              className="h-8 w-8 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors"
            >
              <Gauge size={14} />
            </button>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-0.5 px-3 border-t border-border-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'px-3 py-2 text-xs transition-colors relative',
                activeTab === t.id ? 'text-text-1' : 'text-text-3 hover:text-text-2'
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-1 px-1 py-0.5 text-[9px] rounded bg-accent/20 text-accent-light">
                  {t.count}
                </span>
              )}
              {activeTab === t.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content — body gets extra height so large JSON doesn't need excessive scrolling */}
        <div className={cn('overflow-y-auto', activeTab === 'body' ? 'max-h-[55vh]' : 'max-h-[300px]')}>
          {activeTab === 'params' && (
            <KVEditor rows={request.params ?? []} onChange={(params) => onChange({ ...request, params })} />
          )}
          {activeTab === 'headers' && (
            <KVEditor
              rows={request.headers ?? []}
              onChange={(headers) => onChange({ ...request, headers })}
              keyPlaceholder="Header"
            />
          )}
          {activeTab === 'body' && (
            <>
              {/* Body sub-tabs */}
              <div className="flex items-center gap-0.5 px-2 pt-1 border-b border-border-1">
                {bodies.map((b, i) => (
                  <div
                    key={b.id}
                    onClick={() => onChange({ ...request, activeBodyIdx: i })}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 text-[10px] transition-colors border-b-2 -mb-[1px] cursor-pointer',
                      i === bodyIndex
                        ? 'border-accent text-text-1'
                        : 'border-transparent text-text-3 hover:text-text-2'
                    )}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onChange({ ...request, activeBodyIdx: i })
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setRenameBodyPrompt({ show: true, index: i })
                    }}
                  >
                    {b.name}
                    {bodies.length > 1 && i === bodyIndex && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const newBodies = bodies.filter((_, ii) => ii !== i)
                          const newIdx = Math.max(0, bodyIndex - 1)
                          onChange({ ...request, bodies: newBodies.length ? newBodies : [blankBody()], activeBodyIdx: newBodies.length ? newIdx : 0 })
                        }}
                        className="ml-1 text-text-4 hover:text-error inline-flex"
                        title="Delete body"
                      >
                        <X size={9} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => {
                    const source = activeBody ?? blankBody()
                    const sourceRaw = source.raw ?? ''
                    const nextRaw = source.lang === 'json' && sourceRaw.trim()
                      ? (() => { try { return JSON.stringify(JSON.parse(sourceRaw), null, 2) } catch { return sourceRaw } })()
                      : sourceRaw
                    onChange({
                      ...request,
                      bodies: [
                        ...bodies,
                        {
                          ...source,
                          id: uid(),
                          name: `Body ${bodies.length + 1}`,
                          raw: nextRaw,
                          form: (source.form ?? []).map((row) => ({ ...row, id: uid() })),
                        },
                      ],
                      activeBodyIdx: bodies.length,
                    })
                  }}
                  className="px-1 py-1 text-text-4 hover:text-accent"
                  title="Add body"
                >
                  <Plus size={11} />
                </button>
              </div>
              {activeBody && (
                <BodyEditor
                  key={activeBody.id}
                  body={activeBody}
                  isWebSocket={request.method === 'WS'}
                  requestUrl={request.url}
                  requestMethod={request.method}
                  onChange={(updated) => {
                    const newBodies = bodies.map((b, i) =>
                      i === bodyIndex ? { ...b, ...updated } : b
                    )
                    onChange({ ...request, bodies: newBodies, activeBodyIdx: bodyIndex })
                  }}
                />
              )}
            </>
          )}
          {activeTab === 'auth' && (
            <AuthEditor auth={request.auth ?? blankAuth()} onChange={(auth) => onChange({ ...request, auth })} />
          )}
          {activeTab === 'scripts' && (
            <ScriptsEditor
              pre={scripts.pre ?? ''}
              post={scripts.post ?? ''}
              tests={scripts.tests ?? ''}
              onChange={(s) => onChange({ ...request, scripts: s })}
            />
          )}
          {activeTab === 'tests' && (
            <AssertionsEditor
              assertions={request.assertions ?? []}
              onChange={(assertions) => onChange({ ...request, assertions })}
            />
          )}
        </div>
      </div>

      {showCurlImport && (
        <CurlImportModal
          onClose={() => setShowCurlImport(false)}
          onImport={handleCurlImport}
        />
      )}

      <Prompt
        open={renameBodyPrompt?.show ?? false}
        title="Rename Body"
        placeholder="Body name..."
        defaultValue={renameBodyPrompt ? bodies[renameBodyPrompt.index]?.name : ''}
        confirmLabel="Rename"
        onConfirm={(name) => {
          if (renameBodyPrompt) {
            const i = renameBodyPrompt.index
            const newBodies = bodies.map((bb, ii) =>
              ii === i ? { ...bb, name } : bb
            )
            onChange({ ...request, bodies: newBodies })
            setRenameBodyPrompt(null)
          }
        }}
        onCancel={() => setRenameBodyPrompt(null)}
      />
    </>
  )
}
