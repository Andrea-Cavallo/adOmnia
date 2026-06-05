# P15 — Response Schema Validation (Auto-Validate vs OAS Schema) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** After each HTTP response arrives, automatically validate it against the OAS schema for that endpoint (status code match, body structure, required fields, types, enums) and display validation results in a dedicated "Schema" tab in the response panel.

**Current State:** `frontend/src/lib/contractValidator.ts` already has a full AJV-based validator — it takes the response + spec string + path + method and returns `ContractValidationResult`. It is NOT currently wired to the automatic response flow. `executeRequest.ts` runs pre/post scripts and assertions but does not call the validator.

**Prerequisites:** P12 (collections with `_openapiSpec`) and P13 (`schemaResolver.ts`) help, but P15 is independently executable — it reads `_openapiSpec` directly from the active collection.

**Tech Stack:** TypeScript, React, AJV (already installed). No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/stores/settings.ts` | Add `autoValidateSchema: boolean` to `requests` block |
| `frontend/src/components/settings/SettingsPanel.tsx` | Add toggle in Requests section |
| `frontend/src/lib/executeRequest.ts` | Call `contractValidator` after response, attach result |
| `frontend/src/lib/types.ts` | Add `schemaValidation?: ContractValidationResult` to `ExecuteRequestResult` |
| `frontend/src/components/response/SchemaValidationTab.tsx` | **New** — validation results UI |
| `frontend/src/components/response/ResponsePanel.tsx` | Add Schema tab |

---

> **EXECUTION NOTE (2026-06-05):** The plan's premise was **outdated**. Response schema
> validation is ALREADY fully wired in `ResponsePanel.tsx`:
> - `validateContract(oaSpec, oaPath, oaMethod, response)` runs automatically via `useMemo`.
> - A **"Contract" tab** already shows a valid/error badge, lists violations
>   (`category`/`message`/`detail`), warnings, and even exports MD/HTML/JSON reports
>   (`ContractResultView`) — richer than the plan's proposed `SchemaValidationTab`.
> - `runnerEngine.ts` also calls `validateContract`. The real function is `validateContract`,
>   not `validateResponse`; result type is `{ valid, errors, warnings, hasSpec }` with errors
>   of shape `{ category, message, detail }` (no `path`/`expected`).
>
> To avoid a duplicate competing "Schema" tab, the **only genuine gap** — a user control — was
> implemented:
> - Added `settings.requests.autoValidateSchema` (**default `true`** to preserve existing
>   behavior; the plan's `false` would have hidden working UI = a regression).
> - Added the Settings → Requests toggle (EN + IT i18n keys).
> - `ResponsePanel` now gates the existing contract validation on the setting.
> - `executeRequest.ts` / `ExecuteRequestResult.schemaValidation` / a new `SchemaValidationTab`
>   were **not** created — they would duplicate the existing Contract tab.

## Feature Checklist

- [x] **Settings toggle `autoValidateSchema`**
  - **AC:** `settings.requests.autoValidateSchema` (default `true`, see note); toggle visible in Settings → Requests; persists across restarts
- [x] **Validation wired to the response flow** *(pre-existing in ResponsePanel, now gated)*
  - **AC:** When `autoValidateSchema` is `true` and `oaSpec`/`oaPath` are available, `validateContract` runs after the response arrives
- [x] **Schema/Contract tab in response panel** *(pre-existing `Contract` tab)*
  - **AC:** Contract tab shows PASS/FAIL badge + violations (category/message/detail) + warnings; hidden when no spec
- [x] **No-op when disabled or no spec**
  - **AC:** When `autoValidateSchema` is false → `contractResult` is null and the Contract tab is absent; collections without `_openapiSpec` already show no contract result

---

### Task 1: Add `autoValidateSchema` to settings

**Files:**
- Modify: `frontend/src/stores/settings.ts`

- [ ] **Step 1: Add field to `requests` block**

  Find the `requests` block in the `AppSettings` interface. Add:

  ```ts
  requests: {
    // ... existing fields ...
    autoValidateSchema: boolean
  }
  ```

  Find `defaultSettings.requests`. Add:

  ```ts
  autoValidateSchema: false,
  ```

  **DoD:**
  - [ ] `autoValidateSchema: boolean` in `AppSettings.requests`
  - [ ] `defaultSettings.requests.autoValidateSchema` is `false`
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/stores/settings.ts
  git commit -m "feat: settings — add autoValidateSchema to requests block (default false)"
  ```

