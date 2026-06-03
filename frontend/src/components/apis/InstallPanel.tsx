import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Download, Check, ExternalLink, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { getCatalog, searchApis } from '@/lib/apis-api'
import type { ApiEntry, ApiCategory, ApiCatalog } from '@/lib/apis-api'
import { uid, type Collection, type RequestItem, type HttpMethod, blankBody } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'

const PUBLIC_APIS_SOURCE_URL = 'https://github.com/public-apis/public-apis'

function installedApiIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('adomnia.apis.installed') ?? '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

function apiToCollection(api: ApiEntry): Collection {
  const method: HttpMethod = 'GET'
  const apiUrl = api.links?.find((l: { name: string; url: string }) => l.name?.toLowerCase().includes('api'))?.url
    ?? api.links?.find((l: { name: string; url: string }) => l.name?.toLowerCase().includes('docs') || l.name?.toLowerCase().includes('website'))?.url
    ?? ''

  const request: RequestItem = {
    id: uid(),
    type: 'request',
    name: api.name,
    description: api.source ? `${api.description}\n\nSource: ${api.source}` : api.description,
    method,
    url: apiUrl || '',
    params: [],
    headers: [],
    bodies: [blankBody()],
    activeBodyIdx: 0,
    auth: { type: 'none', token: '', username: '', password: '' },
    followRedirects: true,
    timeout: 0,
  }

  return {
    id: uid(),
    name: api.name,
    children: [request],
  }
}

export function InstallPanel() {
  const [catalog, setCatalog] = useState<ApiCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ApiEntry[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installedIds, setInstalledIds] = useState<Set<string>>(() => installedApiIds())

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getCatalog()
      setCatalog(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API catalog')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchApis(searchQuery)
        setSearchResults(results ?? [])
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleInstall = (api: ApiEntry) => {
    const collection = apiToCollection(api)
    useCollectionsStore.getState().importCollection(collection)
    setInstalledIds((prev) => {
      const next = new Set([...prev, api.slug])
      safeSetItem('adomnia.apis.installed', JSON.stringify([...next]))
      return next
    })
  }

  const handleViewInWorkspace = () => {
    useAppStore.getState().setActiveRail('collections')
  }

  const allApis = useMemo(() => {
    if (searchResults) return searchResults
    if (!catalog) return []
    if (activeCategory === 'all') {
      return catalog.categories.flatMap((c: ApiCategory) => c.apis)
    }
    const cat = catalog.categories.find((c: ApiCategory) => c.name === activeCategory)
    return cat?.apis ?? []
  }, [catalog, activeCategory, searchResults])

  const categories = useMemo(() => {
    if (!catalog) return []
    const all: { name: string; emoji: string; count: number }[] = [
      { name: 'all', emoji: '📦', count: catalog.total },
    ]
    for (const cat of catalog.categories) {
      all.push({ name: cat.name, emoji: cat.emoji, count: cat.count })
    }
    return all
  }, [catalog])

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-sm text-error font-medium">Failed to load API catalog</div>
        <p className="text-xs text-text-3 max-w-md text-center">{error}</p>
        <button
          onClick={loadCatalog}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0 bg-surface-0">
      {/* Category Sidebar */}
      <aside className="w-52 flex-shrink-0 border-r border-border-1 py-4 overflow-y-auto">
        <h3 className="px-4 text-[10px] font-medium uppercase tracking-wider text-text-4 mb-2">
          Categories
        </h3>
        <nav className="space-y-0.5 px-2">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => { setActiveCategory(cat.name); setSearchQuery(''); setSearchResults(null) }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                activeCategory === cat.name
                  ? 'bg-surface-2 text-text-1 font-medium'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-1'
              )}
            >
              <span className="text-sm flex-shrink-0">{cat.emoji}</span>
              <span className="flex-1 text-left truncate">{cat.name === 'all' ? 'All APIs' : cat.name}</span>
              <span className="text-[10px] text-text-4 tabular-nums">{cat.count}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-6 py-4 border-b border-border-1 flex-shrink-0">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-surface-1 border border-border-1 rounded-md">
            <Search size={13} className="text-text-4 flex-shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (!e.target.value.trim()) setActiveCategory('all')
              }}
              placeholder="Search APIs by name or description..."
              className="flex-1 text-xs bg-transparent text-text-1 placeholder:text-text-4 focus:outline-none"
            />
            {searching && (
              <div className="w-3.5 h-3.5 border-2 border-text-4 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
          </div>
          <button
            onClick={handleViewInWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Globe size={13} />
            View in Workspace
          </button>
        </header>

        <div className="px-6 py-3 border-b border-border-1 bg-surface-1/40">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-text-1">Installable public API starters</div>
              <p className="mt-0.5 text-[11px] text-text-3">
                Curated no-auth/free REST endpoints inspired by public-apis, ready to install as adOmnia requests.
              </p>
            </div>
            <a
              href={PUBLIC_APIS_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-2 hover:text-text-1 border border-border-1 bg-surface-0 hover:bg-surface-2 rounded-md transition-colors"
            >
              <ExternalLink size={12} />
              Source list
            </a>
          </div>
        </div>

        {/* API Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-text-3 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-text-3">Loading API catalog...</span>
              </div>
            </div>
          ) : allApis.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Search size={32} className="text-text-4" />
              <p className="text-sm text-text-3">No APIs found.</p>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setActiveCategory('all') }}
                  className="text-xs text-accent hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-text-3">
                  {searchResults
                    ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${searchQuery}"`
                    : `${allApis.length} API${allApis.length !== 1 ? 's' : ''}`
                  }
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {allApis.map((api: ApiEntry) => {
                  const isInstalled = installedIds.has(api.slug)
                  const docsUrl = api.links?.find((l: { name: string; url: string }) => l.name?.toLowerCase().includes('docs') || l.name?.toLowerCase().includes('website'))?.url
                  const sourceUrl = api.links?.find((l: { name: string; url: string }) => l.name?.toLowerCase().includes('source'))?.url

                  return (
                    <div
                      key={api.slug}
                      className="group relative rounded-lg border border-border-1 bg-surface-1 hover:border-border-2 hover:shadow-sm p-4 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0 text-sm">
                          {api.categories?.[0] && catalog?.emojiMap?.[api.categories[0]]
                            ? catalog.emojiMap[api.categories[0]]
                            : '📦'
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h4 className="text-sm font-medium text-text-1 truncate">{api.name}</h4>
                            {api.isFree && (
                              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-400 rounded">
                                FREE
                              </span>
                            )}
                            {isInstalled && (
                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-400 rounded">
                                <Check size={9} />
                                Installed
                              </span>
                            )}
                            {api.source && (
                              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded">
                                PUBLIC
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-3 line-clamp-2 mb-2">{api.description}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {api.categories?.map((cat: string) => (
                              <span key={cat} className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-2 text-text-3 rounded">
                                {cat}
                              </span>
                            ))}
                            {api.type && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded uppercase">
                                {api.type}
                              </span>
                            )}
                            {api.source && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-2 text-text-3 rounded">
                                {api.source}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {docsUrl && (
                          <a
                            href={docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open documentation"
                            className="flex items-center justify-center w-6 h-6 rounded text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {sourceUrl && sourceUrl !== docsUrl && (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open source list"
                            className="flex items-center justify-center w-6 h-6 rounded text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors"
                          >
                            <Globe size={12} />
                          </a>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleInstall(api)
                          }}
                          disabled={isInstalled}
                          className={cn(
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
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
