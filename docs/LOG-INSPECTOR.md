# Log Inspector — engineering reference

How the Log Inspector is built: parsing pipeline, field normalization, query
language, correlation, large-input strategy and architecture.

> Looking for what shipped and when? See
> [`releases/v0.9.0.md`](releases/v0.9.0.md) and
> [`releases/v0.9.1.md`](releases/v0.9.1.md),
> [`releases/v0.9.2.md`](releases/v0.9.2.md) and
> [`releases/v0.9.3.md`](releases/v0.9.3.md). This file is the technical
> reference and deliberately does not repeat the release notes.

| | |
|---|---|
| **Where** | Rail → **TOOLS** → *Log Inspector* (own full-size workspace) |
| **Command palette** | `Ctrl/Cmd + K` → "Log Inspector" |
| **Logic** | `frontend/src/lib/loginspector/` |
| **UI** | `frontend/src/components/loginspector/` |
| **Tests** | 112 dedicated tests in `frontend/src/lib/loginspector/*.test.ts` |
| **New dependencies** | none |

---

## 1. Input acquisition

Five sources, all behind one seam (`lib/loginspector/sources.ts`):

| Source | How |
|---|---|
| Clipboard | **Paste** button or `Ctrl+V` |
| Text editor | box on the empty screen → **Analyze** (a paste over 2000 chars starts on its own) |
| Drag & drop | drop the file anywhere on the panel |
| Local file | **Open** button |
| Samples | 5 selectable examples on the empty screen |

### Format comes from the content, never from the extension

This is a fixed point of the design. The file picker accepts **any file**
(`accept="*"`) and the drop filters nothing: `pod-2026-03-11.txt`, `app.log`,
`dump.json`, `output.out` or a file with **no extension at all** give the same
result for the same bytes. `detectFormat()` reads the real content and picks
between `json`, `json-array`, `jsonl`, `mixed`, `text`.

One exception: NUL bytes in the first 4 KB mean the file is binary, and the
import is refused with an explicit message instead of filling the list with
mojibake.

> Covered by: *"detects the format from the content, whatever the extension
> says"*, *"reads a .txt file that actually contains JSON Lines"*, *"reads a file
> with no extension at all"*, *"refuses a binary file instead of showing
> mojibake"*.

### `oc logs` — prepared, not implemented

`sources.ts` exposes `OC_LOGS_SOURCE` with `available: false`. Only the Go
binding that runs `oc logs -f` is missing; the rest of the pipeline is already
source-agnostic. The empty state no longer advertises the entry — a disabled row
that never becomes enabled is noise — so the seam is documented here instead.

---

## 2. Parsing

### Recognized formats

- single JSON object (pretty-printed across lines included)
- JSON array of objects
- JSON Lines / NDJSON
- plain text
- **mixed logs**: a text prefix followed by JSON, including the CRI-O shape
  `oc logs` emits →
  `2026-03-11T09:14:02.481774331Z stderr F {"level":"error",…}`
  The prefix is stripped; its timestamp and stream (`stdout`/`stderr`) are kept
  as fallbacks.
- ANSI escape codes: removed before any analysis

### Stack trace aggregation

The parser is an incremental line machine. A line *continues* the previous
event — so it lands in that event's stack trace instead of becoming a new
event — when it matches:

- **Java**: `\tat …`, `Caused by:`, `Suppressed:`, `... 14 more`, and a bare
  throwable name (`java.lang.IllegalStateException: …`)
- **Go**: `panic:` / `fatal error:` open panic mode, which also absorbs the blank
  line, `goroutine 42 [running]:`, frames like
  `/src/cmd/worker/main.go:57 +0x2d4`, `created by …` and `exit status 2`
- **Generic**: any indented line

Frames that carry their own CRI-O prefix still attach to the right event — the
real-world case of `oc logs` on a Java exception.

### Normalized fields

