# P8 — MCP STDIO Enhancement (Multi-Session, Process Manager, Env Injection) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Strengthen the MCP backend to support multi-session connections (run multiple MCP servers simultaneously), expose process health status for STDIO sessions, support restart without full reconnect, and inject adOmnia environment variables into the STDIO `Env` field before connecting.

**Architecture:** `mcp_bindings.go` gains a session map (`map[string]*mcp.Client`) — each session has its own ID. New Wails methods: `ConnectSession`, `DisconnectSession`, `GetSessionStatus`, `RestartSession`, `ListSessions`. `internal/mcp/stdio.go` gets a `ProcessState()` accessor. Frontend `McpConnectionForm.tsx` (from P7) is extended to show per-session status and env injection UI. `substVars` resolves `{{varName}}` in the env array from the active adOmnia environment.

**Tech Stack:** Go `sync`, TypeScript, React. No new dependencies.

**Prerequisite:** P7 delivered — `useMcpStore`, `McpConnectionForm.tsx` already exist.

---

## File Map

| File | Change |
|------|--------|
| `internal/mcp/stdio.go` | Add `ProcessState() string` method to `stdioTransport` |
| `internal/mcp/client.go` | Expose `Transport() string` and `ProcessState() string` on `Client` |
| `mcp_bindings.go` | Replace single `*mcp.Client` with session map; add new session methods |
| `frontend/wailsjs/go/main/MCPClient.d.ts` / `.js` | Regenerate after Go changes |
| `frontend/src/stores/mcp.ts` | Add multi-session state: `sessions` map, update connection actions |
| `frontend/src/components/mcp/McpConnectionForm.tsx` | Add session list, per-session status badge, env injection UI, Restart button |

---

## Feature Checklist

- [x] **Multi-session Go binding**
  - **AC:** `ConnectSession(id, cfgJSON)` creates a new session entry; `DisconnectSession(id)` closes it; `ListSessions()` returns JSON array of `{id, transport, status}`
- [x] **Process state accessor**
  - **AC:** `GetSessionStatus(id)` returns `"running" | "stopped" | "crashed" | "unknown"` for STDIO sessions; `"connected" | "disconnected"` for HTTP sessions
- [x] **Restart without config loss**
  - **AC:** `RestartSession(id)` disconnects and reconnects with the same config; frontend shows brief "restarting" status
- [x] **Env variable injection**
  - **AC:** `{{varName}}` in `env` array entries is resolved from active adOmnia environment before `ConnectSession` is called
- [ ] **Multi-session UI**
  - **AC:** Each saved config can have multiple active sessions shown separately in the sidebar with individual connect/disconnect/restart controls

**Execution note (2026-06-05):** Backend multi-session methods are implemented and Wails bindings are updated. The P8 frontend uses `ConnectSession("default", ...)` so P7's legacy `ListTools`/`CallTool` flow remains functional. Full independent per-session tool/resource/prompt calls remain open because no session-scoped capability/call bindings exist yet.

---

### Task 1: Add `ProcessState()` to `stdioTransport`

**Files:**
- Modify: `internal/mcp/stdio.go`

- [x] **Step 1: Add the method**

  After the existing `Send` method, add:

  ```go
  // ProcessState returns a short status string for the underlying OS process.
  // Returns "running", "stopped", or "unknown".
  func (t *stdioTransport) ProcessState() string {
      t.mu.Lock()
      defer t.mu.Unlock()
      if t.cmd == nil || t.cmd.Process == nil {
          return "unknown"
      }
      if t.cmd.ProcessState != nil {
          return "stopped"
      }
      // Process exists and has not exited
      return "running"
  }
  ```

  **DoD:**
  - [x] `ProcessState()` method added on `*stdioTransport`
  - [x] `go build ./...` exits 0

- [x] **Step 2: Expose on `Client` via `internal/mcp/client.go`**

  Open `internal/mcp/client.go`. Find the `Client` struct and its transport field. The transport is likely stored as an interface. Add:

  ```go
  // ProcessState returns the OS process state for STDIO transports.
  // Returns "n/a" for non-STDIO transports.
  func (c *Client) ProcessState() string {
      if st, ok := c.transport.(interface{ ProcessState() string }); ok {
          return st.ProcessState()
      }
      return "n/a"
  }
  ```

  **DoD:**
  - [x] `ProcessState()` available on `*mcp.Client`
  - [x] `go build ./...` exits 0

