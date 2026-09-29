# gO Studio 2027 — Master Checklist

> **Visione:** non costruire semplicemente “un IDE Go dentro adOmnia”, ma un ambiente di sviluppo Go completo in cui **codice, runtime, API, database, broker, log, trace, profiler e Git sono collegati tra loro**.
>
> **North Star:** _Write the service. Run it. Call it. Debug it. Inspect its database, messages, logs and runtime — without leaving the workspace._
>
> **Principio chiave:** **From code to runtime, everything is connected.**

---

# 0. Obiettivi di prodotto

- [ ] gO Studio deve poter sostituire un IDE Go tradizionale per il lavoro quotidiano. — *funzioni P0 presenti; resta la verifica manuale M1–M31 in `todo-ide.md`.*
- [x] Deve essere valido anche senza AI. — *l'unica funzione AI (Fix with AI) compare solo con un provider configurato e verificato.*
- [x] Deve essere local-first. — *progetti, stato (bbolt `goide`), SDK e tool restano sulla macchina; rete solo su azione esplicita.*
- [ ] Deve funzionare bene su repository piccoli, monorepo e workspace multi-module. — *supporto `go.work`, multi-modulo e folder mode c'è; prestazioni su monorepo grandi non misurate → §4.*
- [x] Deve trattare Go come linguaggio di prima classe, non come semplice editor syntax-highlighted. — *gopls, Delve, test runner strutturato, coverage, Go SDK per progetto.*
- [x] Deve sfruttare `gopls` invece di duplicarne le funzionalità. — *completion, navigazione, rename, code action, semantic token, inlay hint e diagnostica vengono da gopls.*
- [x] Deve usare Delve/DAP per il debugging reale. — *`internal/goide/dap`: launch, attach e remote.*
- [ ] Deve usare i tool ufficiali Go quando possibile: `go test`, `go vet`, `go list`, `go tool`, `pprof`, `trace`, `govulncheck`, race detector. — *integrati `go test`, `go vet`, `go generate`, `go fix`, `go mod why/graph`, `go doc`; mancano race UX → §9, `pprof`/`trace` → §13, `govulncheck` → §20.*
- [ ] Deve rendere visuali dati che oggi finiscono quasi sempre nel terminale. — *test tree e coverage sì; concurrency, profiler, benchmark → §8, §12, §13.*
- [ ] Deve collegare automaticamente codice ↔ API ↔ DB ↔ broker ↔ runtime. — *Developer Context collega codice ↔ API/DB/broker (v0.9.39); runtime → §14.*
- [ ] Deve avere una UX coerente con il resto di adOmnia. — *token condivisi, menu e dialog moderni (v0.9.40); resta la verifica visiva manuale.*
- [x] Deve poter essere usato senza account.
- [x] Telemetria disabilitata di default. — *adOmnia non ha telemetria; gopls parte con `GO_TELEMETRY_CHILD=2` (nessun processo telemetry, verificato), la modalità globale `go telemetry` resta dell'utente.*
- [x] Nessun lock-in cloud.
- [x] AI opzionale e provider-agnostic. — *Settings → AI: OpenAI, Anthropic, Gemini, DeepSeek, Hugging Face, compatibili OpenAI e Ollama locale.*

---

# 1. Priorità strategiche

## P0 — IDE realmente utilizzabile

- [ ] Editor professionale.
- [ ] `gopls`.
- [ ] Workspace.
- [ ] Run configurations.
- [ ] Debugger Delve.
- [ ] Test explorer.
- [ ] Terminale.
- [ ] Git.
- [ ] Go modules.
- [ ] Settings.
- [ ] Toolchain manager.

## P1 — IDE Go superiore alla media

- [ ] Concurrency view.
- [ ] Profiler integrato.
- [ ] Benchmark explorer.
- [ ] Fuzzing UX.
- [ ] Dependency intelligence.
- [ ] Security.
- [ ] Interface explorer.
- [ ] Context propagation inspector.
- [ ] Runtime Lens.
- [ ] Architecture Explorer.

## P2 — Differenziazione adOmnia

- [ ] Code → REST.
- [ ] Code → gRPC.
- [ ] Code → Kafka.
- [ ] Code → DB.
- [ ] Code → WebSocket.
- [ ] Distributed Request Debugger.
- [ ] Service Map runtime-aware.
- [ ] Reproduction Studio.
- [ ] Cross-service debugging.
- [ ] Unified local environment.

## P3 — Funzioni “2027”

- [ ] Runtime-aware AI.
- [ ] Automatic bug reproduction.
- [ ] Performance regression detection.
- [ ] Architectural drift detection.
- [ ] Smart refactoring multi-service.
- [ ] Continuous background code intelligence locale.
- [ ] Semantic workspace graph.
- [ ] Replay di richieste/eventi.
- [ ] Time-travel debugging dove tecnicamente possibile.

---

# 2. Editor Core

## Editing

- [ ] Syntax highlighting Go.
- [ ] Semantic highlighting tramite `gopls`.
- [ ] Bracket matching.
- [ ] Auto indentation.
- [ ] Code folding.
- [ ] Multiple cursors.
- [ ] Multi-selection.
- [ ] Column selection.
- [ ] Find/replace.
- [ ] Regex search.
- [ ] Search in files.
- [ ] Case-sensitive search.
- [ ] Whole-word search.
- [ ] Replace preview.
- [ ] Breadcrumbs.
- [ ] Sticky scopes.
- [ ] Minimap opzionale.
- [ ] Code lens.
- [ ] Inlay hints.
- [ ] Parameter hints.
- [ ] Type hints.
- [ ] Inline diagnostics.
- [ ] Error squiggles.
- [ ] Warning squiggles.
- [ ] Quick fixes.
- [ ] Light bulb actions.
- [ ] Autosave.
- [ ] Format on save.
- [ ] Organize imports on save.
- [ ] Trim trailing whitespace.
- [ ] EditorConfig support.
- [ ] Font ligatures.
- [ ] Zoom.
- [ ] Zen mode.
- [ ] Split editor verticale.
- [ ] Split editor orizzontale.
- [ ] Tab pinning.
- [ ] Tab preview.
- [ ] Recently closed tabs.
- [ ] Restore session.
- [ ] Diff editor.
- [ ] Merge editor.

## Navigazione codice

- [ ] Go to definition.
- [ ] Go to declaration.
- [ ] Go to type definition.
- [ ] Go to implementation.
- [ ] Go to references.
- [ ] Go to symbol.
- [ ] Go to file.
- [ ] Go to line.
- [ ] Go to test.
- [ ] Back/forward navigation.
- [ ] Call hierarchy.
- [ ] Type hierarchy.
- [ ] Implementations tree.
- [ ] File structure.
- [ ] Workspace symbols.
- [ ] Recent locations.
- [ ] Jump to last edit.
- [ ] Navigate errors.

## Refactoring

- [ ] Rename symbol.
- [ ] Extract variable.
- [ ] Extract constant.
- [ ] Extract method/function.
- [ ] Extract interface.
- [ ] Inline variable.
- [ ] Inline function quando sicuro.
- [ ] Move symbol.
- [ ] Change signature.
- [ ] Implement interface.
- [ ] Generate method stubs.
- [ ] Generate constructor.
- [ ] Generate getter/setter solo quando richiesto.
- [ ] Generate tests.
- [ ] Generate table-driven tests.
- [ ] Generate benchmark.
- [ ] Generate fuzz test.
- [ ] Safe preview di ogni refactoring.
- [ ] Multi-file refactoring preview.
- [ ] Undo refactoring.

---

# 3. gopls Integration

