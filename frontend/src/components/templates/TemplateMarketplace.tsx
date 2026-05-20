import { useCallback, useEffect, useState } from 'react'
import { Search, Upload, Plus, Download, Check, FolderOpen, Workflow, Server, Globe, LayoutList, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Template, TemplateCategory } from '@/lib/plugins-api'
import type { Collection, Environment, HttpMethod, RequestItem } from '@/lib/types'
import { blankAuth, blankBody, uid } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import {
  getTemplates,
  getTemplatesByCategory,
  searchTemplates,
  getCategories,
  importTemplate,
  installTemplate,
} from '@/lib/plugins-api'
import { TemplateDetail } from './TemplateDetail'

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  all: Package,
  requests: LayoutList,
  collections: FolderOpen,
  flows: Workflow,
  mocks: Server,
  environments: Globe,
}

type TemplatePayload = {
  requests?: TemplateRequest[]
  collection?: Collection
  environment?: Partial<Environment>
  mockConfig?: { endpoints?: unknown[] }
  name?: string
  steps?: unknown[]
  nodes?: Array<{ id?: string; type?: string; label?: string; request?: Partial<RequestItem> }>
}

type TemplateKv = Partial<{ id: string; key: string; value: string; enabled: boolean }>
type TemplateRequest = Partial<Omit<RequestItem, 'headers' | 'params'>> & {
  headers?: TemplateKv[]
  params?: TemplateKv[]
  body?: { type?: string; raw?: string; params?: TemplateKv[] }
}

function normalizeTemplateRequest(raw: TemplateRequest, index: number): RequestItem {
  const body = raw.body
  const headers = (raw.headers ?? []).map((header) => ({
    id: header.id ?? uid(),
    key: header.key ?? '',
    value: header.value ?? '',
    enabled: header.enabled ?? true,
  }))
  return {
    id: raw.id ?? uid(),
    type: 'request',
    name: raw.name ?? `Request ${index + 1}`,
    method: (raw.method ?? 'GET') as HttpMethod,
    url: raw.url ?? '',
    params: (raw.params ?? []).map((row) => ({ id: row.id ?? uid(), key: row.key ?? '', value: row.value ?? '', enabled: row.enabled ?? true })),
    headers,
    bodies: body ? [{
      ...blankBody(),
      id: uid(),
      type: body.type === 'urlencoded' || body.type === 'formdata' || body.type === 'graphql' ? body.type : 'raw',
      raw: body.raw ?? '',
      lang: body.type === 'xml' ? 'xml' : 'json',
      form: (body.params ?? []).map((row) => ({ id: uid(), key: row.key ?? '', value: row.value ?? '', enabled: row.enabled ?? true })),
    }] : [blankBody()],
    activeBodyIdx: 0,
    auth: raw.auth ?? blankAuth(),
    scripts: raw.scripts,
    timeout: raw.timeout ?? 0,
    followRedirects: raw.followRedirects ?? true,
    assertions: raw.assertions ?? [],
  }
}

function installedTemplateIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('adomnia.templates.installed') ?? '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