Aliases are matched **canonically**: case, `-`, `_` and spaces are ignored, so a
single entry covers every spelling. `correlationId` therefore also matches
`correlation_id`, `correlation-id`, `CorrelationID` and `CORRELATION_ID`; only
genuinely different words need their own entry. Dots are preserved, so nested
paths stay distinct. First alias present wins.

| Field | Aliases |
|---|---|
| `ts` / `tsRaw` | `timestamp`, `time`, `@timestamp`, `@t`, `ts`, `eventTime`, `eventTimestamp`, `datetime`, `date`, `asctime`, `timeMillis`, `timestampMs`, `logTime`, `startTime`, `receivedAt`, `_time` |
| `level` | `level`, `log.level`, `severity`, `severityText`, `logLevel`, `lvl`, `levelname`, `levelValue`, `@l`, `priority` |
| `message` | `message`, `msg`, `log`, `text`, `event`, `@m`, `@mt`, `shortMessage`, `logMessage`, `body` |
| `service` | `service`, `service.name`, `application`, `applicationName`, `app`, `appName`, `serviceName`, `component`, `microservice`, `svc`, `program`, `spring.application.name` |
| `namespace` | `namespace`, `namespaceName`, `ns`, `kubernetes.namespace_name`, `kubernetes.namespace`, `k8s.namespace`, `k8s.namespace.name`, `openshift.namespace`, `project` |
| `pod` | `pod`, `podName`, `podId`, `kubernetes.pod_name`, `kubernetes.pod`, `k8s.pod.name`, `instance`, `nodeName`, `host`, `hostname` |
| `container` | `container`, `containerName`, `containerId`, `kubernetes.container_name`, `k8s.container.name`, `docker.container_name` |
| `traceId` | `traceId`, `trace.id`, `X-B3-TraceId`, `dd.trace_id`, `otel.trace_id`, `otelTraceId`, `apm.trace_id`, `mdc.traceId` |
| `correlationId` | `correlationId`, `X-Correlation-Id`, `correlation`, `corrId`, `cid`, `conversationId`, `mdc.correlationId` |
| `requestId` | `requestId`, `X-Request-Id`, `reqId`, `http.request.id`, `mdc.requestId`, `X-Idempotency-Key`, `idempotencyKey`, `X-Amzn-Trace-Id`, `X-Amz-Request-Id`, `X-Transaction-Id`, `transactionId`, `operationId` |
| `thread` | `thread`, `threadName`, `threadId`, `tid`, `goroutine`, `worker`, `process.thread.name`, `coroutine` |
| `logger` | `logger`, `loggerName`, `log.logger`, `caller`, `source`, `class`, `category`, `channel`, `module`, `facility` |

This covers the common emitters out of the box: ECS (`log.level`, `service.name`,
`trace.id`), OpenTelemetry (`severityText`, `otel.trace_id`), Serilog CLEF
(`@t`, `@l`, `@m`), Python `logging` (`asctime`, `levelname`, `module`),
log4j2 (`timeMillis`), Monolog (`channel`), GELF (`shortMessage`), Datadog
(`dd.trace_id`), Spring MDC (`mdc.correlationId`) and gateway headers
(`X-Correlation-Id`, `X-Request-Id`, `X-Idempotency-Key`).

An idempotency key is not literally a request id, but it is the value an operator
filters by to find every retry of one operation, so it lands in `requestId`.

The payload is flattened into dotted paths, containers included, so both
`attributes` and `attributes.http.status_code` are addressable and aliases like
`k8s.namespace.name` resolve. Depth is capped at 5 and keys at 250 per event so a
pathological payload cannot explode into thousands of entries. Arrays are kept
whole: you filter on scalars, not on element positions.

> Caveat: `priority` is accepted as a level, but a syslog `priority` is a
> facility-encoded number (e.g. `134`), which the numeric level scale reads as
> `fatal`. Text levels and bunyan/pino numbers are correct.

**Levels**: textual (`SEVERE`, `WARNING`, `FINE`…) and numeric bunyan/pino
(`30` → info, `50` → error). For text lines the level is extracted from the
content.