- [ ] Avvio automatico di `gopls`.
- [ ] Auto-detection versione.
- [ ] Download/install controllato.
- [ ] Selezione versione `gopls`.
- [ ] Health indicator.
- [ ] Restart language server.
- [ ] Log dedicato.
- [ ] Diagnostics panel.
- [ ] Semantic tokens.
- [ ] Completion.
- [ ] Signature help.
- [ ] Hover docs.
- [ ] References.
- [ ] Implementations.
- [ ] Call hierarchy.
- [ ] Type hierarchy.
- [ ] Rename.
- [ ] Code actions.
- [ ] Workspace symbols.
- [ ] Inlay hints.
- [ ] Vulnerability diagnostics dove disponibili.
- [ ] Supporto multi-module.
- [ ] Supporto `go.work`.
- [ ] Gestione repository grandi.
- [ ] Indexing incrementale.
- [ ] Cache persistente.
- [ ] Stato indexing visibile ma poco invasivo.
- [ ] Nessun blocco UI durante indexing.

---

# 4. Workspace e Project Model

## Workspace

- [ ] Open folder.
- [ ] Open repository.
- [ ] Open recent.
- [ ] Open multiple roots.
- [ ] Import existing Go project.
- [ ] Clone Git repository.
- [ ] New Go project wizard.
- [ ] New CLI project.
- [ ] New REST service.
- [ ] New gRPC service.
- [ ] New worker.
- [ ] New Kafka consumer/producer.
- [ ] New library.
- [ ] Project templates.
- [ ] Custom templates.

## Multi-module

- [ ] Rilevamento automatico di tutti i `go.mod`.
- [ ] Rilevamento `go.work`.
- [ ] Creazione visuale `go.work`.
- [ ] Aggiunta/rimozione module dal workspace.
- [ ] Vista module dependency.
- [ ] Supporto monorepo.
- [ ] Supporto repository con `/cmd/*`.
- [ ] Supporto repository con `/internal`.
- [ ] Supporto repository con più microservizi.
- [ ] Project graph.

## File explorer

- [ ] Git decorations.
- [ ] Diagnostics decorations.
- [ ] Test status decorations.
- [ ] File icon pack completo.
- [ ] Go file.
- [ ] Mod file.
- [ ] Sum file.
- [ ] Work file.
- [ ] Proto.
- [ ] YAML.
- [ ] JSON.
- [ ] XML.
- [ ] SQL.
- [ ] Dockerfile.
- [ ] Makefile.
- [ ] Markdown.
- [ ] Env.
- [ ] Shell.
- [ ] PowerShell.
- [ ] JavaScript/TypeScript.
- [ ] Terraform.
- [ ] Helm.
- [ ] Kubernetes manifests.

---

# 5. Go Toolchain Manager

- [ ] Rilevamento Go installato.
- [ ] Visualizzazione `GOROOT`.
- [ ] Visualizzazione `GOPATH`.
- [ ] Gestione `GOPROXY`.
- [ ] Gestione `GOPRIVATE`.
- [ ] Gestione `GONOSUMDB`.
- [ ] Gestione `GONOPROXY`.
- [ ] Gestione CGO.
- [ ] Build tags.
- [ ] GOOS.
- [ ] GOARCH.
- [ ] Toolchain per progetto.
- [ ] Toolchain globale.
- [ ] Supporto più versioni Go.
- [ ] Switch rapido toolchain.
- [ ] Compatibilità `toolchain` directive.
- [ ] Controllo versione minima richiesta.
- [ ] Segnalazione mismatch.
- [ ] Installazione tool utili.
- [ ] Aggiornamento tool.
- [ ] Tool health check.

## Tool support

- [ ] `gopls`.
- [ ] `dlv`.
- [ ] `govulncheck`.
- [ ] `staticcheck`.
- [ ] `golangci-lint` opzionale.
- [ ] `goimports`.
- [ ] `gofumpt` opzionale.
- [ ] `mockgen` / alternative configurabili.
- [ ] `stringer`.
- [ ] Tool custom definiti dall'utente.

---

# 6. Run Configurations

- [ ] Run package.
- [ ] Run file.
- [ ] Run command.
- [ ] Run test.
- [ ] Run benchmark.
- [ ] Run fuzz.
- [ ] Run tool.
- [ ] Debug package.
- [ ] Debug test.
- [ ] Attach debugger.
- [ ] Remote debug.
- [ ] Compound run configuration.

## Parametri configurabili

- [ ] Package.
- [ ] Working directory.
- [ ] Environment variables.
- [ ] Env file.
- [ ] Program arguments.
- [ ] Build arguments.
- [ ] Build tags.
- [ ] GOOS.
- [ ] GOARCH.
- [ ] Race detector.
- [ ] Coverage.
- [ ] Profiling.
- [ ] Debug flags.
- [ ] Port.
- [ ] Pre-run tasks.
- [ ] Post-run tasks.

## UX

- [ ] Run configuration persistenti.
- [ ] Condivisione via repository.
- [ ] Configurazioni private.
- [ ] Duplicate config.
- [ ] Run history.
- [ ] Pin configuration.
- [ ] Run current context.
- [ ] Rerun.
- [ ] Stop.
- [ ] Restart.
- [ ] Hot restart quando possibile.

---

# 7. Debugger Go con Delve

## Base

- [ ] Delve integrato.
- [ ] DAP.
- [ ] Breakpoint.
- [ ] Conditional breakpoint.
- [ ] Hit count breakpoint.
- [ ] Logpoint.
- [ ] Function breakpoint.
- [ ] Exception/panic breakpoint.
- [ ] Step over.
- [ ] Step into.
- [ ] Step out.
- [ ] Continue.
- [ ] Pause.
- [ ] Restart.
- [ ] Run to cursor.
- [ ] Set next statement dove supportato.
- [ ] Evaluate expression.
- [ ] Watches.
- [ ] Locals.
- [ ] Globals.
- [ ] Registers opzionali.
- [ ] Call stack.
- [ ] Threads/goroutines.
- [ ] Memory view.
- [ ] Disassembly view.
- [ ] Debug console.

## Go-specific

- [ ] Goroutine selector.
- [ ] Goroutine grouping.
- [ ] Goroutine state.
- [ ] Goroutine creation stack.
- [ ] Goroutine filtering.
- [ ] Show blocked goroutines.
- [ ] Show sleeping goroutines.
- [ ] Show goroutines waiting on channel.
- [ ] Show goroutines waiting on mutex.
- [ ] Panic inspector.
- [ ] Deferred call inspector.
- [ ] Interface dynamic type viewer.
- [ ] Slice internals viewer.
- [ ] Map viewer.
- [ ] Channel state viewer.
- [ ] Context values viewer.
- [ ] Error chain viewer.
- [ ] Wrapped errors viewer.

---

# 8. Concurrency View — Feature distintiva

## Visualizzazione

- [ ] Vista grafica goroutine.
- [ ] Stato: RUNNING.
- [ ] Stato: WAITING.
- [ ] Stato: BLOCKED.
- [ ] Stato: SLEEPING.
- [ ] Stato: SYSCALL.
- [ ] Raggruppamento per stack.
- [ ] Raggruppamento per funzione di origine.
- [ ] Raggruppamento per package.
- [ ] Timeline goroutine.
- [ ] Relazione goroutine → channel.
- [ ] Relazione goroutine → mutex.
- [ ] Relazione goroutine → waitgroup.
- [ ] Relazione goroutine → context.
- [ ] Relazione goroutine → network call.
- [ ] Relazione goroutine → DB query.

## Diagnostica

- [ ] Possibile goroutine leak.
- [ ] Channel senza consumer.
- [ ] Channel senza producer.
- [ ] Send potenzialmente bloccante.
- [ ] Receive potenzialmente bloccante.
- [ ] Mutex contention.
- [ ] RWMutex contention.
- [ ] Lock ordering sospetto.
- [ ] Possibile deadlock.
- [ ] WaitGroup misuse.
- [ ] Context non cancellato.
- [ ] Timer/ticker non stoppato.
- [ ] Worker pool saturation.
- [ ] Excessive goroutine count.

