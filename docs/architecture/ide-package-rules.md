# IDE package rules

How the Go code of Code Studio is split into packages, and the rules every new feature and every new
language follows. `internal/ide/architecture_test.go` and `internal/ide/process_launch_guard_test.go` enforce
the hard ones; the rest is checked in review.

## The layers

```
code_studio_bindings.go (root)      Wails service GoIDE: one-line methods, the stable contract with the UI
        │
internal/codestudio                 HOST: composition root + Service facade. Owns sessions, wires managers,
        │                           checks trust. Service methods stay thin: resolve the session, call a manager.
        ▼
internal/ide/<feature>              CORE: language-agnostic features, one package each
        ▲                           (workspace, langserver, terminal, lsp, dap, run, testing, sdk, process…)
        │
internal/languages/<lang>           ADAPTERS: everything specific to one language
```

- **Imports go down or sideways in the core, never up.** `internal/ide/*` never imports `internal/codestudio`
  or `internal/languages/*`, **not even from tests**: the architecture test runs `go list -deps -test`.
  Core tests use fake languages (`internal/ide/langserver/main_test.go`); a test that needs the real
  adapter (gopls specs, Go syntax) lives in the adapter, which may import the core. Adapters never import
  `internal/codestudio`.
- **`internal/ide/workspace` is the shared vocabulary**: `Project`, `Session`, `Document`, `DocumentID`,
  `AuthorizationState`, `DiskChange`, `ReadTextFile`, `NewID`. A core package that needs a session takes a
  `workspace.Session`, not a `codestudio` type.
- **Run-level ids come from `internal/ide/run`** (`SessionID`, `RunID`). Re-export them with a local alias
  (`type SessionID = run.SessionID`), never redeclare them as a new type.

## Where a piece of code goes

1. Works for any language (editor, documents, terminal, processes, language-server lifecycle, debug adapter
   protocol, test tree, search, SDK plumbing) → its own package under `internal/ide/`.
2. Works for one language (gopls flags, Delve, go.mod, pprof, JDT LS, Maven, pytest, Cargo…) →
   `internal/languages/<lang>`.
3. Needs the session map, the trust check or several managers at once → a `Service` method in
   `internal/codestudio`, a few lines long, that calls the packages above.

A `Service` method that grows past "resolve session, check authorization, call one or two managers" is
feature logic in the wrong place: move the body into the manager as an exported method and keep the
`Service` method as the delegate (see `LSPManager.ImplementationMarkers`, `LSPManager.Protect`).

## Moving code out of codestudio

Each move is one commit and keeps every public contract:

1. **Keep the type names.** Wails derives the TypeScript model name from the Go type name, so
   `TerminalSession` stays `TerminalSession` in `internal/ide/terminal` (no `terminal.Session` rename).
2. **Alias in codestudio**: one `*_aliases.go` file per moved package (`type X = pkg.X`, constants,
   `var Err… = pkg.Err…`). The generated bindings re-export the type from the codestudio module, so the
   frontend imports do not change. **Exception:** a type that appears only nested inside another result
   (never directly in a bound method signature) is generated only in the new package, so the frontend
   imports it from there (`code-studio-lsp-api.ts` imports `EditorTextEdit`, `SymbolNode`… from
   `internal/ide/langserver/models`). Regenerate the bindings and run `npx tsc --noEmit` to catch them.
3. **Service methods stay in codestudio** (Go methods cannot live outside the type's package). Anything
   they read from a manager's unexported fields becomes a small exported method on the manager.
4. **Shared helpers go down, not sideways**: path checks in `ide/project` (`EnsureWithin`, `RelativeWithin`),
   URIs in `ide/lsp` (`FileURI`), process control in `ide/process`, files in `ide/workspace`/`ide/fileio`.
   Do not copy a helper into the new package.
5. **Tests follow the code they test.** A test that only drives the manager moves with it. A test that goes
   through `Service` stays in codestudio and uses the manager's exported API; do not export a field just for a
   test, add a narrow read method when the behaviour is worth asserting (`LSPManager.UserPinned`).
6. **Injection seams stay package variables** in the package that uses them
   (`var terminateProcessTree = ideprocess.TerminateTree`), so tests in that package can replace them.
7. **Server-specific behaviour travels in `lsp.ServerSpec`** (`HiddenCodeActionKinds`,
   `ChangeSignatureCommand`…), set by the adapter's spec builder. A core package that needs a gopls constant
   is a sign the knob belongs in the spec.
8. Watch for **name shadowing**: a local variable named `process`, `session` or `workspace` hides the
   package. Import `internal/ide/process` as `ideprocess` in files that have such variables.

## Tests

- Every package with tests that start processes, commit to git or fake a language server uses the shared
  `TestMain`: `func TestMain(m *testing.M) { idetest.Main(m) }`. It runs the tests with an empty global git
  config (a developer's hooks or signing once cost 60 s per fixture commit) and lets the test binary act as
  the fake gopls (`idetest.FakeGoplsEnv`) or a long-lived child (`idetest.ManagedHelperEnv`).
- Test helpers used by more than one package live in `internal/ide/idetest` (fixtures, positions) and
  `internal/ide/process/proctest` (is a PID alive, shell lines). They are imported only by `_test.go` files.
- A package should test in well under a minute. When one grows past that, look for a slow fixture first
  (`go test -json` and sort by `Elapsed`), then split the package along the rules above.

## A new language

Everything specific goes in `internal/languages/<lang>`; the core never learns its name.

- Implement `language.Language` and only the capabilities it really supports (`ProjectDetector`,
  `DocumentSelector`, `Runner`, `TestRunner`, `DebugAdapterProvider`, `lsp.ServerProvider`…). Register it with
  one line in `internal/codestudio/languages.go`.
- The language server is an `lsp.ServerSpec` built by the adapter and run by `internal/ide/langserver`: no
  second language-server manager, no per-language process code.
- Install of a server or debugger goes through `lsp.ServerProvider.InstallPlan` and the frontend
  `codeStudioToolInstall` store (one visible command, pinned version).
- Run, test and debug reuse `internal/ide/run`, `internal/ide/testing` and `internal/ide/dap`.
- HTTP routes, datasources, topics become Developer Context entities (`internal/devcontext`) so API
  Workspace, Mock and Live Session work for the language like they do for Go.
- Add the in-app checks to `mds/MANUAL-CHECK.md`.

If the new language needs something the core does not offer yet, add it to the core as a small interface
together with this first consumer, not as a `switch language` in the host.