**Timestamps**: ISO with nanoseconds, ISO with offset, Java comma form
(`09:14:02,481`), epoch in seconds / milliseconds / microseconds / nanoseconds,
CLF (`11/Mar/2026:09:14:02 +0000`), syslog, bare clock.

**Nested JSON in string fields**: `message`, `msg`, `body`, `payload`,
`response`, `request`, `data`, `result`, `error`, `exception`, `detail`,
`context`, `params` and `attributes` are decoded automatically when they hold
escaped JSON. The result goes into `decoded` — the original payload is never
mutated — and if the inner JSON has its own `message` that becomes the displayed
message.

Decoding is **recursive**: a gateway that logs a body which itself contains a
serialized payload comes back fully unwrapped (capped at 6 levels so a
pathological input cannot recurse forever). The same routine powers the
**Unwrap** toggle in the JSON tab, which turns every escaped-JSON string in the
event into a real subtree — expandable, searchable, and pretty-printed in the
raw view. It is on by default, because in logs that is almost always what you
want to read.

### Robustness

- An invalid line does **not** stop the import: it is kept, marked `RAW` in the
  list, with its parse error in the detail pane.
- Unparsable lines stay at level `unknown`, so they never inflate the
  application error count.
- Final summary: valid events, invalid lines, total lines, errors, warnings,
  detected format, duration, and truncation if any.
  Error/warning lists are sampled at 100 entries — the counts are complete, but
  a 100k-line file of broken lines does not duplicate itself in memory.

### Internal model

`LogEvent` normalizes the fields but always keeps:

- `raw` — original source text (without ANSI, which is terminal noise)
- `json` — the original JSON payload, untouched
- `extra` — fields that were not promoted
- `decoded` — JSON extracted from text fields
- `line` / `lineCount` — source line and how many lines the event spans
- `parseError` — non-empty when the line was not parsable
- `prefix` — text that preceded the JSON on the same line

---

## 3. Interface

```
┌──────────────────────────────────────────────────────────────┐
│ toolbar: Paste · Open · Clear · search · toggles · Export    │
├──────────────────────────────────────────────────────────────┤
│ time histogram (click = filter that bucket)                  │
├───────────┬──────────────────────────────┬───────────────────┤
│ filters   │ virtualized list             │ detail /          │
│ (collap-  │ (one row = one event)        │ related events    │
│  sible)   │                              │ (resizable)       │
├───────────┴──────────────────────────────┴───────────────────┤
│ summary: shown / total / valid / unparsed / errors           │
└──────────────────────────────────────────────────────────────┘
```

**List row** (compact, not a JSON blob): timestamp, level, service, pod or
container, message, correlation/trace ID, plus two indicators — stack trace
present, and line not parsable. Columns are selectable.

### Detail pane — 5 tabs

| Tab | Content |
|---|---|
| **Overview** | main fields with readable labels; any field turns into a filter with one click; chips for correlation IDs |
| **JSON** | tree with syntax highlighting, collapsible nodes, expand/collapse all, copy whole JSON, copy single value, **copy JSONPath**, in-tree search, word wrap, raw (pretty-printed) view, and **Unwrap** for JSON escaped inside strings |
| **Message** | full message, no truncation, plus any decoded JSON |
| **Stack Trace** | monospace, numbered lines, optional word wrap, copy |
| **Context** | Kubernetes/OpenShift metadata, tracing, source line, and a tree of unrecognized fields |

The **JSON** and **Context** tabs honour hidden fields (see *Noisy fields*,
§6): the keys listed there disappear from the tree at any depth.

`Esc` closes the detail pane.

### Responsive behaviour

The panel measures itself with a `ResizeObserver`:

- below **640 px** the filter column auto-collapses on first render;
- still below 640 px, opening an event takes the detail pane full width instead
  of squeezing the list into an unreadable column;
- above that threshold the three columns coexist and are hand-resizable (widths
  are remembered).

---

## 4. Filtering and search