## Runtime confirmation

- [ ] Distinguere issue statiche da issue osservate runtime.
- [ ] Badge `STATIC`.
- [ ] Badge `OBSERVED`.
- [ ] Badge `CONFIRMED`.
- [ ] Collegamento diretto allo stack.
- [ ] Collegamento diretto alla riga di codice.
- [ ] Snapshot esportabile.

---

# 9. Race Detector UX

- [ ] Run with race.
- [ ] Parsing output race detector.
- [ ] Evidenziare entrambi gli accessi concorrenti.
- [ ] Mostrare stack A.
- [ ] Mostrare stack B.
- [ ] Collegare alle righe sorgenti.
- [ ] Mostrare goroutine coinvolte.
- [ ] Mostrare ordine temporale quando disponibile.
- [ ] Raggruppare race duplicate.
- [ ] Salvare sessione race.
- [ ] Confrontare run diverse.
- [ ] Generare test di regressione assistito.

---

# 10. Test Explorer

## Base

- [ ] Tree package → test.
- [ ] Subtests.
- [ ] Table-driven tests.
- [ ] Stato pass.
- [ ] Stato fail.
- [ ] Stato skipped.
- [ ] Durata.
- [ ] Output.
- [ ] Stack trace.
- [ ] Rerun failed.
- [ ] Rerun package.
- [ ] Debug test.
- [ ] Run selected tests.
- [ ] Search tests.
- [ ] Filter failed.
- [ ] Filter slow.
- [ ] Filter flaky.

## Coverage

- [ ] Coverage package.
- [ ] Coverage file.
- [ ] Coverage function.
- [ ] Inline coverage.
- [ ] Branch-like insights dove deducibili.
- [ ] Coverage diff rispetto a branch base.
- [ ] Coverage per PR.
- [ ] Highlight codice non coperto.

## Flaky Test Detector

- [ ] Run N times.
- [ ] Failure rate.
- [ ] Duration distribution.
- [ ] Seed tracking.
- [ ] Concurrency correlation.
- [ ] Flaky history.
- [ ] Badge flaky.
- [ ] Possibile causa.
- [ ] Generazione scenario riproducibile.

---

# 11. Fuzzing Studio

- [ ] Discover fuzz targets.
- [ ] Run fuzz.
- [ ] Stop fuzz.
- [ ] Corpus viewer.
- [ ] Crash input viewer.
- [ ] Minimized failing input.
- [ ] Replay failing case.
- [ ] Promote failing case a unit test.
- [ ] Corpus management.
- [ ] Fuzz session history.
- [ ] CPU/time limits.
- [ ] Parallelism controls.
- [ ] Crash deduplication.

---

# 12. Benchmark Studio

## Benchmark explorer

- [ ] Discover benchmark.
- [ ] Run selected benchmark.
- [ ] Run package benchmarks.
- [ ] `benchmem`.
- [ ] Iterations.
- [ ] Duration.
- [ ] ns/op.
- [ ] B/op.
- [ ] allocs/op.
- [ ] Custom benchmark metrics.
- [ ] Historical benchmark runs.

## Comparazioni

- [ ] Compare current vs previous.
- [ ] Compare branch vs main.
- [ ] Compare commit vs commit.
- [ ] Compare before/after refactor.
- [ ] Percentuale regressione.
- [ ] Percentuale miglioramento.
- [ ] Significance indicator quando calcolabile.
- [ ] Regression threshold configurabile.
- [ ] CI-friendly export.

---

# 13. Performance Studio

## Profiler

- [ ] CPU profile.
- [ ] Heap profile.
- [ ] Allocations profile.
- [ ] Goroutine profile.
- [ ] Mutex profile.
- [ ] Block profile.
- [ ] Thread creation profile dove disponibile.
- [ ] `pprof` integration.

## Visualizzazioni

- [ ] Top functions.
- [ ] Call graph.
- [ ] Flame graph.
- [ ] Icicle view.
- [ ] Source line cost.
- [ ] Package grouping.
- [ ] Hide runtime internals.
- [ ] Diff profiles.
- [ ] Search function.
- [ ] Navigate to source.

## Go trace

- [ ] Trace capture.
- [ ] Goroutine timeline.
- [ ] Scheduler activity.
- [ ] GC.
- [ ] Syscalls.
- [ ] Network blocking.
- [ ] Synchronization.
- [ ] Long-running goroutines.
- [ ] Runtime events.
- [ ] Navigate trace event → code.

---

# 14. Runtime Lens

> Mostrare informazioni runtime direttamente sopra o accanto al codice.

- [ ] Call count.
- [ ] Average duration.
- [ ] P50.
- [ ] P95.
- [ ] P99.
- [ ] Error count.
- [ ] Allocation estimate.
- [ ] CPU cost.
- [ ] Last execution.
- [ ] Hot path indicator.
- [ ] Slow path indicator.
- [ ] Runtime values opzionali.
- [ ] Feature disattivabile.
- [ ] Sampling per ridurre overhead.
- [ ] Privacy/local-only.

## Esempi

- [ ] Handler HTTP → request count.
- [ ] DB call → duration.
- [ ] Kafka publish → message count.
- [ ] Kafka consume → throughput.
- [ ] gRPC call → latency.
- [ ] Retry loop → retry count.
- [ ] Cache access → hit/miss.
- [ ] Function → allocations.
- [ ] Goroutine → lifetime.

---

# 15. Architecture Explorer

## Static architecture

- [ ] Package graph.
- [ ] Import graph.
- [ ] Call graph.
- [ ] Interface implementation graph.
- [ ] Module graph.
- [ ] Entry points.
- [ ] HTTP handlers.
- [ ] gRPC services.
- [ ] Kafka producers.
- [ ] Kafka consumers.
- [ ] DB repositories.
- [ ] Scheduled jobs.
- [ ] CLI commands.

## Runtime enrichment

- [ ] Evidenziare componenti realmente usati.
- [ ] Mostrare call frequency.
- [ ] Mostrare latency.
- [ ] Mostrare errors.
- [ ] Mostrare dependencies non usate.
- [ ] Mostrare edge dinamici.
- [ ] Mostrare runtime-only integration.

## UX

- [ ] Clic nodo → codice.
- [ ] Clic API → REST client.
- [ ] Clic gRPC → gRPC client.
- [ ] Clic topic → Kafka inspector.
- [ ] Clic DB → DB explorer.
- [ ] Clic service → service workspace.
- [ ] Clic trace → distributed debugger.

---

# 16. Interface Explorer

- [ ] Lista interface.
- [ ] Lista implementazioni.
- [ ] Implicit implementation detection.
- [ ] Visual graph.
- [ ] “Who uses this interface?”.
- [ ] “Who satisfies this interface?”.
- [ ] Missing methods.
- [ ] Generate methods.
- [ ] Detect interface too broad.
- [ ] Detect interface implemented only once.
- [ ] Consumer-side interface hint non invasivo.
- [ ] Navigate interface ↔ implementation.

---

# 17. Context Propagation Inspector

- [ ] Traccia `context.Context`.
- [ ] Evidenzia `context.Background()` dentro call chain.
- [ ] Evidenzia `context.TODO()`.
- [ ] Detect cancellation chain broken.
- [ ] Detect missing timeout.
- [ ] Detect timeout troppo ampio configurabile.
- [ ] Detect context stored in struct quando sospetto.
- [ ] Detect ignored cancellation.
- [ ] Detect leaked cancel function.
- [ ] Visual context graph.
- [ ] Context deadline viewer runtime.
- [ ] Context values viewer.
- [ ] Trace ID correlation.

