import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/codegen'
import {
  getCookies,
  deleteCookie,
  getLocalStorage,
  getSessionStorage,
  getIndexedDBDatabases,
  type CookieEntry,
  type StorageItem,
} from '@/lib/browser-debug-api'
import {
  Database,
  RefreshCw,
  Trash2,
  Copy,
  Cookie,
  HardDrive,
} from 'lucide-react'

export type { CookieEntry, StorageItem }

type StorageTab = 'cookies' | 'localStorage' | 'sessionStorage' | 'indexedDB'

const TABS: { id: StorageTab; label: string; icon: typeof Cookie }[] = [
  { id: 'cookies', label: 'Cookies', icon: Cookie },
  { id: 'localStorage', label: 'Local Storage', icon: HardDrive },
  { id: 'sessionStorage', label: 'Session Storage', icon: HardDrive },
  { id: 'indexedDB', label: 'IndexedDB', icon: Database },
]

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function formatExpires(ts: number): string {
  if (ts <= 0) return 'Session'
  return new Date(ts * 1000).toLocaleDateString()
}

export function StoragePanel() {
  const [activeTab, setActiveTab] = useState<StorageTab>('cookies')
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const [localItems, setLocalItems] = useState<StorageItem[]>([])
  const [sessionItems, setSessionItems] = useState<StorageItem[]>([])
  const [indexedDBNames, setIndexedDBNames] = useState<string[]>([])

  const refresh = useCallback(async () => {
    switch (activeTab) {
      case 'cookies': {
        const data = await getCookies()
        setCookies(data)
        break
      }
      case 'localStorage': {
        const data = await getLocalStorage()
        setLocalItems(data)
        break
      }
      case 'sessionStorage': {
        const data = await getSessionStorage()
        setSessionItems(data)
        break
      }
      case 'indexedDB': {
        const data = await getIndexedDBDatabases()
        setIndexedDBNames(data)
        break
      }
    }
  }, [activeTab])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleDeleteCookie = useCallback(
    async (name: string, domain: string) => {
      await deleteCookie(name, domain)
      const data = await getCookies()
      setCookies(data)
    },
    []
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Tab bar */}
      <div className="flex items-center h-8 px-3 gap-1 border-b border-border-1 bg-surface-0 flex-shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'h-6 px-2 rounded text-[10px] font-medium flex items-center gap-1 transition-colors',
              activeTab === id
                ? 'bg-accent/20 text-accent'
                : 'text-text-3 hover:text-text-2 hover:bg-surface-2'
            )}
          >
            <Icon size={10} />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={refresh}
          title="Refresh"
          className="h-6 w-6 rounded flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'cookies' && (
          <CookiesTable cookies={cookies} onDelete={handleDeleteCookie} />
        )}
        {activeTab === 'localStorage' && (
          <StorageTable items={localItems} />
        )}
        {activeTab === 'sessionStorage' && (
          <StorageTable items={sessionItems} />
        )}
        {activeTab === 'indexedDB' && (
          <IndexedDBList databases={indexedDBNames} />
        )}
      </div>
    </div>
  )
}

interface CookiesTableProps {
  cookies: CookieEntry[]
  onDelete: (name: string, domain: string) => void
}

function CookiesTable({ cookies, onDelete }: CookiesTableProps) {
  if (cookies.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-3 text-xs">
        No cookies found
      </div>
    )
  }

  return (
    <table className="w-full text-[10px] font-mono">
      <thead>
        <tr className="border-b border-border-1 bg-surface-0 text-text-3 uppercase tracking-wide">
          <th className="text-left px-2 py-1.5 font-medium">Name</th>
          <th className="text-left px-2 py-1.5 font-medium">Value</th>
          <th className="text-left px-2 py-1.5 font-medium">Domain</th>
          <th className="text-left px-2 py-1.5 font-medium">Path</th>
          <th className="text-left px-2 py-1.5 font-medium">Expires</th>
          <th className="text-center px-2 py-1.5 font-medium">HttpOnly</th>
          <th className="text-center px-2 py-1.5 font-medium">Secure</th>
          <th className="text-left px-2 py-1.5 font-medium">SameSite</th>
          <th className="px-2 py-1.5 w-8"></th>
        </tr>
      </thead>
      <tbody>
        {cookies.map((cookie) => (
          <tr
            key={`${cookie.name}-${cookie.domain}`}
            className="border-b border-border-1/50 hover:bg-surface-2/50 transition-colors"
          >
            <td className="px-2 py-1 text-text-1">{cookie.name}</td>
            <td className="px-2 py-1 text-text-2 max-w-[120px] truncate">
              {truncate(cookie.value, 30)}
            </td>
            <td className="px-2 py-1 text-text-2">{cookie.domain}</td>
            <td className="px-2 py-1 text-text-3">{cookie.path}</td>
            <td className="px-2 py-1 text-text-3">
              {formatExpires(cookie.expires)}
            </td>
            <td className="px-2 py-1 text-center">
              {cookie.httpOnly ? (
                <span className="text-emerald-400">Yes</span>
              ) : (
                <span className="text-text-3">No</span>
              )}
            </td>
            <td className="px-2 py-1 text-center">
              {cookie.secure ? (
                <span className="text-emerald-400">Yes</span>
              ) : (
                <span className="text-text-3">No</span>
              )}
            </td>
            <td className="px-2 py-1 text-text-2">{cookie.sameSite}</td>
            <td className="px-2 py-1">
              <button
                onClick={() => onDelete(cookie.name, cookie.domain)}
                title="Delete cookie"
                className="h-4 w-4 rounded flex items-center justify-center text-text-3 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={9} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface StorageTableProps {
  items: StorageItem[]
}

function StorageTable({ items }: StorageTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-3 text-xs">
        No items found
      </div>
    )
  }

  return (
    <table className="w-full text-[10px] font-mono">
      <thead>
        <tr className="border-b border-border-1 bg-surface-0 text-text-3 uppercase tracking-wide">
          <th className="text-left px-2 py-1.5 font-medium">Key</th>
          <th className="text-left px-2 py-1.5 font-medium">Value</th>
          <th className="px-2 py-1.5 w-8"></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.key}
            className="border-b border-border-1/50 hover:bg-surface-2/50 transition-colors"
          >
            <td className="px-2 py-1 text-text-1">{item.key}</td>
            <td className="px-2 py-1 text-text-2 max-w-[300px] truncate">
              {truncate(item.value, 80)}
            </td>
            <td className="px-2 py-1">
              <button
                onClick={() => copyToClipboard(item.value)}
                title="Copy value"
                className="h-4 w-4 rounded flex items-center justify-center text-text-3 hover:text-accent hover:bg-accent/10 transition-colors"
              >
                <Copy size={9} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface IndexedDBListProps {
  databases: string[]
}

function IndexedDBList({ databases }: IndexedDBListProps) {
  if (databases.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-3 text-xs">
        No IndexedDB databases found
      </div>
    )
  }

  return (
    <div className="px-3 py-2 space-y-1">
      {databases.map((name) => (
        <div
          key={name}
          className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-0 border border-border-1 text-xs font-mono text-text-1"
        >
          <Database size={12} className="text-accent flex-shrink-0" />
          {name}
        </div>
      ))}
    </div>
  )
}