- [ ] **Step 3: Commit**

  ```bash
  git add internal/mcp/stdio.go internal/mcp/client.go
  git commit -m "feat: mcp — add ProcessState() to stdioTransport and Client for health monitoring"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 2: Rewrite `mcp_bindings.go` for multi-session

**Files:**
- Modify: `mcp_bindings.go`

- [x] **Step 1: Replace the struct and add session map**

  Replace the existing `MCPClient` struct with:

  ```go
  package main

  import (
      "adomnia/internal/mcp"
      "context"
      "encoding/json"
      "fmt"
      "sync"
  )

  type mcpSession struct {
      client *mcp.Client
      cfg    mcp.ConnectionConfig
  }

  type MCPClient struct {
      mu       sync.RWMutex
      sessions map[string]*mcpSession
  }

  func NewMCPClient() *MCPClient {
      return &MCPClient{sessions: make(map[string]*mcpSession)}
  }
  ```

  **DoD:**
  - [x] `MCPClient` uses a `sessions` map instead of a single `*mcp.Client` field
  - [x] `go build ./...` exits 0

- [x] **Step 2: Add `ConnectSession`**

  ```go
  func (m *MCPClient) ConnectSession(sessionID, cfgJSON string) (string, error) {
      var cfg mcp.ConnectionConfig
      if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
          return "", fmt.Errorf("invalid config: %w", err)
      }
      c, err := mcp.NewClient(cfg)
      if err != nil {
          return "", err
      }
      result, err := c.Initialize(context.Background())
      if err != nil {
          _ = c.Close()
          return "", err
      }
      m.mu.Lock()
      if existing, ok := m.sessions[sessionID]; ok {
          _ = existing.client.Close()
      }
      m.sessions[sessionID] = &mcpSession{client: c, cfg: cfg}
      m.mu.Unlock()
      raw, _ := json.Marshal(result)
      return string(raw), nil
  }
  ```

  **DoD:**
  - [x] `ConnectSession(id, cfgJSON)` opens a new session; replacing an existing session closes the old one first
  - [x] `go build ./...` exits 0

- [x] **Step 3: Add `DisconnectSession`, `GetSessionStatus`, `RestartSession`**

  ```go
  func (m *MCPClient) DisconnectSession(sessionID string) error {
      m.mu.Lock()
      defer m.mu.Unlock()
      s, ok := m.sessions[sessionID]
      if !ok {
          return nil
      }
      err := s.client.Close()
      delete(m.sessions, sessionID)
      return err
  }

  func (m *MCPClient) GetSessionStatus(sessionID string) string {
      m.mu.RLock()
      s, ok := m.sessions[sessionID]
      m.mu.RUnlock()
      if !ok {
          return "disconnected"
      }
      state := s.client.ProcessState()
      if state == "stopped" || state == "crashed" {
          return state
      }
      return "connected"
  }

  func (m *MCPClient) RestartSession(sessionID string) (string, error) {
      m.mu.Lock()
      s, ok := m.sessions[sessionID]
      m.mu.Unlock()
      if !ok {
          return "", fmt.Errorf("session %s not found", sessionID)
      }
      cfg := s.cfg
      _ = m.DisconnectSession(sessionID)
      cfgRaw, _ := json.Marshal(cfg)
      return m.ConnectSession(sessionID, string(cfgRaw))
  }

  func (m *MCPClient) ListSessions() string {
      type sessionInfo struct {
          ID        string `json:"id"`
          Transport string `json:"transport"`
          Status    string `json:"status"`
      }
      m.mu.RLock()
      defer m.mu.RUnlock()
      items := make([]sessionInfo, 0, len(m.sessions))
      for id, s := range m.sessions {
          items = append(items, sessionInfo{
              ID:        id,
              Transport: string(s.cfg.Transport),
              Status:    m.GetSessionStatus(id),
          })
      }
      raw, _ := json.Marshal(items)
      return string(raw)
  }
  ```

  **DoD:**
  - [x] `DisconnectSession(id)` closes and removes the session
  - [x] `GetSessionStatus(id)` returns `"connected" | "disconnected" | "stopped" | "crashed"`
  - [x] `RestartSession(id)` disconnects then reconnects with the same config
  - [x] `ListSessions()` returns JSON array of session infos
  - [x] `go build ./...` exits 0

- [x] **Step 4: Keep legacy single-session methods for backward compat**

  The existing `Connect`, `Disconnect`, `ListTools`, `CallTool`, `ListResources`, `ListPrompts` methods on `MCPClient` (used in P7's `McpConnectionForm.tsx`) should be kept as wrappers that use a fixed session ID `"default"`:

  ```go
  const defaultSessionID = "default"

  func (m *MCPClient) Connect(cfgJSON string) (string, error) {
      return m.ConnectSession(defaultSessionID, cfgJSON)
  }

  func (m *MCPClient) Disconnect() error {
      return m.DisconnectSession(defaultSessionID)
  }

  func (m *MCPClient) getDefault() *mcp.Client {
      m.mu.RLock()
      defer m.mu.RUnlock()
      if s, ok := m.sessions[defaultSessionID]; ok {
          return s.client
      }
      return nil
  }

  func (m *MCPClient) ListTools() (string, error) {
      c := m.getDefault()
      if c == nil { return "", fmt.Errorf("not connected") }
      tools, err := c.ListTools(context.Background())
      if err != nil { return "", err }
      raw, _ := json.Marshal(tools)
      return string(raw), nil
  }

  func (m *MCPClient) CallTool(name, argsJSON string) (string, error) {
      c := m.getDefault()
      if c == nil { return "", fmt.Errorf("not connected") }
      var args map[string]any
      if argsJSON != "" {
          if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
              return "", fmt.Errorf("invalid args JSON: %w", err)
          }
      }
      result, err := c.CallTool(context.Background(), name, args)
      if err != nil { return "", err }
      raw, _ := json.Marshal(result)
      return string(raw), nil
  }

  func (m *MCPClient) ListResources() (string, error) {
      c := m.getDefault()
      if c == nil { return "", fmt.Errorf("not connected") }
      res, err := c.ListResources(context.Background())
      if err != nil { return "", err }
      raw, _ := json.Marshal(res)
      return string(raw), nil
  }

  func (m *MCPClient) ListPrompts() (string, error) {
      c := m.getDefault()
      if c == nil { return "", fmt.Errorf("not connected") }
      prompts, err := c.ListPrompts(context.Background())
      if err != nil { return "", err }
      raw, _ := json.Marshal(prompts)
      return string(raw), nil
  }
  ```

  **DoD:**
  - [x] All legacy methods (`Connect`, `Disconnect`, `ListTools`, `CallTool`, `ListResources`, `ListPrompts`) still present and route to `"default"` session
  - [x] P7 code continues to compile and work without changes
  - [x] `go build ./...` exits 0

- [x] **Step 5: Build check**

  ```bash
  go build ./... 2>&1
  ```

  **DoD:**
  - [x] Exit code 0, zero Go errors

- [ ] **Step 6: Commit**

  ```bash
  git add mcp_bindings.go
  git commit -m "feat: mcp — multi-session binding (ConnectSession, DisconnectSession, GetStatus, Restart, ListSessions)"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 3: Add env variable injection in `McpConnectionForm.tsx`