---

# 18. Error Handling Intelligence

- [ ] Returned error ignored.
- [ ] Error shadowing.
- [ ] Incorrect wrapping.
- [ ] `%w` awareness.
- [ ] `errors.Is`.
- [ ] `errors.As`.
- [ ] Sentinel error navigation.
- [ ] Error type hierarchy.
- [ ] Unhandled errors.
- [ ] Lost context in returned errors.
- [ ] Panic usage analysis.
- [ ] Recover usage analysis.
- [ ] Nil + nil suspicious return patterns.
- [ ] Error path visualization.
- [ ] Generate contextual wrapping.
- [ ] Error chain debugger.

---

# 19. Go Modules & Dependency Studio

## go.mod

- [ ] Visual editor.
- [ ] Direct dependencies.
- [ ] Indirect dependencies.
- [ ] `replace`.
- [ ] `exclude`.
- [ ] `retract`.
- [ ] Go version.
- [ ] Toolchain directive.
- [ ] Module path.
- [ ] Upgrade dependency.
- [ ] Downgrade dependency.
- [ ] Remove dependency.
- [ ] `go mod tidy`.
- [ ] Preview tidy changes.

## Dependency graph

- [ ] Dependency tree.
- [ ] Why dependency exists.
- [ ] `go mod why`.
- [ ] Duplicate transitive dependencies.
- [ ] Module version chain.
- [ ] License display.
- [ ] Vulnerability badge.
- [ ] Outdated badge.
- [ ] Unused dependency indicator.
- [ ] Dependency weight estimate.
- [ ] Package count impact.

---

# 20. Security Studio

- [ ] `govulncheck`.
- [ ] Reachable vulnerability path.
- [ ] Vulnerability severity.
- [ ] Advisory detail.
- [ ] Fixed version.
- [ ] Dependency path.
- [ ] Call path.
- [ ] Open vulnerable source call.
- [ ] Upgrade preview.
- [ ] Secret scanning.
- [ ] Dangerous filesystem permissions.
- [ ] TLS misconfiguration hints.
- [ ] Weak crypto hints.
- [ ] Insecure HTTP usage hints.
- [ ] SQL injection static hints.
- [ ] Command injection static hints.
- [ ] Path traversal hints.
- [ ] Unsafe deserialization-like patterns dove applicabili.
- [ ] Security findings suppression con motivazione.
- [ ] Baseline per non inondare legacy projects.

---

# 21. Static Analysis

- [ ] `go vet`.
- [ ] `staticcheck`.
- [ ] Custom linter support.
- [ ] `golangci-lint` opzionale.
- [ ] Per-project linter settings.
- [ ] Inline diagnostics.
- [ ] Lint on save.
- [ ] Lint on demand.
- [ ] Lint changed files only.
- [ ] Quick fix.
- [ ] Suppression.
- [ ] Baseline.
- [ ] Quality panel.
- [ ] Technical debt trend.

---

# 22. Git Integration

## Base

- [ ] Status.
- [ ] Stage.
- [ ] Unstage.
- [ ] Commit.
- [ ] Amend.
- [ ] Push.
- [ ] Pull.
- [ ] Fetch.
- [ ] Branch.
- [ ] Tag.
- [ ] Stash.
- [ ] Cherry-pick.
- [ ] Revert.
- [ ] Reset.
- [ ] Rebase.
- [ ] Merge.
- [ ] Conflict resolver.

## IDE integration

- [ ] Gutter diff.
- [ ] Blame.
- [ ] File history.
- [ ] Line history.
- [ ] Commit graph.
- [ ] Compare branches.
- [ ] Compare commits.
- [ ] Changed symbols.
- [ ] Changed tests.
- [ ] Changed APIs.
- [ ] Changed DB interactions.
- [ ] Changed broker interactions.
- [ ] AI summary del diff opzionale.
- [ ] Pre-commit checks.
- [ ] Test affected code.

---

# 23. Terminale

- [ ] Integrated terminal.
- [ ] Multiple terminals.
- [ ] Rename terminal.
- [ ] Split terminal.
- [ ] Shell detection.
- [ ] PowerShell.
- [ ] CMD.
- [ ] Bash.
- [ ] Zsh.
- [ ] WSL.
- [ ] Environment per project.
- [ ] Clickable file paths.
- [ ] Clickable stack traces.
- [ ] Detect Go commands.
- [ ] Command history.
- [ ] Copy clean output.
- [ ] Search terminal.

---

# 24. API Integration — REST

## Code detection

- [ ] Riconoscere `net/http`.
- [ ] Riconoscere Gin.
- [ ] Riconoscere Echo.
- [ ] Riconoscere Fiber.
- [ ] Riconoscere Chi.
- [ ] Framework adapter estendibile.
- [ ] Individuare method.
- [ ] Individuare path.
- [ ] Individuare handler.
- [ ] Individuare middleware.
- [ ] Individuare request DTO.
- [ ] Individuare response DTO.

## Azioni inline

- [ ] `CALL`.
- [ ] `DEBUG CALL`.
- [ ] `OPEN IN API CLIENT`.
- [ ] `GENERATE REQUEST`.
- [ ] `MOCK`.
- [ ] `COPY CURL`.
- [ ] `OPENAPI`.

## Debug integration

- [ ] Send request → breakpoint.
- [ ] Correlation ID automatico.
- [ ] Request body inspector.
- [ ] Response inspector.
- [ ] Header inspector.
- [ ] Timing.
- [ ] Trace.
- [ ] Logs correlated.

---

# 25. gRPC Integration

- [ ] `.proto` support.
- [ ] Proto syntax highlighting.
- [ ] Proto navigation.
- [ ] Service explorer.
- [ ] Method explorer.
- [ ] Request editor.
- [ ] Metadata.
- [ ] TLS.
- [ ] mTLS.
- [ ] Reflection.
- [ ] Import proto.
- [ ] Generate Go code.
- [ ] Detect generated Go service.
- [ ] Link proto method → Go handler.
- [ ] Call method.
- [ ] Debug method.
- [ ] Streaming support.
- [ ] Server streaming.
- [ ] Client streaming.
- [ ] Bidirectional streaming.
- [ ] Message history.

---

# 26. Kafka / Broker Integration

## Detection

- [ ] Detect Kafka libraries.
- [ ] Detect producer.
- [ ] Detect consumer.
- [ ] Detect topic.
- [ ] Detect consumer group.
- [ ] Detect serializers.
- [ ] Detect retry topic.
- [ ] Detect dead-letter topic.

## Actions

- [ ] Open topic.
- [ ] Browse messages.
- [ ] Publish test message.
- [ ] Replay message.
- [ ] Copy message.
- [ ] Save message fixture.
- [ ] Debug consumer.
- [ ] Debug producer.
- [ ] Inspect lag.
- [ ] Inspect partitions.
- [ ] Inspect consumer groups.

## Code ↔ broker

- [ ] Topic → producer functions.
- [ ] Topic → consumer functions.
- [ ] Producer → topic.
- [ ] Consumer → topic.
- [ ] Message schema → Go struct.
- [ ] Message → breakpoint.
- [ ] Correlation ID propagation.

---

# 27. Database Integration

## Code intelligence

- [ ] Detect `database/sql`.
- [ ] Detect pgx.
- [ ] Detect GORM.
- [ ] Detect sqlx.
- [ ] Adapter architecture per ORM/driver.
- [ ] Detect datasource.
- [ ] Detect query.
- [ ] Detect table.
- [ ] Detect transaction.
- [ ] Detect prepared statements.

## SQL editor

- [ ] Syntax highlighting.
- [ ] Completion.
- [ ] Schema-aware completion.
- [ ] Query execution.
- [ ] Explain.
- [ ] Explain analyze.
- [ ] Result grid.
- [ ] Export.
- [ ] History.

