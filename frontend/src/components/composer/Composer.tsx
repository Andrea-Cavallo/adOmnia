import { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Save, FileCode, Gauge, X, Plus, Check, CornerDownRight, Clock, Code, Copy, CheckCheck, FileText } from 'lucide-react'
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
import { prepareRequestForCodegen } from '@/lib/sendRequest'
import { useTabsStore, type ComposerSection } from '@/stores/tabs'
import { useCookieJarStore, type JarEntry } from '@/lib/cookieJar'
import { useSettingsStore } from '@/stores/settings'

interface ComposerProps {
  tabId: string
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
          <button onClick={onClose} title="Close" className="text-text-4 hover:text-text-1"><X size={16} /></button>
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

function CopyAsDropdown({ request, vars }: { request: RequestItem; vars: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [preparing, setPreparing] = useState<string | null>(null)
  const [error, setError] = useState('')
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
    setPreparing(langId)
    setError('')
    try {
      const prepared = await prepareRequestForCodegen(request, vars)
      const code = generateCode(prepared, langId as typeof LANGUAGES[number]['id'])
      const ok = await copyToClipboard(code)
      if (ok) {
        setCopied(langId)
        setTimeout(() => setCopied(null), 1500)
      } else {
        setError('Clipboard unavailable.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreparing(null)
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
              onClick={() => void handleCopy(lang.id)}
              disabled={preparing !== null}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors text-left disabled:opacity-55"
            >
              {copied === lang.id ? <CheckCheck size={12} className="text-success" /> : <Copy size={12} />}
              <span>{lang.label}</span>
              {preparing === lang.id && <span className="ml-auto text-[10px] text-accent">Preparing...</span>}
            </button>
          ))}
          {error && <p className="border-t border-error/20 px-3 py-2 text-[10px] text-error">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** Displays session-jar cookies for the request's domain, with delete controls. */
function CookieJarSection({ requestUrl }: { requestUrl: string }) {
  const sendCookiesAutomatically = useSettingsStore((s) => s.settings.requests.sendCookiesAutomatically)
  // Select `entries` (a stable reference) rather than calling getCookiesForUrl() inside the
  // selector.  getCookiesForUrl always returns a new array via .filter(), so using it as a
  // Zustand selector causes Zustand 5 / useSyncExternalStore to see a different snapshot on
  // every tearing-check call → infinite re-render loop → React error #185.
  const allEntries = useCookieJarStore((s) => s.entries)
  const deleteCookie = useCookieJarStore((s) => s.deleteCookie)
  const clearDomain = useCookieJarStore((s) => s.clearDomain)

  let domain = ''
  try { domain = new URL(requestUrl).hostname } catch { /* invalid url while typing */ }

  // Filter entries with useMemo so we only recompute when the stable deps actually change.
  const jarEntries = useMemo((): JarEntry[] => {
    if (!sendCookiesAutomatically || !domain || !allEntries.length) return []
    let host: string, reqPath: string, isHttps: boolean
    try {
      const u = new URL(requestUrl)
      host = u.hostname.toLowerCase()
      reqPath = u.pathname || '/'
      isHttps = u.protocol === 'https:'
    } catch {
      return []
    }
    const now = Date.now()
    return allEntries.filter((e) => {
      if (e.expires !== undefined && e.expires < now) return false
      if (e.secure && !isHttps) return false
      if (host !== e.domain && !host.endsWith(`.${e.domain}`)) return false
      if (e.path === '/') return true
      if (reqPath === e.path) return true
      const prefix = e.path.endsWith('/') ? e.path : `${e.path}/`
      return reqPath.startsWith(prefix)
    })
  }, [allEntries, sendCookiesAutomatically, requestUrl, domain])

  if (!domain) return null

  return (
    <div className="border-t border-border-1 mt-1">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-4 flex-1">
          Session Jar · {domain}
        </span>
        {!sendCookiesAutomatically && (
          <span className="text-[9px] text-warning">disabled in Settings</span>
        )}
        {jarEntries.length > 0 && (
          <button
            onClick={() => clearDomain(domain)}
            className="text-[10px] text-error hover:opacity-75 transition-opacity"
            title="Clear all cookies for this domain"
          >
            Clear
          </button>
        )}
      </div>
      {jarEntries.length === 0 ? (
        <p className="px-3 pb-2 text-[10px] text-text-4">
          {sendCookiesAutomatically ? 'No cookies captured yet for this domain' : 'Cookie jar is off'}
        </p>
      ) : (
        <div className="px-2 pb-2 flex flex-col gap-0.5">
          {jarEntries.map((e) => (
            <div
              key={`${e.domain}-${e.path}-${e.name}`}
              className="group flex items-center gap-2 h-6 px-2 rounded hover:bg-surface-2"
            >
              <span className="font-mono text-[10px] text-text-3 shrink-0">{e.name}</span>
              <span className="text-[10px] text-text-4">=</span>
              <span className="font-mono text-[10px] text-text-2 min-w-0 flex-1 truncate">{e.value}</span>
              {e.secure && <span className="text-[9px] text-success shrink-0">S</span>}
              <button
                onClick={() => deleteCookie(e.domain, e.name)}
                className="shrink-0 text-text-4 opacity-0 group-hover:opacity-100 hover:text-error transition-all"
                title="Remove from jar"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Composer({ tabId, request, onChange, onSend, onSave, onLoadTest, loading }: ComposerProps) {
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const resolvedVars = getResolvedVars()
  const hasActiveEnv = activeEnvId !== null

  const updateViewState = useTabsStore((s) => s.updateViewState)
  const [activeTab, setActiveTab] = useState<ComposerSection>(
    () => useTabsStore.getState().getViewState(tabId).composerSection,
  )
  const [showCurlImport, setShowCurlImport] = useState(false)
  const [renameBodyPrompt, setRenameBodyPrompt] = useState<{ show: boolean; index: number } | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  const isDirty = useTabsStore((s) => s.tabs.find((t) => t.id === tabId)?.dirty ?? false)

  const scripts = request.scripts ?? { pre: '', post: '', tests: '' }

  const bodies = request.bodies ?? []
  const bodyCount = bodies.filter((b) => b.type !== 'none').length

  const cookieJarEntries = useCookieJarStore((s) => s.entries)
  const sendCookiesAutomatically = useSettingsStore((s) => s.settings.requests.sendCookiesAutomatically)
  const jarCount = useMemo(() => {
    if (!sendCookiesAutomatically || !cookieJarEntries.length) return 0
    try {
      const url = new URL(request.url)
      const host = url.hostname.toLowerCase()
      const path = url.pathname || '/'
      const https = url.protocol === 'https:'
      const now = Date.now()
      return cookieJarEntries.filter((entry) => {
        if (entry.expires !== undefined && entry.expires < now) return false
        if (entry.secure && !https) return false
        if (host !== entry.domain && !host.endsWith(`.${entry.domain}`)) return false
        if (entry.path === '/' || path === entry.path) return true
        const prefix = entry.path.endsWith('/') ? entry.path : `${entry.path}/`
        return path.startsWith(prefix)
      }).length
    } catch {
      return 0
    }
  }, [cookieJarEntries, request.url, sendCookiesAutomatically])

  const tabs = [
    { id: 'body' as ComposerSection, label: 'Body', count: bodyCount },
    { id: 'auth' as ComposerSection, label: 'Auth', count: request.auth?.type !== 'none' ? 1 : 0 },
    { id: 'headers' as ComposerSection, label: 'Headers', count: (request.headers ?? []).filter((h) => h.enabled && h.key).length },
    { id: 'cookies' as ComposerSection, label: 'Cookies', count: (request.cookies ?? []).filter((c) => c.enabled && c.key).length + jarCount },
    { id: 'params' as ComposerSection, label: 'Params', count: (request.params ?? []).filter((p) => p.enabled && p.key).length },
    { id: 'scripts' as ComposerSection, label: 'Scripts', count: (scripts.pre || scripts.post || scripts.tests) ? 1 : 0 },
    { id: 'tests' as ComposerSection, label: 'Tests', count: (request.assertions ?? []).length },
    { id: 'notes' as ComposerSection, label: 'Notes', count: request.description?.trim() ? 1 : 0 },
  ]

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

  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop =
        useTabsStore.getState().getViewState(tabId).composerContentScrollTop[activeTab] ?? 0
    }
  }, [tabId, activeTab])

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
            title={isDirty ? 'Unsaved changes — Save to collection (Ctrl+S)' : 'Save to collection (Ctrl+S)'}
            className={cn(
              'h-8 w-8 flex items-center justify-center rounded transition-all',
              savedFlash
                ? 'text-success bg-success/10'
                : isDirty
                  ? 'text-warning bg-warning/15 hover:bg-warning/25 border border-warning/30'
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

          <CopyAsDropdown request={request} vars={resolvedVars} />

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
              onClick={() => {
                setActiveTab(t.id)
                updateViewState(tabId, { composerSection: t.id })
              }}
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
        <div
          ref={contentScrollRef}
          onScroll={(e) => {
            const viewState = useTabsStore.getState().getViewState(tabId)
            updateViewState(tabId, {
              composerContentScrollTop: {
                ...viewState.composerContentScrollTop,
                [activeTab]: e.currentTarget.scrollTop,
              },
            })
          }}
          className="overflow-y-auto"
        >
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
          {activeTab === 'cookies' && (
            <>
              <KVEditor
                rows={request.cookies ?? []}
                onChange={(cookies) => onChange({ ...request, cookies })}
                keyPlaceholder="Cookie name"
                valuePlaceholder="Cookie value"
              />
              <CookieJarSection requestUrl={request.url} />
            </>
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
          {activeTab === 'notes' && (
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2 text-[11px] font-medium text-text-3">
                <FileText size={12} className="text-accent" />
                Request documentation
              </div>
              <textarea
                value={request.description ?? ''}
                onChange={(event) => onChange({ ...request, description: event.target.value })}
                placeholder="Document constraints, token lifetime, batch windows, examples, or handoff notes for this request..."
                className="min-h-24 w-full resize-y rounded border border-border-2 bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
              <p className="text-[10px] text-text-4">Stored locally with this request and preserved in workspace or Postman collection exports.</p>
            </div>
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
