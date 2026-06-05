# P17 — Scheduled Tasks (Cron-Based Request Runner) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Allow users to schedule any saved request (or collection folder) to run automatically on a cron expression or interval. The scheduler runs inside the Wails process (no separate daemon), persists job definitions to a bbolt bucket, keeps a capped run history, and exposes a `SchedulerPanel.tsx` that shows job status, next-run time, and a scrollable result log.

**Current State:** No scheduler exists. The backend has the load-test and flow runners, but nothing time-triggered. `RunnerPanel.tsx` exists as a placeholder with a Scheduled tab that shows an empty state.

**Tech Stack:** Go (`robfig/cron/v3`), Wails lifecycle hooks in `app.go`, bbolt for persistence, React + Zustand for frontend state. One new Go dependency.

---

## File Map

| File | Change |
|------|--------|
| `go.mod` | Add `github.com/robfig/cron/v3` |
| `scheduler.go` | **New** — `SchedulerBinding` struct with all Wails-bound methods |
| `app.go` | Start/stop scheduler in `startup`/`shutdown` lifecycle hooks |
| `main.go` | Register `SchedulerBinding` in the Wails `Bind` slice |
| `frontend/src/components/runner/SchedulerPanel.tsx` | **New** — scheduler UI (job list + history + editor) |
| `frontend/src/components/runner/RunnerPanel.tsx` | Wire Scheduled tab to `SchedulerPanel` |
| `frontend/wailsjs/go/main/SchedulerBinding.d.ts` | Regenerated Wails bindings |

---