export function TemplateMarketplace() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(() => installedTemplateIds())
  const [importMode, setImportMode] = useState(false)
  const [importJson, setImportJson] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    const [allTemplates, cats] = await Promise.all([
      getTemplates(),
      getCategories(),
    ])
    setTemplates(allTemplates)
    setCategories(cats)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    async function filterTemplates() {
      if (searchQuery.trim()) {
        const results = await searchTemplates(searchQuery)
        setTemplates(results)
      } else if (activeCategory === 'all') {
        const all = await getTemplates()
        setTemplates(all)
      } else {
        const filtered = await getTemplatesByCategory(activeCategory)
        setTemplates(filtered)
      }
    }
    filterTemplates()
  }, [activeCategory, searchQuery])

  const applyTemplateContent = (template: Template, content: string) => {
    const payload = JSON.parse(content) as TemplatePayload
    if (payload.collection) {
      useCollectionsStore.getState().importCollection({ ...payload.collection, id: uid(), name: `${payload.collection.name ?? template.name} Template` })
      useAppStore.getState().setActiveRail('collections')
      return
    }
    if (payload.requests?.length) {
      const collection: Collection = {
        id: uid(),
        name: template.name,
        children: payload.requests.map(normalizeTemplateRequest),
      }
      useCollectionsStore.getState().importCollection(collection)
      useAppStore.getState().setActiveRail('collections')
      return
    }
    if (payload.environment) {
      const env: Environment = {
        id: uid(),
        name: payload.environment.name ?? template.name,
        variables: (payload.environment.variables ?? []).map((variable) => ({
          id: variable.id ?? uid(),
          key: variable.key ?? '',
          value: variable.value ?? '',
          enabled: variable.enabled ?? true,
          type: variable.type ?? 'text',
        })),
      }
      useEnvironmentsStore.setState((state) => ({ environments: [...state.environments, env], activeEnvId: env.id, loaded: true }))
      useEnvironmentsStore.getState().save()
      useAppStore.getState().setActiveRail('collections')
      return
    }
    if (payload.mockConfig?.endpoints?.length) {
      const raw = localStorage.getItem('adomnia.mock.endpoints')
      const existing = raw ? JSON.parse(raw) as unknown[] : []
      localStorage.setItem('adomnia.mock.endpoints', JSON.stringify([...existing, ...payload.mockConfig.endpoints]))
      useAppStore.getState().setActiveRail('mock')
      return
    }
    if (payload.steps?.length || payload.nodes?.length) {
      const raw = localStorage.getItem('adomnia.flows.v1')
      const existing = raw ? JSON.parse(raw) as unknown[] : []
      const steps = payload.steps ?? payload.nodes?.map((node, index) => ({
        id: uid(),
        type: node.type === 'condition' ? 'condition' : 'request',
        name: node.label ?? `step${index + 1}`,
        request: normalizeTemplateRequest(node.request ?? {}, index),
        condition: { variable: '', operator: 'exists', value: '' },
        waitMs: 500,
        script: '',
        status: 'idle',
      }))
      localStorage.setItem('adomnia.flows.v1', JSON.stringify([...existing, { id: uid(), name: payload.name ?? template.name, steps, updatedAt: new Date().toISOString() }]))
      useAppStore.getState().setActiveRail('flows')
      return
    }
    throw new Error('Unsupported template content')
  }

  const handleInstall = async (template: Template) => {
    const content = await installTemplate(template.id)
    if (content) {
      applyTemplateContent(template, content)
      setInstalledIds((prev) => {
        const next = new Set([...prev, template.id])
        localStorage.setItem('adomnia.templates.installed', JSON.stringify([...next]))
        return next
      })
    }
  }

  const handleImport = async () => {
    if (!importJson.trim()) return
    const result = await importTemplate(importJson.trim())
    if (result) {
      await loadData()
      setImportMode(false)
      setImportJson('')
    }
  }

  if (selectedTemplate) {
    return (
      <TemplateDetail
        template={selectedTemplate}
        isInstalled={installedIds.has(selectedTemplate.id)}
        onInstall={() => handleInstall(selectedTemplate)}
        onBack={() => setSelectedTemplate(null)}
      />
    )
  }

  const allCategory: TemplateCategory = { id: 'all', name: 'All', icon: 'package', count: templates.length }
  const displayCategories = [allCategory, ...categories]

  return (
    <div className="flex-1 flex min-h-0 bg-surface-0">
      <aside className="w-48 flex-shrink-0 border-r border-border-1 py-4 overflow-y-auto">
        <h3 className="px-4 text-[10px] font-medium uppercase tracking-wider text-text-4 mb-2">
          Categories
        </h3>
        <nav className="space-y-0.5 px-2">
          {displayCategories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] || Package
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                  activeCategory === cat.id
                    ? 'bg-surface-2 text-text-1 font-medium'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-1'
                )}
              >
                <Icon size={13} />
                <span className="flex-1 text-left">{cat.name}</span>
                <span className="text-[10px] text-text-4">{cat.count}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-6 py-4 border-b border-border-1 flex-shrink-0">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-surface-1 border border-border-1 rounded-md">
            <Search size={13} className="text-text-4 flex-shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="flex-1 text-xs bg-transparent text-text-1 placeholder:text-text-4 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setImportMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Upload size={13} />
            Import
          </button>
          <button
            onClick={() => setSelectedTemplate(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
          >
            <Plus size={13} />
            Create
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && templates.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-sm text-text-3">Loading templates...</div>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Package size={32} className="text-text-4" />
              <p className="text-sm text-text-3">No templates found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {templates.map((template) => {
                const isInstalled = installedIds.has(template.id)
                return (
                  <div
                    key={template.id}
                    className="group relative rounded-lg border border-border-1 bg-surface-1 hover:border-border-2 hover:shadow-sm p-4 transition-all cursor-pointer"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0">
                        <Package size={14} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className="text-sm font-medium text-text-1 truncate">{template.name}</h4>
                          {isInstalled && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-400 rounded">
                              <Check size={9} />
                              Installed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-3 line-clamp-2 mb-2">{template.description}</p>
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-2 text-text-3 rounded">
                            {template.category}
                          </span>
                          <span className="text-[10px] text-text-4">by {template.author}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleInstall(template)
                      }}
                      disabled={isInstalled}
                      className={cn(
                        'absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity',
                        'flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors',
                        isInstalled
                          ? 'bg-surface-2 text-text-4 cursor-not-allowed'
                          : 'bg-accent text-white hover:opacity-90'
                      )}
                    >
                      <Download size={10} />
                      {isInstalled ? 'Installed' : 'Install'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {importMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[500px] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-text-1">Import Template</h2>
            <p className="text-xs text-text-3">Paste the exported template JSON below:</p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              className="w-full h-48 px-3 py-2 text-xs font-mono bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent resize-none"
              placeholder='{"id": "...", "name": "...", ...}'
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setImportMode(false); setImportJson('') }}
                className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!importJson.trim()}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  importJson.trim()
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'bg-surface-2 text-text-4 cursor-not-allowed'
                )}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
