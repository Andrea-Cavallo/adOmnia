import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, ArrowRightLeft, Boxes, ChevronDown, ClipboardPaste, Download, Link2,
  Loader2, MoreVertical, RotateCcw, Save, ShieldCheck, Sparkles, WandSparkles, X,
} from 'lucide-react'
import { useCollectionsStore } from '@/stores/collections'
import { collectionToOAS, collectionsToOAS } from '@/lib/oasExport'
import { executeRequest } from '@/lib/executeRequest'
import { blankRequest, type Collection, type RequestItem, type TreeNode } from '@/lib/types'
import type { ApiDocModel, ApiDocOperation } from '@/lib/apidocs/parseSpec'
import { generateApiDocsWithAI, improveApiDocsWithAI } from '@/lib/apidocs/aiDocs'
import {
  STARTER_SPEC, convertSpec, detectLanguage, formatSpec, parseSpecForEditor,
  type SpecLanguage, type SpecParseError,
} from '@/lib/apidocs/editorSupport'
import { ApiDocsViewer } from './ApiDocsViewer'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { useSettingsStore } from '@/stores/settings'
import { OASGovernancePanel } from './OASGovernancePanel'
import type { OASLintFinding } from '@/lib/oaslint-api'
import { openApiToCollection } from '@/lib/openapiImport'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'

const DRAFT_KEY = 'adomnia.apidocs.draft'

interface Draft {
  raw: string
  language: SpecLanguage
}

function loadDraft(): Draft {
  try {
    const stored = localStorage.getItem(DRAFT_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Draft>
      if (typeof parsed.raw === 'string') {
        return { raw: parsed.raw, language: parsed.language === 'json' ? 'json' : 'yaml' }
      }
    }
  } catch { /* fall through to starter */ }
  return { raw: STARTER_SPEC, language: 'yaml' }
}