> **EXECUTION NOTE (2026-06-05):** Adapted to the real codebase:
> - Persistence uses the **`storage` package** (`storage.Get/Put/List/Delete`), not a raw `*bolt.DB`
>   on `App` (there is none). Added a `scheduler` bucket to the storage allowlist. Jobs keyed
>   `job:<id>`, history keyed `history:<id>`.
> - Execution: there was **no `ExecuteRequestByID`**. Implemented `executeRequestByID` that reads
>   the persisted `collections/all`, finds the request node by ID (recursive, across workspaces +
>   legacy top-level), and runs it via the existing **`httpexec.Execute`** (same CORS-free HTTP
>   stack as normal requests). v1 limitation: no env substitution / auth / scripts (documented in UI).
> - **Cron parser:** used `cron.New()` (standard 5-field + `@every`/`@hourly`) for BOTH validation
>   (`ParseStandard`) and scheduling, instead of the plan's `WithSeconds()` which would have made
>   5-field expressions fail at schedule time.
> - **Bind timing fix:** the binding instance is created in `main.go` *before* `wails.Run` and stored
>   on `app.scheduler`; `Start()` runs in `OnStartup` (after `storage.Open`), `Stop()` in `OnShutdown`.
>   The plan's "add to Bind" with an instance created inside `OnStartup` would have bound `nil`.
> - Wails bindings (`SchedulerBinding.ts` + global type) written **manually** (no `wails generate` run).
> - **Scheduler panel is a Rail panel** (API Core › Testing), not a RunnerPanel tab — RunnerPanel is a
>   single-view runner with no tab system (the plan's "Scheduled tab placeholder" did not exist).
> - Run-history rows use status tokens, not hardcoded palette colors.

## Feature Checklist

- [x] **Go scheduler binding**
  - **AC:** `SchedulerBinding` exposes `AddJob`, `UpdateJob`, `DeleteJob`, `EnableJob`, `DisableJob`, `ListJobs`, `GetHistory`; persists to bbolt (`scheduler` bucket); starts/stops with app lifecycle
- [x] **Cron expression support**
  - **AC:** Accepts standard 5-field cron (`0 * * * *`) and shorthands (`@hourly`, `@every 5m`); invalid expressions rejected with a clear error (validated on Add/Update)
- [x] **Run history**
  - **AC:** Capped ring buffer of 50 runs per job; each entry has `startedAt`, `durationMs`, `statusCode`, `error`; readable via `GetHistory(jobId)`
- [x] **Scheduler panel UI**
  - **AC:** Left job list with status dot (active/paused) + pause/delete; right pane editor (name, cron, request ID) + next-run time + history table; 10s auto-refresh

---

### Task 1: Add `robfig/cron/v3` dependency

**Files:**
- Modify: `go.mod`

- [ ] **Step 1: Add the dependency**

  ```bash
  go get github.com/robfig/cron/v3@latest
  go mod tidy
  ```

  **DoD:**
  - [ ] `go.mod` contains `github.com/robfig/cron/v3`
  - [ ] `go.sum` updated
  - [ ] `go build ./...` exits 0

- [ ] **Step 2: Commit**

  ```bash
  git add go.mod go.sum
  git commit -m "chore: add robfig/cron/v3 dependency for scheduler"
  ```

---

### Task 2: Create `scheduler.go`

**Files:**
- Create: `scheduler.go`

- [ ] **Step 1: Define types**

  ```go
  package main

  import (
      "context"
      "encoding/json"
      "fmt"
      "sync"
      "time"

      "github.com/robfig/cron/v3"
      bolt "go.etcd.io/bbolt"
  )

  const (
      schedulerBucket  = "scheduler_jobs"
      schedulerHistory = "scheduler_history"
      historyMaxRuns   = 50
  )

  type ScheduledJob struct {
      ID          string `json:"id"`
      Name        string `json:"name"`
      CronExpr    string `json:"cronExpr"`
      RequestID   string `json:"requestId"`
      CollectionID string `json:"collectionId,omitempty"`
      Enabled     bool   `json:"enabled"`
      CreatedAt   string `json:"createdAt"`
      LastRunAt   string `json:"lastRunAt,omitempty"`
      NextRunAt   string `json:"nextRunAt,omitempty"`
  }

  type JobRun struct {
      JobID      string `json:"jobId"`
      StartedAt  string `json:"startedAt"`
      Duration   int64  `json:"durationMs"`
      StatusCode int    `json:"statusCode"`
      Error      string `json:"error,omitempty"`
      Success    bool   `json:"success"`
  }

  type SchedulerBinding struct {
      app   *App
      cron  *cron.Cron
      db    *bolt.DB
      mu    sync.Mutex
      entryIDs map[string]cron.EntryID // jobID -> cron entry ID
  }
  ```

  **DoD:**
  - [ ] Types defined: `ScheduledJob`, `JobRun`, `SchedulerBinding`

- [ ] **Step 2: Implement lifecycle and persistence helpers**

  ```go
  func NewSchedulerBinding(app *App, db *bolt.DB) *SchedulerBinding {
      s := &SchedulerBinding{
          app:      app,
          cron:     cron.New(cron.WithSeconds()),
          db:       db,
          entryIDs: make(map[string]cron.EntryID),
      }
      return s
  }

  func (s *SchedulerBinding) Start() {
      jobs, _ := s.listJobsInternal()
      for _, j := range jobs {
          if j.Enabled {
              s.scheduleJob(j)
          }
      }
      s.cron.Start()
  }

  func (s *SchedulerBinding) Stop() {
      ctx := s.cron.Stop()
      <-ctx.Done()
  }

  func (s *SchedulerBinding) persistJob(job ScheduledJob) error {
      return s.db.Update(func(tx *bolt.Tx) error {
          b, err := tx.CreateBucketIfNotExists([]byte(schedulerBucket))
          if err != nil { return err }
          data, err := json.Marshal(job)
          if err != nil { return err }
          return b.Put([]byte(job.ID), data)
      })
  }

  func (s *SchedulerBinding) deleteJobFromDB(id string) error {
      return s.db.Update(func(tx *bolt.Tx) error {
          b := tx.Bucket([]byte(schedulerBucket))
          if b == nil { return nil }
          return b.Delete([]byte(id))
      })
  }

  func (s *SchedulerBinding) listJobsInternal() ([]ScheduledJob, error) {
      var jobs []ScheduledJob
      err := s.db.View(func(tx *bolt.Tx) error {
          b := tx.Bucket([]byte(schedulerBucket))
          if b == nil { return nil }
          return b.ForEach(func(k, v []byte) error {
              var j ScheduledJob
              if err := json.Unmarshal(v, &j); err != nil { return err }
              jobs = append(jobs, j)
              return nil
          })
      })
      return jobs, err
  }

  func (s *SchedulerBinding) appendHistory(run JobRun) {
      _ = s.db.Update(func(tx *bolt.Tx) error {
          b, err := tx.CreateBucketIfNotExists([]byte(schedulerHistory))
          if err != nil { return err }
          key := []byte(run.JobID)
          var runs []JobRun
          if existing := b.Get(key); existing != nil {
              _ = json.Unmarshal(existing, &runs)
          }
          runs = append([]JobRun{run}, runs...)
          if len(runs) > historyMaxRuns {
              runs = runs[:historyMaxRuns]
          }
          data, _ := json.Marshal(runs)
          return b.Put(key, data)
      })
  }
  ```

  **DoD:**
  - [ ] `Start()` loads enabled jobs from bbolt and registers them with cron
  - [ ] `Stop()` drains cron gracefully
  - [ ] `appendHistory` keeps max 50 runs per job, newest first

- [ ] **Step 3: Implement `scheduleJob` and the execution func**

  ```go
  func (s *SchedulerBinding) scheduleJob(job ScheduledJob) error {
      fn := func() {
          start := time.Now()
          run := JobRun{
              JobID:     job.ID,
              StartedAt: start.UTC().Format(time.RFC3339),
              Success:   false,
          }
          // Execute via the existing executeHTTP helper already in the App
          // We call the backend directly rather than going through the frontend
          result, err := s.app.ExecuteRequestByID(job.RequestID)
          run.Duration = time.Since(start).Milliseconds()
          if err != nil {
              run.Error = err.Error()
          } else {
              run.StatusCode = result.Status
              run.Success = result.Status >= 200 && result.Status < 400
          }
          s.appendHistory(run)
          // Update lastRunAt on the persisted job
          s.mu.Lock()
          jobs, _ := s.listJobsInternal()
          for _, j := range jobs {
              if j.ID == job.ID {
                  j.LastRunAt = run.StartedAt
                  _ = s.persistJob(j)
                  break
              }
          }
          s.mu.Unlock()
      }

      s.mu.Lock()
      defer s.mu.Unlock()
      // Remove existing entry if re-scheduling
      if eid, ok := s.entryIDs[job.ID]; ok {
          s.cron.Remove(eid)
          delete(s.entryIDs, job.ID)
      }
      eid, err := s.cron.AddFunc(job.CronExpr, fn)
      if err != nil { return err }
      s.entryIDs[job.ID] = eid
      return nil
  }
  ```

  **Note:** `s.app.ExecuteRequestByID(requestID)` is a helper that needs to be added to `app.go` — it looks up the request by ID from the frontend's data and calls the same HTTP stack used by `ExecuteRequest`. If that helper is complex to add, use a simplified GET-only path for the first version and document the limitation.

  **DoD:**
  - [ ] `scheduleJob` registers cron entry; removes old entry before re-registering
  - [ ] Run result appended to history after each execution

- [ ] **Step 4: Implement the public Wails-bound methods**

  ```go
  func (s *SchedulerBinding) AddJob(name, cronExpr, requestID string) (ScheduledJob, error) {
      if _, err := cron.ParseStandard(cronExpr); err != nil {
          if _, err2 := cron.New(cron.WithSeconds()).AddFunc(cronExpr, func() {}); err2 != nil {
              return ScheduledJob{}, fmt.Errorf("invalid cron expression: %w", err)
          }
      }
      job := ScheduledJob{
          ID:        generateID(),
          Name:      name,
          CronExpr:  cronExpr,
          RequestID: requestID,
          Enabled:   true,
          CreatedAt: time.Now().UTC().Format(time.RFC3339),
      }
      if err := s.persistJob(job); err != nil {
          return ScheduledJob{}, err
      }
      _ = s.scheduleJob(job)
      return job, nil
  }

  func (s *SchedulerBinding) UpdateJob(id, name, cronExpr, requestID string) (ScheduledJob, error) {
      jobs, _ := s.listJobsInternal()
      for _, j := range jobs {
          if j.ID == id {
              j.Name = name
              j.CronExpr = cronExpr
              j.RequestID = requestID
              if err := s.persistJob(j); err != nil { return j, err }
              if j.Enabled {
                  _ = s.scheduleJob(j)
              }
              return j, nil
          }
      }
      return ScheduledJob{}, fmt.Errorf("job %s not found", id)
  }

  func (s *SchedulerBinding) DeleteJob(id string) error {
      s.mu.Lock()
      if eid, ok := s.entryIDs[id]; ok {
          s.cron.Remove(eid)
          delete(s.entryIDs, id)
      }
      s.mu.Unlock()
      return s.deleteJobFromDB(id)
  }

  func (s *SchedulerBinding) EnableJob(id string) error  { return s.setEnabled(id, true) }
  func (s *SchedulerBinding) DisableJob(id string) error { return s.setEnabled(id, false) }

  func (s *SchedulerBinding) setEnabled(id string, enabled bool) error {
      jobs, _ := s.listJobsInternal()
      for _, j := range jobs {
          if j.ID == id {
              j.Enabled = enabled
              if err := s.persistJob(j); err != nil { return err }
              if enabled {
                  return s.scheduleJob(j)
              }
              s.mu.Lock()
              if eid, ok := s.entryIDs[id]; ok {
                  s.cron.Remove(eid)
                  delete(s.entryIDs, id)
              }
              s.mu.Unlock()
              return nil
          }
      }
      return fmt.Errorf("job %s not found", id)
  }

  func (s *SchedulerBinding) ListJobs() ([]ScheduledJob, error) {
      jobs, err := s.listJobsInternal()
      if err != nil { return nil, err }
      s.mu.Lock()
      defer s.mu.Unlock()
      for i, j := range jobs {
          if eid, ok := s.entryIDs[j.ID]; ok {
              entry := s.cron.Entry(eid)
              jobs[i].NextRunAt = entry.Next.UTC().Format(time.RFC3339)
          }
      }
      return jobs, nil
  }

  func (s *SchedulerBinding) GetHistory(jobID string) ([]JobRun, error) {
      var runs []JobRun
      _ = s.db.View(func(tx *bolt.Tx) error {
          b := tx.Bucket([]byte(schedulerHistory))
          if b == nil { return nil }
          data := b.Get([]byte(jobID))
          if data == nil { return nil }
          return json.Unmarshal(data, &runs)
      })
      return runs, nil
  }
  ```

  **DoD:**
  - [ ] `AddJob` validates cron expression before persisting
  - [ ] `ListJobs` populates `NextRunAt` from live cron entries
  - [ ] `EnableJob`/`DisableJob` idempotent
  - [ ] `GetHistory` returns empty slice (not error) when no history exists
  - [ ] Build passes

- [ ] **Step 5: Commit**

  ```bash
  git add scheduler.go
  git commit -m "feat: add SchedulerBinding — cron-based request scheduler with bbolt persistence"
  ```

---

### Task 3: Wire into `app.go` and `main.go`

**Files:**
- Modify: `app.go`
- Modify: `main.go`

- [ ] **Step 1: Add `SchedulerBinding` to `App` and wire lifecycle**

  In `app.go`, add a field to the `App` struct:

  ```go
  scheduler *SchedulerBinding
  ```

  In `startup`:

  ```go
  func (a *App) startup(ctx context.Context) {
      a.ctx = ctx
      // ... existing startup code ...
      a.scheduler = NewSchedulerBinding(a, a.db) // pass existing bbolt db handle
      a.scheduler.Start()
  }
  ```

  In `shutdown` (add if missing, otherwise append):

  ```go
  func (a *App) shutdown(ctx context.Context) {
      if a.scheduler != nil {
          a.scheduler.Stop()
      }
      // ... existing shutdown code ...
  }
  ```

  **DoD:**
  - [ ] Scheduler starts on app startup
  - [ ] Scheduler drains gracefully on app shutdown

- [ ] **Step 2: Register in `main.go`**

  In the Wails options `Bind` slice:

  ```go
  Bind: []interface{}{
      app,
      // ... existing bindings ...
      app.scheduler,
  },
  ```

  **DoD:**
  - [ ] `SchedulerBinding` appears in `Bind`
  - [ ] `wails build` regenerates `frontend/wailsjs/go/main/SchedulerBinding.d.ts`

- [ ] **Step 3: Build check + commit**

  ```bash
  go build ./...
  git add app.go main.go
  git commit -m "feat: wire SchedulerBinding into app lifecycle and Wails Bind"
  ```

  **DoD:**
  - [ ] `go build ./...` exits 0

---

### Task 4: Create `SchedulerPanel.tsx`

**Files:**
- Create: `frontend/src/components/runner/SchedulerPanel.tsx`

- [ ] **Step 1: Create the component**

  ```tsx
  import { useEffect, useState } from 'react'
  import { Plus, Play, Pause, Trash2, Clock, CheckCircle2, XCircle } from 'lucide-react'
  import {
    AddJob, UpdateJob, DeleteJob, EnableJob, DisableJob, ListJobs, GetHistory
  } from '@wailsjs/go/main/SchedulerBinding'
  import { cn } from '@/lib/utils'

  interface ScheduledJob {
    id: string; name: string; cronExpr: string; requestId: string
    enabled: boolean; createdAt: string; lastRunAt?: string; nextRunAt?: string
  }

  interface JobRun {
    jobId: string; startedAt: string; durationMs: number
    statusCode: number; error?: string; success: boolean
  }

  const BLANK_JOB = { name: '', cronExpr: '@every 1h', requestId: '' }

  export function SchedulerPanel() {
    const [jobs, setJobs] = useState<ScheduledJob[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [history, setHistory] = useState<JobRun[]>([])
    const [form, setForm] = useState(BLANK_JOB)
    const [isNew, setIsNew] = useState(false)
    const [error, setError] = useState('')

    const reload = async () => {
      try { setJobs(await ListJobs()) } catch { /* ignore */ }
    }

    useEffect(() => { reload() }, [])

    useEffect(() => {
      const id = setInterval(reload, 10_000)
      return () => clearInterval(id)
    }, [])

    const selectJob = async (job: ScheduledJob) => {
      setSelectedId(job.id)
      setIsNew(false)
      setForm({ name: job.name, cronExpr: job.cronExpr, requestId: job.requestId })
      setError('')
      try { setHistory(await GetHistory(job.id)) } catch { setHistory([]) }
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
      } catch (e) { setError(String(e)) }
    }

    const handleDelete = async (id: string) => {
      await DeleteJob(id)
      if (selectedId === id) { setSelectedId(null); setForm(BLANK_JOB); setHistory([]) }
      await reload()
    }

    const handleToggle = async (job: ScheduledJob) => {
      if (job.enabled) await DisableJob(job.id)
      else await EnableJob(job.id)
      await reload()
    }

    const selected = jobs.find(j => j.id === selectedId) ?? null

    return (
      <div className="flex h-full overflow-hidden">
        {/* Left: job list */}
        <div className="w-[200px] border-r border-border-1 flex flex-col bg-surface-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
            <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Scheduled Jobs</span>
            <button onClick={handleNew} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => selectJob(job)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                  selectedId === job.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', job.enabled ? 'bg-green-400' : 'bg-text-4')} />
                <span className="flex-1 truncate">{job.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggle(job) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-text-4 transition-all shrink-0"
                  title={job.enabled ? 'Pause' : 'Resume'}
                >
                  {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(job.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-red-400 transition-all shrink-0"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {jobs.length === 0 && (
              <p className="px-3 py-4 text-[10px] text-text-4 text-center">No jobs.<br />Click + to schedule one.</p>
            )}
          </div>
        </div>

        {/* Right: editor + history */}
        {(isNew || selected) ? (
          <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
            {/* Editor */}
            <div className="flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold text-text-1">{isNew ? 'New Scheduled Job' : 'Edit Job'}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-text-2 block mb-1">Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-text-2 block mb-1">Cron Expression</label>
                  <input
                    value={form.cronExpr}
                    onChange={(e) => setForm(f => ({ ...f, cronExpr: e.target.value }))}
                    placeholder="@every 1h  or  0 * * * *"
                    className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-text-2 block mb-1">Request ID</label>
                <input
                  value={form.requestId}
                  onChange={(e) => setForm(f => ({ ...f, requestId: e.target.value }))}
                  placeholder="Request ID from your collection"
                  className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                />
                <p className="text-[9px] text-text-4 mt-1">Tip: right-click a request in the sidebar to copy its ID.</p>
              </div>
              {error && <p className="text-[10px] text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="h-7 px-3 text-[10px] bg-accent text-white rounded hover:bg-accent/90 transition-colors"
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

            {/* History */}
            {!isNew && history.length > 0 && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <p className="text-[10px] font-semibold text-text-2 mb-2">Run History</p>
                <div className="flex-1 overflow-y-auto space-y-1">
                  {history.map((run, i) => (
                    <div key={i} className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded border text-[10px]',
                      run.success
                        ? 'bg-green-950/20 border-green-900/30 text-green-200'
                        : 'bg-red-950/20 border-red-900/30 text-red-200'
                    )}>
                      {run.success ? <CheckCircle2 size={11} className="text-green-400 shrink-0" /> : <XCircle size={11} className="text-red-400 shrink-0" />}
                      <span className="text-text-3 shrink-0">{new Date(run.startedAt).toLocaleString()}</span>
                      {run.statusCode > 0 && <span className="font-mono shrink-0">{run.statusCode}</span>}
                      <span className="text-text-4 shrink-0">{run.durationMs}ms</span>
                      {run.error && <span className="truncate text-red-300">{run.error}</span>}
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
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/runner/SchedulerPanel.tsx`
  - [ ] Left pane: job list with enable/disable toggle and delete
  - [ ] Status dot: green = enabled, gray = disabled
  - [ ] Right pane: name + cron + requestId editor with Save
  - [ ] Next-run time shown when job exists
  - [ ] Run history with pass/fail coloring
  - [ ] Auto-refresh every 10 s
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/runner/SchedulerPanel.tsx
  git commit -m "feat: add SchedulerPanel — job list, editor, history with 10s auto-refresh"
  ```

---

### Task 5: Wire into `RunnerPanel.tsx`

**Files:**
- Modify: `frontend/src/components/runner/RunnerPanel.tsx`

- [ ] **Step 1: Import and render `SchedulerPanel`**

  ```tsx
  import { SchedulerPanel } from './SchedulerPanel'
  ```

  Find the Scheduled tab content area (currently empty state) and replace with:

  ```tsx
  {activeTab === 'scheduled' && <SchedulerPanel />}
  ```

  **DoD:**
  - [ ] `SchedulerPanel` renders in the Scheduled tab
  - [ ] No empty state placeholder remains

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/runner/RunnerPanel.tsx
  git commit -m "feat: runner — wire SchedulerPanel into Scheduled tab"
  ```

  **DoD:**
  - [ ] Build exits 0, zero TypeScript errors

---

### Task 6: Smoke test

- [ ] **Step 1: Manual verification**

  Run `wails dev`. Open the Runner panel → Scheduled tab.

  **DoD:**
  - [ ] "+" button creates a new job; cron expression validates on save
  - [ ] Invalid cron (`* * * *`) shows error message without crashing
  - [ ] Valid job with `@every 10s` fires within 10 seconds; run appears in history
  - [ ] Disable/enable toggle pauses and resumes runs
  - [ ] Next-run countdown shown for enabled jobs
  - [ ] Jobs survive app restart (persisted in bbolt)
  - [ ] Deleting a job removes it from the list and stops future runs

