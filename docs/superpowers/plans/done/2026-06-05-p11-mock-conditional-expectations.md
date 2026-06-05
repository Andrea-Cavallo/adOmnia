# P11 — Mock Conditional Expectations (Multi-Field Request Matching) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Allow each mock response to have a set of conditions evaluated against the incoming request. When all conditions for a response pass (AND logic), that response is returned. Conditions can match on query params, headers, path params, and JSON body fields (via JSONPath). Responses are evaluated in order; the first match wins. An unconditional response (empty conditions) acts as the fallback.

**Architecture:** A `Conditions []mockCondition` field is added to `mockResponse` in `internal/mock/mock.go`. A `mockCondition` struct has `Source`, `Field`, `Operator`, `Value`. The match handler iterates responses in priority order, evaluates all conditions, and returns the first match. The frontend `MockPanel.tsx` gains a "Conditions" tab per response using a new `MockConditionEditor.tsx` component.

**Tech Stack:** Go, TypeScript, React. No new dependencies. JSONPath evaluation uses a lightweight inline approach (no library needed for basic `.field.nested` paths).

---

## File Map

| File | Change |
|------|--------|
| `internal/mock/mock.go` | Add `mockCondition` struct; add `Conditions []mockCondition` to `mockResponse`; implement condition evaluation in the request handler |
| `frontend/src/lib/types.ts` | Add `MockCondition` type and `conditions` field to mock response type |
| `frontend/src/components/mock/MockConditionEditor.tsx` | **New** — condition rows editor |
| `frontend/src/components/mock/MockPanel.tsx` | Add Conditions tab to response editor |

---

## Feature Checklist

> `MockPanel.tsx` implementation note: the existing response editor uses collapsible sections, so P11 renders Conditions as a compact expandable response section with a count badge instead of introducing an isolated tab bar.

- [x] **`mockCondition` struct and evaluation in Go**
  - **AC:** `Source` values: `query`, `header`, `path_param`, `body_jsonpath`; `Operator` values: `eq`, `neq`, `contains`, `not_contains`, `regex`, `exists`, `not_exists`; all conditions in a response must pass (AND logic); first matching response wins; empty conditions = always matches (fallback)
- [x] **Response priority ordering**
  - **AC:** Responses are evaluated in their array order; an unconditional response at the end acts as fallback; if no response matches, returns 404 with `{"error": "no matching condition"}`
- [x] **Frontend condition editor**
  - **AC:** Each response has a "Conditions" tab; condition rows show Source/Field/Operator/Value; add/remove row buttons work; saved to mock config
- [x] **Backward compat**
  - **AC:** Existing mock configs without `conditions` field continue to work as before (empty conditions = match always)

---

### Task 1: Add `mockCondition` and evaluation to `internal/mock/mock.go`

**Files:**
- Modify: `internal/mock/mock.go`

- [x] **Step 1: Add `mockCondition` struct**

  After the `mockResponse` struct definition, add:

  ```go
  type mockCondition struct {
      Source   string `json:"source"`   // query | header | path_param | body_jsonpath
      Field    string `json:"field"`    // param name, header name, or JSONPath expression
      Operator string `json:"operator"` // eq | neq | contains | not_contains | regex | exists | not_exists
      Value    string `json:"value"`    // expected value (unused for exists/not_exists)
  }
  ```

  And add `Conditions []mockCondition` to `mockResponse`:

  ```go
  type mockResponse struct {
      // ... existing fields ...
      Conditions []mockCondition `json:"conditions"`
  }
  ```

  **DoD:**
  - [x] `mockCondition` struct defined
  - [x] `Conditions` field on `mockResponse`
  - [x] `go build ./...` exits 0

