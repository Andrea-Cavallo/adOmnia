# Release Process

adOmnia releases are driven by Git tags and GitHub Actions.

## v0.9.73 release notes: an arcade in the Hub

See [the full v0.9.73 notes](releases/v0.9.73.md): Snake, Tris, Pong and
Asteroids on one dot-matrix renderer behind the FOLD wordmark, chosen at
random, and arrow keys that no longer leak to the app while playing.

## v0.9.72 release notes: FOLD, a wordmark and a game of Snake

See [the full v0.9.72 notes](releases/v0.9.72.md): FOLD in the Hub with the
adOmnia wordmark in the accent color, a dot-matrix Snake behind it, dot-matrix
time and date, and a brand that follows the palette.

## v0.9.71 release notes: a Hub that knows your day

See [the full v0.9.71 notes](releases/v0.9.71.md): a Nothing-inspired Today
column with a live dot-matrix clock and a daily request/error counter, an
executable icon that matches the app, and resizable Database Studio columns.

## v0.9.70 release notes: Live Collaboration and a new identity

See [the full v0.9.70 notes](releases/v0.9.70.md): secure LAN sharing of
collections, requests and environments, a new theme-aware icon, a quieter
interface and a thinner Go binding layer.

## v0.9.69 release notes: coherent design and personal palettes

See [the full v0.9.69 notes](releases/v0.9.69.md) for the editorial Hub, shared
Dark/White visual system, locally saved custom accent and IDE extension integration.

Recovery latency checks retain the 500 ms budget at the 95th percentile, with
repeated recovery loads validating every buffer and content hash. Maximum snapshot
latency stays in the test logs to expose isolated runner filesystem spikes.
`main` is the default branch; `develop` remains the development branch.

## v0.9.68 release notes: chat understands the open file

See [the full v0.9.68 notes](releases/v0.9.68.md): milk and Copilot receive the
current editor buffer and a filtered project index, including from detached
windows, with visible attachment choices and project AI rules respected.

## v0.9.67 release notes: modular workspace and stable Git Sync navigation

See [the full v0.9.67 notes](releases/v0.9.67.md): modular Go Studio tools detach
into native windows and automatically free space in the main IDE. Git Sync opens safely from
the sidebar when there is no active request or collection, including a closed
active tab. This fixes the reported `request` exception.

## v0.9.66 release notes: flexible tools, remote execution and extensions

See [the full v0.9.66 notes](releases/v0.9.66.md): movable, maximizable and
native detached Go Studio tool views; Kafka producer/consumer roles; WSL/SSH/container
execution; pod debug/profile/trace; WASI, signed plugins and developer hot reload;
and package-manager templates with explicit publication requirements.

## v0.9.64 release notes: AI that knows your workspace

See [the full v0.9.64 notes](releases/v0.9.64.md): 18 AI actions in the gO Studio
editor build prompts from the real workspace (problems, references, Git diff,
failing tests, coverage, architecture analysis). milk settings add agents for
API keys already in your environment, without writing the key to disk.

## v0.9.63 release notes: a milk chat you can read