## Code ↔ database

- [ ] Query line → open SQL.
- [ ] Query → schema.
- [ ] Table → repository methods.
- [ ] Runtime query duration.
- [ ] Rows returned.
- [ ] Slow query detection.
- [ ] N+1-like behavior hints.
- [ ] Transaction duration.
- [ ] Lock/wait hints quando disponibili.
- [ ] DB error → source line.

---

# 28. WebSocket Integration

- [ ] Detect WebSocket server.
- [ ] Detect WebSocket client.
- [ ] Connection explorer.
- [ ] Send message.
- [ ] Receive messages.
- [ ] Message history.
- [ ] JSON viewer.
- [ ] Binary payload viewer.
- [ ] Reconnect.
- [ ] Debug handler.
- [ ] Connection → goroutine.
- [ ] Connection → trace/log.

---

# 29. Docker e Containers

- [ ] Dockerfile support.
- [ ] Docker Compose support.
- [ ] Build image.
- [ ] Run container.
- [ ] Stop.
- [ ] Restart.
- [ ] Logs.
- [ ] Exec shell.
- [ ] Ports.
- [ ] Volumes.
- [ ] Environment.
- [ ] Container health.
- [ ] Attach debugger.
- [ ] Run tests in container.
- [ ] Run profiler in container.
- [ ] Container → local service mapping.
- [ ] Dev container support.
- [ ] BuildKit awareness.

---

# 30. Kubernetes / Remote Development

- [ ] Kubernetes contexts.
- [ ] Namespace selector.
- [ ] Pod viewer.
- [ ] Logs.
- [ ] Exec.
- [ ] Port forward.
- [ ] Copy file.
- [ ] Deployment overview.
- [ ] Service overview.
- [ ] ConfigMap.
- [ ] Secret metadata senza mostrare valori di default.
- [ ] Attach remote debugger.
- [ ] Remote profile.
- [ ] Remote trace.
- [ ] Remote logs correlated to source.
- [ ] SSH development.
- [ ] WSL development.
- [ ] Container development.

---

# 31. Service Map

## Static

- [ ] Identificare servizi.
- [ ] API edges.
- [ ] gRPC edges.
- [ ] Kafka edges.
- [ ] DB edges.
- [ ] Redis edges.
- [ ] WebSocket edges.
- [ ] External HTTP edges.

## Runtime

- [ ] Request rate.
- [ ] Error rate.
- [ ] Latency.
- [ ] Active connections.
- [ ] Kafka lag.
- [ ] DB latency.
- [ ] Downstream failures.
- [ ] Retry activity.

## Navigazione

- [ ] Service → project.
- [ ] Endpoint → handler.
- [ ] Kafka edge → topic.
- [ ] DB edge → datasource.
- [ ] Trace edge → source.
- [ ] Error edge → logs.
- [ ] Open full architecture.

---

# 32. Distributed Request Debugger — Killer Feature

> Debuggare una richiesta attraverso più componenti, non solo una funzione.

## Capture

- [ ] Generare correlation ID.
- [ ] Supportare trace ID.
- [ ] Collegare HTTP.
- [ ] Collegare gRPC.
- [ ] Collegare Kafka.
- [ ] Collegare DB.
- [ ] Collegare logs.
- [ ] Collegare goroutines.
- [ ] Collegare spans.
- [ ] Collegare retries.

## Timeline

- [ ] Timeline unica.
- [ ] Service boundaries.
- [ ] Network duration.
- [ ] Handler duration.
- [ ] DB duration.
- [ ] Broker delay.
- [ ] Retry delay.
- [ ] Error point.
- [ ] Parallel branches.
- [ ] Async branches.

## Source navigation

- [ ] Click span → funzione.
- [ ] Click DB → query.
- [ ] Click Kafka → producer/consumer.
- [ ] Click log → source.
- [ ] Click panic → stack.
- [ ] Click retry → policy.
- [ ] Click external call → client code.

## Debug workflow

- [ ] Replay request.
- [ ] Replay broker message.
- [ ] Re-run with debugger.
- [ ] Re-run with race detector.
- [ ] Re-run with profiler.
- [ ] Save session.
- [ ] Compare sessions.

---

# 33. Reproduction Studio

> Trasformare un bug osservato in uno scenario ripetibile.

- [ ] Capture request.
- [ ] Capture headers.
- [ ] Capture body.
- [ ] Capture env references.
- [ ] Capture relevant DB state.
- [ ] Capture broker message.
- [ ] Capture config.
- [ ] Capture feature flags.
- [ ] Capture stack.
- [ ] Capture logs.
- [ ] Capture trace.

## Output

- [ ] Generate unit test.
- [ ] Generate integration test.
- [ ] Generate HTTP request fixture.
- [ ] Generate Kafka fixture.
- [ ] Generate SQL fixture.
- [ ] Generate env template.
- [ ] Generate Docker/Compose reproduction where useful.
- [ ] Generate README reproduction steps.
- [ ] Strip secrets automatically.
- [ ] Mark non-deterministic dependencies.

---

# 34. Runtime-Aware AI

## Principio

- [ ] L'AI non deve conoscere solo il file aperto.
- [ ] Deve poter usare il semantic graph del workspace.
- [ ] Deve conoscere symbol references.
- [ ] Deve conoscere Git diff.
- [ ] Deve conoscere test results.
- [ ] Deve conoscere coverage.
- [ ] Deve conoscere compiler errors.
- [ ] Deve conoscere profiler.
- [ ] Deve conoscere runtime traces.
- [ ] Deve conoscere API.
- [ ] Deve conoscere DB schema.
- [ ] Deve conoscere broker metadata.
- [ ] Deve conoscere logs.
- [ ] Deve conoscere architecture graph.

## Azioni contestuali

- [ ] Explain code.
- [ ] Explain error.
- [ ] Generate tests.
- [ ] Generate benchmark.
- [ ] Generate fuzz target.
- [ ] Find race risks.
- [ ] Find goroutine leaks.
- [ ] Find allocation hotspots.
- [ ] Find missing context propagation.
- [ ] Improve error handling.
- [ ] Explain dependency.
- [ ] Explain architecture.
- [ ] Generate docs.
- [ ] Generate migration.
- [ ] Generate mock.
- [ ] Generate API call.
- [ ] Generate SQL query.
- [ ] Generate Kafka message.

## Safety / control

- [ ] Preview changes.
- [ ] Diff before apply.
- [ ] Apply single hunk.
- [ ] Apply file.
- [ ] Apply workspace changes.
- [ ] Undo.
- [ ] No silent modifications.
- [ ] Provider selection.
- [ ] Local model support.
- [ ] Cloud model opt-in.
- [ ] Secret redaction.
- [ ] Exclude paths.
- [ ] `.aiignore`-like support.

---

# 35. AI Debugging

- [ ] Panic analysis.
- [ ] Compiler error analysis.
- [ ] Test failure analysis.
- [ ] Race analysis.
- [ ] Deadlock analysis.
- [ ] Slow request analysis.
- [ ] Memory leak suspicion analysis.
- [ ] Allocation regression analysis.
- [ ] DB error analysis.
- [ ] Kafka failure analysis.
- [ ] gRPC error analysis.
- [ ] Context deadline analysis.

## AI debugging context

- [ ] Stack trace.
- [ ] Locals.
- [ ] Goroutines.
- [ ] Last logs.
- [ ] Recent request.
- [ ] Trace.
- [ ] Git diff.
- [ ] Relevant tests.
- [ ] Related functions.
- [ ] Runtime metrics.

## Actions

- [ ] “Show likely cause”.
- [ ] “Open relevant code”.
- [ ] “Generate fix”.
- [ ] “Generate regression test”.
- [ ] “Reproduce”.
- [ ] “Explain why”.
- [ ] “Compare with previous working commit”.