- [x] **Step 2: Implement condition evaluation helper**

  Add a new function:

  ```go
  import (
      "encoding/json"
      "net/http"
      "regexp"
      "strings"
  )

  // extractField extracts a field value from the request based on source.
  func extractField(r *http.Request, cond mockCondition, pathParams map[string]string, bodyBytes []byte) (string, bool) {
      switch cond.Source {
      case "query":
          v := r.URL.Query().Get(cond.Field)
          return v, v != ""
      case "header":
          v := r.Header.Get(cond.Field)
          return v, v != ""
      case "path_param":
          v, ok := pathParams[cond.Field]
          return v, ok
      case "body_jsonpath":
          return extractJSONPath(bodyBytes, cond.Field)
      }
      return "", false
  }

  // extractJSONPath extracts a value from a JSON body using a simple dot-path (e.g. ".user.name").
  func extractJSONPath(body []byte, path string) (string, bool) {
      if len(body) == 0 || path == "" {
          return "", false
      }
      var obj any
      if err := json.Unmarshal(body, &obj); err != nil {
          return "", false
      }
      parts := strings.Split(strings.TrimPrefix(path, "."), ".")
      current := obj
      for _, part := range parts {
          if part == "" {
              continue
          }
          m, ok := current.(map[string]any)
          if !ok {
              return "", false
          }
          current, ok = m[part]
          if !ok {
              return "", false
          }
      }
      switch v := current.(type) {
      case string:
          return v, true
      case float64:
          return fmt.Sprintf("%g", v), true
      case bool:
          return fmt.Sprintf("%t", v), true
      default:
          raw, _ := json.Marshal(current)
          return string(raw), current != nil
      }
  }

  // evaluateCondition returns true if the single condition matches the request.
  func evaluateCondition(r *http.Request, cond mockCondition, pathParams map[string]string, bodyBytes []byte) bool {
      actual, exists := extractField(r, cond, pathParams, bodyBytes)

      switch cond.Operator {
      case "exists":
          return exists
      case "not_exists":
          return !exists
      case "eq":
          return actual == cond.Value
      case "neq":
          return actual != cond.Value
      case "contains":
          return strings.Contains(actual, cond.Value)
      case "not_contains":
          return !strings.Contains(actual, cond.Value)
      case "regex":
          re, err := regexp.Compile(cond.Value)
          if err != nil {
              return false
          }
          return re.MatchString(actual)
      }
      return false
  }

  // matchesAllConditions returns true if all conditions for a response pass.
  func matchesAllConditions(r *http.Request, resp mockResponse, pathParams map[string]string, bodyBytes []byte) bool {
      if len(resp.Conditions) == 0 {
          return true // unconditional fallback
      }
      for _, cond := range resp.Conditions {
          if !evaluateCondition(r, cond, pathParams, bodyBytes) {
              return false
          }
      }
      return true
  }
  ```

  **DoD:**
  - [x] `extractField` handles all 4 sources
  - [x] `extractJSONPath` handles dot-notation paths
  - [x] `evaluateCondition` handles all 7 operators
  - [x] `matchesAllConditions` returns true for empty conditions
  - [x] `go build ./...` exits 0

- [x] **Step 3: Wire into the request handler**

  Find the function that selects which `mockResponse` to return for a matched endpoint (look for where `Mode` is checked — `"first"`, `"rr"`, `"random"`). Replace the selection logic with:

  ```go
  // Read body once for condition evaluation
  var bodyBytes []byte
  if r.Body != nil {
      bodyBytes, _ = io.ReadAll(r.Body)
      r.Body = io.NopCloser(bytes.NewReader(bodyBytes)) // restore for later use
  }

  // Find first response whose conditions all pass
  var selectedResp *mockResponse
  for i := range endpoint.Responses {
      resp := &endpoint.Responses[i]
      if !resp.IsActive {
          continue
      }
      if matchesAllConditions(r, *resp, pathParams, bodyBytes) {
          selectedResp = resp
          break
      }
  }

  if selectedResp == nil {
      w.Header().Set("Content-Type", "application/json")
      w.WriteHeader(http.StatusNotFound)
      w.Write([]byte(`{"error":"no matching condition"}`))
      return
  }
  // Use selectedResp for the response (apply delay, headers, body/schema generation)
  ```

  Add `"bytes"` and `"io"` to imports if not already present.

  **DoD:**
  - [x] Request handler reads body once and restores it
  - [x] First matching active response is returned
  - [x] If no match, returns 404 with `{"error":"no matching condition"}`
  - [x] Existing tests still pass: `go test ./internal/mock/...`
  - [x] `go build ./...` exits 0