### Query mini-language

```
level:error                    modelled field
merchantId:M-4471              any key in the payload
http.status:502                nested key
level:warn|error               alternatives
pod:pay-*                      wildcard
/timed ?out/                   regular expression
traceId:*                      field exists and is non-empty
-service:noisy-cron            exclusion
"latency above threshold"      exact phrase
merchant                       full text over raw + message + stack
```

Clauses combine with AND. Synonyms are accepted (`svc`, `ns`, `cid`, `req`,
`trace`…).

**Any payload key is searchable**, not just the twelve modelled fields: a name
that is not a known field is resolved canonically against the event payload
(`json`, `extra` and the decoded nested JSON), so `merchantId:M-4471` works
without the field being modelled, and `x_idempotency_key:` finds
`X-Idempotency-Key`. That index is built lazily, per event, and cached in a
`WeakMap`, so queries that never mention an unmodelled field pay nothing.

**Fields are discovered automatically.** After an import, `discoverFields()`
scans the batch and reports every key it contains — including nested ones
(`attributes.http.status_code`) — with coverage, inferred types, and the most
frequent values. The sidebar lists them: click a field to see its top values,
click a value to filter by it. A high-cardinality field (an id) is marked `id`
and offers `field:*` instead of a value list. Nothing has to be configured, so a
custom application format is searchable the moment it is loaded.

Large batches are strided rather than fully scanned (3,000 events by default):
the shape of a log is visible from a sample, and discovery runs on the main
thread right after the import.

**Shapes are remembered.** The canonical top-level keys form a *signature*;
`rememberSchema()` stores the union of every path ever seen for that shape under
`adomnia.loginspector.schemas` (last 20 shapes, local only). A later import is
matched by **resemblance**, not by an exact key set — 60% overlap is enough —
because logs gain and lose fields between releases. Paths known from earlier
imports but absent from the current batch are still listed, under *Remembered,
absent here*: that missing field is often exactly what you are looking for.

**Regular expressions** are written as `/pattern/flags` and are always
case-insensitive. They work as a bare term (matched against raw + message +
stack) or as a field value (`pod:/^pay-\d$/`). A regex may contain spaces — the
tokenizer keeps a `/…/` literal together — and an invalid one degrades to a
literal search instead of throwing.

**Alternatives** use `|`: `level:warn|error`, or bare `merchant|threshold`.

A name that cannot be a field — a pasted URL such as `https://host/path` — stays
a full-text term.

Query terms are **highlighted** in the list message; regex sources are not
highlighted, alternatives are highlighted one by one.

### Structured filters

- multiple levels with per-level counts
- time range (`From` / `To`, or click a histogram bar)
- facets for service, namespace, pod, container, logger, thread — with
  **include** and **exclude** per value
- "only events with a stack trace"
- "only unparsable lines"
- immediate reset

Query terms are **highlighted** in the list message.

### Visual query builder

Field + operator (`is` / `is not` / `exists`) + value → clause appended to the
query, for anyone who would rather not type the syntax.

### Saved queries

Stored locally in `localStorage` (`adomnia.loginspector`) with the other
preferences: density, word wrap, visible columns, event limit, column widths,
extra sensitive fields and hidden noisy fields. Discovered log shapes live
beside them under `adomnia.loginspector.schemas`.

These are machine preferences: they are not synced, do not end up in the
`.adomnia` workspace and never leave the computer. If `localStorage` is
unavailable (private window, quota exhausted) the tool still works with the
defaults.

---

## 5. Event correlation

From an event carrying `correlationId`, `traceId` or `requestId` → **Show
related events**.

The view shows:

- every correlated event in chronological order
- the **time delta** from the previous event (`+156ms`)
- total chain duration, error count, chain of services crossed
- errors highlighted
- two modes: **list** and **timeline** (position proportional to time)
- copy the value, and **"Use as filter"** to push it into the main query

This is how a distributed request gets reconstructed chronologically.

---

## 6. Additional capabilities