---

# 36. Semantic Workspace Graph

> Una rappresentazione persistente delle relazioni del progetto.

- [ ] Files.
- [ ] Packages.
- [ ] Symbols.
- [ ] Functions.
- [ ] Types.
- [ ] Interfaces.
- [ ] Implementations.
- [ ] Tests.
- [ ] Endpoints.
- [ ] gRPC methods.
- [ ] Topics.
- [ ] Consumers.
- [ ] Producers.
- [ ] DB tables.
- [ ] Queries.
- [ ] Config keys.
- [ ] Env vars.
- [ ] Services.
- [ ] External dependencies.

## Utilizzi

- [ ] Faster navigation.
- [ ] Impact analysis.
- [ ] AI context retrieval.
- [ ] Architecture visualization.
- [ ] Test selection.
- [ ] Security path analysis.
- [ ] Change impact analysis.
- [ ] Runtime correlation.

---

# 37. Change Impact Analysis

> Prima di modificare una funzione, capire cosa può rompere.

- [ ] Direct callers.
- [ ] Indirect callers.
- [ ] Interfaces affected.
- [ ] Tests affected.
- [ ] APIs affected.
- [ ] gRPC methods affected.
- [ ] Kafka flows affected.
- [ ] DB queries affected.
- [ ] Modules affected.
- [ ] Services affected.
- [ ] Public contracts affected.
- [ ] Config affected.

## UX

- [ ] `Impact` tab.
- [ ] Risk map.
- [ ] Suggested tests.
- [ ] Suggested integration calls.
- [ ] Suggested services to run.

---

# 38. Architectural Drift Detection

> Confrontare l'architettura desiderata con ciò che il codice sta diventando.

- [ ] Definire architecture rules.
- [ ] Package boundaries.
- [ ] Forbidden imports.
- [ ] Allowed dependencies.
- [ ] Layer rules.
- [ ] Domain boundaries.
- [ ] Service boundaries.
- [ ] No direct DB access outside repository.
- [ ] No broker calls from forbidden layers.
- [ ] No HTTP client from domain layer.
- [ ] Circular dependencies.
- [ ] Drift report.
- [ ] Diff architecture per commit/branch.

---

# 39. Smart Local Development Environment

- [ ] Detect required services.
- [ ] Detect DB.
- [ ] Detect Kafka.
- [ ] Detect Redis.
- [ ] Detect environment variables.
- [ ] Detect ports.
- [ ] Detect Docker Compose.
- [ ] Detect migrations.
- [ ] Detect seed data.

## One-click environment

- [ ] `Start workspace`.
- [ ] Start required containers.
- [ ] Run migrations.
- [ ] Seed DB.
- [ ] Start services.
- [ ] Wait health checks.
- [ ] Open API.
- [ ] Open logs.
- [ ] Stop workspace.
- [ ] Clean workspace.

---

# 40. Logs Studio

- [ ] Local process logs.
- [ ] Structured JSON logs.
- [ ] Pretty print.
- [ ] Search.
- [ ] Filter level.
- [ ] Filter service.
- [ ] Filter correlation ID.
- [ ] Filter trace ID.
- [ ] Filter goroutine.
- [ ] Click source location.
- [ ] Detect stack traces.
- [ ] Group repeated logs.
- [ ] Timeline.
- [ ] Multi-service merge.
- [ ] Highlight request lifecycle.
- [ ] Save log query.

---

# 41. Trace Studio

- [ ] OpenTelemetry compatibility.
- [ ] Local traces.
- [ ] Trace tree.
- [ ] Span timings.
- [ ] Service colors/theme coherent.
- [ ] Error spans.
- [ ] DB spans.
- [ ] HTTP spans.
- [ ] gRPC spans.
- [ ] Kafka spans.
- [ ] Custom spans.
- [ ] Span → source.
- [ ] Trace → distributed debugger.
- [ ] Compare traces.

---

# 42. Config & Environment Intelligence

- [ ] Detect env variable reads.
- [ ] Detect config keys.
- [ ] Show usages.
- [ ] Missing env warning.
- [ ] Undefined config warning.
- [ ] Unused config warning.
- [ ] Environment profiles.
- [ ] `.env` support.
- [ ] Secret masking.
- [ ] Config diff.
- [ ] Dev/test/staging profiles.
- [ ] Launch config binding.

---

# 43. Documentation Intelligence

- [ ] Go doc preview.
- [ ] Package docs.
- [ ] Exported symbol docs.
- [ ] Missing docs hints opzionali.
- [ ] Generate docs.
- [ ] Markdown preview.
- [ ] Diagram embedding.
- [ ] Architecture docs generation.
- [ ] API docs generation.
- [ ] OpenAPI generation/preview.
- [ ] Proto docs.
- [ ] Dependency report.
- [ ] ADR links.

---

# 44. UX Layout proposta

```text
┌───────────────────────────────────────────────────────────────────────┐
│                           gO STUDIO                                   │
├──────────────┬─────────────────────────────────────┬──────────────────┤
│              │                                     │                  │
│ WORKSPACE    │               CODE                  │     CONTEXT      │
│              │                                     │                  │
│ Files        │                                     │ API              │
│ Symbols      │                                     │ DB               │
│ Services     │                                     │ Kafka            │
│ Endpoints    │                                     │ Runtime          │
│ Tests        │                                     │ AI               │
│ Modules      │                                     │ Architecture     │
│              │                                     │                  │
├──────────────┴─────────────────────────────────────┴──────────────────┤
│ RUN │ TEST │ DEBUG │ LOGS │ TERMINAL │ PROFILE │ TRACE │ PROBLEMS    │
└───────────────────────────────────────────────────────────────────────┘
```

## Context panel intelligente

- [ ] Seleziono handler → API context.
- [ ] Seleziono SQL → DB context.
- [ ] Seleziono Kafka → broker context.
- [ ] Seleziono test → test context.
- [ ] Seleziono goroutine → concurrency context.
- [ ] Seleziono errore → debugging context.
- [ ] Seleziono dependency → module/security context.
- [ ] Seleziono interface → implementation context.
- [ ] Seleziono trace → runtime context.
- [ ] Panel collassabile.
- [ ] Nessuna UI sovraccarica.

---

# 45. Command Palette

- [ ] Ricerca comandi.
- [ ] Ricerca file.
- [ ] Ricerca symbol.
- [ ] Ricerca endpoint.
- [ ] Ricerca topic.
- [ ] Ricerca DB table.
- [ ] Ricerca test.
- [ ] Ricerca run config.
- [ ] Ricerca setting.
- [ ] Quick actions.
- [ ] Recent commands.
- [ ] Keyboard-first UX.

---

# 46. Keyboard Experience

- [ ] Keymap standard.
- [ ] Keymap JetBrains.
- [ ] Keymap VS Code.
- [ ] Custom keybindings.
- [ ] Vim mode opzionale.
- [ ] Emacs-like mode opzionale.
- [ ] Shortcut conflicts detector.
- [ ] Cheat sheet.
- [ ] Search actions by shortcut.

---

# 47. Plugin / Extension Architecture

- [ ] Public extension API.
- [ ] Language extension points.
- [ ] Framework adapters.
- [ ] Broker adapters.
- [ ] DB adapters.
- [ ] Analyzer extensions.
- [ ] Custom code actions.
- [ ] Custom panels.
- [ ] Custom templates.
- [ ] JS plugins.
- [ ] WASM plugins.
- [ ] Permission model.
- [ ] Sandboxing.
- [ ] Local plugin install.
- [ ] Signed plugin support.
- [ ] Plugin developer mode.

---

# 48. Enterprise / Legacy Go