---

### Task 2: Add toggle to `SettingsPanel.tsx`

**Files:**
- Modify: `frontend/src/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Find the Requests section render branch**

  Search for `section === 'requests'` in `SettingsPanel.tsx`. Locate the section's content.

  **DoD:**
  - [ ] Requests section identified before editing

- [ ] **Step 2: Add the toggle**

  Inside the Requests section, add (after existing toggles):

  ```tsx
  <Toggle
    label="Auto-validate response schema"
    desc="Automatically validate each HTTP response against the endpoint's OAS schema (requires a spec on the collection). Shows a Schema tab in the response panel."
    checked={settings.requests.autoValidateSchema ?? false}
    onChange={(v) => updateRequests({ autoValidateSchema: v })}
  />
  ```

  **DoD:**
  - [ ] Toggle visible in Settings → Requests
  - [ ] Toggling updates `settings.requests.autoValidateSchema`
  - [ ] Build passes

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/settings/SettingsPanel.tsx
  git commit -m "feat: settings — add auto-validate schema toggle in Requests section"
  ```

---

### Task 3: Wire validator in `executeRequest.ts`

**Files:**
- Modify: `frontend/src/lib/executeRequest.ts`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Read `executeRequest.ts` to understand the result type and flow**

  ```bash
  grep -n "ExecuteRequestResult\|ContractValidation\|schemaValidation\|return" frontend/src/lib/executeRequest.ts | head -40
  ```

  **DoD:**
  - [ ] `ExecuteRequestResult` type identified before editing

- [ ] **Step 2: Add `schemaValidation` field to `ExecuteRequestResult` in `types.ts`**

  Find `ExecuteRequestResult` (or equivalent) in `types.ts`. Add:

  ```ts
  schemaValidation?: import('@/lib/contractValidator').ContractValidationResult
  ```

  Or if the type is co-located in `executeRequest.ts`, add the field there.

  **DoD:**
  - [ ] `schemaValidation?: ContractValidationResult` on the result type
  - [ ] Build passes

- [ ] **Step 3: Import and call the validator**

  At the top of `executeRequest.ts`, add:

  ```ts
  import { validateResponse } from '@/lib/contractValidator'
  import { useSettingsStore } from '@/stores/settings'
  import { useCollectionsStore } from '@/stores/collections'
  ```

  Find where `executeRequest` builds and returns its result. After the response is received and post-scripts have run, add:

  ```ts
  let schemaValidation: ContractValidationResult | undefined
  const autoValidate = useSettingsStore.getState().settings.requests.autoValidateSchema
  if (autoValidate && response) {
    // Find the collection that owns this request
    const collections = useCollectionsStore.getState().collections
    const ownerCollection = collections.find((c) =>
      JSON.stringify(c).includes(request.id ?? '')
    )
    if (ownerCollection?._openapiSpec) {
      try {
        schemaValidation = validateResponse(response, ownerCollection._openapiSpec, request.url ?? '', request.method ?? 'GET')
      } catch { /* validation errors should not break the flow */ }
    }
  }
  ```

  Include `schemaValidation` in the returned result object.

  **DoD:**
  - [ ] `validateResponse` called only when `autoValidateSchema` is `true`
  - [ ] Called only when the owning collection has `_openapiSpec`
  - [ ] Errors from validation are caught and do not throw
  - [ ] `schemaValidation` included in returned result
  - [ ] Build passes

- [ ] **Step 4: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/lib/executeRequest.ts frontend/src/lib/types.ts
  git commit -m "feat: executeRequest — call contractValidator when autoValidateSchema is enabled"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 4: Create `SchemaValidationTab.tsx`

**Files:**
- Create: `frontend/src/components/response/SchemaValidationTab.tsx`

- [ ] **Step 1: Read `ContractValidationResult` type**

  ```bash
  grep -n "ContractValidationResult\|ContractError\|ContractWarning" frontend/src/lib/contractValidator.ts | head -20
  ```

  **DoD:**
  - [ ] `ContractValidationResult` shape understood before writing the component

