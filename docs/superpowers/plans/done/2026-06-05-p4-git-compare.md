# P4 — Git Compare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Add a "Compare" tab to the existing Git Sync panel that lets users pick two refs (branch, tag, or commit SHA), see the list of changed files with M/A/D/R status, and view per-file diffs using the existing DiffModal.

**Architecture:** The Go backend gains two new methods on the `GitSync` struct: `CompareRefs` (returns list of changed files) and `GetFileDiff` (returns unified diff text for one file). The frontend gets a new `GitCompareTab` component wired into `GitSyncPanel` via a tab bar. The diff display reuses the existing `DiffModal` from `DiffView.tsx`, passing the diff as left/right text.

**Tech Stack:** Go (exec git commands), TypeScript, React. **Depends on P2** (DiffModal improvements) being delivered first, but falls back cleanly if P2 hasn't shipped yet — the old DiffModal still works.

---

## File Map

| File | Change |
|------|--------|
| `internal/git/git.go` | Add `CompareRefs` and `GetFileDiff` functions |
| `git_bindings.go` | Add `CompareRefs` and `GetFileDiff` methods on `GitSync` struct |
| `frontend/src/lib/gitsync-api.ts` | Add `compareRefs` and `getFileDiff` wrapper functions |
| `frontend/src/components/workspace/GitCompareTab.tsx` | **New** — Compare tab UI |
| `frontend/src/components/workspace/GitSyncPanel.tsx` | Add Sync/Compare tab bar, render `GitCompareTab` |

---

## Feature Checklist

- [x] **Sync/Compare tab bar in GitSyncPanel**
  - **AC:** Two tabs at the top; Sync tab shows existing content unchanged; Compare tab shows the new UI
- [x] **Ref selector inputs + Compare button**
  - **AC:** Two text inputs (base/target ref); Compare button calls `CompareRefs`; loading state shown during call
- [x] **Changed files list with status icons**
  - **AC:** Files show M/A/D/R/C status letter in colour; clicking a file triggers diff load
- [x] **Summary bar**
  - **AC:** Shows total files changed, added count (green), modified count (yellow), deleted count (red)
- [x] **File diff modal**
  - **AC:** Clicking a file fetches diff and opens DiffModal with before/after content extracted from unified diff
- [x] **Go backend: CompareRefs and GetFileDiff**
  - **AC:** `CompareRefs` returns JSON array of `ChangedFile`; `GetFileDiff` returns raw unified diff string; both methods bound to `GitSync` struct

---

### Task 1: Add CompareRefs and GetFileDiff to the Go backend

**Files:**
- Modify: `internal/git/git.go`

- [x] **Step 1: Add `ChangedFile` struct**

  After the existing struct definitions (around line 60), add:

  ```go
  type ChangedFile struct {
      Status   string `json:"status"`   // M, A, D, R, C, U
      Path     string `json:"path"`
      OldPath  string `json:"oldPath"`  // only set for renames (R)
  }
  ```

  **DoD:**
  - [x] `ChangedFile` struct has `Status`, `Path`, `OldPath string` with correct JSON tags
  - [x] Go build passes: `go build ./... 2>&1`

- [x] **Step 2: Add `CompareRefs` function**

  ```go
  // CompareRefs returns files changed between refA and refB.
  // Uses: git diff --name-status refA refB
  func CompareRefs(repoPath, refA, refB string) ([]ChangedFile, error) {
      cmd := exec.Command("git", "-C", repoPath, "diff", "--name-status", refA, refB)
      out, err := cmd.Output()
      if err != nil {
          return nil, fmt.Errorf("git diff --name-status: %w", err)
      }
      var files []ChangedFile
      for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
          if line == "" {
              continue
          }
          parts := strings.Fields(line)
          if len(parts) < 2 {
              continue
          }
          status := parts[0]
          if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
              // Rename/copy: two paths
              oldPath := ""
              newPath := parts[len(parts)-1]
              if len(parts) >= 3 {
                  oldPath = parts[1]
              }
              files = append(files, ChangedFile{Status: string(status[0]), Path: newPath, OldPath: oldPath})
          } else {
              files = append(files, ChangedFile{Status: status, Path: parts[1]})
          }
      }
      return files, nil
  }
  ```

  **DoD:**
  - [x] Function signature: `CompareRefs(repoPath, refA, refB string) ([]ChangedFile, error)`
  - [x] Rename/copy status entries populate `OldPath`
  - [x] Empty lines in git output are skipped
  - [x] Go build passes

