# adOmnia 0.9.1 — Log Inspector

Log Inspector turns long application and OpenShift pod logs into structured,
navigable events without sending their contents outside the computer.

It is now a first-class Power Tools destination. Open the **TOOLS** menu and
choose one of the three direct entries:

1. **JSON Studio**
2. **Log Inspector**
3. **Tool Launcher**

Log Inspector opens in its own full-size workspace and no longer appears inside
Tool Launcher.

## Read real application logs

Paste from the clipboard, type in the editor, drag a file onto the workspace or
open a local file. Detection is based on content, so `.log`, `.txt`, `.json`,
`.jsonl`, `.ndjson`, `.out` and extensionless text files all follow the same
pipeline.

Supported input includes:

- single JSON objects and JSON arrays;
- JSON Lines and NDJSON;
- plain and mixed text logs;
- OpenShift and CRI-O prefixes, including stdout/stderr metadata;
- ANSI terminal escape sequences;
- multiline Java exceptions and Go panic stacks;
- escaped JSON stored in message, body, payload, request, response or data fields.

One malformed line does not stop the import. It remains visible as a `RAW` event
with its parsing error, while the rest of the file stays usable.

## Investigate instead of scrolling

The central list presents one compact row per event with timestamp, level,
service, pod or container, correlation identifier and message. Open a row to
inspect its overview, complete JSON tree, full message, numbered stack trace,
Kubernetes context and original source text.

Search accepts free text and field clauses such as:

```text
level:error service:payments
pod:* -namespace:development
correlationId:abc123
```

Visual filters cover levels, time ranges, services, namespaces, pods,
containers, loggers and threads. Filters can be combined, excluded, reset and
saved locally as favourite queries.

## Reconstruct distributed requests

Select a correlation ID, trace ID or request ID to display every related event
in chronological order. List and timeline views show service transitions,
errors, total duration and the delta between consecutive events. The selected
identifier can be applied to the main filter with one action.

## Large inputs and local privacy

Parsing runs in a Web Worker and reports progressive batches to a virtualized
event list. Imports can be cancelled, progressive rendering can be paused and
the retention limit can be set from 50,000 to 500,000 events.

All processing stays local. Sensitive fields can be masked before copying or
exporting; built-in detection covers authorization values, tokens, cookies,
passwords, sessions and secrets, with additional configurable field names.
Filtered results can be exported as JSON, JSONL or readable text.

## Keyboard workflow

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + V` | Paste and analyze |
| `Ctrl/Cmd + F` | Focus search |
| `Ctrl/Cmd + Shift + F` | Toggle filters |
| `Ctrl/Cmd + L` | Clear the workspace |
| `Ctrl/Cmd + E` | Open export actions |
| `Esc` | Close correlation or event details |

## Included examples

The empty workspace includes ready-to-run samples for a JSON event, JSONL,
Java stack trace, Go panic and mixed OpenShift output. They demonstrate the
complete workflow without requiring a cluster or external file.

## Known limitations

- Direct `oc logs` execution and live tailing are architecturally prepared but
  are not included yet.
- Compressed `.gz` and `.zip` archives must be extracted before import.
- Imports stay in memory and are intentionally not restored across sessions.

## Verification

- 73 Log Inspector parser, query, correlation, masking, statistics and export tests.
- 354 frontend tests across 72 files.
- TypeScript compilation and production frontend build.
- Go build and backend test suite.
- Manual navigation check confirming `JSON Studio → Log Inspector → Tool Launcher`
  and confirming that Log Inspector is absent from the launcher catalogue.
