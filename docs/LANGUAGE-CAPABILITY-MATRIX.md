# Language capability matrix

What each Code Studio language can actually do, separated from what is merely
registered. The table below is **generated from the language registry the
application uses** (`internal/codestudio/languages.go` → adapters in
`internal/languages/*`), so a new adapter or a new interface implementation cannot
leave this page behind: `TestCapabilityMatrixDocumentMatchesRegistry` fails when the
document and the code disagree.

## Legend

| Value | Meaning |
|---|---|
| **yes** | The adapter implements the capability: it takes part in the real workflow (detection, LSP, run, test, debug, navigation). It says the code path exists and is wired, not that the native flow was accepted on every platform. |
| **—** | Not implemented for that language. The expected behaviour is an explicit "not available" in the UI, never a silent no-op. |

Capabilities:

- **Project detection** — the adapter reports project units to the UI.
- **Documents** — the adapter owns editor documents and their language id (syntax, formatting, unsaved-buffer sync).
- **Language server** — a server provider exists (started only when its binary is present; nothing is installed silently).
- **Run** — a run configuration the adapter can execute.
- **Tests** — structured test results in the shared Test tree.
- **Debug** — a DAP debug adapter with a supported launch flow.
- **Declarations** — the adapter implements `DeclarationExtractor`: it can show the
  declaration source at a position in Peek/Symbol Origin Lens without asking the
  server.
- **Usages** — the adapter implements `UsageClassifier`: it labels each reference as
  declaration/write/read in the Usages view.

