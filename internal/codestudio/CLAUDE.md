# CLAUDE.md — internal/codestudio (the Code Studio host)

Read [`internal/ide/CLAUDE.md`](../ide/CLAUDE.md) for the whole IDE area. This file adds the rules for the host
package itself. Code rules: [`docs/architecture/go-coding-rules.md`](../../docs/architecture/go-coding-rules.md).
Package layout: [`docs/architecture/ide-package-rules.md`](../../docs/architecture/ide-package-rules.md).

## What this package is

The **composition root and facade** of Code Studio: it owns the session map, wires the managers
(`langserver`, `terminal`, `run`, `dap`, `watcher`…), applies the trust model and exposes `Service`, which the
Wails service `GoIDE` (`code_studio_bindings.go`) calls one method at a time.

It is **not** the place for feature logic. Language-agnostic logic lives in `internal/ide/<feature>`,
language-specific logic in `internal/languages/<lang>`. Code that is still here and is not wiring is a
migration debt, not a pattern to copy.

## Adding or changing something

1. **Put the logic in the right package first** (`ide-package-rules.md`). If none fits, create a small one under
   `internal/ide/` or extend the adapter.
2. **Add the `Service` method** in `service_<feature>.go`. It does only this:

   ```go
   // MoveSymbol computes the move and returns it as a multi-file preview.
   func (s *Service) MoveSymbol(sessionID string, request MoveSymbolRequest) (WorkspaceChange, error) {
   	session, err := s.session(sessionID) // 1. resolve the session
   	if err != nil {
   		return WorkspaceChange{}, err
   	}
   	if session.Project.Authorization != AuthorizationPermitted { // 2. trust, if it runs tools
   		return WorkspaceChange{}, errors.New("explicitly authorize the tools for this project")
   	}
   	// 3. validate and resolve inputs (paths inside the project, toolchain, environment)
   	// 4. delegate to one manager or adapter function and return its result
   	return golang.MoveSymbol(golang.MoveRequest{ /* … */ })
   }
   ```

   Anything beyond these four steps belongs in the delegate. A method that needs a manager's unexported
   field is asking for a new exported method on that manager.
3. **Expose it** in `code_studio_bindings.go` (one line), regenerate the bindings
   (`wails3 generate bindings -clean=true -ts ./...`) and run `npx tsc --noEmit` in `frontend/`.
4. **Moved or new Wails types** keep their names and get an alias in the matching `*_aliases.go`
   (`langserver_aliases.go`, `terminal_aliases.go`, `workspace_aliases.go`, `golang_tools_aliases.go`).

## Rules specific to the host

- **Sessions never leak into each other.** Every method takes a session id and resolves it with
  `s.session(id)`; events carry `sessionId`. No package-level state keyed by anything else.
- **Trust is checked here**, once, before delegating to anything that starts a process, writes into the
  project or calls the network. Delegates may assume it was checked; they still validate their own inputs.
- **Paths from the UI are untrusted.** Resolve them against `session.Project.RealPath` and check them with
  `project.EnsureWithin` before use.
- **Lifecycles are owned here.** Every manager the `Service` creates is stopped in `Service.Shutdown`; a new
  manager with goroutines or processes adds itself there.
- **No new imports of Go tooling** (`go/packages`, `x/tools`, `x/exp/trace`, pprof) in this package: that code
  goes to `internal/languages/golang`.
- **Errors returned to the UI** are short and actionable; wrap tool output with `process.CleanToolError`.

## Tests

- `main_test.go` runs `idetest.Main`: fake gopls, managed helper process, empty global git config. Keep it.
- Tests here go **through `Service`** (open a project, call the method, assert the result or the event). A test
  that only exercises a manager or an adapter belongs in that package.
- Shared fixtures: `idetest.WriteFile`, `idetest.PositionOf`, `proctest.Alive`.
- The package must keep testing in a few minutes: check `go test -json ./internal/codestudio/` sorted by
  `Elapsed` when it grows, and move the slow part out.

## Still to move out (as of 2026-10-28)

Go coverage (`coverage*.go`), changed symbols, error checks, govulncheck and the dependency graph go to
`internal/languages/golang`; quality tools (`sonar`, `lint`) to an `internal/ide/quality` package; `vcs`,
`runconfig` and `debug` keep their `Service` methods here but their logic moves next to `internal/ide/run` and
`internal/ide/dap`. Move a group when you change it, following `ide-package-rules.md`.
