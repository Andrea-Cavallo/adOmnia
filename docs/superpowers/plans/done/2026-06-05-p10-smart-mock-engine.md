# P10 — Smart Mock Engine (Schema-Driven Response Generation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Extend the mock server with schema-driven response generation. When a mock endpoint's response mode is set to `"schema"`, the server generates a realistic JSON body from the stored JSON Schema on every request — using Go-based Faker logic (no client-side JS). Supports string formats (email, uuid, date-time, name, uri), number ranges, enum values, required fields, and nested objects/arrays.

**Architecture:** `internal/mock/mock.go` gains a `GenerationMode` field on `mockResponse` (`"static"` or `"schema"`) and a `BodySchema` string field. A new `internal/mock/faker.go` implements `GenerateFromSchema(schema map[string]any) (string, error)` using Go's `math/rand` and format heuristics — no external dependency. The MockPanel in the frontend gains a "Schema" mode toggle and a JSON Schema editor (same Monaco/CodeMirror-based editor already used in the composer).

**Tech Stack:** Go `math/rand`, TypeScript, React. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `internal/mock/faker.go` | **New** — `GenerateFromSchema`: JSON Schema → random JSON value |
| `internal/mock/mock.go` | Add `GenerationMode string` and `BodySchema string` to `mockResponse`; call faker when mode is `"schema"` |
| `frontend/src/lib/types.ts` | Add `generationMode` and `bodySchema` to mock response type |
| `frontend/src/components/mock/MockSchemaEditor.tsx` | **New** — JSON Schema text editor component |
| `frontend/src/components/mock/MockPanel.tsx` | Add mode toggle (Static/Schema) and `MockSchemaEditor` when mode is `"schema"` |

---

## Feature Checklist

- [x] **`GenerateFromSchema` Go implementation**
  - **AC:** Given a JSON Schema object, returns a valid JSON string where: `type: "string"` with `format: "email"` → realistic email; `format: "uuid"` → UUID-like string; `format: "date-time"` → ISO 8601 timestamp; `format: "name"` or no format → random name/word; `type: "integer"` → random int within `minimum`/`maximum` if set; `type: "number"` → random float; `type: "boolean"` → true or false; `enum` → random enum value; `type: "array"` with `items` → 2–4 generated items; `type: "object"` with `properties` → generates all `required` fields plus optional ones
- [x] **`mockResponse` extended with `GenerationMode` and `BodySchema`**
  - **AC:** Existing static responses unaffected (`GenerationMode: "static"` or empty = use `Body` verbatim); when `GenerationMode: "schema"`, `BodySchema` is passed to `GenerateFromSchema` on each request
- [x] **Frontend mode toggle**
  - **AC:** Each mock response in MockPanel has a "Static / Schema" toggle; switching to Schema shows `MockSchemaEditor` and hides the body textarea
- [x] **Schema editor**
  - **AC:** `MockSchemaEditor` is a resizable textarea pre-populated with a starter schema; content saved to `bodySchema` field on the response
- [x] **Live preview**
  - **AC:** "Preview" button in Schema mode calls the mock server's `/mock/preview-schema` endpoint and shows a sample generated value

---

### Task 1: Create `internal/mock/faker.go`

**Files:**
- Create: `internal/mock/faker.go`