The [milk](https://github.com/scoutme/milk) chat is redesigned for reading:
Geist prose with real Markdown, aligned slash-command output, a chip for the
agent that answered, foldable reasoning and tool calls. Project tree folders
always show their icon.

## v0.9.62 release notes: install and update milk from gO Studio

See [the full v0.9.62 notes](releases/v0.9.62.md): *milk settings* installs or
updates [milk](https://github.com/scoutme/milk) from its official releases with
SHA-256 verification, and an old milk is reported as too old instead of failing.

## v0.9.61 release notes: milk in gO Studio and a fuller Kubernetes Studio

See [the full v0.9.61 notes](releases/v0.9.61.md): [milk](https://github.com/scoutme/milk)
as an AI chat beside the editor (cheap/deep agent routing over ACP, always the
milk you installed, so its updates arrive by updating milk), and Kubernetes
Studio with deployments, services, config maps, secret metadata, exec, file copy
and port forward.

## v0.9.60 release notes: P0 and P1 closed, the project understood from the code

See [the full v0.9.60 notes](releases/v0.9.60.md): Architecture and Interface
Explorer, data access and REST routes from the types, documentation generation,
context propagation across packages with a drawn graph, Error Handling
Intelligence, statistical benchmark comparisons, Fuzzing Studio, the API
Workspace window with its collections, and native Linux sessions.

## v0.9.59 release notes: every studio beside the code

See [the full v0.9.59 notes](releases/v0.9.59.md): open any module in its own
window from the rail (right-click or Shift+click) or from the new Studios
launcher in Go Studio, links from the code reach the window where the module
lives, and module windows save before closing and never overwrite each other.

## v0.9.58 release notes: modules in their own windows, Security Studio and live profiles

See [the full v0.9.58 notes](releases/v0.9.58.md): any module (API workspace,
Database, Broker, Mock and more) opens in its own window next to the code,
Go Studio gets a Security panel with govulncheck reachability and an offline
code scan, Start/Stop Workspace for the whole local environment, profiles from
a running service with a call graph and line cost in the editor, colour-coded
comment tags and a cleaner one-screen Hub.

## v0.9.57 release notes: the IDE Platform, SonarQube and one-click profiles

See [the full v0.9.57 notes](releases/v0.9.57.md): Go Studio runs on a
language-neutral IDE core with Go as its first adapter, the UI learns languages
from the backend (icons for Java, Kotlin, PHP, Ruby, .NET, C/C++ and more),
optional SonarQube analysis with baseline and AI fixes, one-click CPU/memory
profiles and execution traces, redesigned performance charts and AI-ready
performance reports.

## v0.9.56 release notes: Performance Studio, Go trace and the end of the foundations

See [the full v0.9.56 notes](releases/v0.9.56.md): pprof profiles and execution
traces read inside Go Studio, the debugger shows where goroutines were created
and the real pending defers, Move Symbol to Package with a build check before
the preview, total coverage against the base branch, a commit dialog with real
per-file diffs, protection against pushing local go.mod replaces, image preview,
visible gopls activity and the shell picker beside the terminal tabs.

## v0.9.55 release notes: one network policy and private Go modules

See [the full v0.9.55 notes](releases/v0.9.55.md): an app-wide offline mode, one
corporate proxy and CA bundle for every connection, an in-memory network activity
log, private Go module credentials through the Git credential manager with a
registry test, and the Go Studio minimap removed.

## v0.9.54 release notes: Go Studio for teams and enterprise networks

See [the full v0.9.54 notes](releases/v0.9.54.md): Flaky Test Detector, patch and
per-function coverage, lint on changed files with a shared baseline, a smarter
commit dialog, disassembly and memory in the debugger, offline/air-gapped and
proxy-aware toolchains, per-project AI policy, faster Find in Files, plus Finder
folders, a grouped Structure panel and a full-height minimap.

## v0.9.53 release notes: cleaner window, one-screen Hub and Context Inspector

See [the full v0.9.53 notes](releases/v0.9.53.md): the system title bar is hidden
by default again, detached Go Studio windows share the app chrome, the Hub fits on
one screen, Go Studio adds a Context Propagation Inspector, and a gopls startup
error ("addView called before server initialized") is fixed.

## v0.9.52 release notes: readable logs, AI privacy and a visual go.mod editor

See [the full v0.9.52 notes](releases/v0.9.52.md): colour-coded Run console and
Log Inspector, `.adomnia/aiignore` and reversible secret redaction for Fix with AI,
partial apply in the change preview, a visual go.mod editor with version
downgrade, and per-workspace crash recovery.

## v0.9.51 release notes: faster Go Studio, Apple-light IDE and deeper runtime context

See [the full v0.9.51 notes](releases/v0.9.51.md): Go Studio adds one-click
Light/Dark controls and an Apple-inspired light skin, restores the Hub's light
a0 illustration, detects local Go toolchains instantly on restricted networks,
restores project terminals, adds dependency/runtime views, Change Signature,
conflict resolution and stronger crash recovery.

## v0.9.49 release notes: Live Development Session, terminal toolbox and no title bar

See [the full v0.9.49 notes](releases/v0.9.49.md): a Go service started from
Go Studio is shared by every tool (Debug Request, request ↔ code, what a
request caused), GitHub Copilot arrives in Go Studio (enterprise-aware ghost
text), the Go Studio terminal gains rename, split, clickable paths
and stack traces, search, clean copy, history and `go test` detection, the
panel header replaces the separate title bar (app titlebar by default), and
Go Studio adds Low-Resource Mode, diagnostics throttling and large-output
limits, plus runtime value inspectors and Benchmark Studio.

## v0.9.48 release notes: a cleaner gO rail and Project refresh controls

See [the full v0.9.48 notes](releases/v0.9.48.md): Go Studio's Project view
gets context-sensitive IntelliJ-style code actions, explicit Reload from Disk
and Refresh Folder / Project controls that protect dirty buffers. The compact
left rail now uses the transparent cyan gO mark, the README shows the current
Go Studio workspace, and the Brick Workshop skin has been removed completely.

## v0.9.42 release notes: Concurrency View, race comparison and an IDE-grade editor

See [the full v0.9.42 notes](releases/v0.9.42.md): the Concurrency View
completes the goroutine debugger (filters, stack grouping, relations, new
diagnostics, evidence badges, timeline, snapshot export), races are compared
across runs, and Go Studio gains editor core features, hierarchies, code
generation, vulnerability diagnostics, project tree decorations, go.work
management and Clone Repository.

## v0.9.41 release notes: a concurrency-first debugger

See [the full v0.9.41 notes](releases/v0.9.41.md): the Debug tool window is
rebuilt around goroutines, with states, blocked-on expressions, a
Concurrency view that flags deadlocks, blocked channels, mutex contention,
leaks and data races, navigable race detector reports, inline values while
paused and F6/F10/F5 debug keys.

## v0.9.40 release notes: a maximised editor, compose, key encryption and a new look

See [the full v0.9.40 notes](releases/v0.9.40.md): Maximize Editor and
fully closable panes, docker compose from the gutter, Send to API
Workspace, `.pem` keys opened and encrypted in Power Tools (standard
PKCS#8, verified with OpenSSL), and recent projects in the toolbar. Menus
and confirmation dialogs are redesigned, Jenkinsfiles and keys get their
own icons, the a0 launcher stays out of the way, and gopls runs lighter.

## v0.9.39 release notes: Go Studio runs Makefiles and Dockerfiles

See [the full v0.9.39 notes](releases/v0.9.39.md): the gutter ▶ runs
Makefile targets and builds or runs Dockerfiles with the real `make` and
`docker`. Stop really stops the container, and secret build args never
reach the command line. Every file type is now highlighted. Developer
Context turns the project's routes, services, datasources, contracts,
tables and topics into palette actions, and the Hub introduces the aO → gO
ecosystem.

## v0.9.38 release notes: Go Studio Fix with AI and real file icons

See [the full v0.9.38 notes](releases/v0.9.38.md): errors and warnings can
be fixed with the AI provider configured in adOmnia, always through a
reviewed preview, and every file list shows real technology icons.

## v0.9.37 release notes: Go Studio terminal, tests, debugger and GoLand parity

See [the full v0.9.37 notes](releases/v0.9.37.md): Go Studio adds a real
terminal, a structured test runner with coverage, the Delve debugger,
gopls refactoring and navigation, Git in the editor linked to Git Studio,
Project Services, separate project windows and a JetBrains-style chrome.

## v0.9.36 release notes: Go Studio becomes a real Go IDE

See [the full v0.9.36 notes](releases/v0.9.36.md): Go Studio now opens, edits,
understands, lints, runs and tests real Go projects. It adds gopls completion,
navigation, previewed rename and code actions; golangci-lint or staticcheck
findings; gutter ▶ actions for `func main` and tests; split editor, pinned
tabs and a symbolic breadcrumb; and a full GoLand-style menu bar. Debugger,
terminal and test runner tree come in later phases.

## v0.9.35 release notes: Go Studio foundation

See [the full v0.9.35 notes](releases/v0.9.35.md): adOmnia gains the
local-first Go Studio architecture, safe project sessions, a compact `gO`
entry in the existing rail and the first integrated desktop shell. Execution,
editing, gopls, terminal and debugger controls remain intentionally absent
until their gated implementation phases are complete.

## v0.9.34 release notes: a0 knows the product and builds mocks

See [the full v0.9.34 notes](releases/v0.9.34.md): a0 gains a real product
capability map, can generate local Mock Server endpoints and open panels from
chat, and replies in the user's language with bounded conversation context.

The release also lands the leaner startup and the extraction of a0: Bug Hunt
into a separate local project. The fresh Hub's static JavaScript graph falls
from 823,684 to 572,407 uncompressed bytes; closed editors, the command
palette, import parsers and the unconfigured AI companion are deferred, with a
CI startup budget to keep them out of the entry graph. Game source, tests and
artwork are preserved outside adOmnia, and no workspace or settings migration
is required.

## v0.9.33 release notes: a0 can act on the workspace

See [the full v0.9.33 notes](releases/v0.9.33.md): explicit Agent actions,
validated root request creation, a deterministic greeting-API command and a
live DeepSeek verification of the complete structured-action response.

## v0.9.32 release notes: smarter AI setup and native DeepSeek

See [the full v0.9.32 notes](releases/v0.9.32.md): native DeepSeek support,
automatic provider credential discovery, a generic English a0 conversation and
a responsive master-detail AI Engine settings experience.

## v0.9.31 release notes: a living Hub, deliberate play, and focused workspaces

See [the full v0.9.31 notes](releases/v0.9.31.md): a full-body reactive a0
mascot in the Hub, verified-AI chat entry, Bug Hunt launched only by an explicit
request to a0, the new Terminal Green appearance, consolidated customization
settings and a connection-first Broker Studio.

## v0.9.21 release notes: Developer Desk route and visual refresh

See [the full v0.9.21 notes](releases/v0.9.21.md): vertical opening, physical modules, code packets, new enemy art and focus handling.

## v0.9.20 release notes: connected platforming and slide-jumps

See [the full v0.9.20 notes](releases/v0.9.20.md): tuned movement, slide-jump momentum, controllable rebounds, connected desk routes and the larger active Brute finale.

## v0.9.19 release notes: a developer-world campaign and controllable boss gravity

See [the full v0.9.19 notes](releases/v0.9.19.md): three distinct worlds, flying
enemies and specialized attacks, tutorial rule overrides, and a three-phase
Monolith with timed gravity, a safe zone and destructible modules.

## v0.9.18 release notes: a0 has a personality, a bigger Localhost, and three lives

See [the full v0.9.18 notes](releases/v0.9.18.md): reactive expressions, landing
and ledge poses, checkpoint celebrations and contextual quips; Localhost grown by
roughly 50% with seven extra enemies; and three hearts that now cover the entire
campaign, with Game Over at zero. Previous records stay in their original storage
keys, while audio and accessibility settings migrate to the new campaign profile.

## v0.9.17 release notes: a beatable final boss, built platforms, and a dependency sweep

See [the full v0.9.17 notes](releases/v0.9.17.md): the arena slab that made
the Legacy Monolith unbeatable is fixed and guarded by a test, Bug Hunt
platforms become real chassis instead of rectangles, the start menu explains
itself, and every direct dependency moves to its current release.

## v0.9.16 release notes: parallel WebSocket sends, and a boss that rewrites the rules

See [the full v0.9.16 notes](releases/v0.9.16.md): concurrent WebSocket bursts
with `---` and `{{$i}}`, a debug gun and reactive enemies in Bug Hunt, a Legacy
Monolith that throws SOAP envelopes and rewrites one rule per phase, and a
one-spin secret.

## v0.9.15 release notes: Bug Hunt gets a chase and a grapple

See [the full v0.9.15 notes](releases/v0.9.15.md): the DELETE wave that eats the
floor of Production, and the magnetic grapple that chains swings into launches,
dashes and bug hits.

## v0.9.14 release notes: Bug Hunt encounter chains and bonus rushes

See [the full v0.9.14 notes](releases/v0.9.14.md): dash refills on hits, optional aerial encounters, timed bonus collections, score ranks and a final boss escalation.

## v0.9.13 release notes: Bug Hunt becomes a campaign with developer powers

See [the full v0.9.13 notes](releases/v0.9.13.md). The hidden hub game grows to
three stages with a boss, double jump, dash and combos, plus four developer
power-ups: git revert, Breakpoint, sudo and Garbage Collector.

## v0.9.12 release notes: a MongoDB explorer and a hidden game

See [the full v0.9.12 notes](releases/v0.9.12.md). Database Studio gains a
Compass-style MongoDB explorer with documents, aggregations, schema, indexes and
validation; MongoDB auth now survives servers that disable SCRAM-SHA-1; and the
hub hides a small offline platformer, a0: Bug Hunt.

## v0.9.11 release notes: performance flows that explain the load

See [the full v0.9.11 notes](releases/v0.9.11.md). Flow Stress gains editable
stages, CSV data allocation, APDEX, clear workload/distribution/trend charts,
local run history and a portable `adomnia stress` CI runner with release-gate
exit codes.

## v0.9.10 release notes: AI-assisted flows and trustworthy diagnostics

See [the full v0.9.10 notes](releases/v0.9.10.md). This release completes the
Log Inspector P3 investigation workflow, turns natural-language API sequences
into executable flows with data handoffs and recovery branches, and upgrades
stress runs with scenario presets, release gates and actionable diagnostics.

## v0.9.9 release notes: flow stress tests and faster variables

See [the full v0.9.9 notes](releases/v0.9.9.md). Flows gain a concurrent stress
test with CSV/JSON/HTML exports and baseline comparison; `{{var}}` tokens get a
right-click menu to edit or copy them; flow-extracted variables are no longer
flagged unresolved.

## v0.9.8 release notes: complete local log investigations

See [the full v0.9.8 notes](releases/v0.9.8.md). This release completes the
daily Log Inspector workflow: managed and persistent sources, structured search,
custom layouts, redacted evidence, reproduction handoffs, live tails and a
disk-backed path for logs larger than RAM.

## v0.9.7 release notes: Log Inspector reliability pass

See [the full v0.9.7 notes](releases/v0.9.7.md). This is the public release for
the Log Inspector reliability pass: trace-only chains, recovered retry outcomes,
observed-window durations, `attributes.http.*` payloads, source provenance and
a Linux CI packaging fix.

## v0.9.6 release notes: Log Inspector reliability pass

Superseded by `v0.9.7` after the tag workflow failed on an external Ubuntu apt
mirror before release publication. See [the archived notes](releases/v0.9.6.md).

## v0.9.5 release notes: Log Inspector reliability pass

Superseded by `v0.9.6` after the tag workflow failed on an external Ubuntu apt
mirror before release publication. See [the archived notes](releases/v0.9.5.md).

## v0.9.4 release notes: multi-file Log Inspector

See [the full v0.9.4 notes](releases/v0.9.4.md) for cross-file correlation,
dedicated request/response payload inspection, source-file search and columns
that adapt to the fields actually present in the imported logs.

## v0.9.3 release notes: request-level Log Inspector analysis

See [the full v0.9.3 notes](releases/v0.9.3.md) for end-to-end request grouping,
deterministic timeout and HTTP classification, enterprise slog/zap fields,
sensitive-data findings and reliable overlapping import cancellation.

## v0.9.2 release notes: faster log search and nested JSON

See [the full v0.9.2 notes](releases/v0.9.2.md) for automatic field discovery
and remembered log shapes, payload-key search, regular expressions and
alternatives, the widened field aliases, recursive nested-JSON unwrapping and the
rebuilt Log Inspector empty state.

## v0.9.1 release notes: first-class Log Inspector

See [the full v0.9.1 notes](releases/v0.9.1.md) for the dedicated Power Tools
navigation and the complete local log investigation workflow.

## v0.9.0 release notes: Log Inspector

See [the full v0.9.0 notes](releases/v0.9.0.md) for supported formats,
investigation workflow, correlation, large-file behavior and verification.

## v0.8.3 release notes: reliable recording and fluid flow panels

See [the full v0.8.3 notes](releases/v0.8.3.md) for recording, response mappings,
canvas/panel controls, compatibility and verification details.

## v0.8.2 release notes: dependency refresh and sidebar follow

- Full dependency refresh across Go and the frontend, clearing every open
  Dependabot advisory. `wails/v3` and `@wailsio/runtime` moved together from
  `3.0.0-beta.7`/`3.0.0-beta.5` to `3.0.0-beta.16`, keeping the version lock the
  IPC layer depends on. gRPC, the MongoDB driver, Sarama, and amqp091-go were
  updated, along with transitive `golang.org/x/{crypto,net,text}` bumps.
- Frontend: `lucide-react` 1.38.0, `zustand` 5.0.15, `vitest` 4.1.11, and
  `rollup-plugin-visualizer` 7.1.1.
- The collection sidebar now follows the active tab: it expands the full
  collection/folder path of the selected request and scrolls the row into view,
  so a deeply nested request is no longer hidden. An active search is preserved.
- The active request row is easier to spot — accent-tinted surface, medium
  weight, and `aria-current="page"` for assistive technology.

Verified with `go build ./...`, `go vet ./...`, `go test ./...`,
`npm run build`, and `npm test` (69 files, 273 tests passing).

## v0.8.1 release notes: API Flow recording

- API Flow is a core workspace again and is available from the primary navigation.
- The REST/API Composer can record completed sends locally. `Record` captures each
  request in execution order; `Stop` opens a naming dialog and creates an editable,
  executable flow with Start, request nodes, and Stop.
- Recorded snapshots preserve request templates, request configuration, scripts,
  assertions, source request/environment metadata, and execution timing/status.
  Direct credential values are redacted; variable and Vault references remain
  replayable.
- Saved flows now use schema version 4. Existing flow data is migrated on load;
  exports can be imported again as Flow JSON or Mermaid.
- The Flow workspace supports an empty New Flow canvas, request/condition editing,
  response extraction, ordering recorded steps, replay from a selected node, and
  cancellation of a running replay.

## Release Outputs

The build workflow produces:

- `adOmnia-<version>-windows-amd64.exe`
- `adOmnia-<version>-linux-amd64`
- `adOmnia-<version>-linux-amd64.tar.gz`
- `adOmnia-<version>-macos-universal.dmg`
- `SHA256SUMS.txt`

## Pre-Release Checklist

- [ ] `frontend/npm run build` passes.
- [ ] `go test ./...` passes.
- [ ] App launches on at least the primary development platform.
- [ ] Main workflows are smoke-tested: request send, environments, mock/proxy if changed.
- [ ] UI changes have screenshots or visual review.
- [ ] [CHANGELOG.md](../CHANGELOG.md) has the release notes.
- [ ] [README.md](../README.md) download instructions are still accurate.

## Create a Release

Update the desktop version in `build/config.yml`, both npm manifests and their
lockfiles, and `CHANGELOG.md`. Write the public release body in
`docs/releases/<tag>.md`; the tag build publishes that file as its release notes.
Older tags without a notes file retain generated GitHub notes.

Update changelog:

```bash
# Move [Unreleased] entries to the new version section.
git add CHANGELOG.md
git commit -m "chore: prepare release v0.1.0"
```

Create and push a tag:

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

GitHub Actions will:

1. Run checks.
2. Build Windows, Linux, and macOS artifacts.
3. Bundle artifacts and checksums.
4. Publish a GitHub Release for tags matching `v*`.

## CI Builds Without Release

Pushes to `main` or `develop` produce downloadable Actions artifacts but do not create a public Release.

Find them in:

**Actions -> Build Desktop Artifacts -> successful run -> Artifacts**

## Known Packaging Notes

- Windows artifacts are unsigned unless code signing is configured.
- macOS artifacts are unsigned/not notarized unless Apple signing credentials are configured.
- Linux packages are portable artifacts; `.deb` and `.rpm` are not produced. Snap and Flatpak manifests are maintained in `packaging/` (see `packaging/README.md`) and are not auto-published from CI.

## Package managers

On release publish, `.github/workflows/packaging.yml` renders the Scoop and
Homebrew manifests from the `packaging/` templates and pushes them to the
configured bucket/tap repos. Set the repository secrets `SCOOP_BUCKET_REPO`,
`HOMEBREW_TAP_REPO` and `PACKAGING_PAT` to enable auto-publish. Snap and Flatpak
are published by hand (`snapcraft upload`, Flathub review); see
[`packaging/README.md`](../packaging/README.md).