- ascending / descending sort by timestamp
- **pause and resume rendering** while importing large amounts of data
- **compact** / **comfortable** density
- word wrap
- copy the original source line (`Raw` in the detail pane)
- copy filtered events to the clipboard
- export **filtered** results as JSON, JSONL or text
- choose which columns the list shows
- per-level event counts
- mini time histogram with the error share in red
- **Clear sensitive fields**: masks `Bearer …`, `Authorization`, `token`,
  `password`, `secret`, `cookie`, `api_key`, `session`, `credential`,
  `private_key` — at any JSON depth and in free text too. It produces copies:
  the original events stay intact and masking toggles off without re-importing.

### Extra sensitive fields

The icon next to the masking toggle opens a popover for domain-specific field
names — `customer_email`, `iban`, `fiscal_code` — added on top of the built-in
detection. They persist across sessions.

### Noisy fields

In the columns popover, **Hide noisy JSON fields** takes key names to get out of
the way (`kubernetes`, `hostname`, `stream`…). They are removed from the JSON
tree and the Context tab at any depth, without touching the data: a display
choice, not an event filter.

> Mind the difference: **masking** replaces the value with `[redacted]` and also
> applies to the export; **hiding** removes the key from the detail view only.

---

## 7. Large-input strategy

Target: fluid with at least 100,000 events. Covered by the tests.

- **Parsing in a Web Worker**, in 2,000-line blocks: the work never occupies the
  renderer, the progress bar updates, **Cancel** interrupts even very large JSON
  documents, and the list fills progressively. Each message carries only the new
  batch, not a copy of every event.
- **Virtualized list**: only the visible window is mounted, so 100,000 events
  cost what 40 do.
- **Filters** run on cheap predicates, with the search haystack computed once
  per event and kept in a `WeakMap` (released with the batch).
- **Non-blocking typing**: the query goes through `useDeferredValue`, so the
  search box answers every keystroke while the list recompute lags a frame
  instead of blocking input.
- **Configurable ceiling**: 50k / 100k / 200k / 500k events, with truncation
  reported in the summary bar.
- **Memory errors handled explicitly**: a dedicated message suggesting a lower
  limit or a split file, instead of a blank screen.

### Worker and compatibility

The browser uses `parser.worker.ts`; tests and WebViews without Worker support
run the same incremental machine on the main thread. The protocol exchanges
incremental batches to contain serialization cost.

---

## 8. Architecture

The layers are kept separate:

| Layer | File |
|---|---|
| Input acquisition | `lib/loginspector/sources.ts` |
| Format detection | `lib/loginspector/detect.ts` |
| Parsing | `lib/loginspector/parse.ts` |
| Field normalization | `lib/loginspector/normalize.ts` |
| Filters and query | `lib/loginspector/query.ts` |
| Statistics / indexing | `lib/loginspector/stats.ts` |
| Field discovery and remembered shapes | `lib/loginspector/discover.ts` |
| Correlation | `lib/loginspector/correlate.ts` |
| Masking | `lib/loginspector/mask.ts` |
| Export | `lib/loginspector/exporters.ts` |
| Samples | `lib/loginspector/samples.ts` |
| Background execution | `lib/loginspector/background.ts` + `parser.worker.ts` |
| Presentation | `components/loginspector/*` |

Reused from adOmnia: `FileDropZone`, `ResizeHandle`, `downloadText` /
`readFileSmart`, the `--color-*` design tokens, the panel pattern of
`HarViewerPanel`. No npm dependency added: the virtual list and the JSON tree
are purpose-built (~50 and ~130 lines).

### Files