- [x] **Step 3: Add `GetFileDiff` function**

  ```go
  // GetFileDiff returns the unified diff for a single file between two refs.
  // Uses: git diff refA refB -- filePath
  func GetFileDiff(repoPath, refA, refB, filePath string) (string, error) {
      cmd := exec.Command("git", "-C", repoPath, "diff", refA, refB, "--", filePath)
      out, err := cmd.Output()
      if err != nil {
          // exit code 1 = no diff (identical) — treat as empty
          var exitErr *exec.ExitError
          if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
              return "", nil
          }
          return "", fmt.Errorf("git diff file: %w", err)
      }
      return string(out), nil
  }
  ```

  Add `"errors"` to the import block at the top of `git.go`.

  **DoD:**
  - [x] Function signature: `GetFileDiff(repoPath, refA, refB, filePath string) (string, error)`
  - [x] Exit code 1 from git (identical files) returns `("", nil)` — not an error
  - [x] `"errors"` package is imported
  - [x] Go build passes

- [x] **Step 4: Run Go tests**

  ```bash
  go test ./internal/git/... -v 2>&1 | tail -30
  ```

  Expected: existing tests pass. (No new unit tests needed — these functions shell out to git and require a real repo, which is an integration concern.)

  **DoD:**
  - [x] `go test ./internal/git/... -v` exits 0
  - [x] No existing tests broken

- [x] **Step 5: Commit**

  ```bash
  git add internal/git/git.go
  git commit -m "feat: git — add CompareRefs and GetFileDiff functions"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `internal/git/git.go` in the diff

---

### Task 2: Expose CompareRefs and GetFileDiff as Wails bindings

**Files:**
- Modify: `git_bindings.go`

- [x] **Step 1: Add `CompareRefs` method to `GitSync`**

  ```go
  func (g *GitSync) CompareRefs(repoPath, refA, refB string) (string, error) {
      if repoPath == "" {
          repoPath = g.defaultRepoPath()
      }
      files, err := git.CompareRefs(repoPath, refA, refB)
      if err != nil {
          return "", err
      }
      raw, _ := json.Marshal(files)
      return string(raw), nil
  }
  ```

  **DoD:**
  - [x] `GitSync.CompareRefs` method exists and marshals result to JSON string
  - [x] Uses `g.defaultRepoPath()` when `repoPath` is empty
  - [x] Go build passes

- [x] **Step 2: Add `GetFileDiff` method to `GitSync`**

  ```go
  func (g *GitSync) GetFileDiff(repoPath, refA, refB, filePath string) (string, error) {
      if repoPath == "" {
          repoPath = g.defaultRepoPath()
      }
      return git.GetFileDiff(repoPath, refA, refB, filePath)
  }
  ```

  **DoD:**
  - [x] `GitSync.GetFileDiff` method delegates to `git.GetFileDiff`
  - [x] Uses `g.defaultRepoPath()` when `repoPath` is empty
  - [x] Go build passes

- [x] **Step 3: Verify Wails binding registration**

  Open `main.go` or `app.go` and confirm `GitSync` is already registered with Wails. Look for something like `NewGitSync(...)` being passed to `wails.Run`. If it is already there, no change needed. If not, add it.

  **DoD:**
  - [x] `GitSync` struct is in the `Bind` slice in `main.go` or equivalent — confirmed by reading the file
  - [x] No duplicate binding

- [x] **Step 4: Regenerate Wails bindings**

  ```bash
  wails generate module
  ```

  Or run `wails dev` once — Wails auto-regenerates `frontend/wailsjs/go/main/GitSync.js` and `GitSync.d.ts` on startup.

  **DoD:**
  - [x] `frontend/wailsjs/go/main/GitSync.js` contains `CompareRefs` and `GetFileDiff` exports
  - [x] `frontend/wailsjs/go/main/GitSync.d.ts` has TypeScript types for both methods

- [x] **Step 5: Build check**

  ```bash
  go build ./... 2>&1
  ```

  Expected: no build errors.

  **DoD:**
  - [x] `go build ./...` exits 0
  - [x] Zero Go compilation errors

- [x] **Step 6: Commit**

  ```bash
  git add git_bindings.go
  git commit -m "feat: git bindings — expose CompareRefs and GetFileDiff to frontend"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `git_bindings.go` in the diff

---

### Task 3: Add frontend API wrappers