- [x] **Step 1: Create the file**

  ```go
  package mock

  import (
      "encoding/json"
      "fmt"
      "math/rand"
      "strings"
      "time"
  )

  var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

  var firstNames = []string{"Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack"}
  var lastNames = []string{"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor"}
  var words = []string{"apple", "banana", "cherry", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"}
  var tlds = []string{"com", "org", "net", "io", "dev"}

  func randChoice[T any](s []T) T { return s[rng.Intn(len(s))] }

  func fakeEmail() string {
      return fmt.Sprintf("%s.%s@example.%s", strings.ToLower(randChoice(firstNames)), strings.ToLower(randChoice(lastNames)), randChoice(tlds))
  }

  func fakeUUID() string {
      b := make([]byte, 16)
      rng.Read(b)
      return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
  }

  func fakeDateTime() string {
      t := time.Now().Add(-time.Duration(rng.Intn(365*24)) * time.Hour)
      return t.UTC().Format(time.RFC3339)
  }

  func fakeName() string {
      return randChoice(firstNames) + " " + randChoice(lastNames)
  }

  func fakeURI() string {
      return fmt.Sprintf("https://example.%s/%s/%d", randChoice(tlds), randChoice(words), rng.Intn(1000))
  }

  func fakeString(schema map[string]any) string {
      format, _ := schema["format"].(string)
      switch format {
      case "email":
          return fakeEmail()
      case "uuid":
          return fakeUUID()
      case "date-time", "date":
          return fakeDateTime()
      case "uri", "url":
          return fakeURI()
      case "name":
          return fakeName()
      }
      minLen := 0
      if v, ok := schema["minLength"].(float64); ok {
          minLen = int(v)
      }
      maxLen := 20
      if v, ok := schema["maxLength"].(float64); ok {
          maxLen = int(v)
      }
      if minLen > maxLen {
          minLen, maxLen = maxLen, minLen
      }
      length := minLen + rng.Intn(maxLen-minLen+1)
      if length < 3 {
          length = 3
      }
      // Use a random word and pad/trim
      base := randChoice(words)
      for len(base) < length {
          base += randChoice(words)
      }
      return base[:length]
  }

  func fakeNumber(schema map[string]any, isInt bool) any {
      min := 0.0
      max := 1000.0
      if v, ok := schema["minimum"].(float64); ok {
          min = v
      }
      if v, ok := schema["maximum"].(float64); ok {
          max = v
      }
      if min > max {
          min, max = max, min
      }
      n := min + rng.Float64()*(max-min)
      if isInt {
          return int64(n)
      }
      return n
  }

  // GenerateFromSchema generates a random JSON value conforming to the given JSON Schema.
  // Returns the JSON-encoded value as a string.
  func GenerateFromSchema(schema map[string]any) (string, error) {
      v, err := generateValue(schema, 0)
      if err != nil {
          return "", err
      }
      raw, err := json.Marshal(v)
      if err != nil {
          return "", err
      }
      return string(raw), nil
  }

  const maxDepth = 5

  func generateValue(schema map[string]any, depth int) (any, error) {
      if depth > maxDepth {
          return nil, nil
      }

      // Handle enum
      if enum, ok := schema["enum"].([]any); ok && len(enum) > 0 {
          return randChoice(enum), nil
      }

      // Handle const
      if c, ok := schema["const"]; ok {
          return c, nil
      }

      typ, _ := schema["type"].(string)

      switch typ {
      case "object":
          return generateObject(schema, depth)
      case "array":
          return generateArray(schema, depth)
      case "string":
          return fakeString(schema), nil
      case "integer":
          return fakeNumber(schema, true), nil
      case "number":
          return fakeNumber(schema, false), nil
      case "boolean":
          return rng.Intn(2) == 1, nil
      case "null":
          return nil, nil
      default:
          // Try to infer from other properties
          if _, ok := schema["properties"]; ok {
              return generateObject(schema, depth)
          }
          if _, ok := schema["items"]; ok {
              return generateArray(schema, depth)
          }
          return fakeString(schema), nil
      }
  }

  func generateObject(schema map[string]any, depth int) (any, error) {
      props, _ := schema["properties"].(map[string]any)
      requiredRaw, _ := schema["required"].([]any)
      required := make(map[string]bool)
      for _, r := range requiredRaw {
          if s, ok := r.(string); ok {
              required[s] = true
          }
      }

      obj := map[string]any{}
      for key, propRaw := range props {
          prop, ok := propRaw.(map[string]any)
          if !ok {
              continue
          }
          // Generate all required + 50% chance for optional
          if required[key] || rng.Intn(2) == 0 {
              v, err := generateValue(prop, depth+1)
              if err != nil {
                  return nil, err
              }
              obj[key] = v
          }
      }
      return obj, nil
  }

  func generateArray(schema map[string]any, depth int) (any, error) {
      items, _ := schema["items"].(map[string]any)
      minItems := 2
      maxItems := 4
      if v, ok := schema["minItems"].(float64); ok {
          minItems = int(v)
      }
      if v, ok := schema["maxItems"].(float64); ok {
          maxItems = int(v)
      }
      if minItems > maxItems {
          minItems, maxItems = maxItems, minItems
      }
      count := minItems + rng.Intn(maxItems-minItems+1)
      arr := make([]any, 0, count)
      for i := 0; i < count; i++ {
          if items != nil {
              v, err := generateValue(items, depth+1)
              if err != nil {
                  return nil, err
              }
              arr = append(arr, v)
          } else {
              arr = append(arr, fakeString(map[string]any{}))
          }
      }
      return arr, nil
  }
  ```

  **DoD:**
  - [x] File created at `internal/mock/faker.go`
  - [x] `GenerateFromSchema` exported
  - [x] `type: "string"` with `format: "email"` → email-like string
  - [x] `type: "string"` with `format: "uuid"` → UUID-like string
  - [x] `type: "integer"` with `minimum`/`maximum` → bounded int
  - [x] `type: "object"` with `properties` → object with required fields populated
  - [x] `type: "array"` with `items` → 2–4 items
  - [x] `enum` → random enum value
  - [x] `go build ./...` exits 0