- [ ] Corporate proxy.
- [ ] Private module repositories.
- [ ] GOPRIVATE UX.
- [ ] Custom CA certificates.
- [ ] mTLS.
- [ ] JKS/PKCS12 helper integration dove utile.
- [ ] Offline mode.
- [ ] Air-gapped mode.
- [ ] Internal artifact registry.
- [ ] Legacy SOAP services.
- [ ] WSDL.
- [ ] XML.
- [ ] WS-Security tooling.
- [ ] Corporate Git support.
- [ ] Audit-friendly settings export.

---

# 49. Performance e Scalabilità dell'IDE

- [ ] Startup veloce.
- [ ] Lazy loading.
- [ ] Incremental indexing.
- [ ] Partial workspace loading.
- [ ] Virtualized large trees.
- [ ] Large log handling.
- [ ] Large JSON handling.
- [ ] Large generated Go files.
- [ ] Monorepo support.
- [ ] Bounded memory caches.
- [ ] Background workers controllati.
- [ ] Cancelable operations.
- [ ] No UI freeze.
- [ ] Diagnostics throttling.
- [ ] Battery-aware mode laptop.
- [ ] Low-resource mode.

---

# 50. Privacy / Local-first

- [ ] Workspace resta locale.
- [ ] Nessun upload automatico.
- [ ] AI cloud opt-in.
- [ ] Provider scelto dall'utente.
- [ ] Local LLM support.
- [ ] Per-project AI permissions.
- [ ] Secret redaction.
- [ ] Path exclusions.
- [ ] Telemetry opt-in.
- [ ] Clear network activity panel.
- [ ] Offline mode.
- [ ] Export privacy settings.

---

# 51. “Do not build badly” checklist

- [ ] Non creare un clone incompleto di GoLand.
- [ ] Non creare una chat AI gigante come feature principale.
- [ ] Non duplicare `gopls`.
- [ ] Non creare debugger custom se Delve risolve già il core.
- [ ] Non mostrare 20 pannelli contemporaneamente.
- [ ] Non riempire l'editor di badge.
- [ ] Non rendere Runtime Lens sempre acceso.
- [ ] Non rendere l'AI obbligatoria.
- [ ] Non nascondere i tool standard Go.
- [ ] Non rompere workflow terminal-first.
- [ ] Non legare il prodotto a un solo framework Go.
- [ ] Non legare il prodotto a un solo provider AI.
- [ ] Non richiedere cloud per funzionalità locali.
- [ ] Non introdurre astrazioni magiche impossibili da debuggare.

---

# 52. Killer Features da comunicare

## Killer #1 — Concurrency View

- [ ] Goroutine graph.
- [ ] Channel relationships.
- [ ] Mutex contention.
- [ ] Race integration.
- [ ] Leak detection.
- [ ] Deadlock hints.
- [ ] Runtime confirmation.

**Messaggio:** _See what your goroutines are actually doing._

---

## Killer #2 — Runtime Lens

- [ ] Performance inline.
- [ ] Runtime counts.
- [ ] Errors inline.
- [ ] DB timings.
- [ ] Broker timings.
- [ ] Hot paths.

**Messaggio:** _Your code editor knows what happened at runtime._

---

## Killer #3 — Code → Everything

- [ ] Handler → REST.
- [ ] Proto → gRPC.
- [ ] Producer → Kafka.
- [ ] Consumer → Kafka.
- [ ] Query → DB.
- [ ] Trace → source.
- [ ] Log → source.

**Messaggio:** _Every integration is one click away from the code that implements it._

---

## Killer #4 — Distributed Request Debugger

- [ ] HTTP.
- [ ] gRPC.
- [ ] Kafka.
- [ ] DB.
- [ ] Logs.
- [ ] Trace.
- [ ] Source.

**Messaggio:** _Debug the request, not just the process._

---

## Killer #5 — Reproduction Studio

- [ ] Capture.
- [ ] Replay.
- [ ] Generate regression test.
- [ ] Remove secrets.
- [ ] Share reproducible scenario.

**Messaggio:** _Turn a production-like failure into a reproducible test._

---

# 53. Roadmap consigliata

## Phase 1 — “Real IDE”

- [ ] Editor.
- [ ] File explorer.
- [ ] `gopls`.
- [ ] Terminal.
- [ ] Run.
- [ ] Debug.
- [ ] Tests.
- [ ] Git.
- [ ] Go modules.
- [ ] Settings.
- [ ] Toolchain manager.
- [ ] Session restore.

### Exit criteria

- [ ] Posso importare un repository reale.
- [ ] Posso editarlo comodamente.
- [ ] Posso navigarlo.
- [ ] Posso compilarlo.
- [ ] Posso runnarlo.
- [ ] Posso debuggare.
- [ ] Posso eseguire test.
- [ ] Posso committare.
- [ ] Posso lavorare una giornata senza aprire un secondo IDE per funzioni base.

---

## Phase 2 — “Best Go Workflow”

- [ ] Concurrency View.
- [ ] Race UX.
- [ ] Benchmark Studio.
- [ ] Fuzz Studio.
- [ ] Performance Studio.
- [ ] Go trace.
- [ ] Interface Explorer.
- [ ] Context Inspector.
- [ ] Error intelligence.
- [ ] Security.
- [ ] Dependency Studio.

### Exit criteria

- [ ] Un bug concorrente è più facile da capire in gO che dal terminale.
- [ ] Un profiling session porta dal dato alla riga di codice in pochi click.
- [ ] Benchmark prima/dopo sono leggibili senza tool esterni.
- [ ] Una vulnerabilità mostra il percorso reale verso il codice.

---

## Phase 3 — “adOmnia Connected”

- [ ] REST integration.
- [ ] gRPC integration.
- [ ] Kafka integration.
- [ ] DB integration.
- [ ] WebSocket integration.
- [ ] Logs integration.
- [ ] Service Map.
- [ ] Architecture Explorer.

### Exit criteria

- [ ] Posso partire da un handler Go e chiamarlo senza ricreare manualmente la request.
- [ ] Posso partire da un consumer e aprire direttamente il topic.
- [ ] Posso partire da una query e aprire il DB.
- [ ] Posso partire da un trace e arrivare al codice.

---

## Phase 4 — “Runtime-Aware IDE”

- [ ] Runtime Lens.
- [ ] Distributed Request Debugger.
- [ ] Runtime architecture.
- [ ] Multi-service logs.
- [ ] Trace Studio.
- [ ] Reproduction Studio.
- [ ] Change Impact Analysis.

### Exit criteria

- [ ] Una richiesta può essere seguita dall'ingresso API al DB/broker.
- [ ] Ogni passaggio rilevante è navigabile verso il codice.
- [ ] Un errore può essere salvato e riprodotto.
- [ ] Un cambiamento mostra quali parti del sistema può impattare.

---

## Phase 5 — “2027 Intelligence”

- [ ] Semantic Workspace Graph.
- [ ] Runtime-aware AI.
- [ ] AI debugging.
- [ ] Architectural drift.
- [ ] Smart regression tests.
- [ ] Performance regression intelligence.
- [ ] Automatic reproducer.
- [ ] Multi-service refactoring assistance.

### Exit criteria

- [ ] L'AI usa informazioni reali del workspace e del runtime.
- [ ] L'AI non è una semplice chat.
- [ ] Le modifiche sono sempre previewabili.
- [ ] Il sistema può spiegare perché suggerisce una correzione.

---

# 54. MVP: cosa NON rimandare

Queste funzioni devono esserci abbastanza presto perché senza di loro gO sembrerà un editor e non un IDE:

- [ ] `gopls`.
- [ ] Debugger Delve.
- [ ] Run configurations.
- [ ] Test explorer.
- [ ] Git diff.
- [ ] Terminal.
- [ ] Go modules.
- [ ] Workspace restore.
- [ ] Multi-module support.
- [ ] Search everywhere.
- [ ] Keyboard shortcuts.
- [ ] Settings.
- [ ] Toolchain detection.

