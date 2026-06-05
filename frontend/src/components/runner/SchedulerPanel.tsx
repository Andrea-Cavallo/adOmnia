import { useEffect, useState } from 'react'
import { Plus, Play, Pause, Trash2, Clock, CheckCircle2, XCircle } from 'lucide-react'
import {
  AddJob,
  UpdateJob,
  DeleteJob,
  EnableJob,
  DisableJob,
  ListJobs,
  GetHistory,
  type ScheduledJob,
  type JobRun,
} from '@/wailsjs/go/main/SchedulerBinding'
import { cn } from '@/lib/utils'

const BLANK_JOB = { name: '', cronExpr: '@every 1h', requestId: '' }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function SchedulerPanel() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<JobRun[]>([])
  const [form, setForm] = useState(BLANK_JOB)
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState('')

  const reload = async () => {
    try {
      setJobs(await ListJobs())
    } catch {
      /* backend not ready */
    }
  }

  useEffect(() => {
    void reload()
    const id = setInterval(() => void reload(), 10_000)
    return () => clearInterval(id)
  }, [])

  const selectJob = async (job: ScheduledJob) => {
    setSelectedId(job.id)
    setIsNew(false)
    setForm({ name: job.name, cronExpr: job.cronExpr, requestId: job.requestId })
    setError('')
    try {
      setHistory(await GetHistory(job.id))
    } catch {
      setHistory([])
    }
  }

  const handleNew = () => {
    setSelectedId(null)
    setIsNew(true)
    setForm(BLANK_JOB)
    setHistory([])
    setError('')
  }

  const handleSave = async () => {
    setError('')
    try {
      if (isNew) {
        await AddJob(form.name, form.cronExpr, form.requestId)
      } else if (selectedId) {
        await UpdateJob(selectedId, form.name, form.cronExpr, form.requestId)
      }
      await reload()
      setIsNew(false)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleDelete = async (id: string) => {
    await DeleteJob(id)
    if (selectedId === id) {
      setSelectedId(null)
      setForm(BLANK_JOB)
      setHistory([])
    }
    await reload()
  }

  const handleToggle = async (job: ScheduledJob) => {
    if (job.enabled) await DisableJob(job.id)
    else await EnableJob(job.id)
    await reload()
  }

  const selected = jobs.find((j) => j.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: job list */}
      <div className="w-[200px] border-r border-border-1 flex flex-col bg-surface-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
          <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Scheduled Jobs</span>
          <button onClick={handleNew} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors" title="New job">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => void selectJob(job)}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                selectedId === job.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', job.enabled ? 'bg-success' : 'bg-text-4')} />
              <span className="flex-1 truncate">{job.name || '(unnamed)'}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleToggle(job)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-text-4 transition-all shrink-0"
                title={job.enabled ? 'Pause' : 'Resume'}
              >
                {job.enabled ? <Pause size={10} /> : <Play size={10} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(job.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-error transition-all shrink-0"
                title="Delete"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          {jobs.length === 0 && (
            <p className="px-3 py-4 text-[10px] text-text-4 text-center">
              No jobs.
              <br />
              Click + to schedule one.
            </p>
          )}
        </div>
      </div>

      {/* Right: editor + history */}
      {isNew || selected ? (
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold text-text-1">{isNew ? 'New Scheduled Job' : 'Edit Job'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-text-2 block mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-text-2 block mb-1">Cron Expression</label>
                <input
                  value={form.cronExpr}
                  onChange={(e) => setForm((f) => ({ ...f, cronExpr: e.target.value }))}
                  placeholder="@every 1h  or  0 * * * *"
                  className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-text-2 block mb-1">Request ID</label>
              <input
                value={form.requestId}
                onChange={(e) => setForm((f) => ({ ...f, requestId: e.target.value }))}
                placeholder="Request ID from your collection"
                className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
              />
              <p className="text-[9px] text-text-4 mt-1">
                Scheduled runs send the stored request as-is (no environment substitution, auth, or scripts in v1).
              </p>
            </div>
            {error && <p className="text-[10px] text-error">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleSave()}
                className="h-7 px-3 text-[10px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
              >
                {isNew ? 'Create Job' : 'Save Changes'}
              </button>
              {selected && (
                <div className="flex items-center gap-2 ml-auto text-[10px] text-text-3">
                  <Clock size={11} />
                  Next: {selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString() : '—'}
                </div>
              )}
            </div>
          </div>

          {!isNew && history.length > 0 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <p className="text-[10px] font-semibold text-text-2 mb-2">Run History</p>
              <div className="flex-1 overflow-y-auto space-y-1">
                {history.map((run, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded border text-[10px]',
                      run.success ? 'bg-success/10 border-success/30 text-text-1' : 'bg-error/10 border-error/30 text-text-1',
                    )}
                  >
                    {run.success ? (
                      <CheckCircle2 size={11} className="text-success shrink-0" />
                    ) : (
                      <XCircle size={11} className="text-error shrink-0" />
                    )}
                    <span className="text-text-3 shrink-0">{new Date(run.startedAt).toLocaleString()}</span>
                    {run.statusCode > 0 && <span className="font-mono shrink-0">{run.statusCode}</span>}
                    <span className="text-text-4 shrink-0">{run.durationMs}ms</span>
                    {run.error && <span className="truncate text-error">{run.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isNew && history.length === 0 && (
            <p className="text-[10px] text-text-4">No runs recorded yet. The job will execute on its next scheduled time.</p>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
          Select a job to edit it, or click + to create one.
        </div>
      )}
    </div>
  )
}
