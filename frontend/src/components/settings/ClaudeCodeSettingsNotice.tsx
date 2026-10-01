import { useEffect, useState } from 'react'
import { FileCog } from 'lucide-react'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'

interface ClaudeCodeFileStatus {
  path: string
  displayPath: string
  scope: 'local' | 'project' | 'user'
  envKeys: string[]
  hasModel: boolean
  invalid?: boolean
}

type StatusFn = (workspaceDir: string) => Promise<string>

/**
 * Optional until the Wails bindings are regenerated: the backend method
 * AIEngine.ClaudeCodeSettingsStatus may not exist in an older generated module,
 * in which case the notice simply stays hidden.
 */
function statusBinding(): StatusFn | undefined {
  const candidate = (AIEngine as unknown as Record<string, unknown>).ClaudeCodeSettingsStatus
  return typeof candidate === 'function' ? (candidate as StatusFn) : undefined
}

function describe(file: ClaudeCodeFileStatus): string {
  if (file.invalid) return 'invalid JSON, ignored'
  const parts = [...file.envKeys]
  if (file.hasModel) parts.push('model')
  return parts.length ? `env: ${parts.join(', ')}` : 'no AI settings'
}

/**
 * Read-only notice listing Claude Code settings files the Anthropic/Bedrock
 * providers pick up. Shows file paths and variable names only — never values.
 */
export function ClaudeCodeSettingsNotice({ provider }: { provider: string }) {
  const [files, setFiles] = useState<ClaudeCodeFileStatus[]>([])

  useEffect(() => {
    const fetchStatus = statusBinding()
    if (!fetchStatus) return
    let cancelled = false
    fetchStatus('')
      .then((raw) => {
        if (cancelled) return
        const parsed = JSON.parse(raw) as { files?: ClaudeCodeFileStatus[] }
        setFiles(Array.isArray(parsed.files) ? parsed.files : [])
      })
      .catch(() => { if (!cancelled) setFiles([]) })
    return () => { cancelled = true }
  }, [provider])

  if (files.length === 0) return null
  return (
    <div data-claude-code-settings className="mt-4 rounded-md border border-border-2 bg-surface-1 px-3 py-2">
      {files.map((file) => (
        <p key={file.path} title={file.path} className="flex min-w-0 items-center gap-2 py-0.5 text-[10px] text-text-3">
          <FileCog size={12} className={file.invalid ? 'shrink-0 text-warning' : 'shrink-0 text-success'} />
          <span className="truncate">
            Claude Code settings detected: <span className="font-mono text-text-2">{file.displayPath}</span>{' '}
            <span className={file.invalid ? 'text-warning' : 'text-text-4'}>({describe(file)})</span>
          </span>
        </p>
      ))}
      <p className="pt-1 text-[9px] text-text-4">Read from disk on use. Process variables win, then settings.local.json, project, user. Values are never shown or saved.</p>
    </div>
  )
}