- [ ] **Step 2: Create the file**

  ```tsx
  import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
  import type { ContractValidationResult } from '@/lib/contractValidator'
  import { cn } from '@/lib/utils'

  interface Props {
    result: ContractValidationResult
  }

  export function SchemaValidationTab({ result }: Props) {
    const passed = !result.errors || result.errors.length === 0

    return (
      <div className="p-4 space-y-3 overflow-y-auto">
        {/* Overall badge */}
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded border text-[11px] font-medium',
          passed
            ? 'bg-green-950/30 border-green-900/40 text-green-300'
            : 'bg-red-950/30 border-red-900/40 text-red-300'
        )}>
          {passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {passed ? 'Schema validation passed' : `Schema validation failed — ${result.errors?.length ?? 0} error${(result.errors?.length ?? 0) === 1 ? '' : 's'}`}
        </div>

        {/* Errors */}
        {result.errors && result.errors.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-text-2">Errors</p>
            {result.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded bg-red-950/20 border border-red-900/30">
                <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  {err.path && <span className="font-mono text-[9px] text-red-300 block">{err.path}</span>}
                  <span className="text-[10px] text-red-200">{err.message}</span>
                  {err.expected !== undefined && (
                    <span className="text-[9px] text-text-4 block">expected: {String(err.expected)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {result.warnings && result.warnings.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-text-2">Warnings</p>
            {result.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded bg-yellow-950/20 border border-yellow-900/30">
                <AlertTriangle size={11} className="text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  {w.path && <span className="font-mono text-[9px] text-yellow-300 block">{w.path}</span>}
                  <span className="text-[10px] text-yellow-200">{w.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {passed && (!result.warnings || result.warnings.length === 0) && (
          <p className="text-[10px] text-text-4">Response body matches the schema definition for this endpoint.</p>
        )}
      </div>
    )
  }
  ```

  Adjust field names (`errors`, `warnings`, `path`, `message`, `expected`) to match the actual `ContractValidationResult` shape from `contractValidator.ts`.

  **DoD:**
  - [ ] File created at `frontend/src/components/response/SchemaValidationTab.tsx`
  - [ ] PASS badge shown when no errors
  - [ ] FAIL badge with error count when errors exist
  - [ ] Each error shows path + message
  - [ ] Warnings section shown when warnings exist
  - [ ] Build passes

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/response/SchemaValidationTab.tsx
  git commit -m "feat: response — add SchemaValidationTab with PASS/FAIL badge and error/warning list"
  ```

---

### Task 5: Add Schema tab to `ResponsePanel.tsx`

**Files:**
- Modify: `frontend/src/components/response/ResponsePanel.tsx`

- [ ] **Step 1: Import `SchemaValidationTab`**

  ```ts
  import { SchemaValidationTab } from './SchemaValidationTab'
  ```

  **DoD:**
  - [ ] Import resolves without error

- [ ] **Step 2: Add the tab**

  Find where the response tabs are defined (likely an array of tab ids: `['body', 'headers', 'tests', ...]`). Add `'schema'` to the list only when `result.schemaValidation` exists:

  ```tsx
  const responseTabs = [
    'body',
    'headers',
    'cookies',
    'tests',
    ...(result?.schemaValidation ? ['schema'] : []),
  ]
  ```

  In the tab content switch, add:

  ```tsx
  {activeTab === 'schema' && result?.schemaValidation && (
    <SchemaValidationTab result={result.schemaValidation} />
  )}
  ```

  Also add a validation badge on the tab button:

  ```tsx
  {tab === 'schema' && result?.schemaValidation && (
    <span className={cn('ml-1 w-1.5 h-1.5 rounded-full inline-block',
      (!result.schemaValidation.errors || result.schemaValidation.errors.length === 0)
        ? 'bg-green-400'
        : 'bg-red-400'
    )} />
  )}
  ```

  **DoD:**
  - [ ] "Schema" tab only appears when `result.schemaValidation` is set
  - [ ] Green dot on tab when validation passed, red dot when failed
  - [ ] `SchemaValidationTab` renders in the Schema tab
  - [ ] Build passes

- [ ] **Step 3: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [ ] Exit code 0, zero TypeScript errors

- [ ] **Step 4: Manual smoke test**

  Run `wails dev`. Enable Settings → Requests → "Auto-validate response schema". Find a collection with `_openapiSpec` (import one via P12 or use any collection that has been through the OAS importer). Send a request.

  **DoD:**
  - [ ] "Schema" tab appears in the response panel after the request completes
  - [ ] Response conforming to the schema shows "Schema validation passed"
  - [ ] Response with a missing required field shows an error
  - [ ] Disabling the toggle removes the Schema tab on the next request
  - [ ] Collections without `_openapiSpec` do not show the Schema tab

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/response/ResponsePanel.tsx
  git commit -m "feat: response — add Schema validation tab with PASS/FAIL indicator"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