```
frontend/src/lib/loginspector/
  parse.ts           458   line machine, stack traces, chunked + cancel
  query.ts           257   mini-language, structured filters, highlighting
  normalize.ts       251   field aliases, levels, timestamps, nested JSON
  background.ts       98   worker startup, incremental batches, fallback
  types.ts            93   LogEvent, ParseSummary, ParseResult
  discover.ts        230   automatic field discovery, remembered shapes
  stats.ts            82   per-level counts, facets, histogram
  mask.ts             76   Clear sensitive fields + hidden fields
  samples.ts          75   5 examples
  sources.ts          71   acquisition seam, binary guard, oc logs
  detect.ts           70   ANSI, format detection, JSON after a prefix
  correlate.ts        68   correlated chains, deltas, chronological order
  exporters.ts        54   JSON / JSONL / text
  parser.worker.ts    40   worker protocol (parse / progress / cancel)
  index.ts            12   barrel
  parse.test.ts      279   parser + file-drop tests
  query.test.ts      236   query, correlation, mask, stats, export tests

frontend/src/components/loginspector/
  LogInspectorPanel.tsx  751   orchestration, toolbar, layout, shortcuts
  FilterSidebar.tsx      334   levels, time, facets, query builder, saved
  JsonTree.tsx           310   JSON tree with copy value / JSONPath
  EventDetail.tsx        270   5 tabs
  EventList.tsx          223   virtualized list
  RelatedEvents.tsx      141   list + timeline
  EmptyState.tsx         125   samples, drop zone, editor, shortcuts
  Histogram.tsx           45   time histogram
  index.ts                 1   barrel
```

> `LogInspectorPanel.tsx` sits at 751 lines, above the ~400 the repo convention
> favours (800 hard limit). It is the natural split candidate: the toolbar
> popovers (columns, noisy fields, sensitive fields, export) can be extracted
> without touching the logic.

### Wiring

Since v0.9.1 Log Inspector is a **rail destination**, not a Power Tools studio:

- `lib/navigation.ts` — `loginspector` in `RAIL_ITEMS`
- `lib/featureRegistry.ts` — feature entry + *Focused Tools* group
  (`JSON Studio → Log Inspector → Tool Launcher`)
- `components/layout/Rail.tsx` — `Activity` icon
- `components/layout/MainArea.tsx` and `MainAreaRouter.tsx` — lazy-loaded
  `case 'loginspector'`
- `lib/uiI18n.ts` — panel title
- It is deliberately **absent** from `components/utils/toolRegistry.ts`;
  `lib/uiI18n.test.ts` guards that it never reappears in the Tool Launcher
  catalogue.

---

## 9. Shortcuts

| Keys | Action |
|---|---|
| `Ctrl/Cmd+V` | paste and analyze |
| `Ctrl/Cmd+F` | search |
| `Ctrl/Cmd+Shift+F` | show/hide filters |
| `Ctrl/Cmd+L` | clear |
| `Ctrl/Cmd+E` | export |
| `Esc` | close the detail pane |

---

## 10. Tests

`frontend/src/lib/loginspector/*.test.ts` — **103 tests**, all green.

- single JSON, JSON array, JSON Lines
- malformed lines: they do not block the import, they are marked, and they do
  not count as application errors
- Java stack traces (with `Caused by` and `... N more`)
- Go panics (goroutine, `.go:NN` frames, inner blank line, `exit status`)
- logs with OpenShift prefixes, including Java frames carrying their own prefix
- assorted timestamps: ISO nano, ISO with offset, Java comma form, epoch s/ms, CLF
- nested JSON as a string in `message` / `body` / `payload` / `response`
- ANSI escape codes
- file drop: format inferred from content for `.txt`, `.log`, `.json` and
  extensionless files; binary files refused
- correlation by `traceId` and `correlationId`, with deltas and chain duration
- field aliases: casing/separator variants, header-style `X-…` identifiers,
  idempotency key as request id, ECS and OpenTelemetry dotted fields, OpenShift
  `project`/`nodeName`, Serilog compact fields
- fast-search operators: payload-key lookup, nested key, regex as a bare term and
  as a field value, invalid regex degrading to literal, alternatives, highlight
  behaviour, pasted URLs staying full-text
- field discovery: nested keys of a custom format, coverage/kinds/top values,
  high-cardinality fields, sampling of large batches, plain-text logs, stable
  fingerprints, and every discovered field being searchable
