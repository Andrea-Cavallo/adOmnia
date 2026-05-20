import { useBrowserDebugStore, type DebugNetworkEntry } from '@/stores/browser-debug'
import { cn } from '@/lib/utils'

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500'
  if (status >= 300 && status < 400) return 'bg-yellow-500'
  if (status >= 400) return 'bg-red-500'
  return 'bg-text-3'
}

function humanizeSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mimeToType(mime: string): string {
  if (mime.includes('json') || mime.includes('xml')) return 'xhr'
  if (mime.includes('html')) return 'doc'
  if (mime.includes('css')) return 'css'
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'js'
  if (mime.includes('image')) return 'img'
  if (mime.includes('font') || mime.includes('woff')) return 'font'
  return 'other'
}

function truncateUrl(url: string, maxLen: number = 60): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen - 3) + '...'
}

interface NetworkListProps {
  entries: DebugNetworkEntry[]
}

export function NetworkList({ entries }: NetworkListProps) {
  const selectedEntry = useBrowserDebugStore((s) => s.selectedEntry)
  const setSelectedEntry = useBrowserDebugStore((s) => s.setSelectedEntry)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Table header */}
      <div className="flex items-center h-8 px-2 text-xs font-medium text-text-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <span className="w-14 text-center">Status</span>
        <span className="w-16">Method</span>
        <span className="flex-1 min-w-0">URL</span>
        <span className="w-14 text-center">Type</span>
        <span className="w-16 text-right">Size</span>
        <span className="w-16 text-right pr-2">Time</span>
      </div>

      {/* Table body */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-3 text-sm">
            No network requests captured
          </div>
        )}

        {entries.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setSelectedEntry(entry)}
            className={cn(
              'flex items-center w-full h-7 px-2 text-xs text-left transition-colors border-b border-border-1/50',
              selectedEntry?.id === entry.id
                ? 'bg-surface-2 text-text-1'
                : 'text-text-2 hover:bg-surface-1'
            )}
          >
            {/* Status badge */}
            <span className="w-14 flex justify-center">
              {entry.completed ? (
                <span
                  className={cn(
                    'inline-block w-2 h-2 rounded-full',
                    statusColor(entry.status)
                  )}
                  title={`${entry.status} ${entry.statusText}`}
                />
              ) : (
                <span className="inline-block w-2 h-2 rounded-full bg-text-3 animate-pulse" />
              )}
            </span>

            {/* Method */}
            <span className="w-16 font-mono text-text-1 truncate">
              {entry.method}
            </span>

            {/* URL */}
            <span className="flex-1 min-w-0 truncate font-mono" title={entry.url}>
              {truncateUrl(entry.url)}
            </span>

            {/* Type */}
            <span className="w-14 text-center text-text-3">
              {mimeToType(entry.mimeType)}
            </span>

            {/* Size */}
            <span className="w-16 text-right text-text-3">
              {humanizeSize(entry.size)}
            </span>

            {/* Duration */}
            <span className="w-16 text-right pr-2 text-text-3">
              {entry.duration > 0 ? `${Math.round(entry.duration * 1000)}ms` : '-'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
