import { useState, useEffect, useCallback } from 'react'
import { GitBranch, RefreshCw, GitCommit, Upload, Download, AlertCircle, CheckCircle, FolderOpen } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'

interface LogEntry {
  hash: string
  author: string
  date: string
  message: string
}

function parseLog(raw: string): LogEntry[] {
  if (!raw.trim()) return []
  return raw.trim().split('\n').map(line => {
    const parts = line.split('|')
    return {
      hash: parts[0]?.slice(0, 7) ?? '',
      author: parts[1] ?? '',
      date: parts[2] ?? '',
      message: parts[3] ?? line,
    }
  })
}

export function GitSyncPanel() {
  const [repoPath, setRepoPath] = useState('')
  const [remote, setRemote] = useState('origin')
  const [commitMsg, setCommitMsg] = useState('')
  const [status, setStatus] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    GitSync.IsGitInstalled().then(setGitAvailable).catch(() => setGitAvailable(false))
  }, [])

  const clearFeedback = () => { setError(''); setInfo('') }

  const refreshStatus = useCallback(async () => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      const s = await GitSync.GetStatus(repoPath)
      setStatus(s)
      const raw = await GitSync.Log(repoPath, 20)
      setLog(parseLog(raw))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const handleInit = async () => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      await GitSync.InitRepo(repoPath)
      setInfo('Repository initialized.')
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!repoPath || !commitMsg.trim()) return
    clearFeedback()
    setLoading(true)
    try {
      const result = await GitSync.CommitAll(repoPath, commitMsg)
      setInfo(result)
      setCommitMsg('')
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handlePush = async () => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      await GitSync.Push(repoPath, remote)
      setInfo('Push complete.')
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handlePull = async () => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      await GitSync.Pull(repoPath, remote)
      setInfo('Pull complete.')
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  if (gitAvailable === false) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertCircle size={32} className="text-red-500" />
          <p className="text-sm font-medium text-text-1">Git not found</p>
          <p className="text-xs text-text-3">Install Git and ensure it is on your PATH to use Git Sync.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <GitBranch size={16} className="text-accent" />
        <span className="text-sm font-semibold text-text-1">Git Sync</span>
        <div className="flex-1" />
        <button
          onClick={refreshStatus}
          disabled={!repoPath || loading}
          className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 disabled:opacity-40 transition-colors"
          title="Refresh status"
        >
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
        {/* Repo config */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-text-3 uppercase tracking-wider">Repository</h3>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-surface-2 border border-border-1 rounded text-xs">
              <FolderOpen size={12} className="text-text-3 flex-shrink-0" />
              <input
                className="flex-1 bg-transparent outline-none text-text-1 placeholder-text-3"
                placeholder="Repository path…"
                value={repoPath}
                onChange={e => setRepoPath(e.target.value)}
              />
            </div>
            <button
              onClick={handleInit}
              disabled={!repoPath || loading}
              className="px-3 py-1.5 bg-surface-2 border border-border-1 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
            >
              Init
            </button>
            <button
              onClick={refreshStatus}
              disabled={!repoPath || loading}
              className="px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
            >
              Load
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-3 w-14 flex-shrink-0">Remote</label>
            <input
              className="flex-1 px-2.5 py-1.5 bg-surface-2 border border-border-1 rounded text-xs text-text-1 placeholder-text-3 outline-none focus:border-accent"
              value={remote}
              onChange={e => setRemote(e.target.value)}
              placeholder="origin"
            />
          </div>
        </section>

        {/* Feedback */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="flex items-start gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
            <CheckCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{info}</span>
          </div>
        )}

        {/* Status */}
        {status && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text-3 uppercase tracking-wider">Status</h3>
            <pre className="bg-surface-2 border border-border-1 rounded p-2.5 text-xs text-text-2 whitespace-pre-wrap font-mono overflow-x-auto max-h-36">{status}</pre>
          </section>
        )}

        {/* Commit */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-text-3 uppercase tracking-wider">Commit</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 bg-surface-2 border border-border-1 rounded text-xs text-text-1 placeholder-text-3 outline-none focus:border-accent"
              placeholder="Commit message…"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCommit()}
            />
            <button
              onClick={handleCommit}
              disabled={!repoPath || !commitMsg.trim() || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
            >
              <GitCommit size={12} />
              Commit all
            </button>
          </div>
        </section>

        {/* Push / Pull */}
        <section className="flex gap-2">
          <button
            onClick={handlePush}
            disabled={!repoPath || loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-2 border border-border-1 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            <Upload size={12} />
            Push
          </button>
          <button
            onClick={handlePull}
            disabled={!repoPath || loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-2 border border-border-1 rounded text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            <Download size={12} />
            Pull
          </button>
        </section>

        {/* Log */}
        {log.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text-3 uppercase tracking-wider">Recent Commits</h3>
            <div className="flex flex-col gap-1">
              {log.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-2 bg-surface-2 border border-border-1 rounded">
                  <code className="text-xs font-mono text-accent flex-shrink-0 w-14">{entry.hash}</code>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-1 truncate">{entry.message}</p>
                    <p className="text-xs text-text-3">{entry.author}{entry.date ? ` · ${entry.date}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