Capabilities are derived from the interfaces an adapter implements
(`language.CapabilitiesOf`), never declared by hand. A language with documents and a
server but no project detection is an **editor-only** row: the editor works, there is
no project unit, run configuration or test tree for it. See
[CODE-STUDIO.md](CODE-STUDIO.md#editor-only-languages) for the servers each of them
uses and for the reasons a language has no Debug row.

## Capabilities

<!-- capability-matrix:start -->
| Language | ID | Project detection | Documents | Language server | Run | Tests | Debug | Declarations | Usages |
|---|---|---|---|---|---|---|---|---|---|
| C# | `csharp` | yes | yes | yes | yes | yes | yes | — | — |
| C/C++ | `cpp` | yes | yes | yes | yes | yes | yes | — | — |
| CMake | `cmake` | — | yes | yes | — | — | — | — | — |
| CSS | `css` | — | yes | yes | — | — | — | — | — |
| Clojure | `clojure` | yes | yes | yes | — | — | — | — | — |
| Dart | `dart` | yes | yes | yes | yes | yes | yes | — | — |
| Dockerfile | `dockerfile` | — | yes | yes | — | — | — | — | — |
| Elixir | `elixir` | yes | yes | yes | yes | yes | — | — | — |
| Erlang | `erlang` | yes | yes | yes | — | — | — | — | — |
| F# | `fsharp` | yes | yes | yes | yes | yes | yes | — | — |
| Go | `go` | yes | yes | — | yes | yes | yes | yes | yes |
| GraphQL | `graphql` | — | yes | yes | — | — | — | — | — |
| Groovy | `groovy` | — | yes | yes | — | — | — | — | — |
| HTML | `html` | yes | yes | yes | — | — | — | — | — |
| Haskell | `haskell` | yes | yes | yes | — | yes | — | — | — |
| JSON | `json` | — | yes | yes | — | — | — | — | — |
| Java | `java` | yes | yes | yes | yes | yes | yes | — | — |
| Julia | `julia` | yes | yes | yes | yes | — | — | — | — |
| Kotlin | `kotlin` | — | yes | yes | — | — | — | — | — |
| LaTeX | `latex` | — | yes | yes | — | — | — | — | — |
| Lua | `lua` | yes | yes | yes | yes | yes | — | — | — |
| Markdown | `markdown` | — | yes | yes | — | — | — | — | — |
| Nix | `nix` | — | yes | yes | — | — | — | — | — |
| OCaml | `ocaml` | yes | yes | yes | — | — | — | — | — |
| Objective-C | `objective-c` | — | yes | yes | yes | — | yes | — | — |
| PHP | `php` | yes | yes | yes | yes | yes | yes | — | — |
| Perl | `perl` | yes | yes | yes | yes | yes | — | — | — |
| PowerShell | `powershell` | — | yes | yes | yes | — | — | — | — |
| Protocol Buffers | `proto` | yes | yes | yes | — | — | — | — | — |
| Python | `python` | yes | yes | yes | yes | yes | yes | — | — |
| R | `r` | yes | yes | yes | yes | — | — | — | — |
| Ruby | `ruby` | yes | yes | yes | yes | yes | — | — | — |
| Rust | `rust` | yes | yes | yes | yes | yes | yes | — | — |
| SQL | `sql` | — | yes | yes | — | — | — | — | — |
| Scala | `scala` | yes | yes | yes | — | yes | — | — | — |
| Shell Script | `shellscript` | — | yes | yes | — | — | — | — | — |
| Svelte | `svelte` | — | yes | yes | — | — | — | — | — |
| Swift | `swift` | yes | yes | yes | yes | yes | yes | — | — |
| TOML | `toml` | — | yes | yes | — | — | — | — | — |
| Terraform | `terraform` | — | yes | yes | — | — | — | — | — |
| TypeScript | `typescript` | yes | yes | yes | — | yes | yes | — | — |
| Vue | `vue` | — | yes | yes | — | — | — | — | — |
| XML | `xml` | — | yes | yes | — | — | — | — | — |
| YAML | `yaml` | — | yes | yes | — | — | — | — | — |
| Zig | `zig` | yes | yes | yes | yes | yes | yes | — | — |
<!-- capability-matrix:end -->

## Verification status

The matrix above is about implementation. Verification is a separate axis and is
**not** claimed per language without evidence: an automated suite passing is not a
desktop acceptance.

| Language | Automated evidence (in this repository) | Native desktop acceptance |
|---|---|---|
| Go | Unit and integration suites, `-race`, real `gopls` and Delve, process-tree and ConPTY checks (Windows and Linux). | Open: M1–M31 manual checks in the local `mds/todo-ide.md`. |
| Java | Real `quarkus-super-heroes` reactor: compile, tests with Docker Dev Services, Eclipse JDT LS importing every module. | Open: JS-17.M1–M4 in the local `mds/MANUAL-CHECK.md`. |
| JavaScript / TypeScript | Vitest/Jest/node-test runners, web language servers, Live Preview. | Not recorded. |
| Python | Real pytest and real debugpy runs against a local interpreter; pinned basedpyright per unit. | Open: PY-M* in `mds/MANUAL-CHECK.md`. |
| Rust | Real `cargo`, `rustup`, `rust-analyzer` and CodeLLDB runs, including attach by PID. | Open: RS-M1–RS-M10 in `mds/MANUAL-CHECK.md`. |
| Editor-only languages | Adapter table driven: `internal/languages/declared/table.go`, covered by the contract tests. | Not recorded. |

Rules:

- **supported** means the capability is implemented *and* its native flow has been
  accepted on at least one representative platform.
- **partial** means a documented limit (for example single-test rerun and failure
  locations are not available for `ctest`, `dotnet test`, PHPUnit and `swift test`).
- **experimental** means the capability runs only with opt-in setup that is not the
  default path.
- **not supported** means no adapter claims it; the UI must say so.
- **not yet verified** means implemented with automated evidence only. Most desktop
  rows are here today, and that is a statement about evidence, not about quality.

`mds/*` planning documents are local to the maintainer and are not published; the
published status of manual checks is in [ISSUES.md](ISSUES.md).

## How to update

```bash
ADOMNIA_UPDATE_MATRIX=1 go test ./internal/codestudio -run TestCapabilityMatrixDocumentMatchesRegistry
go test ./internal/codestudio -run 'TestCapabilityMatrix'
```

The first command rewrites the table between the markers; the second verifies it.
Update the verification table by hand, with the evidence, when a native check is
actually run.
