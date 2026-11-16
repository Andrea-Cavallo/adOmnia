# AI agents controlling the desktop IDE

adOmnia's built-in stdio MCP server can connect to the running desktop and operate the same Code Studio session the user sees. Start the desktop build containing this feature and open the project first. The project must permit AI access and project tooling must already be authorized in Code Studio; MCP cannot authorize it.

Configure an MCP client with the command `adomnia.exe` and arguments:

```json
["mcp", "C:\\projects\\example", "--write"]
```

Without `--write`, the client can inspect the session, open an editor location, read test status and read retained logs. Executing tests, starting or controlling a debugger, database access and external review snapshots require `--write`. These tools are added to the existing built-in MCP server that adOmnia supplies to its agents; configuring an external client uses the same executable and arguments.

The connection is local: the desktop listens on a random IPv4 loopback port and publishes a per-process bearer token under the user's configuration directory (`adOmnia/agent-control`). Tokens stay outside project folders. Browser-origin requests are rejected. Closed/crashed process registrations do not grant access to another process, and a project open in multiple desktop processes is reported as ambiguous instead of executing an operation twice. Discovery probes status first; mutations are sent exactly once and are never automatically retried after a timeout.

The project AI policy still applies. `off` denies access; `local-only` requires `ADOMNIA_AGENT_LOCAL=1` in the MCP process environment, set by the person configuring a local model. A model-provided tool argument cannot override this setting. The local bridge does not determine whether an external AI client uploads the returned results: configure the client's provider accordingly.

| Tool | Behavior |
|---|---|
| `ide_status` | Find the open project session and its authorization state. `project` defaults to the MCP workspace. |
| `ide_open_file` | Dispatch a source location through the existing entity router (`path`, optional `line` and `column`, 1-based). Returns `dispatched`, not an acknowledgement that a renderer displayed it. |
| `ide_test_start` | Start tests in the IDE using the existing language adapters. Accepts `language`, `workingDirectory`, `packages`, `run`, coverage and the other normal test request fields. Returns a run ID immediately. |
| `ide_test_status` | Inspect `runId`; add `nodeId` to retrieve that test's output. A run belonging to a different project is refused. |
| `ide_debug_start` | Start an installed debugger with `language` and the normal request fields for that adapter: Go (default), Java, Python, Rust, C/C++, JavaScript or TypeScript. Missing tools produce the IDE's normal errors; nothing is installed automatically. |
| `ide_debug` | `action`: `list`, `breakpoints`, `threads`, `stack`, `scopes`, `variables`, `evaluate`, `continue`, `pause`, `next`, `stepIn`, `stepOut`, `stop`. Supply `debugId`, `threadId`, `frameId`, `reference`, `expression`, or `path`/`breakpoints` as appropriate. Debug IDs are checked against this project's sessions. |
| `ide_logs` | Latest 100 run/debug events retained since bridge startup, with each event bounded to 16 KiB. Not a complete historical log archive. |
| `ide_database_connections` | List saved SQL connection IDs and drivers; omit connection strings, hosts and credentials. |
| `ide_database_query` | Query `connectionId` with `query` and optional `limit` (maximum 200 rows). Accepts one SELECT, WITH or EXPLAIN statement, without write/control clauses. Uses the saved credential path, a 10-second deadline and a read-only transaction; SQLite also uses `query_only`. PostgreSQL/MySQL rely on their database-enforced read-only transaction support. Redis/MongoDB are outside this tool. |
| `ide_review_begin` | Capture the project before an external agent turn. Optional `agent` label. Only one external capture is active per project. |
| `ide_review_end` | Finish that capture and publish changes to the existing review UI. Returns counts and any snapshot notice, not file contents. |

Example external-agent workflow:

```text
ide_status({})
ide_review_begin({"agent":"External coding agent"})
... edit files through the existing workspace tools or agent filesystem tools ...
ide_test_start({"language":"go","packages":["./..."]})
ide_test_status({"runId":"<returned run id>"})
ide_review_end({})
ide_open_file({"path":"main.go","line":12,"column":1})
```

Always finish a started external review, including after a failed task. Changes made by an unrelated external process outside this capture interval cannot automatically be attributed to the agent. Built-in ACP agents already use the existing before/after turn observer.

## Selective review

In **Review agent changes**, click a line number on either version; Shift+click extends the range. **Accept selection** advances the baseline for the selected changes; **Reject selection** restores them. Neighboring changes remain pending. Replacement lines use the same positional pairing shown in the side-by-side view. Added and deleted text files support partial decisions too; binary/oversized files and renames retain whole-file controls.

**Load functions** asks the project's language server for methods, constructors and functions, including nested ones. Select a function to select its source range, then accept or reject the selection. Functions are available when the source still exists and the language server supports document symbols; deleted functions can be reviewed by selecting their old lines. No regex-based function boundaries are guessed.

Both baseline and current disk text are checked before applying a partial decision. A concurrent review decision or disk edit makes the operation stale and reloads the review. Unsaved editor buffers block selection decisions. Review remains in memory and is lost on app exit, as before; this change does not introduce a new workspace storage format. Accepting a review does not commit or push anything.

## Verification

Verified on 2026-11-15: focused Go packages (agent control, agent review, MCP CLI, database and IDE architecture), 28 frontend tests, the full TypeScript/production frontend build, startup bundle check and `go build ./...` passed.

Automated coverage includes authenticated loopback transport, browser-origin rejection, workspace and session isolation, AI policies, explicit MCP write permission, external review lifecycle, bounded logs, SQLite read-only queries, stale baseline/disk detection, new/deleted files, line pairing, ranges, CRLF and language-server symbol filtering. Browser fixture verification exercised a single-line rejection with a neighboring change preserved and the existing split view. It stubs Wails operations and is not native desktop acceptance.

Native acceptance still required:

- [ ] Use an external MCP client against a running desktop build: open a source location and confirm the correct project, tab, line and column.
- [ ] Start tests, inspect their output, debug a breakpoint and inspect variables with installed adapters.
- [ ] Query a disposable saved PostgreSQL/MySQL connection and verify server-side write denial (SQLite is covered automatically).
- [ ] Complete an external snapshot turn, select a function from a live language server, accept/reject changes and verify editor reload and focus.