- [x] **Step 2: Quick unit test**

  Create `internal/mock/faker_test.go`:

  ```go
  package mock

  import (
      "encoding/json"
      "testing"
  )

  func TestGenerateFromSchema_Email(t *testing.T) {
      schema := map[string]any{"type": "string", "format": "email"}
      result, err := GenerateFromSchema(schema)
      if err != nil {
          t.Fatal(err)
      }
      if result == "" || result == `""` {
          t.Fatal("expected non-empty email")
      }
  }

  func TestGenerateFromSchema_Object(t *testing.T) {
      schema := map[string]any{
          "type": "object",
          "properties": map[string]any{
              "id":    map[string]any{"type": "string", "format": "uuid"},
              "email": map[string]any{"type": "string", "format": "email"},
              "age":   map[string]any{"type": "integer", "minimum": float64(18), "maximum": float64(99)},
          },
          "required": []any{"id", "email"},
      }
      result, err := GenerateFromSchema(schema)
      if err != nil {
          t.Fatal(err)
      }
      var obj map[string]any
      if err := json.Unmarshal([]byte(result), &obj); err != nil {
          t.Fatalf("result not valid JSON: %v — got: %s", err, result)
      }
      if _, ok := obj["id"]; !ok {
          t.Fatal("expected 'id' field in generated object")
      }
      if _, ok := obj["email"]; !ok {
          t.Fatal("expected 'email' field in generated object")
      }
  }

  func TestGenerateFromSchema_Enum(t *testing.T) {
      schema := map[string]any{"enum": []any{"active", "inactive", "pending"}}
      result, err := GenerateFromSchema(schema)
      if err != nil {
          t.Fatal(err)
      }
      if result != `"active"` && result != `"inactive"` && result != `"pending"` {
          t.Fatalf("unexpected enum value: %s", result)
      }
  }
  ```

  Run: `go test ./internal/mock/... -run TestGenerateFromSchema`

  **DoD:**
  - [x] All 3 tests pass
  - [x] `go test` exits 0