---

# 55. Funzioni che danno identità a gO

Se si dovessero scegliere **solo 8 funzioni distintive**, sceglierei:

- [ ] **Concurrency View**.
- [ ] **Runtime Lens**.
- [ ] **Code → REST/gRPC/Kafka/DB**.
- [ ] **Distributed Request Debugger**.
- [ ] **Architecture Explorer**.
- [ ] **Reproduction Studio**.
- [ ] **Semantic Workspace Graph**.
- [ ] **Runtime-aware AI**.

Queste sono le funzioni che possono far dire:

> “Questo non è soltanto un altro IDE Go.”

---

# 56. Nuove idee da valutare

## A. Live Dependency Heatmap

- [ ] Visualizzare quali package sono più usati runtime.
- [ ] Evidenziare dipendenze statiche mai attraversate.
- [ ] Evidenziare dipendenze centrali troppo accoppiate.
- [ ] Visualizzare “blast radius” di una modifica.

---

## B. API Contract Drift

- [ ] Confrontare handler con OpenAPI.
- [ ] Confrontare DTO con schema OpenAPI.
- [ ] Detect endpoint implementato ma non documentato.
- [ ] Detect endpoint documentato ma non implementato.
- [ ] Detect breaking changes.
- [ ] Diff API per branch.

---

## C. Event Contract Drift

- [ ] Schema Kafka ↔ Go struct.
- [ ] Producer ↔ consumer compatibility.
- [ ] Breaking event changes.
- [ ] Missing fields.
- [ ] Type mismatch.
- [ ] Version evolution.

---

## D. Runtime Snapshot

- [ ] Salva goroutines.
- [ ] Salva heap summary.
- [ ] Salva active requests.
- [ ] Salva broker activity.
- [ ] Salva recent logs.
- [ ] Salva DB activity.
- [ ] Salva trace.
- [ ] Compare snapshot before/after.

---

## E. “Why is this running?”

Su una goroutine/process/task:

- [ ] Mostrare chi l'ha creata.
- [ ] Da quale request è nata.
- [ ] Da quale message è nata.
- [ ] Da quanto tempo vive.
- [ ] Cosa sta aspettando.
- [ ] Quale context possiede.
- [ ] Quale cancellation path ha.

---

## F. “Why is this dependency here?”

- [ ] Module.
- [ ] Package.
- [ ] Import chain.
- [ ] Runtime usage.
- [ ] Security impact.
- [ ] Binary size impact.

---

## G. Binary Inspector

- [ ] Binary size.
- [ ] Package contribution.
- [ ] Symbol contribution.
- [ ] Embedded assets.
- [ ] Build metadata.
- [ ] Go version.
- [ ] Module versions.
- [ ] Compare binary size between commits.

---

## H. Startup Analyzer

- [ ] Startup duration.
- [ ] Slow init functions.
- [ ] Slow config loading.
- [ ] Slow dependency initialization.
- [ ] DB connect duration.
- [ ] Broker connect duration.
- [ ] HTTP server ready time.
- [ ] Ready signal timeline.

---

## I. Shutdown Analyzer

- [ ] Context cancellation.
- [ ] HTTP graceful shutdown.
- [ ] Pending goroutines.
- [ ] Pending Kafka messages.
- [ ] DB cleanup.
- [ ] Timeout exceeded.
- [ ] Resource leaks.
- [ ] “Why process does not exit?”

---

## J. Go Memory Model Helper

- [ ] Evidenziare accessi concorrenti.
- [ ] Spiegare happens-before relevante.
- [ ] Channel synchronization edges.
- [ ] Mutex synchronization edges.
- [ ] Atomic operations.
- [ ] Runtime race evidence.
- [ ] Collegamento a codice coinvolto.

---

# 57. Definition of Done per feature

Ogni nuova feature di gO dovrebbe essere considerata finita solo se:

- [ ] Funziona su Windows.
- [ ] Funziona su macOS.
- [ ] Funziona su Linux.
- [ ] Non blocca UI.
- [ ] Ha keyboard navigation.
- [ ] Ha error state.
- [ ] Ha empty state.
- [ ] Ha loading state.
- [ ] Ha cancellation.
- [ ] Ha logs diagnostici.
- [ ] Ha setting dedicati se necessari.
- [ ] È disattivabile se costosa.
- [ ] Funziona su repository medio/grande.
- [ ] Ha test.
- [ ] Ha documentazione minima.
- [ ] Non manda dati in rete senza consenso.
- [ ] Si integra visivamente con adOmnia.
- [ ] Si collega alle altre aree quando semanticamente utile.

---

# 58. KPI tecnici utili

- [ ] Time to first usable editor.
- [ ] Time to first diagnostics.
- [ ] Time to first completion.
- [ ] Workspace indexing time.
- [ ] Memory usage.
- [ ] CPU idle usage.
- [ ] Search latency.
- [ ] Go-to-definition latency.
- [ ] Debug startup latency.
- [ ] Test discovery latency.
- [ ] Large repo performance.
- [ ] Crash-free sessions.
- [ ] gopls restart frequency.
- [ ] Delve failure rate.

---

# 59. KPI di prodotto

- [ ] % utenti che usano gO senza aprire altro IDE.
- [ ] % sessioni con Run.
- [ ] % sessioni con Debug.
- [ ] % sessioni con Test.
- [ ] % utenti che usano Code → API.
- [ ] % utenti che usano Code → DB.
- [ ] % utenti che usano Code → Kafka.
- [ ] % utenti che usano Concurrency View.
- [ ] % utenti che usano Runtime Lens.
- [ ] % utenti che usano Distributed Debugger.
- [ ] % bug riprodotti tramite Reproduction Studio.
- [ ] Tempo medio code → running.
- [ ] Tempo medio error → relevant source.
- [ ] Tempo medio request → root cause.

---

# 60. Posizionamento finale

## Non:

> “A Go IDE inside adOmnia.”

## Meglio:

> **A complete Go development environment connected to your APIs, databases, brokers and runtime.**

## Oppure:

> **Build, run, debug and understand Go systems — from source code to runtime.**

## Oppure, come principio di prodotto:

> **From code to runtime, everything is connected.**

---

# 61. North Star Experience

Lo scenario ideale da raggiungere:

- [ ] Apro un repository.
- [ ] gO riconosce i module.
- [ ] gO riconosce i servizi.
- [ ] gO riconosce API, DB, broker e config.
- [ ] Avvio il workspace.
- [ ] Parte l'ambiente locale.
- [ ] Apro `CreateOrder`.
- [ ] Vedo che implementa `POST /orders`.
- [ ] Premo `CALL`.
- [ ] adOmnia prepara la request.
- [ ] Premo `DEBUG CALL`.
- [ ] Il breakpoint viene colpito.
- [ ] Vedo goroutine e context.
- [ ] La funzione esegue una query.
- [ ] Posso aprire quella query nel DB explorer.
- [ ] Pubblica un evento Kafka.
- [ ] Posso aprire quel topic direttamente.
- [ ] Il consumer di un altro servizio riceve il messaggio.
- [ ] Il distributed debugger collega i due servizi.
- [ ] Vedo log e trace della stessa operazione.
- [ ] Se qualcosa fallisce posso salvarne la riproduzione.
- [ ] Posso generare un regression test.
- [ ] Posso profilare la stessa richiesta.
- [ ] Posso confrontare performance prima/dopo il fix.

Quando questo flusso funziona bene, gO Studio non è più “un IDE aggiunto ad adOmnia”.

È il punto in cui **adOmnia diventa un ambiente di sviluppo completo per sistemi Go**.