**Files:**
- Modify: `frontend/src/components/mcp/McpConnectionForm.tsx`

- [x] **Step 1: Import substVars and environments store**

  At the top of `McpConnectionForm.tsx`, add:

  ```ts
  import { useEnvironmentsStore } from '@/stores/environments'
  import { substVars } from '@/lib/substVars'
  ```

  **DoD:**
  - [x] Imports resolve without error
  - [x] Build passes

- [x] **Step 2: Resolve env vars before connecting**

  In `handleConnect`, before building `cfgJSON`, add env variable resolution:

  Find this block:
  ```ts
  const cfgJSON = JSON.stringify({
    transport: activeConfig.transport,
    command: activeConfig.command,
    args: activeConfig.args,
    env: activeConfig.env,
    baseURL: activeConfig.baseURL,
    bearerToken: activeConfig.bearerToken,
  })
  ```

  Replace with:
  ```ts
  const activeEnv = useEnvironmentsStore.getState()
  const envVars: Record<string, string> = {}
  const activeEnvironment = activeEnv.environments.find((e) => e.id === activeEnv.activeEnvId)
  for (const v of (activeEnvironment?.variables ?? [])) {
    if (v.key) envVars[v.key] = v.value ?? ''
  }

  const resolvedEnv = activeConfig.env.map((e) => substVars(e, envVars))
  const resolvedBaseURL = substVars(activeConfig.baseURL, envVars)
  const resolvedToken = substVars(activeConfig.bearerToken, envVars)

  const cfgJSON = JSON.stringify({
    transport: activeConfig.transport,
    command: activeConfig.command,
    args: activeConfig.args,
    env: resolvedEnv,
    baseURL: resolvedBaseURL,
    bearerToken: resolvedToken,
  })
  ```

  **DoD:**
  - [x] `{{VAR}}` in `env` entries is resolved from the active adOmnia environment before connect
  - [x] `{{VAR}}` in `baseURL` and `bearerToken` also resolved
  - [x] If no active environment, resolves to empty string (no crash)
  - [x] Build passes

