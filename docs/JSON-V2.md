# Migration to `encoding/json/v2`

adOmnia marshals JSON through Go 1.27's [`encoding/json/v2`](https://go.dev/doc/jsonv2-migration)
everywhere it owns the code. `encoding/json` (v1) remains **only** where documented below.

## What migrated

Every `json.Marshal` / `json.Unmarshal` / `json.NewEncoder(...).Encode(...)` /
`json.NewDecoder(...).Decode(...)` / `json.MarshalIndent` / `json.Valid` call in `internal/`, `cmd/`
and the root package now uses `encoding/json/v2` (and `encoding/json/jsontext` for raw values,
indentation and streaming).

Conversions applied:

| v1 | v2 |
| --- | --- |
| `json.NewEncoder(w).Encode(v)` | `json.MarshalWrite(w, v)` |
| `json.NewDecoder(r).Decode(&v)` | `json.UnmarshalRead(r, &v)` |
| `json.MarshalIndent(v, "", "  ")` | `json.Marshal(v, jsontext.WithIndent("  "))` |
| `json.Valid(b)` | `jsontext.Value(b).IsValid()` |
| streaming `dec.More()`/`dec.Decode(&v)` | `dec.ReadValue()` + `json.Unmarshal(v, &x)` |

## What deliberately stays on v1

- **`json.RawMessage`** (now `jsonv1.RawMessage` where a file also imports v2): it is the type of the
  Wails binding surface (`LanguageOptions`, plugin manifests…) and the generated TypeScript
  (`json$0.RawMessage` in `frontend/bindings/`) depends on it. It implements `json.Marshaler`, so v2
  marshals it as raw JSON exactly as before. Do not swap it for `jsontext.Value` without regenerating
  the bindings and fixing the frontend contract.
- **`json.Number` / `UseNumber`** (`internal/oaslint`, `internal/oascontract`, two type switches in
  `internal/browser`): `UseNumber` has no v2 equivalent and those call sites need exact number text
  (JSON linting, spec comparison). The v1 decoder stays there, next to v2.

## Behavior changes of v2 (accepted, checked by tests)

- **JSON member names match Go field names case-sensitively.** v1 matched case-insensitively, so an
  untagged struct field `Result` silently received `"result"` under v1 and silently stays **empty**
  under v2. Every struct decoded from JSON needs exact `json:"..."` tags (this bit the MCP handshake
  test). When decoding foreign JSON with unknown casing, pass `json.MatchCaseInsensitiveNames(true)`.
- **Go maps marshal in non-deterministic order** (v1 sorted the keys). Output built from maps must
  use `jsonutil.Marshal*` (deterministic) or it differs run to run: exports, canonical revisions and
  golden files broke on this.
- A nil slice or map marshals as `[]` / `{}` instead of `null` (v1: `null`). Consumers are our own
  frontend and files: empty collections are safer than `null` in TypeScript.
- `Unmarshal` **rejects** duplicate object names and invalid UTF-8 instead of silently accepting
  them. Malformed input now fails with a `json.SemanticError` instead of decoding into garbage.
- Invalid struct tags are a runtime error instead of being ignored.
- Byte slices marshal as base64 strings (v1: array of numbers); `time.Duration` has no default
  representation (`FormatByteArrayAsArray` / `FormatDurationAsNano` restore the v1 shapes).
- `MarshalWrite`/`MarshalEncode` do not append the trailing newline that v1's `Encoder.Encode` did:
  **line-delimited protocols must write the `\n` themselves** (see `internal/adomniacli/mcp.go`,
  whose MCP stdio transport is newline-framed).

When a specific call must keep v1 behavior, pass the option — later options override earlier ones,
`encoding/json.DefaultOptionsV1()` lists them all:

```go
json.Marshal(v, jsonv1.DefaultOptionsV1())                 // exactly v1 semantics
json.Marshal(v, json.FormatNilSliceAsNull(true))           // v1 except everything else
```

## Rules for new code

- Import `encoding/json/v2` (the package name is still `json`).
- **Marshal through `jsonutil.Marshal` / `jsonutil.MarshalWrite` / `jsonutil.MarshalEncode`**
  (`internal/jsonutil`): they are v2 with `json.Deterministic(true)`, because v2 marshals Go maps in
  non-deterministic order while v1 sorted them — exports, canonical revisions, manifest signatures
  and golden tests compare JSON bytes. Use plain `json.Marshal` only for throwaway output.
- Struct fields that were `omitempty` on a **bool or number** are now `omitzero` (v2's `omitempty`
  only omits values that encode as empty JSON: `false` and `0` no longer qualify). `omitempty` on
  strings, slices and maps behaves identically in v1 and v2 and stays as it is.
- Use `encoding/json/jsontext` for raw values (`jsontext.Value`), indentation (`jsontext.WithIndent`)
  and streaming (`jsontext.NewDecoder`).
- Never reintroduce `encoding/json` except for `RawMessage`/`Number` as described above.
