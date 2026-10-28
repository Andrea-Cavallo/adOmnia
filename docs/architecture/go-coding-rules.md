# Go coding rules

The rules every Go change in adOmnia follows. They sit on top of the gates that already fail the build
(`golangci-lint` with `modernize`, `errorlint`, `gocyclo` 40, `errcheck`; `go vet`; `gosec`; the architecture
tests) and of the package layout in [`ide-package-rules.md`](ide-package-rules.md). Where a rule and the
surrounding code disagree, follow the rule in new code and do not mass-rewrite old code.

## 1. Keep it simple (KISS, YAGNI)

- **Solve the case in front of you.** No interface with one implementation, no option nobody sets, no
  "framework" for a second caller that does not exist yet. Add the abstraction with its second real consumer.
- **Prefer the standard library**, then a dependency already in `go.mod`, then a few lines of code. A new
  module needs a reason in the PR (size, maintenance, licence).
- **Plain data, plain functions.** A struct with exported fields and a constructor beats a builder; a function
  beats a method when it uses no state.
- **One level of abstraction per function.** If a function reads a file, parses it, validates it and
  formats a message, it is four functions.
- **Small units.** Functions fit on a screen (aim < 50 lines, gocyclo < 15 for new code; the gate is 40),
  files stay under ~600 lines and hold one concern. Split by extracting well-named helpers or a table, never
  by adding flags.

## 2. Don't repeat yourself (DRY), but don't couple either

- **Search before writing.** Path checks: `project.EnsureWithin` / `project.RelativeWithin`. URIs:
  `lsp.FileURI`. Processes: `procutil` / `ide/process`. Tool output in errors: `process.CleanToolError`.
  Atomic writes: `fileio.AtomicWriteFile`. JSON: `jsonutil` (json v2). Ids: `workspace.NewID`.
- **A third copy is a bug.** Two similar blocks may stay; the third moves to the lowest package both callers
  can import (`ide-package-rules.md` §"Shared helpers go down").
- **Duplicate data, not decisions.** Repeating a 3-field struct in two packages is fine; repeating the rule that
  decides what is safe, valid or allowed is not.

## 3. Fail fast, fail clearly

- **Validate at the boundary**, first thing: bound method arguments, file paths, URLs, user commands, data read
  from disk or the network. Return an error before doing any work or side effect.
- **Guard clauses, not nesting.** Check, return, continue at the left margin. More than three levels of
  indentation is a signal to extract or invert.
- **Never ignore an error.** Handle it, return it with context, or — only for best-effort cleanup — discard it
  with `_ =` and a one-line reason (`_ = file.Close() // read-only handle`).
- **Wrap with `%w`** and add what the caller does not know: `fmt.Errorf("reading %s: %w", name, err)`.
  Compare with `errors.Is` / `errors.As`, never `==` or a type assertion.
- **Error text:** lowercase, no trailing period, no raw tool dumps, no secrets. Messages that reach the UI say
  what happened and what to do ("explicitly authorize the tools for this project").
- **No `panic`** for runtime conditions. It is only for programming errors detected at startup (a duplicate
  language id in the registry) and tests.
- **Trust before processes.** Anything that starts a process checks
  `session.Project.Authorization == AuthorizationPermitted` first and goes through `procutil`/`ide/process`.

## 4. Naming

- **Packages:** short, lower case, one word, named for what they provide (`langserver`, `terminal`,
  `workspace`), never `util`, `common`, `helpers`, `misc`. No stutter: callers read `terminal.Open`, so avoid
  `terminal.TerminalOpen` in new APIs (moved Wails types keep their names on purpose, see the package rules).
- **Exported names** are nouns for types (`ProfileReport`), verbs for functions (`LoadProfile`), and say what,
  not how. Getters have no `Get` prefix (`Status()`, not `GetStatus()`), except on the Wails facade where the
  frontend contract already uses it.
- **Short names for short scopes** (`i`, `err`, `ctx`, `s` for the receiver), descriptive names for long ones
  and for package-level identifiers. Avoid abbreviations nobody would type (`mgr`, `cfgMgr`, `tmpRes`).