- [ ] **Step 3: Commit**

  ```bash
  git add internal/mock/faker.go internal/mock/faker_test.go
  git commit -m "feat: mock faker — GenerateFromSchema Go implementation with email/uuid/object/array/enum support"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 2: Extend `mockResponse` in `internal/mock/mock.go`

**Files:**
- Modify: `internal/mock/mock.go`

- [x] **Step 1: Add fields to `mockResponse`**

  Find the `mockResponse` struct (around line 18). Add two fields:

  ```go
  type mockResponse struct {
      ID             string            `json:"id"`
      Name           string            `json:"name"`
      Status         int               `json:"status"`
      Headers        map[string]string `json:"headers"`
      Body           string            `json:"body"`
      DelayMs        int               `json:"delayMs"`
      IsActive       bool              `json:"isActive"`
      GenerationMode string            `json:"generationMode"` // "static" (default) or "schema"
      BodySchema     string            `json:"bodySchema"`     // JSON Schema string when GenerationMode=="schema"
  }
  ```

  **DoD:**
  - [x] `GenerationMode` and `BodySchema` fields added to `mockResponse`
  - [x] `go build ./...` exits 0

- [x] **Step 2: Use `GenerateFromSchema` when serving a matched response**

  Find the handler function that selects and returns the active `mockResponse` body (look for where `resp.Body` is written to the HTTP response writer). Before writing the body, add:

  ```go
  responseBody := resp.Body
  if resp.GenerationMode == "schema" && resp.BodySchema != "" {
      var schema map[string]any
      if err := json.Unmarshal([]byte(resp.BodySchema), &schema); err == nil {
          if generated, err := GenerateFromSchema(schema); err == nil {
              responseBody = generated
          }
      }
  }
  // Use responseBody instead of resp.Body when writing to ResponseWriter
  ```

  **DoD:**
  - [x] When `GenerationMode == "schema"`, `responseBody` comes from `GenerateFromSchema`
  - [x] When `GenerationMode` is empty or `"static"`, `responseBody == resp.Body` (unchanged)
  - [x] Existing static mock tests still pass: `go test ./internal/mock/...`
  - [x] `go build ./...` exits 0

- [x] **Step 3: Add `/mock/preview-schema` endpoint**

  In `RegisterHandlers`, add a new endpoint for frontend preview:

  ```go
  mux.HandleFunc("/mock/preview-schema", func(w http.ResponseWriter, r *http.Request) {
      if r.Method != http.MethodPost {
          http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
          return
      }
      var body struct {
          Schema string `json:"schema"`
      }
      if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
          http.Error(w, "invalid body", http.StatusBadRequest)
          return
      }
      var schema map[string]any
      if err := json.Unmarshal([]byte(body.Schema), &schema); err != nil {
          http.Error(w, "invalid JSON schema", http.StatusBadRequest)
          return
      }
      result, err := GenerateFromSchema(schema)
      if err != nil {
          http.Error(w, err.Error(), http.StatusInternalServerError)
          return
      }
      w.Header().Set("Content-Type", "application/json")
      w.Write([]byte(result))
  })
  ```

  **DoD:**
  - [x] `POST /mock/preview-schema` with `{"schema": "{...}"}` returns a generated JSON value
  - [x] `go build ./...` exits 0

- [ ] **Step 4: Commit**

  ```bash
  git add internal/mock/mock.go
  git commit -m "feat: mock — add GenerationMode/BodySchema fields and schema-driven response generation"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 3: Update frontend mock types

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add fields to mock response type**

  Find the `MockResponse` (or equivalent) interface/type in `types.ts`. Add:

  ```ts
  generationMode?: 'static' | 'schema'
  bodySchema?: string
  ```

  **DoD:**
  - [ ] `generationMode` and `bodySchema` optional fields added to the mock response type
  - [x] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/types.ts
  git commit -m "feat: mock types — add generationMode and bodySchema fields to MockResponse"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 4: Create `MockSchemaEditor.tsx`