- remembered shapes: storage under the fingerprint, merging by resemblance so a
  field from an earlier import survives, no merge across different shapes,
  forgetting on request, and surviving an unavailable localStorage
- combined filtering: query + levels + facets + exclusions + time range
- large files: 100k events, ceiling, truncation, cancellation, progress
- sensitive-data masking, including not mutating the originals

### Verification performed

- `npx tsc --noEmit` clean
- `npm run test` green — 73 files, 384 tests
- `npm run build` green
- `go build ./...`, `go vet ./...` and `go test ./...` green

---

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *"Clipboard access was denied"* | The WebView did not grant clipboard reads. Paste into the editor box on the empty screen: over 2000 characters it starts on its own. |
| *"… looks like a binary file, not a text log"* | NUL bytes in the first 4 KB. Extract the archive first; compressed logs must be decompressed (`.gz` is not handled). |
| *"Out of memory while parsing"* | Lower the event ceiling in the toolbar, or split the file (`split -l 200000`). |
| `truncated at …` in the summary bar | You passed the event ceiling: events beyond it were not read. Raise the limit, or narrow the input upstream with `oc logs --since`. |
| Many events with no time | No recognizable timestamp: the histogram and time filter exclude them, but they stay in the list and in search. The count is in the summary *warnings*. |
| Rows marked `RAW` | Lines that start with `{` but are not valid JSON — typically output truncated by the terminal. Use *"Only unparsable lines"* to see them all. |
| The list does not update during an import | Progressive rendering is paused (▶ icon in the toolbar). Every event still arrives when the import finishes. |

---

## 12. Known limits

- **`oc logs` not implemented** — the seam is ready, the Go binding is missing.
- A single huge JSON array is read with one `JSON.parse`: a limit of the format,
  not of the implementation. It still runs in the worker, so it never blocks the
  UI and can be cancelled; running out of memory produces a dedicated message
  instead of a blank screen.
- `raw` keeps the original line **without** ANSI: the escapes are terminal noise
  and would make "copy the original line" useless.
- No import is remembered between sessions — a local-first choice: logs live in
  memory and disappear when the tool is closed.
- Compressed archives (`.gz`, `.zip`) are not handled and must be extracted.

---

## 13. Possible improvements

Ordered by value/cost. None is required for today's usage: these are the points
that would give first if the bar were raised.

### High value

1. **Integrated `oc logs`** — the missing Go binding. It removes the
   terminal → clipboard → paste round trip, which is the real daily friction.
2. **Streaming / continuous tail** — follow a pod while it runs, with the parser
   consuming a stream instead of a string. The parser is already an incremental
   machine (`createLogParser`), so the change is contained.
3. **Worker protocol tests** — today the 103 tests cover the pure parser and the
   main-thread fallback, but not the `parse` / `progress` / `cancel` message
   exchange. It is the only uncovered piece.

### Medium

4. **Block-wise file reading** — `loadFromFile` pulls the whole file into a
   string and the worker `split`s it, so for a moment both the text and the line
   array exist in memory. A `stream()` on the `File` would cut that peak.
5. **`raw` as the dominant memory cost** — every event keeps its own source
   line, i.e. a second copy of the whole input. On 100k events it is the
   heaviest item. Keeping only an offset into the original text and deriving
   `raw` on demand would fix it.
6. **Sorting large batches** — flipping the direction copies and re-sorts the
   whole array. On 500k events it shows. A precomputed sort index would make it
   instant.
7. **Split `LogInspectorPanel.tsx`** (751 lines) by extracting the toolbar
   popovers.

### Low / optional

8. **Zoom and drag-selection** on the correlated-events timeline and on the
   histogram (today a click selects a single bucket).
9. **Diff between two imports** — comparing the logs of two deploys.
10. **Incremental facets** — today recomputed over the whole batch on every
    masking change; memoized, but not incremental.
11. **`.gz` support** on input, for archived logs.