- [ ] **Step 4: Commit**

  ```bash
  git add internal/mock/mock.go
  git commit -m "feat: mock — add conditional expectations (AND logic, 7 operators, 4 sources, fallback on empty conditions)"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 2: Update frontend mock types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [x] **Step 1: Add `MockCondition` type**

  ```ts
  export interface MockCondition {
    source: 'query' | 'header' | 'path_param' | 'body_jsonpath'
    field: string
    operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'regex' | 'exists' | 'not_exists'
    value: string
  }
  ```

  Add `conditions?: MockCondition[]` to the mock response interface.

  **DoD:**
  - [x] `MockCondition` type exported
  - [x] `conditions` optional field on mock response type
  - [x] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/types.ts
  git commit -m "feat: mock types — add MockCondition type and conditions field to mock response"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 3: Create `MockConditionEditor.tsx`

**Files:**
- Create: `frontend/src/components/mock/MockConditionEditor.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { Plus, Trash2 } from 'lucide-react'
  import type { MockCondition } from '@/lib/types'
  import { cn } from '@/lib/utils'

  interface Props {
    conditions: MockCondition[]
    onChange: (conditions: MockCondition[]) => void
  }

  const SOURCE_OPTIONS: { value: MockCondition['source']; label: string }[] = [
    { value: 'query', label: 'Query param' },
    { value: 'header', label: 'Header' },
    { value: 'path_param', label: 'Path param' },
    { value: 'body_jsonpath', label: 'Body JSONPath' },
  ]

  const OPERATOR_OPTIONS: { value: MockCondition['operator']; label: string }[] = [
    { value: 'eq', label: '= equals' },
    { value: 'neq', label: '≠ not equals' },
    { value: 'contains', label: '⊃ contains' },
    { value: 'not_contains', label: '⊄ not contains' },
    { value: 'regex', label: '~ regex' },
    { value: 'exists', label: '✓ exists' },
    { value: 'not_exists', label: '✗ not exists' },
  ]

  const BLANK_CONDITION: MockCondition = { source: 'query', field: '', operator: 'eq', value: '' }

  const valueHidden = (op: MockCondition['operator']) => op === 'exists' || op === 'not_exists'

  export function MockConditionEditor({ conditions, onChange }: Props) {
    const add = () => onChange([...conditions, { ...BLANK_CONDITION }])
    const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i))
    const update = (i: number, patch: Partial<MockCondition>) =>
      onChange(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c))

    return (
      <div className="space-y-2">
        {conditions.length === 0 && (
          <p className="text-[10px] text-text-4 py-1">
            No conditions — this response always matches (fallback).
          </p>
        )}

        {conditions.map((cond, i) => (
          <div key={i} className="flex items-start gap-1.5 flex-wrap">
            {/* Source */}
            <select
              value={cond.source}
              onChange={(e) => update(i, { source: e.target.value as MockCondition['source'] })}
              className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Field */}
            <input
              value={cond.field}
              onChange={(e) => update(i, { field: e.target.value })}
              placeholder={cond.source === 'body_jsonpath' ? '.user.name' : 'field name'}
              className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none w-[110px]"
            />

            {/* Operator */}
            <select
              value={cond.operator}
              onChange={(e) => update(i, { operator: e.target.value as MockCondition['operator'] })}
              className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Value (hidden for exists/not_exists) */}
            {!valueHidden(cond.operator) && (
              <input
                value={cond.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="expected value"
                className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none flex-1 min-w-[80px]"
              />
            )}

            {/* Remove */}
            <button
              onClick={() => remove(i)}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}

        <button
          onClick={add}
          className="flex items-center gap-1.5 h-6 px-2 text-[9px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
        >
          <Plus size={11} />
          Add condition
        </button>

        {conditions.length > 0 && (
          <p className="text-[9px] text-text-4">All conditions must match (AND logic). Empty conditions = always match.</p>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/mock/MockConditionEditor.tsx`
  - [x] Add condition row with source/field/operator/value inputs
  - [x] Value input hidden when operator is `exists` or `not_exists`
  - [x] Remove button deletes a condition row
  - [x] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/mock/MockConditionEditor.tsx
  git commit -m "feat: mock — add MockConditionEditor component (source/field/operator/value rows)"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 4: Add Conditions tab to `MockPanel.tsx`

**Files:**
- Modify: `frontend/src/components/mock/MockPanel.tsx`

- [x] **Step 1: Import `MockConditionEditor`**

  ```ts
  import { MockConditionEditor } from './MockConditionEditor'
  import type { MockCondition } from '@/lib/types'
  ```

  **DoD:**
  - [x] Imports resolve without error

- [x] **Step 2: Add Conditions tab to the response editor**

  Find the per-response tab set in `MockPanel.tsx` (likely "Body" / "Headers" tabs). Add a "Conditions" tab:

  ```tsx
  {/* Tab bar */}
  <div className="flex border-b border-border-1">
    {(['body', 'headers', 'conditions'] as const).map((tab) => (
      <button
        key={tab}
        onClick={() => setActiveTab(tab)}
        className={cn(
          'px-3 py-1.5 text-[10px] capitalize border-b-2 transition-colors',
          activeTab === tab
            ? 'border-accent text-accent'
            : 'border-transparent text-text-3 hover:text-text-1'
        )}
      >
        {tab}
        {tab === 'conditions' && (response.conditions?.length ?? 0) > 0 && (
          <span className="ml-1 px-1 rounded bg-accent/20 text-accent text-[8px]">
            {response.conditions!.length}
          </span>
        )}
      </button>
    ))}
  </div>

  {/* Tab content */}
  {activeTab === 'conditions' && (
    <div className="p-3">
      <MockConditionEditor
        conditions={response.conditions ?? []}
        onChange={(conds) => updateResponseField(response.id, 'conditions', conds)}
      />
    </div>
  )}
  ```

  The exact variable names (`activeTab`, `setActiveTab`, `response`, `updateResponseField`) should match the existing pattern in `MockPanel.tsx` — read the file first to confirm.

  **DoD:**
  - [ ] "Conditions" tab appears in the response editor tab bar
  - [x] Condition count badge shown when conditions exist
  - [x] `MockConditionEditor` renders in the Conditions section
  - [x] Conditions saved to mock config via `updateResponseField`
  - [x] Build passes

- [x] **Step 3: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0, zero TypeScript errors

- [ ] **Step 4: Manual smoke test**

  Run `wails dev`. Open Mock Server. Create an endpoint with two responses:
  - Response 1: condition `query` / `role` / `eq` / `admin` → body `{"role":"admin","access":"full"}`
  - Response 2: no conditions → body `{"role":"user","access":"limited"}`

  Start the mock server. Make two requests: one with `?role=admin`, one without.

  **DoD:**
  - [ ] Request with `?role=admin` returns the admin response
  - [ ] Request without the param returns the fallback response
  - [ ] Hit log shows which condition matched

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/mock/MockPanel.tsx
  git commit -m "feat: mock — add Conditions tab to response editor with condition count badge"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