**Files:**
- Create: `frontend/src/components/mock/MockSchemaEditor.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { useState } from 'react'
  import { Eye, EyeOff } from 'lucide-react'
  import { useServerPort } from '@/lib/useServerPort'

  const STARTER_SCHEMA = JSON.stringify({
    type: "object",
    required: ["id", "name", "email"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string", format: "name" },
      email: { type: "string", format: "email" },
      createdAt: { type: "string", format: "date-time" },
      active: { type: "boolean" },
      score: { type: "integer", minimum: 0, maximum: 100 }
    }
  }, null, 2)

  interface Props {
    value: string
    onChange: (v: string) => void
  }

  export function MockSchemaEditor({ value, onChange }: Props) {
    const port = useServerPort()
    const [preview, setPreview] = useState('')
    const [previewError, setPreviewError] = useState('')
    const [loading, setLoading] = useState(false)

    const handlePreview = async () => {
      setLoading(true)
      setPreviewError('')
      try {
        const resp = await fetch(`http://localhost:${port}/mock/preview-schema`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: value }),
        })
        const text = await resp.text()
        if (!resp.ok) {
          setPreviewError(text)
        } else {
          try {
            setPreview(JSON.stringify(JSON.parse(text), null, 2))
          } catch {
            setPreview(text)
          }
        }
      } catch (e) {
        setPreviewError(String(e))
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-3">JSON Schema (response will be generated on each request)</span>
          {!value && (
            <button
              onClick={() => onChange(STARTER_SCHEMA)}
              className="text-[9px] text-accent hover:underline"
            >
              Use starter schema
            </button>
          )}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={STARTER_SCHEMA}
          rows={10}
          className="w-full px-2 py-1.5 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-y"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={loading || !value}
            className="flex items-center gap-1.5 h-6 px-3 text-[10px] bg-surface-2 text-text-2 rounded border border-border-2 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            {loading ? <EyeOff size={10} /> : <Eye size={10} />}
            {loading ? 'Generating…' : 'Preview'}
          </button>
          {previewError && <span className="text-[9px] text-red-400 truncate flex-1">{previewError}</span>}
        </div>
        {preview && (
          <pre className="text-[9px] font-mono bg-surface-1 border border-border-1 rounded p-2 overflow-auto max-h-[160px] text-text-2 whitespace-pre-wrap">
            {preview}
          </pre>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/mock/MockSchemaEditor.tsx`
  - [x] Textarea for JSON Schema input
  - [x] "Use starter schema" button populates a realistic starter
  - [x] Preview button calls `/mock/preview-schema` and shows result
  - [x] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/mock/MockSchemaEditor.tsx
  git commit -m "feat: mock — add MockSchemaEditor with preview button calling /mock/preview-schema"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 5: Add mode toggle to `MockPanel.tsx`

**Files:**
- Modify: `frontend/src/components/mock/MockPanel.tsx`

- [x] **Step 1: Import `MockSchemaEditor`**

  ```ts
  import { MockSchemaEditor } from './MockSchemaEditor'
  ```

  **DoD:**
  - [x] Import resolves without error

- [x] **Step 2: Add mode toggle per response**

  Find the section in `MockPanel.tsx` where each response's body is edited (the body textarea). Immediately above the body textarea, add a Static/Schema toggle:

  ```tsx
  {/* Generation mode toggle */}
  <div className="flex items-center gap-2 mb-2">
    <span className="text-[10px] text-text-3">Response body:</span>
    <div className="flex rounded overflow-hidden border border-border-2">
      {(['static', 'schema'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => updateResponseField(responseId, 'generationMode', mode)}
          className={cn(
            'px-2 py-0.5 text-[9px] capitalize transition-colors',
            (response.generationMode ?? 'static') === mode
              ? 'bg-accent text-white'
              : 'bg-surface-2 text-text-4 hover:text-text-2'
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  </div>

  {(response.generationMode ?? 'static') === 'schema' ? (
    <MockSchemaEditor
      value={response.bodySchema ?? ''}
      onChange={(v) => updateResponseField(responseId, 'bodySchema', v)}
    />
  ) : (
    <textarea {/* existing body textarea props */} />
  )}
  ```

  The exact variable names (`responseId`, `updateResponseField`, `response`) should match what's already used in `MockPanel.tsx` — read the file before editing to confirm the exact pattern.

  **DoD:**
  - [x] Each mock response has a Static/Schema toggle
  - [x] Selecting "Schema" replaces the body textarea with `MockSchemaEditor`
  - [x] Selecting "Static" shows the original body textarea
  - [x] `generationMode` and `bodySchema` are saved to the mock config
  - [x] Build passes

- [x] **Step 3: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0, zero TypeScript errors

- [ ] **Step 4: Manual smoke test**

  Run `wails dev`. Open Mock Server. Create an endpoint, add a response, switch to "Schema" mode. Enter a JSON Schema (or use the starter). Start the mock server and make a request to the endpoint.

  **DoD:**
  - [ ] Response body is dynamically generated from the schema on each request
  - [ ] Two consecutive requests return different values (random generation)
  - [ ] Preview button in `MockSchemaEditor` shows a sample value
  - [ ] Switching back to Static restores the original body textarea

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/mock/MockPanel.tsx
  git commit -m "feat: mock — add Static/Schema mode toggle and MockSchemaEditor to response editor"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
