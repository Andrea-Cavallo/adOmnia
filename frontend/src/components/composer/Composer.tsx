import { useState, useRef, useEffect, useMemo } from 'react'
import { Send, Save, FileCode, Gauge, X, Plus, Check, CornerDownRight, Clock, Code, Copy, CheckCheck, FileText, Circle, ListChecks, ShieldCheck, MoreVertical } from 'lucide-react'
import type { RequestItem, HttpMethod, KVRow, RequestBody } from '@/lib/types'
import { uid, blankBody, blankAuth } from '@/lib/types'
import { cn } from '@/lib/utils'
import { detectPathParamKeys } from '@/lib/pathParams'
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
import { ContextMenu } from '@/components/ui/ContextMenu'

interface ComposerProps {
  tabId: string
  request: RequestItem
  onChange: (request: RequestItem) => void
  onSend: () => void
  onSave: () => void
  onLoadTest?: () => void
  loading?: boolean
  hideRequestBar?: boolean
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

function enabledRows(rows: KVRow[] | undefined): KVRow[] {
  return (rows ?? []).filter((row) => row.enabled && row.key.trim())
}

function requestVariables(request: RequestItem): string[] {
  const values = [
    request.url,
    request.description ?? '',
    ...(request.headers ?? []).flatMap((row) => [row.key, row.value]),
    ...(request.params ?? []).flatMap((row) => [row.key, row.value]),
    ...(request.cookies ?? []).flatMap((row) => [row.key, row.value]),
    ...(request.bodies ?? []).flatMap((body) => [body.raw, body.graphqlVariables ?? '', ...(body.form ?? []).flatMap((row) => [row.key, row.value])]),
  ]
  const names = new Set<string>()
  for (const value of values) {
    for (const match of String(value ?? '').matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
      names.add(match[1])
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function hostFromUrl(url: string): string {
  try { return new URL(url).host } catch { return 'No host yet' }
}

function queryRowsFromUrl(url: string): KVRow[] {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return []
  const hashStart = url.indexOf('#', queryStart)
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart)
  if (!query) return []
  const params = new URLSearchParams(query)
  const rows: KVRow[] = []
  params.forEach((value, key) => {
    rows.push({ id: uid(), key, value, enabled: true })
  })
  return rows
}

function rowsWithTrailingBlank(rows: KVRow[]): KVRow[] {
  return rows.length ? [...rows, { id: uid(), key: '', value: '', enabled: true }] : rows
}

// Rewrite the URL's query string from the params table, preserving the base path
// and hash. Values are kept raw so `{{variables}}` survive round-trips.
function urlWithQuery(url: string, params: KVRow[]): string {
  const hashStart = url.indexOf('#')
  const hash = hashStart === -1 ? '' : url.slice(hashStart)
  const beforeHash = hashStart === -1 ? url : url.slice(0, hashStart)
  const queryStart = beforeHash.indexOf('?')
  const base = queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart)
  const query = params
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => `${row.key}=${row.value}`)
    .join('&')
  return query ? `${base}?${query}${hash}` : `${base}${hash}`
}

function PathParamRow({
  paramKey,
  value,
  enabled,
  resolvedVars,
  hasActiveEnv,
  onChange,
}: {
  paramKey: string
  value: string
  enabled: boolean
  resolvedVars: Record<string, string>
  hasActiveEnv: boolean
  onChange: (patch: { value?: string; enabled?: boolean }) => void
}) {
  return (
    <div className={cn('grid grid-cols-[28px_minmax(120px,200px)_1fr] items-center gap-1 px-2 py-1', !enabled && 'opacity-40')}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        className="w-3.5 h-3.5 accent-accent rounded"
      />
      <span className="truncate px-2 font-mono text-xs text-accent" title={paramKey}>{paramKey}</span>
      <div className="h-7 bg-surface-2 border border-border-2 rounded focus-within:border-accent overflow-hidden">
        <VarHighlightInput
          value={value}
          onChange={(next) => onChange({ value: next })}
          resolvedVars={resolvedVars}
          hasActiveEnv={hasActiveEnv}
          placeholder="Path value"
          className="h-full"
        />
      </div>
    </div>
  )
}

function ParamsSection({
  request,
  onChange,
}: {
  request: RequestItem
  onChange: (request: RequestItem) => void
}) {
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const resolvedVars = getResolvedVars()
  const hasActiveEnv = activeEnvId !== null

  const pathKeys = detectPathParamKeys(request.url)
  const storedPathParams = request.pathParams ?? []

  // The query table always reflects the URL: if nothing is stored yet (e.g. a
  // request loaded with a query already in its URL), derive the rows from the
  // URL so they show up immediately instead of an empty table.
  const storedParams = request.params ?? []
  const storedHasQuery = storedParams.some((row) => row.key.trim())
  const urlQueryRows = queryRowsFromUrl(request.url)
  const queryRows = storedHasQuery || urlQueryRows.length === 0
    ? storedParams
    : rowsWithTrailingBlank(urlQueryRows)
  const queryCount = queryRows.filter((row) => row.enabled && row.key.trim()).length

  // Editing the query table rewrites the URL so the two stay in sync live.
  const handleParamsChange = (params: KVRow[]) => {
    onChange({ ...request, params, url: urlWithQuery(request.url, params) })
  }

  const setPathParam = (key: string, patch: { value?: string; enabled?: boolean }) => {
    const existing = storedPathParams.find((p) => p.key === key)
    const next = existing
      ? storedPathParams.map((p) => (p.key === key ? { ...p, ...patch } : p))
      : [...storedPathParams, { id: uid(), key, value: '', enabled: true, ...patch }]
    onChange({ ...request, pathParams: next })
  }

  return (
    <div className="flex flex-col gap-3 pb-3">
      <section>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div>
            <h3 className="text-xs font-semibold text-text-1">Query Params</h3>
            <p className="text-[10px] text-text-4">Edit here or in the URL — they stay in sync.</p>
          </div>
          <span className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-4">
            {queryCount}
          </span>
        </div>
        <KVEditor
          rows={queryRows}
          onChange={handleParamsChange}
          keyPlaceholder="Query key"
          valuePlaceholder="Query value"
        />
      </section>

      <section className="mx-3 rounded-md border border-border-1 bg-surface-1">
        <div className="flex items-center justify-between gap-2 border-b border-border-1 px-3 py-2">
          <div>
            <h3 className="text-xs font-semibold text-text-1">Path Params</h3>
            <p className="text-[10px] text-text-4">Detected from :id and {'{id}'} segments in the path.</p>
          </div>
          <span className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-4">
            {pathKeys.length}
          </span>
        </div>
        {pathKeys.length ? (
          <div className="flex flex-col gap-0.5 py-1">
            <div className="grid grid-cols-[28px_minmax(120px,200px)_1fr] gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">
              <span />
              <span>Path key</span>
              <span>Path value</span>
            </div>
            {pathKeys.map((key) => {
              const stored = storedPathParams.find((p) => p.key === key)
              return (
                <PathParamRow
                  key={key}
                  paramKey={key}
                  value={stored?.value ?? ''}
                  enabled={stored?.enabled ?? true}
                  resolvedVars={resolvedVars}
                  hasActiveEnv={hasActiveEnv}
                  onChange={(patch) => setPathParam(key, patch)}
                />
              )
            })}
          </div>
        ) : (
          <p className="px-3 py-3 text-[11px] text-text-4">
            No path params detected in the current URL.
          </p>
        )}
      </section>
    </div>
  )
}

function RequestOverview({
  request,
  vars,
  hasActiveEnv,
  onChange,
  onOpenSection,
}: {
  request: RequestItem
  vars: Record<string, string>
  hasActiveEnv: boolean
  onChange: (request: RequestItem) => void
  onOpenSection: (section: ComposerSection) => void
}) {
  const variables = requestVariables(request)
  const unresolved = variables.filter((name) => vars[name] === undefined)
  const headers = enabledRows(request.headers)
  const params = enabledRows(request.params)
  const cookies = enabledRows(request.cookies)
  const activeBody = request.bodies?.[request.activeBodyIdx ?? 0]
  const hasBody = Boolean(activeBody && activeBody.type !== 'none')
  const docsFilled = Boolean(request.description?.trim())
  const authLabel = request.auth?.type && request.auth.type !== 'none' ? request.auth.type.toUpperCase() : 'No auth'
  const setupItems = [
    { label: 'URL is ready', ok: Boolean(request.url.trim()), section: null },
    { label: variables.length ? `${variables.length} variable${variables.length === 1 ? '' : 's'} detected` : 'No variables needed', ok: unresolved.length === 0, section: 'params' as ComposerSection | null },
    { label: request.auth?.type && request.auth.type !== 'none' ? `${authLabel} configured` : 'Auth intentionally empty', ok: true, section: 'auth' as ComposerSection | null },
    { label: docsFilled ? 'Documentation present' : 'Add request notes', ok: docsFilled, section: 'notes' as ComposerSection | null },
  ]

  return (
    <div className="flex flex-col gap-3 p-[var(--ui-panel-pad)]">
      <section className="border-b border-border-1 pb-3">
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-4">
          <span className={cn('font-bold', METHOD_COLORS[request.method] ?? 'text-text-2')}>{request.method}</span>
          <span>{hostFromUrl(request.url)}</span>
        </div>
        <input
          value={request.name}
          onChange={(event) => onChange({ ...request, name: event.target.value })}
          placeholder="Request title"
          className="w-full bg-transparent text-[22px] font-semibold leading-tight text-text-1 outline-none placeholder:text-text-4"
        />
        <textarea
          value={request.description ?? ''}
          onChange={(event) => onChange({ ...request, description: event.target.value })}
          placeholder="Add a clear description: what this request does, when to use it, required setup, examples or edge cases..."
          className="mt-2 min-h-16 w-full resize-y rounded-md border border-border-2 bg-surface-1 px-3 py-2 text-[12px] leading-relaxed text-text-2 outline-none placeholder:text-text-4 focus:border-accent"
        />
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-md border border-border-1 bg-surface-1">
          <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
            <ListChecks size={13} className="text-accent" />
            <h3 className="text-[12px] font-semibold text-text-1">Setup</h3>
          </div>
          <div className="divide-y divide-border-1">
            {setupItems.map((item) => (
              <button
                key={item.label}
                onClick={() => item.section && onOpenSection(item.section)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-2 transition-colors hover:bg-surface-2"
              >
                {item.ok ? <Check size={13} className="text-success" /> : <Circle size={13} className="text-warning" />}
                <span className="flex-1">{item.label}</span>
                {item.section && <span className="font-mono text-[10px] text-text-4">open</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border-1 bg-surface-1">
          <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
            <ShieldCheck size={13} className="text-accent" />
            <h3 className="text-[12px] font-semibold text-text-1">Request context</h3>
          </div>
          <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 px-3 py-3 font-mono text-[10px]">
            <dt className="text-text-4">Auth</dt><dd className="truncate text-text-2">{authLabel}</dd>
            <dt className="text-text-4">Headers</dt><dd className="text-text-2">{headers.length}</dd>
            <dt className="text-text-4">Params</dt><dd className="text-text-2">{params.length}</dd>
            <dt className="text-text-4">Cookies</dt><dd className="text-text-2">{cookies.length}</dd>
            <dt className="text-text-4">Body</dt><dd className="text-text-2">{hasBody ? activeBody?.type : 'none'}</dd>
            <dt className="text-text-4">Tests</dt><dd className="text-text-2">{request.assertions?.length ?? 0}</dd>
          </dl>
        </div>
      </section>

      {variables.length > 0 && (
        <section className="rounded-md border border-border-1 bg-surface-1">
          <div className="flex items-center justify-between gap-2 border-b border-border-1 px-3 py-2">
            <h3 className="text-xs font-semibold text-text-1">Variables</h3>
            <span className="font-mono text-[10px] text-text-4">{hasActiveEnv ? `${unresolved.length} unresolved` : 'No environment selected'}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2">
            {variables.map((name) => {
              const resolved = vars[name]
              return (
                <div key={name} className="flex min-w-0 items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 py-1.5 font-mono text-[10px]">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', resolved === undefined ? 'bg-warning' : 'bg-success')} />
                  <span className="truncate text-accent">{`{{${name}}}`}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-text-4">{resolved === undefined ? 'unresolved' : resolved}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}

function bodyFormatLabel(body: RequestBody): string {
  if (body.type === 'raw' && body.lang === 'json') return 'JSON'
  if (body.type === 'raw') return body.lang.toUpperCase()
  if (body.type === 'urlencoded') return 'URL ENCODED'
  if (body.type === 'formdata') return 'FORM DATA'
  if (body.type === 'graphql') return 'GRAPHQL'
  return 'NO BODY'
}

export function Composer({ tabId, request, onChange, onSend, onSave, onLoadTest, loading, hideRequestBar = false }: ComposerProps) {
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
  const [bodyMenu, setBodyMenu] = useState<{ x: number; y: number; index: number } | null>(null)
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
    { id: 'overview' as ComposerSection, label: 'Overview', count: request.description?.trim() ? 1 : 0, icon: FileText },
    { id: 'body' as ComposerSection, label: 'Body', count: bodyCount, icon: Code },
    { id: 'auth' as ComposerSection, label: 'Auth', count: request.auth?.type !== 'none' ? 1 : 0, icon: ShieldCheck },
    { id: 'headers' as ComposerSection, label: 'Headers', count: (request.headers ?? []).filter((h) => h.enabled && h.key).length, icon: ListChecks },
    { id: 'cookies' as ComposerSection, label: 'Cookies', count: (request.cookies ?? []).filter((c) => c.enabled && c.key).length + jarCount, icon: Circle },
    { id: 'params' as ComposerSection, label: 'Params', count: (request.params ?? []).filter((p) => p.enabled && p.key).length, icon: CornerDownRight },
    { id: 'scripts' as ComposerSection, label: 'Scripts', count: (scripts.pre || scripts.post || scripts.tests) ? 1 : 0, icon: FileCode },
    { id: 'tests' as ComposerSection, label: 'Tests', count: (request.assertions ?? []).length, icon: CheckCheck },
    { id: 'notes' as ComposerSection, label: 'Notes', count: request.description?.trim() ? 1 : 0, icon: FileText },
  ]

  const bodyIndex = bodies.length
    ? Math.min(Math.max(request.activeBodyIdx, 0), bodies.length - 1)
    : 0
  const activeBody = bodies[bodyIndex]

  const cloneBody = (source: RequestBody, name: string): RequestBody => ({
    ...source,
    id: uid(),
    name,
    raw: source.lang === 'json' && source.raw.trim()
      ? (() => { try { return JSON.stringify(JSON.parse(source.raw), null, 2) } catch { return source.raw } })()
      : source.raw,
    form: (source.form ?? []).map((row) => ({ ...row, id: uid() })),
  })

  const addBody = () => {
    const source = activeBody ?? blankBody()
    onChange({
      ...request,
      bodies: [...bodies, cloneBody(source, `Body ${bodies.length + 1}`)],
      activeBodyIdx: bodies.length,
    })
  }

  const duplicateBody = (index: number) => {
    const source = bodies[index]
    if (!source) return
    const next = [...bodies]
    next.splice(index + 1, 0, cloneBody(source, `${source.name} copy`))
    onChange({ ...request, bodies: next, activeBodyIdx: index + 1 })
  }

  const deleteBody = (index: number) => {
    if (bodies.length <= 1) return
    const next = bodies.filter((_, bodyIndexToDelete) => bodyIndexToDelete !== index)
    const nextIndex = bodyIndex > index ? bodyIndex - 1 : Math.min(bodyIndex, next.length - 1)
    onChange({ ...request, bodies: next, activeBodyIdx: Math.max(0, nextIndex) })
  }

  const handleCurlImport = (curlStr: string) => {
    const parsed = parseCurl(curlStr)
    if (parsed) onChange(applyParsedCurl(parsed, request))
  }

  const handleUrlChange = (url: string) => {
    // Keep the query-param table in sync with whatever is typed into the URL.
    onChange({ ...request, url, params: rowsWithTrailingBlank(queryRowsFromUrl(url)) })
  }

  const openSection = (section: ComposerSection) => {
    setActiveTab(section)
    updateViewState(tabId, { composerSection: section })
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
      <div className="flex-1 min-h-0 flex flex-col border-b border-border-1">
        {!hideRequestBar && (
          <>
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
              onChange={handleUrlChange}
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
          </>
        )}

        {/* Section tabs */}
        <div role="tablist" aria-label="Request sections" className="flex min-h-12 items-end gap-1 overflow-x-auto border-y-2 border-border-2 bg-surface-1 px-3 pt-2 no-scrollbar">
          {tabs.map((t) => {
            const TabIcon = t.icon
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(t.id)
                  updateViewState(tabId, { composerSection: t.id })
                }}
                className={cn(
                  'relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[11.5px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  active
                    ? 'border-border-2 bg-surface-3 text-text-1 shadow-[inset_0_-3px_0_var(--color-accent)]'
                    : 'border-transparent text-text-2 hover:border-border-2 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                <TabIcon size={12} className={active ? 'text-accent' : 'text-text-3'} />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold',
                    active ? 'bg-accent/25 text-accent-light' : 'bg-surface-3 text-text-2',
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
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
          className="flex-1 min-h-0 overflow-y-auto flex flex-col"
        >
          {activeTab === 'overview' && (
            <RequestOverview
              request={request}
              vars={resolvedVars}
              hasActiveEnv={hasActiveEnv}
              onChange={onChange}
              onOpenSection={openSection}
            />
          )}
          {activeTab === 'params' && (
            <ParamsSection request={request} onChange={onChange} />
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
              <section className="border-b-2 border-border-2 bg-surface-1/70 px-3 py-3">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[11.5px] font-semibold text-text-1">Request body variants</h3>
                    <p className="mt-0.5 text-[10px] text-text-3">Examples and payload alternatives for this request</p>
                  </div>
                  <button
                    onClick={addBody}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[11px] font-medium text-text-1 outline-none transition-colors hover:border-accent/60 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
                    title="Add body example"
                  >
                    <Plus size={12} className="text-accent" /> New body
                  </button>
                </div>
                <div role="tablist" aria-label="Request body variants" className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {bodies.map((body, index) => {
                    const active = index === bodyIndex
                    return (
                      <div
                        key={body.id}
                        className={cn(
                          'group relative h-[68px] w-[168px] shrink-0 overflow-hidden rounded-md border bg-surface-2 transition-all',
                          active
                            ? 'border-accent/80 bg-surface-3 shadow-[0_0_0_1px_rgba(34,211,238,.12)]'
                            : 'border-border-2 hover:border-accent/40 hover:bg-surface-3',
                        )}
                      >
                        {active && <span className="absolute inset-x-0 top-0 z-10 h-[3px] bg-accent" />}
                        <button
                          role="tab"
                          aria-selected={active}
                          onClick={() => onChange({ ...request, activeBodyIdx: index })}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setBodyMenu({ x: event.clientX, y: event.clientY, index })
                          }}
                          className="flex h-full w-full flex-col items-start justify-center px-3 pr-11 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          title={body.name}
                        >
                          <span
                            className={cn('max-w-full overflow-hidden text-[11px] font-semibold leading-[14px]', active ? 'text-text-1' : 'text-text-2')}
                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                          >
                            {body.name}
                          </span>
                          <span className={cn('mt-1 font-mono text-[8.5px] font-semibold tracking-wide', active ? 'text-accent' : 'text-text-4')}>{bodyFormatLabel(body)}</span>
                        </button>
                        <div className={cn('absolute right-1.5 top-1.5 flex items-center gap-0.5 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}>
                          {bodies.length > 1 && (
                            <button aria-label={`Delete ${body.name}`} onClick={() => deleteBody(index)} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-error/10 hover:text-error focus-visible:ring-2 focus-visible:ring-accent" title={`Delete ${body.name}`}><X size={11} /></button>
                          )}
                          <button
                            aria-label={`More options for ${body.name}`}
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect()
                              setBodyMenu({ x: rect.right, y: rect.bottom, index })
                            }}
                            className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-1 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
                            title={`More options for ${body.name}`}
                          >
                            <MoreVertical size={12} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
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
              <p className="text-[10px] text-text-4">Stored locally with this request and included in workspace exports.</p>
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

      {bodyMenu && (
        <ContextMenu
          x={bodyMenu.x}
          y={bodyMenu.y}
          items={[
            { id: 'rename', label: 'Rename body variant' },
            { id: 'duplicate', label: 'Duplicate body variant' },
            { id: 'delete', label: 'Delete body variant', danger: true, disabled: bodies.length <= 1, separatorBefore: true },
          ]}
          onSelect={(action) => {
            const index = bodyMenu.index
            setBodyMenu(null)
            if (action === 'rename') setRenameBodyPrompt({ show: true, index })
            if (action === 'duplicate') duplicateBody(index)
            if (action === 'delete') deleteBody(index)
          }}
          onClose={() => setBodyMenu(null)}
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