**Files:**
- Modify: `frontend/src/lib/gitsync-api.ts` (create if it doesn't exist)

- [x] **Step 1: Check if gitsync-api.ts exists**

  ```bash
  ls frontend/src/lib/gitsync-api.ts 2>/dev/null || echo "missing"
  ```

  If missing, create it. If it exists, add to it.

- [x] **Step 2: Add `compareRefs` wrapper**

  ```ts
  import * as GitSync from '@/wailsjs/go/main/GitSync'

  export interface ChangedFile {
    status: string   // M, A, D, R, C
    path: string
    oldPath: string
  }

  export async function compareRefs(
    repoPath: string,
    refA: string,
    refB: string,
  ): Promise<ChangedFile[]> {
    const raw = await GitSync.CompareRefs(repoPath, refA, refB)
    return JSON.parse(raw) as ChangedFile[]
  }

  export async function getFileDiff(
    repoPath: string,
    refA: string,
    refB: string,
    filePath: string,
  ): Promise<string> {
    return GitSync.GetFileDiff(repoPath, refA, refB, filePath)
  }
  ```

  **DoD:**
  - [x] `compareRefs` parses JSON response and returns `ChangedFile[]`
  - [x] `getFileDiff` returns `string` (raw unified diff)
  - [x] `ChangedFile` interface matches Go struct field names (camelCase)
  - [x] Build passes: `cd frontend && npm run build 2>&1 | tail -20`

- [x] **Step 3: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [x] **Step 4: Commit**

  ```bash
  git add frontend/src/lib/gitsync-api.ts
  git commit -m "feat: gitsync-api — add compareRefs and getFileDiff frontend wrappers"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `gitsync-api.ts` in the diff

---

### Task 4: Create GitCompareTab component

**Files:**
- Create: `frontend/src/components/workspace/GitCompareTab.tsx`

- [x] **Step 1: Create the file**

  (See plan for full component code)

  **DoD:**
  - [x] File created at `frontend/src/components/workspace/GitCompareTab.tsx`
  - [x] Renders ref inputs + Compare button + empty file list on mount
  - [x] After compare: summary bar shows total/added/modified/deleted counts
  - [x] File list shows status letter in correct colour (M=yellow, A=green, D=red, R=accent)
  - [x] Selected file row is highlighted
  - [x] Loading spinner appears on Compare button and on selected file row while loading diff
  - [x] Error message appears when compare or diff fetch fails
  - [x] DiffModal opens with extracted before/after content when file is clicked
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [x] **Step 3: Commit**

  ```bash
  git add frontend/src/components/workspace/GitCompareTab.tsx
  git commit -m "feat: add GitCompareTab component with file list and diff view"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `GitCompareTab.tsx` in the diff

---

### Task 5: Add Compare tab to GitSyncPanel

**Files:**
- Modify: `frontend/src/components/workspace/GitSyncPanel.tsx`

- [x] **Step 1: Import GitCompareTab**

  At the top of `GitSyncPanel.tsx`, add:

  ```ts
  import { GitCompareTab } from './GitCompareTab'
  ```

  **DoD:**
  - [x] Import resolves without error
  - [x] Build passes

- [x] **Step 2: Add tab state**

  Inside the `GitSyncPanel` component body, add:

  ```ts
  const [activeTab, setActiveTab] = useState<'sync' | 'compare'>('sync')
  ```

  **DoD:**
  - [x] `activeTab` defaults to `'sync'`
  - [x] Build passes

- [x] **Step 3: Add tab bar to the panel header**

  Find the panel's header/toolbar area at the top. After the title, add a tab bar.

  **DoD:**
  - [x] Sync and Compare tabs render in the panel header
  - [x] Active tab has `border-b-2 border-accent text-accent` styling
  - [x] Build passes

- [x] **Step 4: Conditionally render the Compare tab**

  **DoD:**
  - [x] When `activeTab === 'sync'`, existing GitSyncPanel content is unchanged
  - [x] When `activeTab === 'compare'`, `GitCompareTab` renders with correct `repoPath`
  - [x] Build passes

- [x] **Step 5: Add `cn` import if not already present**

  Check the top of `GitSyncPanel.tsx` — `cn` should already be imported from `@/lib/utils`. If not, add it.

- [x] **Step 6: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

- [x] **Step 7: Manual smoke test**

  Run `wails dev`. Go to Git Sync (under Local Data & Workspace → Git Sync). Verify:
  - A "Sync" and "Compare" tab appear at the top.
  - "Sync" tab shows the existing Git Sync content unchanged.
  - "Compare" tab shows ref inputs, a Compare button, and an empty file list.
  - Entering `HEAD~1` and `HEAD` and clicking Compare returns a file list if there are commits.
  - Clicking a file opens the DiffModal with before/after content.

  **DoD:**
  - [x] Sync and Compare tabs appear at the top of the Git Sync panel
  - [x] Sync tab shows existing content unchanged
  - [x] Compare tab shows ref inputs and Compare button
  - [x] Entering `HEAD~1` and `HEAD` and clicking Compare returns a file list (if commits exist)
  - [x] Clicking a file opens DiffModal with before/after text
  - [x] Clicking back to Sync tab — existing sync functionality still works

- [x] **Step 8: Commit**

  ```bash
  git add frontend/src/components/workspace/GitSyncPanel.tsx
  git commit -m "feat: git sync panel — add Compare tab with branch/commit diff"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `GitSyncPanel.tsx` in the diff