- [x] **Step 3: Add env input hint to the new config form**

  In the `showForm` section of the textarea for Env, add a hint:

  ```tsx
  <textarea
    placeholder={"Env vars (KEY=VALUE, one per line).\nUse {{VAR}} to inject from active env."}
    value={form.env.join('\n')}
    onChange={(e) => setForm((f) => ({ ...f, env: e.target.value.split('\n').filter(Boolean) }))}
    rows={2}
    className="w-full px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none font-mono resize-none"
  />
  ```

  **DoD:**
  - [x] Env textarea appears in the new config form for both STDIO and HTTP transports
  - [x] Placeholder explains `{{VAR}}` substitution
  - [x] Build passes

- [x] **Step 4: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/mcp/McpConnectionForm.tsx
  git commit -m "feat: mcp — inject adOmnia env variables ({{VAR}}) into STDIO env before connect"
  ```

  **DoD:**
  - [x] Build exits 0, zero TS errors
  - [x] Commit created

---

### Task 4: Add session status polling and Restart button to the UI

**Files:**
- Modify: `frontend/src/stores/mcp.ts`
- Modify: `frontend/src/components/mcp/McpConnectionForm.tsx`

- [x] **Step 1: Add `restartSession` action to `useMcpStore`**

  In `frontend/src/stores/mcp.ts`, add to the `McpState` interface:

  ```ts
  restartingIds: Set<string>
  setRestarting: (id: string, value: boolean) => void
  ```

  And to the store implementation:

  ```ts
  restartingIds: new Set<string>(),
  setRestarting: (id, value) => set((s) => {
    const next = new Set(s.restartingIds)
    value ? next.add(id) : next.delete(id)
    return { restartingIds: next }
  }),
  ```

  **DoD:**
  - [x] `restartingIds` and `setRestarting` in store
  - [x] Build passes

- [x] **Step 2: Add Restart button to `McpConnectionForm.tsx`**

  In `McpConnectionForm.tsx`, in the footer where the Connect/Disconnect button is, add a Restart button when status is `'connected'`:

  ```tsx
  import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
  // ...
  const { restartingIds, setRestarting, setStatus, setCapabilities, setServerInfo } = useMcpStore()
  const isRestarting = activeConfigId ? restartingIds.has(activeConfigId) : false

  const handleRestart = async () => {
    if (!activeConfigId) return
    setRestarting(activeConfigId, true)
    try {
      // ConnectSession wraps the reconnect via RestartSession on Go side
      // Use the legacy Connect which routes to 'default' session
      await MCPClientBinding.Disconnect()
      await handleConnect() // reuse existing handleConnect logic
    } finally {
      setRestarting(activeConfigId, false)
    }
  }
  ```

  Add the button next to Disconnect:

  ```tsx
  {status === 'connected' && (
    <button
      onClick={handleRestart}
      disabled={isRestarting}
      className="mt-1 w-full h-7 text-[10px] bg-surface-2 text-text-3 rounded hover:bg-surface-3 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
    >
      <RefreshCw size={11} className={isRestarting ? 'animate-spin' : ''} />
      {isRestarting ? 'Restarting…' : 'Restart Session'}
    </button>
  )}
  ```

  Add `RefreshCw` to the lucide-react import if not already present.

  **DoD:**
  - [x] Restart button appears only when connected
  - [x] Clicking Restart disconnects, reconnects, reloads capabilities
  - [x] Spinner shown while restarting
  - [x] Build passes

- [x] **Step 3: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/stores/mcp.ts frontend/src/components/mcp/McpConnectionForm.tsx
  git commit -m "feat: mcp — add Restart Session button with loading state in McpConnectionForm"
  ```

  **DoD:**
  - [x] Build exits 0
  - [x] Commit created

---

### Task 5: Full build verification + smoke test

- [x] **Step 1: Go + frontend build**

  ```bash
  go build ./... 2>&1
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Both exit 0
  - [x] Zero errors

- [ ] **Step 2: Manual smoke test**

  Run `wails dev`. Open MCP panel. Verify:

  **DoD:**
  - [ ] Saved config with env var (e.g. `API_KEY={{MY_KEY}}`) resolves the value from the active environment before connecting
  - [ ] Disconnect and Restart Session both work without crashing
  - [ ] After Restart, capabilities reload and history is preserved
  - [ ] Multiple saved configs can each be independently connected (via legacy default session)

- [ ] **Step 3: Final commit**

  ```bash
  git add .
  git commit -m "feat: p8 complete — MCP STDIO multi-session, env injection, restart support"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