- **Booleans read as questions**: `readOnly`, `hasGoFiles`, `userInitiated`. Functions returning a bool:
  `IsX`, `HasX`, `CanX`, `MatchesX`.
- **Initialisms keep their case:** `ID`, `URL`, `URI`, `HTTP`, `JSON`, `PID`, `LSP` (`sessionID`, `fileURI`).
- **Files** are lower_snake_case and named for their concern (`move_symbol.go`, `service_lsp.go`); platform
  variants use the build-tag suffix (`_windows.go`, `_unix.go`). `service_<feature>.go` holds only `Service`
  methods; aliases of moved types live in `<package>_aliases.go`.
- **Constants** are CamelCase, never SCREAMING_CASE; units in the name when not a `time.Duration`
  (`maxProfileSizeBytes`, `MemoryLimitMiB`).

## 5. Functions and types

- **Accept interfaces, return concrete types.** Define the interface in the package that consumes it, small
  (one to three methods), and discover optional capabilities by type assertion (`language.DocumentSelector`).
- **Context first:** `func (m *Manager) Do(ctx context.Context, …)`. Every network call, process and
  long-running operation takes a context with a timeout; `defer cancel()` right after `WithTimeout`.
  `context.Background()` only at the top (a Wails binding, a goroutine owner, `main`).
- **Few parameters.** More than four, or two of the same type next to each other, become a request struct
  (`golang.MoveRequest`).
- **Zero values work** where possible; otherwise a `New…` constructor returns a ready value. No `Init()`
  methods to call afterwards.
- **No package-level mutable state** in new code. Per-session state lives in the session's manager; tests
  inject behaviour through a package variable only when it is a deliberate seam
  (`var terminateProcessTree = …`), documented as such.
- **No `init()`** except to register something that cannot be registered otherwise.

## 6. Concurrency

- **Every goroutine has an owner and an exit**: a context, a stop channel or a `sync.WaitGroup` the owner waits
  on in `Shutdown`/`Close`. No fire-and-forget goroutines that outlive a session.
- **Hold locks briefly**: copy what you need under the lock, release, then do I/O or call out. Never call back
  into another manager while holding a mutex.
- **Atomics only for counters and flags**; anything with more than one field uses a mutex. Never copy a struct
  that contains a mutex or an atomic (`go vet copylocks`).
- Run focused tests with `-race` when you touch a lock, a channel or a goroutine.

## 7. Comments and docs

- **Every exported identifier has a doc comment** that starts with its name and says what it does and any
  contract (who calls it, what must hold). Package comments live in `doc.go` for packages with more than one
  file.
- **Comment why, not what.** The code says what; a comment explains the constraint, the trade-off or the bug it
  avoids ("gopls answers `addView called before server initialized` if…").
- New comments are in **English**; existing Italian comments stay until the code around them changes.
- Deliberate simplifications say so and name the upgrade path (`// global lock: per-session locks if
  contention shows up`).

## 8. Tests

- **Test behaviour through the public surface** of the package; reach into internals only when the behaviour
  cannot be observed otherwise.
- **Table-driven** for input/output rules; one test per scenario name that reads as a sentence
  (`TestStopLanguageServerWhenTreeKillFails`).
- **Hermetic and fast:** `t.TempDir()`, `t.Context()`, `t.Setenv`; no network; fixtures written by the test.
  Packages that start processes or commit to git use `idetest.Main` (see the package rules). A package should
  test in well under a minute; a test over a few seconds needs a reason or a `-short` skip.
- **Benchmarks** use `b.Loop()`.
- Every bug fix comes with the test that would have caught it.

## 9. Before you commit

```bash
gofmt -l . ; go vet ./...
golangci-lint run --build-tags gtk3        # 0 issues
go test ./<packages you touched>/...       # plus ./internal/ide/ -run 'Core|Adapters' for IDE code
```

If you changed a Wails-bound type: regenerate the bindings and run `npx tsc --noEmit` in `frontend/`.