function docName(model: ApiDocModel | null, language: SpecLanguage): string {
  const base = (model?.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
  return `${base}.${language === 'json' ? 'json' : 'yaml'}`
}

export function ApiDocsPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const updateCollection = useCollectionsStore((s) => s.updateCollection)
  const importCollection = useCollectionsStore((s) => s.importCollection)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const openTab = useTabsStore((s) => s.openTab)
  const aiEnabled = useSettingsStore((s) => s.settings.ai.enabled)

  const initial = useRef(loadDraft())
  const [rawSpec, setRawSpec] = useState(initial.current.raw)
  const [language, setLanguage] = useState<SpecLanguage>(initial.current.language)
  const [model, setModel] = useState<ApiDocModel | null>(null)
  const [error, setError] = useState<SpecParseError | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  const [view, setView] = useState<'workspace' | 'governance'>('workspace')
  const [menu, setMenu] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState('__all__')
  const [saveCollectionId, setSaveCollectionId] = useState('')
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Debounced live parse: keep the last valid model on the right when the
  // current text is broken; only the status bar + inline marker reflect the error.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = parseSpecForEditor(rawSpec, language)
      if (result.model) setModel(result.model)
      setError(result.error ?? null)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [rawSpec, language])

  // Persist the working draft locally (local-first, survives reopening the panel).
  useEffect(() => {
    safeSetItem(DRAFT_KEY, JSON.stringify({ raw: rawSpec, language }))
  }, [rawSpec, language])

  const applyContent = (raw: string, nextLanguage?: SpecLanguage) => {
    setRawSpec(raw)
    if (nextLanguage) setLanguage(nextLanguage)
    setDirty(false)
    setError(null)
    setMenu(null)
  }

  const notify = (kind: 'ok' | 'err', text: string) => {
    setStatus({ kind, text })
    if (kind === 'ok') window.setTimeout(() => setStatus((s) => (s?.text === text ? null : s)), 4000)
  }

  const onEdit = (next: string) => {
    setRawSpec(next)
    setDirty(true)
  }

  const collectionsForSource = (): Collection[] =>
    collectionId === '__all__' ? collections : collections.filter((c) => c.id === collectionId)

  const generateFromCollections = () => {
    const source = collectionsForSource()
    if (source.length === 0) return notify('err', 'No collection selected.')
    try {
      applyContent(collectionsToOAS(source, language === 'json' ? 'json' : 'yaml'))
      if (source.length === 1) setSaveCollectionId(source[0].id)
      notify('ok', `Generated an OpenAPI document from ${source.length === 1 ? source[0].name : 'all collections'}.`)
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not generate spec from collection')
    }
  }

  const generateFromCollectionsWithAI = async () => {
    const source = collectionsForSource()
    if (source.length === 0) return notify('err', 'No collection selected.')
    if (!aiEnabled) return notify('err', 'AI features are disabled. Enable them in Settings > AI Engine.')
    setAiLoading(true)
    setMenu(null)
    try {
      const generated = await generateApiDocsWithAI(source)
      applyContent(generated, detectLanguage(generated))
      if (source.length === 1) setSaveCollectionId(source[0].id)
      notify('ok', 'AI generated an OpenAPI document. Review it, then save it to a collection.')
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not generate docs with AI')
    } finally {
      setAiLoading(false)
    }
  }

  const improveWithAI = async () => {
    if (!rawSpec.trim()) return
    if (!aiEnabled) return notify('err', 'AI features are disabled. Enable them in Settings > AI Engine.')
    setAiLoading(true)
    setMenu(null)
    try {
      const improved = await improveApiDocsWithAI(rawSpec)
      applyContent(improved, detectLanguage(improved))
      notify('ok', 'AI improved this API document.')
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not improve docs with AI')
    } finally {
      setAiLoading(false)
    }
  }

  const loadCollectionIntoEditor = () => {
    const target = collections.find((c) => c.id === collectionId)
    if (!target) return notify('err', 'Choose a specific collection to import.')
    try {
      applyContent(collectionToOAS(target, language === 'json' ? 'json' : 'yaml'))
      setSaveCollectionId(target.id)
      notify('ok', `Loaded "${target.name}" into the editor.`)
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not convert collection to OpenAPI')
    }
  }

  const loadFromUrl = async () => {
    if (!url.trim()) return
    setUrlLoading(true)
    try {
      const req = { ...blankRequest('GET', 'OpenAPI spec'), url: url.trim() }
      const { response } = await executeRequest(req, {})
      if (response.error) return notify('err', `Request failed: ${response.error.message}`)
      if (!response.body) return notify('err', `Empty response (status ${response.status}).`)
      applyContent(response.body, detectLanguage(response.body))
      notify('ok', 'Fetched the document into the editor.')
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not fetch the spec')
    } finally {
      setUrlLoading(false)
    }
  }

  const renderPasted = () => {
    if (!pasteText.trim()) return
    applyContent(pasteText, detectLanguage(pasteText))
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    setPasteText(text)
    applyContent(text, detectLanguage(text))
  }

  const format = () => {
    try {
      const next = formatSpec(rawSpec, language)
      setRawSpec(next)
      setDirty(true)
      notify('ok', 'Formatted document.')
    } catch (e: unknown) {
      notify('err', `Cannot format: ${e instanceof Error ? e.message : 'invalid document'}`)
    }
  }

  const toggleLanguage = () => {
    const next: SpecLanguage = language === 'yaml' ? 'json' : 'yaml'
    try {
      const converted = convertSpec(rawSpec, language, next)
      setRawSpec(converted)
      setLanguage(next)
      setDirty(true)
    } catch (e: unknown) {
      notify('err', `Cannot convert to ${next.toUpperCase()}: ${e instanceof Error ? e.message : 'invalid document'}`)
    }
  }

  const validate = () => {
    const result = parseSpecForEditor(rawSpec, language)
    if (result.error) notify('err', `${result.error.line ? `Line ${result.error.line}: ` : ''}${result.error.message}`)
    else notify('ok', `Valid OpenAPI document · ${result.model?.operationCount ?? 0} operations.`)
  }

  const exportFile = () => {
    setMenu(null)
    const blob = new Blob([rawSpec], { type: language === 'json' ? 'application/json' : 'text/yaml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = docName(model, language)
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const copyToClipboard = async () => {
    setMenu(null)
    await navigator.clipboard.writeText(rawSpec)
    notify('ok', 'Copied document to clipboard.')
  }

  const saveToCollection = () => {
    if (!rawSpec.trim()) return notify('err', 'Nothing to save.')
    const target = collections.find((c) => c.id === saveCollectionId)
    if (!target) return notify('err', 'Choose a collection to save into.')
    updateCollection(target.id, { _openapiSpec: rawSpec })
    setDirty(false)
    setMenu(null)
    notify('ok', `Saved API documentation to ${target.name}.`)
  }

  const importAsCollection = () => {
    if (!rawSpec.trim()) return notify('err', 'Nothing to import.')
    try {
      const collection = openApiToCollection(rawSpec)
      importCollection(collection)
      setSaveCollectionId(collection.id)
      setMenu(null)
      notify('ok', `Created API Core collection "${collection.name}".`)
      setActiveRail('collections')
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not convert to a collection')
    }
  }

  const resetToStarter = () => {
    applyContent(STARTER_SPEC, 'yaml')
    setSaveCollectionId('')
    notify('ok', 'Reset to a starter document.')
  }

  const findOperationRequest = (collection: Collection, operation: ApiDocOperation): RequestItem | null => {
    const walk = (nodes: TreeNode[]): RequestItem | null => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const found = walk(node.children)
          if (found) return found
        } else if (
          node.method.toUpperCase() === operation.method.toUpperCase() &&
          (node._openapiPath === operation.path || node.url.endsWith(operation.path) || node.url === operation.path)
        ) {
          return node
        }
      }
      return null
    }
    return walk(collection.children)
  }

  const tryOperation = (operation: ApiDocOperation) => {
    if (!rawSpec.trim()) return
    try {
      let target = saveCollectionId
        ? useCollectionsStore.getState().collections.find((c) => c.id === saveCollectionId) ?? null
        : null
      if (!target) {
        target = openApiToCollection(rawSpec)
        importCollection(target)
        setSaveCollectionId(target.id)
      } else if (!target._openapiSpec) {
        updateCollection(target.id, { _openapiSpec: rawSpec })
        target = { ...target, _openapiSpec: rawSpec }
      }
      let request = findOperationRequest(target, operation)
      if (!request) {
        target = openApiToCollection(rawSpec)
        importCollection(target)
        setSaveCollectionId(target.id)
        request = findOperationRequest(target, operation)
      }
      if (!request) return notify('err', `Could not find ${operation.method} ${operation.path} in the API Core collection.`)
      openTab(request, target.id)
      setActiveRail('collections')
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : 'Could not open operation in API Core')
    }
  }

  const openFinding = (finding: OASLintFinding) => {
    if (!finding.path || !finding.method) return
    const targetKey = `${finding.method.toUpperCase()} ${finding.path}`
    setView('workspace')
    window.setTimeout(() => {
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-oas-operation]'))
        .find((candidate) => candidate.dataset.oasOperation === targetKey)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.querySelector<HTMLButtonElement>('button')?.focus()
    }, 0)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-0">
      {/* Toolbar */}
      <div className="relative flex flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-3 py-1.5">
        <div className="mr-1 flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-3">{docName(model, language)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${dirty ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
            {dirty ? 'Modified' : 'Saved'}
          </span>
          <div className="h-5 w-px bg-border-2" />
        </div>
        <Menu id="import" menu={menu} setMenu={setMenu} icon={<Boxes size={13} />} label="Import collection">
          <div className="w-64 space-y-2 p-3">
            <label className="text-[11px] font-semibold text-text-3">Collection</label>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent">
              <option value="__all__">All collections ({collections.length})</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={loadCollectionIntoEditor} className="h-8 w-full rounded bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover">Load into editor</button>
          </div>
        </Menu>

        <Menu id="url" menu={menu} setMenu={setMenu} icon={<Link2 size={13} />} label="From URL">
          <div className="w-72 space-y-2 p-3">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadFromUrl() }}
              placeholder="https://api.example.com/openapi.json"
              className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent"
            />
            <button onClick={() => void loadFromUrl()} disabled={urlLoading} className="flex h-8 w-full items-center justify-center gap-2 rounded bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
              {urlLoading && <Loader2 size={13} className="animate-spin" />} Fetch into editor
            </button>
            <p className="text-[10px] text-text-4">Fetched through adOmnia's engine — no browser CORS limits.</p>
          </div>
        </Menu>

        <Menu id="paste" menu={menu} setMenu={setMenu} icon={<ClipboardPaste size={13} />} label="Paste / File">
          <div className="w-80 space-y-2 p-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste an OpenAPI/Swagger JSON or YAML document…"
              className="h-32 w-full resize-none rounded border border-border-2 bg-surface-2 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button onClick={renderPasted} disabled={!pasteText.trim()} className="h-8 flex-1 rounded bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">Load</button>
              <button onClick={() => fileRef.current?.click()} className="h-8 rounded border border-border-2 px-3 text-[12px] text-text-2 hover:text-text-1">Open file…</button>
              <input ref={fileRef} type="file" accept=".json,.yaml,.yml,application/json,text/yaml" className="hidden" onChange={handleFile} />
            </div>
          </div>
        </Menu>

        <Menu id="generate" menu={menu} setMenu={setMenu} icon={<WandSparkles size={13} />} label="Generate">
          <div className="w-64 space-y-2 p-3">
            <label className="text-[11px] font-semibold text-text-3">From collection</label>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent">
              <option value="__all__">All collections ({collections.length})</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={generateFromCollections} className="h-8 w-full rounded bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover">Generate docs</button>
            <button onClick={() => void generateFromCollectionsWithAI()} disabled={aiLoading} className="flex h-8 w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 text-[12px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-50">
              {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate with AI
            </button>
          </div>
        </Menu>

        <div className="mx-1 h-5 w-px bg-border-2" />

        <ToolbarButton onClick={format}>Format</ToolbarButton>
        <ToolbarButton onClick={validate}>Validate</ToolbarButton>
        <ToolbarButton onClick={toggleLanguage} title={`Convert to ${language === 'yaml' ? 'JSON' : 'YAML'}`}>
          {language === 'yaml' ? 'To JSON' : 'To YAML'}
        </ToolbarButton>

        <Menu id="export" menu={menu} setMenu={setMenu} icon={<Download size={13} />} label="Export">
          <div className="w-48 py-1">
            <MenuItem onClick={exportFile}><Download size={13} /> Download {language === 'json' ? '.json' : '.yaml'}</MenuItem>
            <MenuItem onClick={() => void copyToClipboard()}><ClipboardPaste size={13} /> Copy to clipboard</MenuItem>
          </div>
        </Menu>

        <div className="ml-auto flex items-center gap-1.5">
          <Menu id="more" menu={menu} setMenu={setMenu} icon={<MoreVertical size={14} />} label="" iconOnly align="right">
            <div className="w-60 py-1">
              <div className="border-b border-border-1 px-3 py-1.5">
                <label className="text-[10px] font-semibold uppercase text-text-4">Save target</label>
                <select value={saveCollectionId} onChange={(e) => setSaveCollectionId(e.target.value)} className="mt-1 h-7 w-full rounded border border-border-2 bg-surface-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent">
                  <option value="">Choose collection…</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <MenuItem onClick={saveToCollection}><Save size={13} /> Save to collection</MenuItem>
              <MenuItem onClick={importAsCollection}><ArrowRightLeft size={13} /> Create API Core collection</MenuItem>
              <MenuItem onClick={() => void improveWithAI()}><Sparkles size={13} /> Improve with AI</MenuItem>
              <MenuItem onClick={() => { setView(view === 'governance' ? 'workspace' : 'governance'); setMenu(null) }}>
                <ShieldCheck size={13} /> {view === 'governance' ? 'Back to editor' : 'Governance / lint'}
              </MenuItem>
              <MenuItem onClick={resetToStarter}><RotateCcw size={13} /> Reset to starter</MenuItem>
            </div>
          </Menu>
        </div>
      </div>

      {status && (
        <div className={`flex items-center gap-2 border-b px-3 py-1.5 text-[11px] ${status.kind === 'err' ? 'border-error/20 bg-error/10 text-error' : 'border-success/20 bg-success/10 text-success'}`}>
          {status.kind === 'err' && <AlertCircle size={13} className="shrink-0" />}
          <span className="min-w-0 flex-1">{status.text}</span>
          <button onClick={() => setStatus(null)} className="shrink-0 text-current opacity-60 hover:opacity-100"><X size={12} /></button>
        </div>
      )}

      {view === 'governance' ? (
        <OASGovernancePanel rawSpec={rawSpec} onOpenOperation={openFinding} />
      ) : (
        <ApiDocsViewer
          model={model}
          rawSpec={rawSpec}
          language={language}
          error={error}
          onRawSpecChange={onEdit}
          onTryOperation={tryOperation}
        />
      )}
    </div>
  )
}

function Menu({
  id, menu, setMenu, icon, label, iconOnly, align = 'left', children,
}: {
  id: string
  menu: string | null
  setMenu: (v: string | null) => void
  icon: React.ReactNode
  label: string
  iconOnly?: boolean
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const open = menu === id
  return (
    <div className="relative">
      <button
        onClick={() => setMenu(open ? null : id)}
        className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
          open ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border-2 text-text-3 hover:text-text-1'
        }`}
      >
        {icon}
        {!iconOnly && <>{label} <ChevronDown size={11} className="text-text-4" /></>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className={`absolute top-8 z-50 overflow-hidden rounded-md border border-border-2 bg-surface-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-2 hover:bg-surface-2 hover:text-text-1">
      {children}
    </button>
  )
}

function ToolbarButton({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 items-center rounded border border-border-2 px-2.5 text-[11px] font-medium text-text-3 transition-colors hover:text-text-1"
    >
      {children}
    </button>
  )
}
