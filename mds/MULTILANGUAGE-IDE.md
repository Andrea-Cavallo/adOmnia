# Code Studio — Piano multi-linguaggio

> **Visione:** un solo IDE, `Code Studio`, che si adatta al progetto. Stesso editor, stessa UI di Run/Debug/Test, per qualunque linguaggio; ciò che cambia lo decide un *provider* del linguaggio, non un `if go / if java` sparso.
>
> **Sottotitolo:** _Build. Run. Debug._ · **Icona:** `</>` minimale, coerente con il rail sinistro · **Nome interno:** `code-studio` (nessun riferimento a Go).

Creato il 2026-10-17. Estende `docs/architecture/ide-multilanguage-refactor.md` (le 12 fasi di quel refactor sono chiuse: qui si usano le fondamenta, non si rifanno) e sostituisce, per la parte multi-linguaggio, i punti aperti di `03-GO-STUDIO-PIANO-UNIFICATO.md`.

**Regole del piano**
- Un task si spunta `[x]` solo quando è **fatto e verificato** (test mirati verdi o prova in app avviata). Build verde da sola non basta per le voci UI.
- Un commit verde per fase (o sotto-fase). Mai lasciare il ramo rotto a fine sessione.
- Contratti pubblici stabili: nomi dei binding Wails, JSON persistiti e file di workspace restano compatibili; si **migra nei loader** e si **aliasa** durante gli spostamenti (CLAUDE.md, "Build to extend").
- Generico nel core, specifico nell'adapter. Una capability si aggiunge solo insieme al suo primo consumatore reale. Niente interfacce con un'unica implementazione immaginaria.
- **Congelamento:** `03-GO-STUDIO-PIANO-UNIFICATO.md` vieta feature nuove finché il Gate Fase 1 (collaudo desktop) non è chiuso. Questo piano parte dopo quel gate; la Fase 1 (solo nome visibile) è l'unica eccezione proponibile, da confermare.
- **Verifiche manuali:** ogni voce "prova in app" (1.8, 2.8, 4.9, 8.8, gate di fase) va registrata in `MANUAL-CHECK.md` con ID `ML-<fase>.M<n>` e lo stesso ID qui; si spunta con evidenza (regole `mds/CLAUDE.md` 2–3). Qui restano codice e test automatici.
- Nessuna feature nuova di un linguaggio finché il suo adapter non passa il *contratto minimo* (Fase 4).

---

## Priorità operativa aggiornata — 2026-10-18

1. **P0: completamento Java e outline senza JDT LS**, definiti in [06-JAVA-SPRING-STUDIO.md](06-JAVA-SPRING-STUDIO.md), **JS-14.1–JS-14.6**. È il prossimo blocco richiesto dall'utente, prima degli altri ampliamenti.
2. Chiudere i gap Java già aperti e i collaudi; poi tab multilinea (10.9), formati commit AI (10.8) e datasource Spring (**JS-15** del piano 06).
3. Markdown/Yuque (7.6), rilevamento degli ecosistemi ancora mancanti (9.2/9.5/9.6), verifica distribuzione Homebrew (10.10).

Non riaprire funzioni già presenti: Git/diff, Double Shift, ricerca globale, cronologia locale, progetti/file multipli, monitor memoria e controlli LSP. Gli script già implementati in 7.4 si collaudano, non si duplicano.

---

## 0. Stato di partenza (verificato nel codice)

| Fatto | Dove |
| --- | --- |
| Core agnostico già diviso: `language`, `project`, `lsp`, `dap`, `run`, `testing`, `sdk`, `process`, `preview` | `internal/ide/*` |
| Due adapter: **Go** (gopls, Delve, test2json, SDK) e **web** (TS/JS/HTML/CSS/JSON, Live Preview) | `internal/languages/{golang,web}` |
| Registrazione linguaggi in un solo punto | `internal/goide/languages.go` |
| `run.Configuration` ha già `Language`, `LanguageOptions` (JSON opaco), `PreRun`, `PostRun`, `Compound`, `RestartOnSave`, `RestartPolicy`, `EnvFile`, `Docker` | `internal/ide/run/configuration.go` |
| Ma il DTO `goide.RunConfiguration` espone ancora campi piatti Go (`GOOS`, `GOARCH`, `BuildTags`, `GoArguments`, `Race`…) e `normalizeConfiguration` ha rami Go (`.go` obbligatorio, `RunKindGoTool`) | `internal/goide/runconfig.go` |
| UI run: form unico con molti input uguali, nessuna scelta guidata per tecnologia | `GoStudioRunConfigurations.tsx`, `GoStudioRunParameters.tsx`, `GoStudioRunTarget.tsx` |
| Naming: **737 file** citano `goide`, **368** citano `GoStudio`, **188 file** si chiamano `GoStudio*`; rail id `goide`; chiavi `adomnia.goide.*`; service Wails `GoIDE` | repo |
| Hub: titolo "Go Studio" in `frontend/src/lib/i18n.ts` (righe 31 e 319); card dell'hub in `layout/WelcomePanel.tsx` (gruppi tipo "API & Protocols") | frontend |

**Implicazione:** l'architettura è già pronta a più linguaggi; mancano (a) il nome, (b) lo strato *provider* sopra la run configuration, (c) la UI che lo usa, (d) gli adapter nuovi.

---

## Fase 1 — Naming user-visible: "Code Studio" nell'hub e nella UI

Obiettivo: l'utente non vede più "Go Studio" da nessuna parte. Nessun rename di file/package in questa fase (basso rischio, alto impatto).

- [x] 1.1 Inventario: elenco di tutte le stringhe visibili con "Go Studio" / "gO Studio" / "Go IDE" (`git grep -nI "Go Studio\|gO Studio\|Go IDE" -- frontend/src *.go`), classificate: _generico_ → "Code Studio"; _davvero Go-specifico_ (es. "Go tool flags", gopls) → resta Go.
- [x] 1.2 `frontend/src/lib/i18n.ts` (righe ~31 e ~319) e `uiI18n.ts`: `goide: 'Code Studio'`; aggiungere traduzione IT.
- [x] 1.3 Hub (`layout/WelcomePanel.tsx`): card **Code Studio**, sottotitolo **Build. Run. Debug.**, icona `</>` (riusare un `Icon.*` esistente; se manca, aggiungerlo accanto agli altri icon, stesso stroke/size).
- [x] 1.4 Rail sinistro: stessa icona `</>` e label "Code Studio"; tooltip e command palette allineati.
- [x] 1.5 Titoli finestra (`DetachedGoStudioWindow`, `DetachedStudioToolWindow`, finestra staccata `goidewindow`), dialog, empty state, toast, messaggi d'errore, help dialog degli shortcut.
- [x] 1.6 Messaggi del backend mostrati all'utente (stringhe in `internal/goide`, `internal/ide/*`) che dicono "Go Studio": rimuovere/rendere neutri.
- [x] 1.7 Test che asseriscono le vecchie stringhe: aggiornarli (`rg "Go Studio" -g "*.test.*"`).
- [ ] 1.8 (ML-1.M1–M4 in `MANUAL-CHECK.md`) Prova in app: hub, rail, finestra staccata, light + dark, IT + EN. Screenshot di conferma in `mds/archivio/` (opzionale).

**Gate Fase 1:** `npx tsc --noEmit` pulito, Vitest mirati verdi, nessuna occorrenza visibile di "Go Studio" nell'app (grep sugli screenshot/UI + grep sorgenti per le stringhe di UI).

---

## Fase 2 — Rename nel codice (id interni, file, simboli) con compatibilità

Obiettivo: nel codice non resta "Go Studio" come nome del prodotto. **Resta "Go" dove è davvero Go** (gopls, Delve, pprof, `internal/languages/golang`, flame graph/race/goroutine view, ecc.).

Decisioni (applicate, 2026-10-17):
- Rail id `goide` → `code-studio`. Il valore persistito è **migrato in lettura** (loader che accetta `goide` e riscrive `code-studio`).
- Chiavi storage `adomnia.goide.*` → `adomnia.codestudio.*` con **migrazione one-shot** (copia + non cancellare subito la vecchia per un rilascio, per poter tornare indietro).
- Service Wails `GoIDE`: **resta il nome del binding** finché non c'è motivo forte di rompere i call-site; si aggiunge l'alias/nuovo nome `CodeStudio` e si migra i call-site in modo graduale. _Se_ si rinomina, si rigenerano i binding con `go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.32 generate bindings`.
- File `.adomnia/run-configurations.json` (formato condiviso via Git): **invariato**, solo caricato con migrazione.

Sotto-fasi (un commit ciascuna, in quest'ordine):
- [x] 2.1 *(GIÀ OK: sostituita dalla regola unica di prefisso `GoStudio`→`CodeStudio`, i file davvero Go restano `CodeStudioGo*`; nessuna tabella necessaria, vedi registro 2026-10-17)* Classificare i 188 file `GoStudio*` in tre liste: **GENERICO** (→ `CodeStudio*`), **GO-SPECIFICO** (→ `Go*` senza "Studio", es. `GoFlameGraph`), **da dividere**. Salvare la lista in questo file (tabella sotto) prima di toccare nulla.
- [x] 2.2 Script di rename mirato (`git mv` + sostituzione simboli/import), un file di mappa `old→new`, eseguito in modo deterministico; **mai** sed globale cieco (cfr. `reference_inline_script_backslashes`). Lo script resta in `scripts/` solo se riusabile, altrimenti nello scratchpad.
- [x] 2.3 Cartelle frontend: `components/goide/` → `components/code-studio/`; `lib/goide/` → `lib/code-studio/`; `stores/goide*.ts` → `stores/codeStudio*.ts`; `lib/goide-api.ts` → `lib/code-studio-api.ts`. Lasciare re-export temporanei solo se serve per non rompere branch aperti.
- [x] 2.4 (go vet ./... pulito; go test codestudio 427s, copilot, root verdi) Backend: package host `internal/goide` → `internal/codestudio`; `goide_bindings.go` → `code_studio_bindings.go`; `internal/goidewindow` → `internal/codestudiowindow`. Aggiornare `architecture_test.go` (la regola "il core non importa adapter" deve restare verde) e import in `main.go`.
- [x] 2.5 Chiavi di storage + rail id + eventi Wails: introdurre i nuovi nomi, loader di migrazione, test di migrazione (stato vecchio → stato nuovo, idempotente).
- [x] 2.6 (link ai doc rinominati e frasi goffe corrette; i nomi legacy restano dove documentato in CLAUDE.md) `docs/`: `GO-STUDIO.md` → `CODE-STUDIO.md` (con sezione "Go" per le parti Go); aggiornare `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/adomnia-feature-catalog.en.md`, `docs/architecture/ide-multilanguage-refactor.md`, `docs/ISSUES.md`, `internal/**/CLAUDE.md`, `frontend/src/components/**/CLAUDE.md`. Non toccare `CHANGELOG.md` e `docs/releases/*` (storia).
- [x] 2.7 `npm run check:startup`: Code Studio resta **lazy**, mai importato da `App.tsx`/startup.
- [ ] 2.8 Verifica: `go vet ./...` (mai `go build .` nella root: sovrascrive `adomnia.exe`, usare `-o NUL`), `go test ./internal/ide/... ./internal/codestudio/... ./internal/languages/...`, `npx tsc --noEmit`, Vitest dell'area, `npm run build`, avvio `wails3 task dev` e giro completo (apri progetto, run, debug, finestra staccata, riavvio con stato vecchio per testare la migrazione).

**Gate Fase 2:** `git grep -nIi "go studio\|gostudio\|goide" -- . ":!CHANGELOG.md" ":!docs/releases" ":!mds/archivio" ":!mds/03-*"` restituisce solo: chiavi/alias di migrazione dichiarati, e occorrenze volute in file storici.

---

## Fase 3 — Modello run provider-driven

```
RunConfiguration → RuntimeProvider → ExecutionEngine
```

- `RunConfiguration`: dato persistito, **agnostico**. Campi comuni (nome, unità/modulo di appartenenza, `Language`, kind, target, cwd, args, env, envFile, profilo, beforeLaunch, restart, run target) + `LanguageOptions` opaco validato dal provider.
- `RuntimeProvider`: dichiarato dall'adapter. Dice: *schema dei campi*, *validazione*, *comando di avvio/build/test*, *capacità di debug*, *auto-detection*.
- `ExecutionEngine`: esiste già in `internal/ide/run` (manager/processes): avvia, ferma, riavvia, streamma log. Non conosce linguaggi.

Task:
- [x] 3.1 *(chiuso 2026-10-18: `Suggest` esiste (`run.SuggestionProvider`, Go/web/Java); `Capabilities` non aggiunto: nessun consumatore. Storico parziale 2026-10-17: `run.SchemaProvider` e `run.ConfigValidator` in `internal/ide/run/schema.go`, implementati da `golang.Language`; `Command` esiste già come `Runner.CommandSpec`; manca `Suggest` → Fase 5 e il secondo implementatore web)* Spec del contratto in `internal/ide/run` (o `language`): `RuntimeProvider` con soli metodi che hanno **un consumatore reale subito** — `Suggest(ctx, unit) []Suggestion`, `Schema(kind) FieldSchema`, `Validate(cfg) error`, `Command(cfg, action) Command` con `action ∈ {run, debug, test, build}`, `Capabilities()`. Il Go adapter è il primo implementatore, web il secondo.
- [x] 3.2 *(chiuso 2026-10-18: schema web non necessario, i suoi kind sono `command` generici senza campi propri; schema `go-tool` aggiunto al Go adapter. Storico: `FieldSchema` + test Go in `run_schema_test.go`; manca lo schema web e la sezione `basic` dei campi comuni)* `FieldSchema` serializzabile (JSON): sezioni `basic` / `advanced`, campi tipizzati (`text`, `path`, `select`, `list`, `keyvalue`, `toggle`), `visibleWhen`, `required`, `default`, `help`. La UI genera i campi da qui. Test: snapshot dello schema Go e web.
- [x] 3.3 *(chiuso 2026-10-18: la validazione di `go-tool` vive in `golang.ValidateRunConfiguration`, `normalizeCommandConfiguration` delega all'adapter; i campi Go piatti restano nel DTO di proposito (formato condiviso, 3.4). Storico: validazione `.go` del kind files spostata in `golang.ValidateRunConfiguration`; restano `RunKindGoTool` e i campi Go piatti del DTO)* Spostare i rami Go di `normalizeConfiguration` nell'adapter: validazione `.go`, `RunKindGoTool`, `GOOS/GOARCH/BuildTags/GoArguments/Race/Coverage/Profile/DebugFlags` diventano `golang.RunOptions` dentro `LanguageOptions` (il tipo esiste già: `golang.RunOptions`). Il core non ha più `case ... .go`.
- [x] 3.4 *(2026-10-17: GIÀ OK nel codice, ora provato da `internal/codestudio/runconfig_compat_test.go`: file vecchio con soli campi Go piatti → `languageOptions` + piatti riemessi; file nuovo con solo `languageOptions` → campi piatti derivati; `go test ./internal/codestudio/ -run 'LegacyFlat|NewFormatWith'` ok)* **Compatibilità file**: il DTO `.adomnia/run-configurations.json` continua a leggere i campi Go piatti e li migra in `languageOptions` al load; in scrittura emette il formato nuovo **e** (per un rilascio) i campi piatti per Go, così una versione precedente non perde dati. Test: round-trip vecchio→nuovo→vecchio.
- [x] 3.5 *(2026-10-18: nel core restano `package/files/build/binary/test/command/compound/make/docker-*`; per `go-tool` core conosce solo il nome persistito, regole e schema sono nell'adapter. `maven-goal`/`npm-script` non esistono: Java e web usano `command`)* `kind` generici (`run`, `test`, `build`, `command`, `compound`, `docker-*`) nel core; i kind propri di un linguaggio (es. `go-tool`, `maven-goal`, `npm-script`) vivono nell'adapter e arrivano dallo schema.
- [x] 3.6 *(2026-10-17: `GetRunSchema` e `GetRunSuggestions` + wrapper `getRunSchema()`/`getRunSuggestions()` in `code-studio-api.ts`, binding rigenerati, `tsc` pulito)* Binding: `GetRunSuggestions(sessionId, unitId)`, `GetRunSchema(language, kind)`, invariato il resto. Rigenerare i binding. Wrapper in `lib/code-studio-api.ts`.
- [x] 3.7 *(chiuso 2026-10-18: `go test ./internal/codestudio/ -run "RealWorkspace|LegacyFlat|NewFormat|RunConfig"` e `go test ./internal/languages/java/` verdi, `go vet` pulito. Storico: `internal/ide/...` e `internal/languages/golang` verdi; `internal/codestudio` NON verificato: la suite intera è andata in timeout (600s, dump sul watcher) e poi il package non compila per lavoro Java in corso in `internal/languages/java/spring_*.go`. Rilanciare `go test ./internal/codestudio/ -run "RealWorkspace|LegacyFlat|NewFormat|RunConfig"` a build verde)* Test mirati: `go test ./internal/ide/run/... ./internal/languages/golang/... ./internal/codestudio/...`.

*Stato 2026-10-17:* schema web e `Suggest` rimandati di proposito: l'adapter web non ha ancora un runner (arriva con la Fase 9, JS/TS), quindi oggi non avrebbero un consumatore reale. Grep del gate su `internal/ide` (`GOOS|GOARCH|go-tool|gopls|.go"`): restano solo commenti e una lista generica di estensioni; `architecture_test.go` verde. Mancano il test sul file reale di un workspace e 3.5.

*Stato 2026-10-18:* codice chiuso, verifica `codestudio` da rifare (vedi 3.7). Aggiunto `TestRealWorkspaceGoConfigSurvives` (file con `go-tool` → import → salvataggio senza perdite).

**Gate Fase 3 (codice fatto, test `codestudio` da rieseguire):** una configurazione Go esistente (file reale di un workspace) si carica, si esegue e si salva identica a prima; il core non contiene stringhe `go`/`.go`/`GOOS` (verifica con grep + `architecture_test.go`).

---

## Fase 4 — UI Run unica con sezioni dinamiche

Obiettivo: eliminare l'effetto "form amministrativo". Una sola interfaccia, generata dallo schema del provider.

- [x] 4.1 *(2026-10-18: mock e direzione in `mds/archivio/RUN-UI-MOCK.md`; token gs-* e icone lucide)* Direzione visuale (prima di scrivere codice, cfr. `docs/SOUL.md` e `rules/web/design-quality`): campi compatti, gerarchia tipografica netta, bordi sottili, icone dal set già presente, **niente scroll infinito**, token CSS (`--color-*`) e zero palette Tailwind hardcoded. Mock a bassa fedeltà in questo file o in `mds/archivio/`.
- [x] 4.2 *(2026-10-18: barra Run/Debug/Test/Edit separata; CRUD, nome, pin e Git nel gestore)* **Separare creare da eseguire**: la barra Run (selettore configurazione + ▶ Run / 🐞 Debug / ✓ Test) non mostra mai il form; il form si apre in un popover/pannello "Edit". Salva, **duplica**, rinomina, elimina, fissa (pin), condividi (Git) senza ricompilare i campi.
- [x] 4.3 *(2026-10-18: `CodeStudioRunWizard`: proposte rilevate confermate in un click, provider registrati nelle contribuzioni; Shell command ed Executable sempre disponibili)* **Wizard "Nuova configurazione"**: parte dal rilevamento (Fase 5). L'utente vede proposte ("Go · cmd/api", "Vite · npm run dev", "Maven · Spring Boot") e le conferma con un click; "Generico → Shell Command / Executable" sempre disponibile.
- [x] 4.4 *(2026-10-18: `RunConfigForm` unico; campi provider da `GetRunSchema`, controlli base condivisi, Advanced chiuso; required, default salvati e visibleWhen supportati)* `RunConfigForm` che renderizza `FieldSchema`: sezione base sempre visibile, **Avanzate** collassata. `GOOS`, `GOARCH`, build tags, Go tool flags compaiono **solo** nelle avanzate Go (arrivano dallo schema, non dal JSX).
- [x] 4.5 *(2026-10-18: sezioni comuni Environment con preset di file dev/test/prod e override, task ordinabili, target esistente riusato e testo neutro, Restart; profili nominati e capability Restart della Fase 8 restano separati)* Sezioni trasversali (uguali per tutti, componenti riusati): **Environment** (profili `.env` dev/test/prod + override per configurazione), **Before launch** (lista ordinabile di task/altre configurazioni), **Run target** (Local / Dev Container / futuro Remote — `GoStudioRunTarget.tsx` esiste: va generalizzato, non copiato), **Restart** (Fase 8).
- [x] 4.6 *(2026-10-18: validazione HTML dei required e del range porta; `ConfigValidator` invocato al salvataggio, Go e Java; errori inline nel footer, senza avviare processi)* Validazione inline dallo `validate` del provider; messaggi puliti, nessun output grezzo di terminale.
- [x] 4.7 *(2026-10-18: stati di rilevamento e schema loading/error/retry/empty, azioni busy/success/error; verifica percettiva in app ancora in 4.9)* Stato vuoto / errore / caricamento / successo per ogni azione (feedback percepibile su hover, active, loading).
- [x] 4.8 *(2026-10-18: gestore, form, wizard, schema renderer e task sotto 300 righe; nessun any aggiunto)* Componenti < 300 righe (split di `GoStudioRunConfigurations.tsx` e `GoStudioRunParameters.tsx`), nessun `any`.
- [ ] 4.9 Prova in app (Windows + verifica WebKitGTK per i controlli nativi `select`/`input` in tema scuro, vedi CLAUDE.md) con: Go, web, e una configurazione generica.

**Gate Fase 4 (codice condiviso implementato; accettazione in app 4.9 ancora aperta):** stesso componente `RunConfigForm` serve Go, web e generico; nessun `if (language === ...)` nel JSX del form (solo nelle contribuzioni di linguaggio).

---

*Verifica 2026-10-18:* **22/22 test frontend mirati**, TypeScript e build frontend finali verdi; startup **613.611 / 650.000 byte**, nessun modulo differito nel percorso iniziale. Test Java verdi prima dell'arrivo dei nuovi file Spring concorrenti. Verifica Go finale (`go build ./...` e test RunConfig mirati) bloccata dal lavoro Spring concorrente: `spring_index.go` (`depth` duplicato), `spring_metadata.go` (`metadataCache` duplicato), `spring_java.go` (argomenti di `parseJavaAnnotation`). Suite generale codestudio interrotta e sostituita dai controlli mirati: non dichiarata superata. **Windows e WebKitGTK non verificati**: 4.9 resta aperta.

## Fase 5 — Auto-detection e suggerimenti

Il rilevamento è per **unità di build** (`project.Unit`), non per cartella radice: è ciò che rende possibili i workspace multi-modulo (Fase 6).

| Marker | Linguaggio / ecosistema | Suggerimenti |
| --- | --- | --- |
| `go.mod`, `go.work` | Go | Package, File, Tests, Build, Debug |
| `package.json` (+ lockfile → npm/pnpm/yarn/bun) | JS/TS | Node script, npm script, Debug |
| `vite.config.*` / dep `vite` | React/Vite | Dev Server, Build, Test, Preview |
| `next.config.*`, `angular.json`, `nest-cli.json`, `nuxt.config.*` | Next / Angular / Nest / Nuxt | dev, build, test |
| `pom.xml` / `build.gradle(.kts)` | Java (Maven/Gradle) | Main Class, `mvn`/`gradle` goal, JUnit, Spring Boot run |
| `pyproject.toml`, `requirements.txt`, `manage.py` | Python | Script, module, uvicorn/FastAPI, Django `runserver`, pytest |
| `Cargo.toml` | Rust | `cargo run/test/build` |
| `*.csproj`, `*.sln` | C# | `dotnet run/test` |
| `index.html` senza bundler | HTML/CSS | Static server, Live Preview |
| `Dockerfile`, `docker-compose.yml` | Container | Build, Run, Compose |

- [x] 5.1 *(2026-10-18: nessun metadato aggiunto; il consumatore reale, le suggestion, legge già `Unit.Kind` e i manifest, quindi `Ecosystem`/`PackageManager` sull'`Unit` sarebbero speculativi)* Capability `ProjectDetector` esiste già; estenderla per riportare `Ecosystem` (es. `vite`, `spring-boot`) e `PackageManager` come metadati dell'`Unit` — **solo se** il primo consumatore (le suggestion) li usa in questa fase.
- [x] 5.2 *(2026-10-18: wrapper `mvnw`/`gradlew` prima del binario di sistema in `java.resolveBuildTool`, con test `TestSuggestPrefersWrapperOverSystemTool`. L'helper PATH/progetto condiviso NON è stato estratto: le copie restano diverse (Java: wrapper+PATH; web: `lookPath` sostituibile nei test; `run.ResolveCommandExecutable`: confinamento al progetto) e un'unica funzione avrebbe un solo consumatore. Storico: il package manager reale del web usa già lockfile/`packageManager` via `web.Inspect`; mancano `mvnw`/`gradlew` e l'helper unico PATH/progetto)* Rilevamento **del package manager reale** (lockfile: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`) e del wrapper (`mvnw`, `gradlew`) prima del binario di sistema. Un solo helper condiviso "trova lo strumento nel PATH / nel progetto" (ne esistono già copie sparse: **estrarre, non aggiungere una sesta**).
- [x] 5.3 *(2026-10-17: `run.SuggestionProvider` in `internal/ide/run/suggest.go`; `golang.Suggest` = Run/Test/Build per modulo; `web.Suggest` = script dev/build/test come comando del package manager reale, kind `command`; test `TestSuggestGoModule`, `TestSuggestUsesRealPackageManagerAndExistingScripts`, `TestSuggestNothingWithoutManifestScripts`)* `Suggest()` per Go e web (web: script `dev`/`start`/`build`/`test` letti da `package.json`).
- [x] 5.4 *(2026-10-17: `finalizeSuggestions` in `internal/codestudio/run_suggestions.go`, test `TestFinalizeSuggestionsDedupesMarksSavedAndUsesRelativeDirectory`)* Ordinamento e deduplicazione: una proposta per (unità, azione); marcare quelle già salvate.
- [x] 5.5 *(2026-10-18: fixture temporanee per Go, Node/static, Maven, Spring Boot, Gradle+wrapper, nessuno strumento — `internal/languages/java/suggest_test.go`. Python, Rust, C# non hanno adapter (sono scenari di validazione, non feature) e Docker passa dai kind `make`/`docker-*`, non da `Suggest`: nessuna fixture finché non esiste il consumatore)* Test con fixture minime in `testdata/` per ogni marker (cartelle di 2–3 file, niente progetti veri).
- [x] 5.6 *(2026-10-18: stato vuoto della barra Run = voci "Add …" nel menu della configurazione quando il progetto non ne ha (`useDetectedRunItems.ts`, max 4, un click salva e attiva); prova in app = ML-5.M1/M2/M3. Storico 2026-10-17: `CodeStudioRunSuggestions.tsx` nel gestore Run configurations, sezione "Detected" con aggiunta a un click; `tsc` e vitest code-studio verdi; prova in app = ML-5.M1/M2; manca lo stato vuoto della barra Run)* UI: card suggerimenti nel wizard e nello stato vuoto della barra Run ("Trovato Vite · `pnpm dev` → Aggiungi").

*Stato 2026-10-18:* `tsc` pulito, Vitest `code-studio` verde (579), `go test ./internal/languages/java -run TestSuggest` verde. Non provato in app.

**Gate Fase 5 (codice e test automatici fatti; prova in app da fare):** aprendo ognuna delle fixture, le suggestion attese compaiono e sono eseguibili con un click.

---

## Fase 6 — Workspace multi-modulo / microservizi misti

Caso d'uso: una cartella con `orders/` (Go), `billing/` (Java), `ml/` (Python), `web/` (React). Un solo Code Studio, quattro unità, ognuna col suo linguaggio.

- [x] 6.1 *(chiuso 2026-10-18: `TestMonorepoWithGoWorkNpmWorkspacesAndJava` prova go.work con due moduli, workspaces npm annidati e un servizio Maven nello stesso root, nessun rilevatore "vince" sugli altri; il Python non ha adapter e non diventa unità. Storico 2026-10-17: `TestMixedWorkspaceYieldsOneUnitPerModuleAndLanguage` prova 2 moduli Go + app Node + pacchetto annidato nello stesso root, `TestMixedWorkspaceSuggestionsStayInTheirOwnUnit` prova che ogni unità riceve solo le sue proposte; mancano `go.work`/workspaces npm e i rilevatori Java/Python, che arrivano con la Fase 9)* Verificare che `project.Project` produca *N unità con linguaggi diversi* nello stesso root, anche annidate e con `go.work`/workspaces npm; correggere i punti in cui un rilevatore "vince" sugli altri.
- [x] 6.2 *(2026-10-21: icona del linguaggio nella barra Run e nella lista delle configurazioni — `LanguageBrandIcon` legge la contribuzione del linguaggio, `ContextMenu` accetta un'icona già disegnata, fallback su `Play` quando l'unità non ha linguaggio; test `languages.test.ts` verifica che ogni linguaggio registrato abbia un'icona Simple Icons. Storico 2026-10-17: scelta di design = l'unità si **deriva** dalla working directory (`lib/code-studio/runUnits.ts`, 4 test) invece di aggiungere `unitId` al formato persistito; la lista di Run configurations è raggruppata per `cartella · Linguaggio`, prova in app = ML-6.M1; 2026-10-18: anche il menu della barra Run raggruppa per unità con `orders · Go` a destra della voce.)* Ogni `RunConfiguration` porta `unitId` (modulo di appartenenza) e cwd derivata dall'unità; la barra Run raggruppa per unità (`orders · Go`, `billing · Java`…) con icona di linguaggio (Simple Icons, già nel flusso `generate-brand-icons.mjs`).
- [x] 6.3 *(2026-10-18: un server per (sessione, linguaggio), avviato lazy e spento per inattività come prima; la "root giusta" ora è per unità: se tutte le unità del linguaggio stanno in sottocartelle il server riceve i loro `workspaceFolders` (`lsp_folders.go`, `TestWorkspaceFolderRoots`), prima gopls partiva dalla radice senza `go.mod`. Con un'unità alla radice (modulo, go.work) non cambia nulla. Prova in app = ML-6.M2)* LSP/DAP **per unità**: un language server per (linguaggio, root dell'unità), avviato lazy alla prima apertura di un file di quel linguaggio, spento per inattività. Verificare l'instradamento per `sessionId`/`language` negli store (nessuno stato che attraversa sessioni).
- [x] 6.4 *(2026-10-18: il JDK scelto vale per Run, Debug e Test dell'unità Java (`jdks.go`), Node/Go usano il binario del PATH; Python venv non esiste (nessun adapter). Nessun codice nuovo)* SDK/toolchain per unità (JDK per `billing`, Python venv per `ml`, Node per `web`): l'`ide/sdk` rileva per unità; tool-version cache resta process-wide (decisione già presa, non toccare).
- [ ] 6.5 *(NON fatto 2026-10-18: solo UI, serve l'app avviata; la lista delle configurazioni è già raggruppata, mancano albero, ricerca, problemi e test)* Albero progetto, ricerca, problemi e test raggruppati per unità con filtro; i risultati di ricerca non mescolano linguaggi senza etichetta.
- [x] 6.6 *(2026-10-18: ordine di avvio e readiness arrivano da 8.5; i log restano un'esecuzione per processo con il nome della configurazione. Prova in app = ML-8.M4)* **Compound configuration** (Fase 8) che avvia più unità diverse insieme: ordine, readiness, log separati per processo con colore/etichetta.
- [x] 6.7 *(2026-10-18: `process_launch_guard_test.go` — Go, Node, Java, comando generico e compound non avviano nessun processo senza autorizzazione)* Sicurezza: ogni avvio di processo controlla `session.Project.Authorization == AuthorizationPermitted` (già regola del core; test `process_launch_guard_test.go` deve coprire i nuovi provider).
- [x] 6.8 *(chiuso 2026-10-18: fixture Go+Node+Java+Python finto, routing LSP (`TestWorkspaceFolderRoots`) e compound (8.5). Storico: fixture in cartelle temporanee Go+Node in `mixed_workspace_test.go`; mancano Python, routing LSP e compound)* Fixture di test: monorepo con 3 unità (Go + Node + Python finto) in `testdata/`; test di rilevamento, di routing LSP e di compound.

**Gate Fase 6 (codice e test fatti; 6.2 icona e 6.5 aperti, prova in app da fare):** in un monorepo misto, aprire un file per linguaggio avvia il server giusto con la root giusta; Run di una unità non tocca le altre; compound avvia le unità scelte.

---

## Fase 7 — Supporto "indipendente dal linguaggio" (file base)

Devono funzionare bene **fin dall'inizio**, senza adapter di runtime: sono "file support" (editor + highlighting + validazione leggera + schemi), non linguaggi eseguibili.

| Gruppo | Formati | Cosa deve esserci |
| --- | --- | --- |
| Frontend | HTML, CSS, **SCSS** | già nel web adapter per HTML/CSS; aggiungere SCSS (LSP `vscode-css-languageservice`, già parte della famiglia usata) |
| Database | SQL | evidenziazione, formattazione, e collegamento al modulo Database esistente per eseguire la query selezionata |
| Config | JSON, YAML, TOML, XML | schema/validazione (JSON Schema, YAML LS), outline, formattazione |
| Automazione | Bash, PowerShell, Dockerfile | highlighting, snippet, "Run file" via Shell Command; Dockerfile → build/run già in `run` |
| Documentazione | Markdown | preview affiancata (riusare l'esistente `markdown` binding), outline |

- [x] 7.1 *(GIÀ OK 2026-10-17: la tabella unica è `languageByExtension`/`languageForPath` in `internal/codestudio/documents.go`; il frontend legge `document.language`, nessuna cartella per formato; `TestLanguageForPathCoversProjectFiles` ora copre html/css/scss/sql/json/jsonc/yaml/toml/xml/sh/ps1/bat/Dockerfile/md)* Tabella unica `fileSupport` (estensione/nome file → Monaco language + LSP opzionale + azioni) in `components/ide/`, **non** una cartella per formato.
- [ ] 7.2 *(parziale: mappatura estensione→linguaggio provata da test; evidenziazione/formattazione/outline = ML-7.M1; buco noto: TOML usa la sintassi `ini`, SCSS/YAML senza language server dedicato)* Verifica per ciascun formato: apre, evidenzia, formatta, outline dove sensato. Segnare i buchi qui sotto invece di inventare feature.
- [x] 7.3 *(2026-10-18: azione dell'editor "Run SQL in Database" (Ctrl/Cmd+Invio sui file `sql`): la selezione o l'istruzione sotto il cursore passa al modulo Database in una nuova scheda (`DATABASE_PENDING_QUERY_KEY`, `sqlStatement.ts`, test). Esegue l'utente con la connessione scelta: nessun client nuovo, nessuna credenziale toccata. Prova in app = ML-7.M2)* SQL: azione "Esegui nella connessione…" che riusa `internal/database` (nessun nuovo client); credenziali sempre sigillate come da CLAUDE.md.
- [x] 7.4 *(2026-10-18: `run_scripts.go` aggiunge alle proposte "Detected" gli script `.sh/.ps1/.bat/.cmd` della radice e di `scripts/`/`script/`/`bin/`, come comando senza shell, solo se l'interprete esiste; test `TestScriptCommandPicksInterpreterPerPlatform`. Prova in app = ML-7.M3)* Script (Bash/PowerShell): "Run file" come configurazione *generica* (Shell Command) proposta in automatico; su Windows i processi spawnati nascosti salvo uso interattivo.
- [x] 7.5 *(2026-10-18: nessun server aggiunto, quindi nessun download; SCSS/YAML/TOML restano sui servizi di Monaco, buchi dichiarati in 7.2)* Server dei linguaggi di config: solo se assenti in Monaco; nessun download silenzioso (local-first, vedi 9.3).

- [ ] 7.6 **Markdown/Yuque (P2).** Inventario delle estensioni richieste rispetto al renderer esistente, fixture di confronto e documentazione delle differenze. Completare solo le sintassi mancanti verificate; mantenere sanitizzazione HTML e link sicuri. Nessuna dichiarazione di compatibilità Yuque completa senza un corpus di accettazione. Prova in app: ML-7.M4.

**Gate Fase 7 (codice fatto; 7.2 e prova in app aperte):** apro un file per formato nella fixture "polyglot": evidenziato, formattabile, nessun errore in console.

---

## Fase 8 — Funzioni di run trasversali

Ognuna è una sezione di UI/engine **comune**, non per linguaggio.

- [x] 8.1 *(GIÀ OK 2026-10-18: la barra Run disabilita Debug con il motivo (`debugReason` in `CodeStudioToolbar.tsx`: strumenti non pronti, provider senza debug, tipo di configurazione); l'azione "Installa…" non ha consumatori finché nessun debugger si installa a parte — Java lo porta con JDT LS)* **Run / Debug / Test come tre azioni distinte**, sempre visibili quando il provider le dichiara in `Capabilities()`, disabilitate con *motivo* quando no (es. "Debug non disponibile: manca `debugpy`" + azione "Installa…").
- [x] 8.2 *(GIÀ OK 2026-10-18: ogni passo di `PreRun` è già un'altra configurazione — comando, build, tool, install sono i suoi kind — e `run.Chain` dice quale task è fallito ("Task X non riuscito: i passi successivi sono stati saltati"); una lista con tipi propri duplicherebbe i kind)* **Before Launch**: `PreRun` esiste; trasformarlo in lista tipizzata (comando | altra configurazione | build | install), con fallimento che blocca l'avvio e mostra *quale* step è fallito.
- [x] 8.3 *(GIÀ OK 2026-10-18: Local, Dev Container, WSL, SSH e Container in `CodeStudioRunTarget.tsx`; Remote generico non implementato)* **Run targets**: Local e Dev Container (esistono, generalizzare l'UI); Remote lasciato come voce disabilitata documentata, *non* implementata.
- [x] 8.4 *(GIÀ OK 2026-10-18: preset `.env` dev/test/prod e override nel form (4.5), `Secret` mai mostrato, precedenza env file < voci della configurazione in `docs/CODE-STUDIO.md`)* **Environment Profiles**: `.env`, profili dev/test/prod, override per configurazione; segreti marcati `Secret` mai mostrati né loggati; precedenza documentata (profilo < `.env` < override).
- [x] 8.5 *(2026-10-18: i membri partono nell'ordine dell'elenco; un membro con `Port` trattiene i successivi finché la porta accetta connessioni (`run.WaitPort`, 90 s, si ferma se il processo muore), con avvisi nella console; le dipendenze compose restano come prima. Log pattern non fatto: nessun consumatore oltre alla porta. Test `TestWaitPort`. Prova in app = ML-8.M4)* **Compound Configurations**: `Compound` esiste; aggiungere ordine/dipendenze e *readiness* (porta aperta o log pattern — `composeready.go` ha già la base) così il frontend parte dopo il backend.
- [x] 8.6 *(chiuso 2026-10-18: le esecuzioni il cui comando ricarica da sé (`vite`, `air`, `nodemon`, `next`, `npm run dev`…) non vengono riavviate dal processo, e i file in `node_modules`/`target`/`build`/`dist`/`.git`… non innescano riavvii (`reloadsByItself`, test in `codeStudioRunContext.test.ts`; prova in app = ML-8.M5); manca solo un campo `Capabilities().Restart` per provider: nessun secondo consumatore oltre a queste regole. Storico 2026-10-17: il riavvio al salvataggio non è più legato a `.go`: riavvia solo le esecuzioni dello stesso linguaggio del file salvato e con il file dentro la loro working directory — `codeStudioRunOnSave.ts`, test in `codeStudioRunContext.test.ts`; prova in app = ML-8.M1; mancano `Capabilities().Restart` per provider e l'esclusione dei file generati)* **Auto Restart**: `RestartOnSave`/`RestartPolicy` esistono; renderli valori per provider (`Capabilities().Restart`: `native` come `vite`/`air`, `process` = riavvio del processo, `none`), con debounce e senza loop su file generati/`node_modules`/`target`.
- [ ] 8.7 *(2026-10-18: resta aperto il solo riuso di un dev server già avviato da Run, richiede l'app. Storico 2026-10-17: Run su una configurazione `<pm> run dev` di un'app Node apre la Live Preview, che possiede il dev server e rileva l'URL dall'output — `lib/code-studio/runPreview.ts` + `startConfigured` in `CodeStudioPanel.tsx`, 2 test; prova in app = ML-8.M2; manca il collegamento per script non-dev e il riuso di un dev server già avviato da Run)* **Live Preview** per frontend: premendo Run su un'unità Vite/HTML la preview si apre in Code Studio (`internal/ide/preview` esiste; collegare il run al preview URL rilevato dall'output, p.es. "Local: http://localhost:5173").
- [ ] 8.8 *(test mirati scritti per 8.5, 8.6, 7.3, 7.4, 6.x; resta la prova in app di un compound reale)* Test mirati per ogni voce (engine: Go test; UI: Vitest) + prova in app di un compound reale (frontend + backend).

**Gate Fase 8 (codice fatto; 8.7 e 8.8 aperti, prova in app da fare):** scenario completo in app — apro React/Vite, vedo la proposta `pnpm dev`, premo Run, vedo l'app nella Live Preview; salvo un file e si ricarica; in un monorepo avvio il compound frontend + backend Go.

---

## Fase 9 — Nuovi linguaggi (roadmap)

Ogni linguaggio = package `internal/languages/<lang>` + **una riga** in `languages.go` + cartella UI `components/ide/languages/<lang>/` (icona Simple Icons aggiunta a `scripts/generate-brand-icons.mjs` e rigenerata) + una riga in `IDE_LANGUAGES`. Se serve toccare il core per aggiungere un linguaggio, il contratto è sbagliato: correggere il contratto, non aggirarlo.

### Contratto minimo per dichiarare un linguaggio "supportato"
- [ ] `Language` + `ProjectDetector` + `DocumentSelector`
- [ ] LSP: `lsp.ServerSpec` con download/rilevamento **esplicito** (9.3)
- [ ] `Runner` + `RuntimeProvider` (schema, validate, suggest)
- [ ] `TestRunner` con risultati strutturati (albero test, pass/fail, rerun)
- [ ] Debug (`DebugAdapterProvider`) *oppure* motivo documentato per cui manca
- [ ] SDK/toolchain detection per unità
- [ ] Contribuzione UI: icona, comandi con `requires: { language }`, languageId Monaco
- [ ] Test fixture + `docs/CODE-STUDIO.md` aggiornato

### Roadmap

| Pri | Linguaggio | Ecosistema | Language server | Debug |
| --- | --- | --- | --- | --- |
| P0 | **JavaScript** | Node.js, React, Vue, Next.js | TypeScript Language Server | js-debug |
| P0 | **TypeScript** | React, Angular, Next.js, NestJS | TypeScript Language Server | js-debug |
| P0 | **Java** | Spring Boot, Maven, Gradle, JUnit | Eclipse JDT LS | Java Debug Server |
| P1 | **Python** | FastAPI, Django, Flask, pytest | basedpyright / Pyright | debugpy |
| P1 | **Rust** | Cargo | rust-analyzer | CodeLLDB |
| P2 | **C#** | .NET, ASP.NET Core, NuGet | Roslyn-based tooling | debugger .NET |
| P2 | **Kotlin** | JVM, Spring Boot, Gradle | LSP da valutare | JVM debugger |
| — | C/C++, PHP, Ruby | _solo su domanda reale degli utenti_ | — | — |

> Nota di perimetro: oggi l'adapter `web` copre già TS/JS **a livello editor** (LSP + Live Preview). La Fase 9-P0 aggiunge ciò che manca per essere "linguaggio eseguibile": run/test/debug Node, provider npm-script, js-debug. Non riscrivere ciò che c'è: **estendere** `internal/languages/web` (oppure estrarre `javascript`/`typescript` se il confine lo richiede, decisione in 9.1).

Task:
- [x] 9.1 *(2026-10-17: decisione scritta in `docs/architecture/ide-multilanguage-refactor.md` §24: un solo adapter `web`)* **Decisione di struttura JS/TS**: un adapter `web` (editor) + un adapter `node` (runtime/test/debug)? o `web` esteso? Scrivere la decisione in `docs/architecture/ide-multilanguage-refactor.md` prima di codare.
- [ ] 9.2 *(parziale 2026-10-17: `scriptAdapter.TestCommand` esegue Vitest/Jest dal binario locale via package manager reale con report JSON → albero test (`internal/languages/web/test_runner.go`, `testing.BatchParser` nel core, 3 test); mancano `node --test`, la UI dei test per le unità JS/TS (prova in app = ML-9.M1), js-debug e i suggerimenti Next/Angular/Nest)* **P0 JS/TS**: provider `npm-script`/`node-script`, rilevamento package manager (5.2), test runner (Vitest/Jest/`node --test` con output strutturato), debug via js-debug, suggerimenti Vite/Next/Angular/Nest, Live Preview agganciata (8.7).
- [x] 9.3 *(2026-10-17: politica scritta in §24 dello stesso documento; l'implementazione dell'installazione esplicita arriva con il primo server da scaricare)* **Politica download tool** (decisione trasversale, prima del primo server): niente download silenziosi (local-first). Ogni server/debugger mancante → stato "non installato" con pulsante **Installa** esplicito, versione pinnata, checksum verificato, cartella tool per-utente, funzionamento offline se già installato. Riusare `ide/sdk` e il pattern di `sdk_install.go`.
- [ ] 9.4 *(parziale 2026-10-17; il punto 6 è tutto verificato in app tranne i casi sotto)* **P0 Java**: rilevamento JDK (per unità), Maven/Gradle (wrapper prima del sistema), JDT LS, Main Class + Spring Boot run, JUnit con risultati strutturati, Java Debug Server (via JDT LS).
  - [x] 9.4.1 Adapter `internal/languages/java`: Maven/Gradle (progetti più esterni), JDK (JAVA_HOME/PATH), proposte test/build e Spring Boot run con wrapper o strumento di sistema; registrato in `languages.go` + contribuzione UI (icona `openjdk`). ML-9.M9 OK.
  - [x] 9.4.2 JDT LS 1.60.0 (release fissa) con installazione visibile; nasce `lsp.ServerProvider` (locate/spec/`InstallPlan`) usato anche dal web adapter, metodi host generici `Provided*`, store `ideLanguageServers`. ML-9.M10 OK; Lombok agent e fix "installazione finita sblocca ogni sessione" (ML-9.M14).
  - [x] 9.4.3 Test JUnit strutturati: `TestRunner` Java (Maven `-Dtest`, Gradle `cleanTest test --tests`), `BatchParser` sui report Surefire/Gradle XML, albero sotto il sorgente di test con riga del fallimento. ML-9.M11 OK.
  - [x] 9.4.4 Classi `main` nei moduli e `@SpringBootApplication` proposte in Detected: Maven `spring-boot:run` / `exec:java`, Gradle `run` (plugin `application`). **Form Main Class**: kind `main` con `RunSchema` (classe + VM options), working directory = modulo, init script Gradle per il classpath. ML-9.M16 OK; ML-9.M12 (proposte Maven/Spring/Gradle) da spuntare in app.
  - [x] 9.4.5 Debug via Java Debug Server (plugin 0.53.1 nello stesso comando visibile di JDT LS): `StartJavaDebug`, endpoint DAP, `DebugManager` generico, pannello Threads. ML-9.M13 OK.
  - [x] 9.4.6 Debug di test JUnit (▶ gutter `Debug 'adds'`), build Spring Boot e **attach/remote JVM** (kind `Java remote JVM`, JDWP) via `DebugArguments`; ▶ gutter Run/Debug su `main` e `@Test` (ML-9.M14). Provati in app: JUnit + Maven (ML-9.M17), remote (ML-9.M16).
  - [x] 9.4.7 Navigazione su classi JDK/librerie (`java/classFileContents`, documenti virtuali sola lettura), colori semantici con retry durante l'import, Ctrl+Shift+O (ML-9.M15); proposte rapide Maven/Gradle build e motivo di pausa "breakpoint" neutro e pannello Threads al posto di Goroutines per Java.
  - [x] 9.4.9 *(2026-10-18)* **pom.xml intelligente**: `java.ParsePomDependencies` (righe/colonne di `<version>` e delle property, anche da testo non salvato), `java.LookupVersions` (Maven Central, solo su azione, cache 30 min, niente alpha/beta/RC/milestone), host `PomDependencies`/`PomVersions`, lens `Check for updates`/`Scan vulnerabilities`, `↑ versione` per dipendenza, marker CVE dal report `securityintel` (OSV) e quick fix che aggiorna `<version>` o la property. Test: `pomdeps_test.go`, `mavencentral_test.go`, `pomInsights.test.ts`. Prova in app = ML-9.M18. Parent/BOM e scansione CVE Gradle sono implementati in JS-8/JS-12 del piano `06-JAVA-SPRING-STUDIO.md` (lettura offline delle versioni gestite e scansione statica Gradle); restano il collegamento completo al Security Center e le prove in app.
  - [ ] 9.4.8 *(2026-10-18: debug automatico reale superato per Maven `spring-boot:run` su Spring Boot 3.4.5 offline e Gradle 8.13 `:run`, `:test` con JUnit 4, `:bootRun` come task JavaExec di fixture, non plugin Spring Gradle. Breakpoint, evaluate e ambiente provati. Corretti task qualificati, flag duplicati, VM options Spring preservate tramite argfile JDK 9+ su Windows, DevTools restart disabilitato e projectName JDT per attach. Gradle fixture importata come progetto Eclipse: classpath/import Buildship e plugin Spring Gradle reali restano da verificare. Test: `TestJavaGradleDebugRunStopsAtBreakpoint`, `TestJavaSpringBootGoalDebugKeepsVMOptions`. Prove native non eseguite, ML-9.M19 aperta.)* **Ancora aperto:** debug in app di `spring-boot:run` e di `test`/`bootRun`/`run` Gradle (porta 5005; provato solo Maven + JUnit); classpath da JDT LS per Gradle con classe scelta; ML-9.M12 da provare con progetto Spring/Gradle reale.
- [ ] 9.5 *(2026-10-21: implementato il supporto Python — run script/modulo, pytest strutturato, debug debugpy, basedpyright, interpreti per unità, azioni ambiente esplicite — con verifica automatica reale; con gli incrementi 2026-10-21 sono chiusi PY-0.4, PY-2.2, PY-2.3, PY-2.4, PY-2.6, PY-5.4, PY-6.4 e 10.1/10.2. Restano aperti PY-0.2, PY-2.1, PY-4.2/4.3/4.5/4.6, PY-5.5/5.6, PY-6.1/6.2/6.5, PY-7.2–7.5, PY-8.3/8.4 e tutti i collaudi PY-M. Vedi registro in fondo.)* **P1 Python**: piano dettagliato PY-0–PY-9 qui sotto (2026-10-21). Prima implementazione Python; Rust segue come adapter separato. Nessun supporto dichiarato completato.
- [ ] 9.6 **P1 Rust**: Cargo (bin/example/test/bench), rust-analyzer, CodeLLDB.
- [ ] 9.7 **P2 C# e Kotlin**: solo dopo che P0 e P1 passano il contratto minimo; Kotlin riusa il lavoro Gradle/JVM di Java.
- [ ] 9.8 Per ogni linguaggio chiuso: aggiornare `docs/CODE-STUDIO.md`, `docs/adomnia-feature-catalog.en.md`, `docs/ISSUES.md`, `README.md`, e ricordarsi di verificare l'AI (contesto minimo, cache) se il linguaggio la usa.

**Gate per linguaggio:** progetto reale piccolo (clone di un esempio ufficiale) → aperto, indicizzato, eseguito, testato, debuggato con breakpoint in app avviata, **senza** modifiche al core.

---

### 9.5 — Python: TODO dettagliato (2026-10-21)

**Obiettivo:** aprire una cartella Python, scegliere l'interprete corretto per unità, modificare con assistenza, eseguire script e moduli, usare pytest e fermarsi a un breakpoint. Successivamente completare i flussi FastAPI/Uvicorn, Django e Flask. Stesso Code Studio e stessi pannelli degli altri linguaggi.

**Stato verificato:** `internal/codestudio/languages.go` registra Go, web e Java; non esistono adapter Python/Rust. Il core espone già `ProjectDetector`/`UnitScanner`, `DocumentSelector`, `Runner`, `TestRunner`, `ServerProvider`, `DebugAdapterProvider`; la UI usa `frontend/src/components/ide/languages.ts`. Le descrizioni storiche di questo piano non sono un inventario corrente. Il Python rimosso dal catalogo F4 è il runtime dei plugin: questo piano riguarda strumenti esterni dell'IDE e non lo reintroduce.

**Pilastri:** Local-first (interpreti, ambienti, analisi e processi locali) e User-extensible (adapter, interprete selezionabile, configurazioni versionabili). Nessun account o servizio cloud necessario.

**Ordine:** PY-0 → PY-1 → PY-2 → PY-3 → PY-4 → PY-5; poi PY-6 e PY-7; PY-8/PY-9 chiudono il supporto. La richiesta del 2026-10-21 autorizza questa pianificazione; non chiude i gate desktop preesistenti e non dichiara implementate nuove feature.

| Blocco | Risultato | Sede principale proposta |
| --- | --- | --- |
| PY-0/1 | Contratto e unità Python | `internal/languages/python/{language,detect}.go` |
| PY-2 | Interprete e ambiente per unità | `internal/languages/python/interpreter.go`, host/settings esistenti |
| PY-3 | Script/moduli nella Run UI comune | `internal/languages/python/{runner,suggest}.go` |
| PY-4 | Editor con basedpyright | `internal/languages/python/server.go`, `components/ide/languages/python/` |
| PY-5 | pytest nell'albero Test | `internal/languages/python/{test_runner,pytest}.go` |
| PY-6 | Debug con debugpy | `internal/languages/python/debug.go`, DAP esistente |
| PY-7 | Framework e flusso API | adapter Python, preview/entity router esistenti |
| PY-8/9 | Packaging, compatibilità e verifica | installer, docs, test e collaudi centrali |

I nomi nuovi sono proposte di collocazione, non file già presenti. Estrarre utility nel core solo se riusate davvero; nessuna riscrittura generale dell'host.

#### PY-0 — Contratto, confini e decisioni da fissare

- [x] PY-0.1 *(2026-10-21: ID `python` registrato in `internal/codestudio/languages.go`; unità `python-project`/`python-scripts`, selettore `.py`/`.pyi`, opzioni JSON `interpreter`/`script`/`module`; capability dichiarate solo con i flussi reali: Run, Test, Debug, LanguageServer, `GetCapabilities().languages` allineato.)* Registrare `python` come ID stabile; documentare kind delle unità, selettore `.py`/`.pyi`, opzioni JSON e capability minime. Nessuna capability pubblicizzata prima del relativo flusso funzionante.
- [ ] PY-0.2 *(parziale 2026-10-21: pinnate `basedpyright==1.40.2` e `debugpy==1.8.22`, verificate in esecuzione reale con Python 3.11/Windows. Matrice macOS/Linux non verificata; hash degli artefatti non verificati — pip risolve il pacchetto della versione pinnata, il checksum esplicito resta da fare.)* Fissare versioni Python supportate e matrice Windows/macOS/Linux dopo verifica delle dipendenze; scegliere versioni pinnate di basedpyright/debugpy e relativi artefatti/hash/licenze. Non copiare numeri di versione da esempi storici.
- [x] PY-0.3 *(2026-10-21: `python.Options{Interpreter,Script,Module}` in `LanguageOptions`; args/cwd/env/env-file/restart/compound sono i campi comuni; la selezione della macchina vive in `.adomnia/python.local.json` e il campo `interpreter` delle configurazioni resta opzionale, così il file condiviso via Git è portabile. I flussi framework usano script/module + argomenti, senza opzioni tipizzate dedicate — vedi PY-7.2.)* Definire opzioni tipizzate per script/modulo, interprete, argomenti, cwd e framework dentro `LanguageOptions`; riusare env/env-file, restart e compound esistenti. Distinguere selezione locale della macchina da configurazione condivisa.
- [x] PY-0.4 *(2026-10-21: fixture e test coprono script sciolto, pacchetto `src/`, pytest parametrizzato reale, unità annidate e monorepo misto (le asserzioni storiche che escludevano Python sono state aggiornate); la fixture end-to-end con due unità a ambienti diversi è `TestTwoUnitsWithDifferentEnvironmentsRunInIsolation` — due unità con venv propri e un modulo installato solo nel proprio, eseguite nello stesso test.)* Preparare fixture piccole: script sciolto, pacchetto `src/`, pytest parametrizzato, due unità con ambienti diversi, monorepo Go/web/Java/Python. Condividere le prove di contratto già presenti invece di creare un secondo registry.

#### PY-1 — Rilevamento progetto e navigazione

- [x] PY-1.1 *(2026-10-21: adapter in `internal/languages/python` e registrazione in `internal/codestudio/languages.go`, zero import Python nel core; contribuzione UI in `components/ide/languages/python/` con icona, menu e comandi `python.selectInterpreter`/`python.installDebugpy` con `requires`.)* Implementare adapter e registrazione nella composition root, senza import Python nel core; contributo UI in `components/ide/languages/python/`, icona e comandi con `requires`.
- [x] PY-1.2 *(2026-10-21: parser TOML tollerante in `toml.go` + `readManifest` in `pyproject.go`: `[project]`, `requires-python`, `[project.scripts]`, `dependency-groups`/`optional-dependencies`, `[tool.pytest.ini_options]`, `[tool.uv.workspace]`; `requirements*.txt` come indizi; righe malformate ignorate senza bloccare. Nessun codice eseguito.)* Leggere TOML con parser: `pyproject.toml`, `[project]`, `requires-python`, entry point e sezioni tool pertinenti; considerare `requirements*.txt`, `setup.cfg`, `setup.py`, `manage.py` come indizi. Mai eseguire `setup.py` o importare il progetto durante la scansione.
- [x] PY-1.3 *(2026-10-21: precedenza marcatori (pyproject > setup.cfg > setup.py > requirements > manage.py), i pacchetti nudi appartengono all'antenato, solo i manifest espliciti aprono unità annidate (copre i membri uv workspace con proprio pyproject.toml); identità = cartella dell'unità.)* Riconoscere script senza manifest e package con/senza `__init__.py`; evitare un'unità per ogni file o sottopackage. Definire precedenza dei marker e identità stabile delle unità, incluse unità uv workspace annidate.
- [x] PY-1.4 *(2026-10-21: scansione condivisa `project.WalkDirectories` con limiti e cancellazione, skip di `.venv`/`venv`/`__pycache__`/`*.egg-info`/cache/build; TOML malformato tollerato; script confinati al progetto con risoluzione dei symlink; percorsi con spazi/Unicode provati dai test di run.)* Riusare scansione condivisa, cancellazione e limiti; escludere `.venv`, `venv`, `__pycache__`, cache, build e dipendenze. Gestire symlink, percorsi Unicode/spazi e manifest malformati senza bloccare le altre unità.
- [x] PY-1.5 *(2026-10-21: test detection/dedup/isolamento in `python_test.go`/`python_support_test.go`; i test monorepo misti e host sono verdi dopo l'aggiornamento dell'asserzione storica che escludeva Python; nessuno schema persistito è cambiato, quindi Go/Java/web e le configurazioni esistenti restano intatte.)* Aggiungere test di detection/dedup/isolamento e restore; aprire un progetto Go/web/Java esistente deve conservare unità e configurazioni.

#### PY-2 — Interpreti, venv, uv e Poetry

- [ ] PY-2.1 *(parziale 2026-10-21, aggior. 2026-10-21: `DiscoverInterpreters`/`ResolveInterpreter` con origine esplicita — scelta salvata → ambiente del progetto → PATH — e `VIRTUAL_ENV` fuori dal progetto segnalato e mai usato implicitamente; alias `WindowsApps\python.exe` scartati. `requires-python` ora è controllato: `CheckRequiresPython` (sottoinsieme PEP 440 con `*` e `~=`) e `FlagIncompatible` segnalano la versione incompatibile nel report del dialogo (`TestCheckRequiresPython`, `TestFlagIncompatibleMarksOnlyTheProbedCandidates`). Manca l'ambiente dei gestori esterni (cache Poetry/uv).)* Proporre candidati con origine esplicita: scelta salvata per unità → ambiente locale riconosciuto → ambiente del gestore configurato → interpreti di sistema. Non usare ciecamente `VIRTUAL_ENV` di un altro progetto; segnalare conflitti e `requires-python` incompatibile.
- [x] PY-2.2 *(2026-10-21: layout `.venv/Scripts/python.exe` e `.venv/bin/python`, launcher `py` non proposto (non è un interprete concreto), alias non eseguibili scartati; probe limitato (`-c` con versione, `sys.executable`, prefix, `platform.machine()`+bits, pacchetti noti) solo con progetto autorizzato — `TestProbeReportsVersionPackagesAndArchitecture` esegue il probe reale.)* Gestire `.venv/Scripts/python.exe` su Windows e `.venv/bin/python` su Unix; distinguere launcher Windows `py` da interprete concreto e scartare alias non eseguibili. Verificare versione, `sys.executable`, prefix e architettura con probe limitato e solo dopo autorizzazione del progetto.
- [x] PY-2.3 *(2026-10-21: `DetectEnvironmentManager` riconosce `uv.lock`, `poetry.lock`, `[tool.poetry]`, `[project]`/`requirements*.txt` e `.python-version`; `PlanEnvironment` descrive ambiente e comandi **senza eseguire nulla**. Le azioni sono separate e visibili — "Create environment" (`<python> -m venv .venv`, mai sopra un ambiente esistente, mai un interprete preso dall'ambiente stesso) e "Install dependencies" (`<venv>/pip install -r requirements.txt` oppure `-e .`) — quindi nessun `uv run`, `poetry install` o sync implicito nel percorso normale e nessun download di Python. Host `PythonEnvironment`/`CreatePythonEnvironment`/`InstallPythonDependencies` con autorizzazione e conferma (test `environment_test.go`, guardia `process_launch_guard_test.go`).)* Rilevare `uv.lock`, `poetry.lock`, `.python-version` e configurazioni ambiente. Risolvere l'ambiente senza installare, sincronizzare lockfile o scaricare Python; se mancante, mostrare errore e azione esplicita. Nessun `uv run` che provochi sync/download impliciti nel percorso normale.
- [x] PY-2.4 *(2026-10-21: il dialogo ha il campo per un percorso arbitrario ("Use this path"), la riga dell'ambiente con gestore/lockfile/versione, i pulsanti separati "Create environment…" e "Install dependencies…" con il comando esatto nella conferma e il motivo quando non sono proponibili; loading/error/refresh invariati. La scelta resta per progetto con supporto per-unità in binding e storage. Prova in app = PY-M2.)* Selettore interprete per unità con percorso/versione/origine/stato, refresh e selezione manuale; riusare modal e stati loading/error/retry di Code Studio. Creazione venv e installazione dipendenze sono azioni separate con comando, destinazione e conseguenze visibili.
- [x] PY-2.5 *(2026-10-21: `ResolveInterpreter` alimenta Run/Test/Debug e `python.pythonPath` va al server (la configurazione LSP è rivalutata a ogni richiesta, quindi il cambio interprete arriva al server senza resettare i buffer); un ambiente rimosso resta selezionato e segnalato dal probe; nessuna run config viene toccata.)* Lo stesso interprete alimenta Run/Test/Debug e risoluzione import LSP. Cambio interprete invalida solo le cache interessate, aggiorna il server e non cancella buffer o run config; un ambiente rimosso resta selezionato ma segnalato come mancante.
- [x] PY-2.6 *(2026-10-21: due unità con ambienti diversi end-to-end (`TestTwoUnitsWithDifferentEnvironmentsRunInIsolation`: venv propri, modulo installato solo nel proprio, stessa esecuzione nello stesso test), timeout del probe su interprete bloccato (`TestProbeTimesOutOnAStuckInterpreter`, **rosso→verde**: il probe restava appeso ~29 s perché il figlio teneva lo stdout — ora la lettura non attende il tubo e `process.TerminateTree` chiude l'albero), versione incompatibile (`TestCheckRequiresPython`, `TestFlagIncompatibleMarksOnlyTheProbedCandidates`) e restore su macchina diversa (`TestSavedInterpreterFromAnotherMachineFallsBack`: scelta salvata scomparsa → ambiente del progetto). Assente, alias, spazi/Unicode e launcher già coperti dai test esistenti. Nessuna installazione globale né attivazione shell serve o viene usata.)* Testare due unità con dipendenze diverse, interprete assente/incompatibile, timeout, path con spazi, launcher e restore su macchina diversa. Nessuna installazione globale o attivazione shell necessaria.

#### PY-3 — Run di script e moduli

- [x] PY-3.1 *(2026-10-21: `Runner`/`SchemaProvider`/`ConfigValidator`/`SuggestionProvider` sui contratti esistenti, kind `script`/`module` con target, args e cwd comuni; `RunConfigForm` genera i campi da `GetRunSchema` senza rami Python nel JSX.)* Implementare `Runner`, `SchemaProvider`, `ConfigValidator` e suggerimenti usando i contratti esistenti: kind script e module con selezione unità, target, args e cwd. Form schema-driven comune; nessun `if (language === 'python')` nel JSX condiviso.
- [x] PY-3.2 *(2026-10-21: argv distinti `<interprete> -u <script>` e `<interprete> -u -m <modulo>` senza shell (test reali con argomenti Unicode/spazi); validazione modulo (`moduleName`), confinamento dello script al progetto con symlink risolti, interprete assoluto verificato alla partenza; nessun `PYTHONPATH` aggiunto alle run.)* Costruire argv distinti per `<interprete> <script>` e `<interprete> -m <modulo>`, senza shell; validare modulo/target, percorsi autorizzati, cwd ed eseguibile. Supportare `src/` senza aggiungere silenziosamente `PYTHONPATH`.
- [x] PY-3.3 *(2026-10-21: proposte Detected per script di avvio verificabili, `manage.py runserver`, uvicorn/Flask solo con app univoca riconosciuta staticamente e dipendenza dichiarata, `python -m` solo per entry point con modulo eseguibile verificato (`__main__`/guardia); gli `[project.scripts]` non diventano mai comandi automatici; test `TestSuggestKeepsConsoleScriptsUnverified`.)* Proporre file attivo e entry point verificabili; script console dichiarati nel manifest non diventano automaticamente `python -m`. Mostrare fonte e motivo di indisponibilità, salvare/duplicare/rieseguire attraverso la UI esistente.
- [x] PY-3.4 *(2026-10-21: output progressivo non bufferizzato (`-u`), stderr/exit code/stop/process tree dal lifecycle Run comune, env-file e redazione invariate; nessun probe con import del progetto: la detection è solo statica.)* Integrare output progressivo non bufferizzato, stderr, exit code, stop e process tree; riusare env-file/redazione, storico e compound. Nessun probe di dipendenze tramite import dell'app durante il rilevamento.
- [ ] PY-3.5 *(parziale 2026-10-21: esecuzione reale di script/modulo verificata con Python 3.11, argomenti Unicode/spazi, output senza newline finale, guardia di autorizzazione su run/test/debug (`process_launch_guard_test.go` esteso a Python); mancano cancel esplicito durante un run reale e input errato lato utente.)* Testare esecuzione reale di script/modulo, argomenti Unicode/spazi, input errato, output finale senza newline, cancel e progetto non fidato. La lettura dei file resta possibile senza autorizzare processi.
- [x] PY-3.6 *(2026-10-21: `codeStudioPythonTargets.ts` + test: il ▶ del gutter compare sulla riga del guard `if __name__ == "__main__":` o, senza guard, sulla prima riga; menu Run/Debug come per Java (`CodeStudioRunTargetMenu`), dispatch in `CodeStudioPanel.runTarget` con guardia di autorizzazione, hover dell'editor; la run usa `startRun('script', { languageOptions: { script } })` (kind `script` in `GoIDEQuickRunKind`, `languageOptions` inoltrato da `startRun`) e il debug usa debugpy sullo stesso script. Prova in app = PY-M10.)* ▶ nel gutter Run/Debug per gli script Python, coerente con Go e Java: stessa autorizzazione e stesso interprete risolto delle altre run.

#### PY-4 — Editor e basedpyright

- [x] PY-4.1 *(2026-10-21: `lsp.ServerProvider` con `basedpyright-langserver --stdio`; installazione esplicita da notice con un solo comando visibile `python -m pip install --target <tools>/basedpyright basedpyright==1.40.2` (comprende il runtime Node di nodejs-wheel, quindi offline dopo l'installazione); `providedServer: true` e il tool installer comune (`codeStudioToolInstall.ts`). Nota: il server gestito parte con `-c "from basedpyright.langserver import main; main()"` + PYTHONPATH sulla cartella strumenti, perché pip --target non genera script eseguibili indipendenti.)* Implementare `lsp.ServerProvider`/`ServerSpec` con `basedpyright-langserver --stdio`; riusare tool installer e `codeStudioToolInstall.ts`, `providedServer: true`, Run console e task status. Installazione isolata dai pacchetti dell'app utente, comando/versione visibili; considerare anche le dipendenze transitive nell'offline packaging.
- [ ] PY-4.2 *(parziale 2026-10-21: `python.pythonPath` porta l'interprete scelto al server e `pyrightconfig.json`/`[tool.pyright]` restano la fonte delle altre impostazioni; `WatchesFile` segue manifest e sorgenti. Il gate "due ambienti nello stesso server multi-root" NON è superato: un server per sessione e linguaggio con un solo interprete, vince la scelta del progetto — estendere l'identità LSP per unità resta aperto con questo consumer reale.)* Configurare interprete, root e import per unità, rispettando `pyrightconfig.json` e sezioni pyproject. **Gate tecnico:** verificare due ambienti nello stesso server multi-root; se non isolabili, estendere genericamente l'identità LSP per unità con questo consumer reale, senza switch Python nel core.
- [ ] PY-4.3 *(parziale 2026-10-21: completion, hover, definition/references, rename, signature help e diagnostica arrivano dai provider Monaco comuni come per Java/web; la verifica specifica su buffer non salvati, UTF-16, import `src/` e stub `.pyi` è manuale — PY-M6.)* Collegare completion, hover, definition/references, rename, signature help, diagnostica e Structure tramite provider Monaco comuni; verificare buffer non salvati, UTF-16, import `src/` e stub `.pyi`. Esporre solo operazioni supportate dal server.
- [x] PY-4.4 *(2026-10-21: lifecycle comune (lazy alla prima apertura, stop/restart/Low resources come Java e web); server mancante con stato e azione di installazione esplicita; nessun server parte per la sola presenza del progetto nella schermata iniziale.)* Avvio lazy quando serve, stop/restart e Low resources tramite lifecycle comune; assenza tool/interprete con stato e retry. Nessun server avviato per la sola presenza del progetto nella schermata iniziale.
- [ ] PY-4.5 *(non fatto 2026-10-21: nessun formatter Python integrato; la formattazione non è attribuita a basedpyright. Ruff resta uno strumento opzionale da progettare con installazione esplicita e un solo owner delle modifiche al salvataggio.)* Formatting/organize imports: verificare capability reali; Ruff è uno strumento opzionale separato con installazione esplicita, configurazione pyproject rispettata e un solo owner delle modifiche al salvataggio. Non attribuire formattazione a basedpyright senza supporto.
- [x] PY-4.6 *(2026-10-21: routing e impostazioni verificate da test (settings dal progetto, PYTHONPATH solo del server); **integrazione LSP reale automatizzata** `TestRealBasedpyrightAnalysesProjectImports` (`server_lsp_test.go`): langserver `basedpyright-langserver --stdio` avviato sul PATH del test, initialize/didOpen con `workspace/didChangeConfiguration` dalle `pyrightSettings`, diagnostica sull'import irrisolto e **nessun** "could not be resolved" sull'import presente solo nell'ambiente del progetto (venv con modulo marcato), `textDocument/definition` che punta a `site-packages`, rename di una variabile locale con dichiarazione + uso. Senza interprete con basedpyright il test salta con il motivo (`ADOMNIA_TEST_PYTHON` lo seleziona), senza chiamare la prova superata.)* Testare routing e cambio ambiente con server stub; integrazione reale basedpyright con import noto presente in un solo venv, rename e diagnostica. Registrare skip se lo strumento manca, senza chiamare la prova superata.

#### PY-5 — pytest strutturato

- [x] PY-5.1 *(2026-10-21: `TestRunner` con `python -m pytest` e l'interprete risolto; `StartTests` richiede il progetto autorizzato, quindi collection/conftest girano solo su azione esplicita.)* Implementare `TestRunner` e parser dell'adapter, invocando pytest con l'interprete scelto; discovery solo su azione/progetto fidato: la collection importa moduli e può eseguire `conftest.py`.
- [x] PY-5.2 *(2026-10-21: node ID veri dal plugin (file/classe/funzione/parametrizzazione, `/` nei parametri → U+2215 con ricostruzione deterministica verificata da test); run singolo per node ID, selezione, suite e rerun failed dai node ID falliti; mai ricostruzione da output colorato.)* Usare node ID stabili per file/classe/funzione/parametrizzazione; run singolo, selezione, suite e rerun failed. Non ricostruire gli ID da label o output colorato.
- [x] PY-5.3 *(2026-10-21: scelto il plugin pytest distribuito con adOmnia (`adomnia_pytest_events.py`, embedded e scritto in una cartella temporanea per-utente): eventi JSONL con node ID veri, marcatore finale per il flush; provato con pytest reale 9.1.1 — anche errori di setup/teardown, skip, xfail. Nessun parsing dell'output umano, JUnit XML non usato.)* Scegliere e provare il trasporto strutturato: piccolo plugin pytest distribuito con adOmnia per eventi e node ID, oppure report con mapping dimostrato. JUnit XML da solo non garantisce discovery, streaming e identità completa: niente parsing fragile dell'output umano.
- [x] PY-5.4 *(2026-10-21: il plugin riporta `capstdout`/`capstderr` per fase (limite 32 KiB) e il parser li conserva nell'output del singolo test, anche quando passa, con blocchi `--- stdout ---`/`--- stderr ---` accanto al traceback; `pytest_parser` non supera `maxPytestOutput`. La vista Test distingue i motivi di un albero vuoto (`testRunMessages.ts`, 4 test): run in corso, run interrotto, comando fallito prima dei risultati (con `diagnostics`), nessun test. Test: `TestPytestParserKeepsCapturedOutput` e `TestRealPytestRunProducesTree` verificano la cattura reale con pytest 9.1.1. Prova in app = ML-9.M1.)* Mappare passed/failed/skipped/xfail/xpass, errori collection/setup/teardown, durata e location; conservare traceback/stdout/stderr e distinguere nessun test, errore di avvio e cancellazione.
- [ ] PY-5.5 *(non fatto 2026-10-21: nessuna coverage; la baseline pytest non la richiede.)* Coverage opzionale solo con strumento presente/installato esplicitamente; riportare file/linee alla vista esistente, isolare report per esecuzione e non sovrascrivere quelli dell'utente. Baseline pytest non dipende dalla coverage.
- [ ] PY-5.6 *(parziale 2026-10-21, aggior. 2026-10-21: fixture reale verificata con parametrizzazione, failure, skip, xfail/xpass, errore di setup e di collection; **cancel**: `Finisher` nel core chiude i test rimasti aperti quando il processo termina senza report finale (annullamento/crash) come skip con motivo, una sola volta — test `TestManagerFinishesOpenTestsWhenTheProcessEnds` e `TestPytestParserFinishesUnfinishedTests`; **Unicode**: node ID con caratteri accentati e parametri conservati (`TestPytestParserKeepsUnicodeNodeIDs`). Manca solo un test async con il plugin presente: non è una dipendenza di adOmnia.)* Testare fixture reale con parametrizzazione, async se plugin presente, failure, skip, collection error e cancel; albero e rerun devono conservare identità anche con nomi Unicode e percorsi annidati.

#### PY-6 — Debug con debugpy

- [ ] PY-6.1 *(parziale 2026-10-21: `DebugAdapterProvider` sul DAP esistente con `python -m debugpy --listen 127.0.0.1:<porta> --wait-for-client`: il programma è il debuggee e la porta è di loopback dinamica. La presenza di debugpy si vede dal probe dell'interprete e mancante si installa solo con l'azione esplicita e confermata `python -m pip install debugpy==1.8.22`; nessuna modifica automatica al venv utente. Non separato: l'interprete del programma ospita debugpy (modello launch standard); la modalità adapter separato/attach resta da fare.)* Implementare `DebugAdapterProvider` con DAP esistente. Separare interprete che ospita l'adapter dall'interprete del programma; verificare compatibilità e presenza debugpy senza modificare il venv utente in automatico.
- [x] PY-6.2 *(2026-10-21: launch di script/modulo e pytest selezionato con stessi args/cwd/env della run; breakpoint, continue/step, thread, call stack, variabili, watch ed evaluate nei pannelli comuni. **Exception breakpoint aggiunti**: `dap.SetExceptionBreakpoints` invia `setExceptionBreakpoints` ai debug attivi e all'handshake, i filtri sono dichiarati dalle contribuzioni linguaggio (`exceptionFilters`, debugpy: `raised`/`uncaught`) e si gestiscono dal dialog Breakpoints, salvati per progetto; `SaveSessionView` del frontend non li azzera. Test: `TestExceptionBreakpointsReachTheAdapter` (fake adapter che riecheggia i filtri ricevuti: handshake e cambio a sessione viva) e `TestExceptionBreakpointsAreSavedAndRestored` (normalizzazione, sopravvivenza al layout, ripristino alla riapertura).)* Supportare launch script/modulo e pytest selezionato, stessi args/cwd/env della run; breakpoint, continue/step, exception breakpoint, thread/call stack, variabili/watch/evaluate nei pannelli comuni.
- [x] PY-6.3 *(2026-10-21: porta di loopback dinamica riservata prima dell'avvio, timeout e cleanup del processo gestito su errore/stop/chiusura; nessuna porta su tutte le interfacce, nessun attach remoto implicito. L'attach locale esplicito resta futuro per design.)* Connessioni locali su loopback/porta dinamica, timeout e cleanup su errore/stop/chiusura progetto. Attach locale esplicito successivo al launch; nessuna porta aperta su tutte le interfacce o attach remoto implicito.
- [x] PY-6.4 *(2026-10-21: `debugProgramArguments` toglie `--reload`, `--reload-*` (con il valore quando è separato) e `--debugger` dagli argomenti del debug; `flask` perde `--debug` e `manage.py runserver` riceve `--noreload` una sola volta. Il debuggee resta il programma, su porta di loopback, con `subProcess: false`. Test `TestDebugArgumentsDropTheReloader` (uvicorn, flask, Django, `--noreload` già presente).)* Verificare policy subprocess e reload dei framework: primo flusso debug senza reloader, poi gestione figli se supportata. Evitare breakpoint apparentemente attivi nel processo sbagliato e processi orfani.
- [x] PY-6.5 *(2026-10-21: test DAP reale `TestRealDebugpyStopsAtBreakpoint` (skip motivato senza interprete con debugpy; `ADOMNIA_TEST_PYTHON` lo seleziona): breakpoint confermato, frame atteso, evaluate `x == 1`, **step** `next` che avanza di riga, **due sessioni contemporanee** — la seconda parte con la propria porta mentre la prima è ancora ferma, `awaitDebugStop` filtra per sessione — e stop di entrambe. `TestDebugAdapterRejectsAMissingInterpreter` (interprete assente prima dell'avvio), `TestDebugAdapterCrashEndsTheSession` (adapter che muore subito: la sessione finisce senza restare viva) e `TestAdapterThatNeverOpensTheEndpointEndsTheSession` (adapter silenzioso: scatta `debugAddressTimeout`, ora variabile per i test, e la sessione muore con l'errore sull'endpoint). Verificato con debugpy 1.8.22 reale.)* Test DAP reale: breakpoint confermato, frame e variabile attesa, step, stop e secondo avvio; testare interprete/debugpy assente, crash adapter, timeout e due sessioni. Skip espliciti se manca il tool.

#### PY-7 — FastAPI/Uvicorn, Django, Flask e API

- [x] PY-7.1 *(2026-10-21: rilevamento prudente e statico: `manage.py` → Django runserver; dipendenze dichiarate + una sola app `FastAPI(`/`Flask(` riconosciuta nei sorgenti (≤2 livelli, ≤32 file) → `uvicorn module:app --reload` / `flask --app … run`; con più candidati o nessuno non si propone nulla; nessun import del progetto.)* Rilevamento statico prudente da manifest/config/file; proposte modificabili Uvicorn (modulo:oggetto, factory opzionale), Django (`manage.py runserver`), Flask (`-m flask --app … run`). Non importare framework né indovinare entry point ambigui.
- [x] PY-7.2 *(2026-10-21: campi guidati nel kind `module` — `app` (`modulo:attributo`), `host`, `porta`, `reload` (avanzate), visibili solo con `module` = uvicorn/flask tramite `visibleWhen`; `Options.App/Host/Port/Reload` validati (app, host senza schema/spazi, porta 1–65535, campi framework rifiutati su un modulo normale) e tradotti in argv dal solo adapter. Le proposte FastAPI/Flask non usano più argomenti opachi; il debug passa dai campi guidati e **non** attiva mai il reloader. La dipendenza del framework è visibile nel dialogo interprete (badge `uvicorn`/`flask`/`django` dal probe). Readiness e restart restano quelli comuni: l'adapter non avvia un secondo processo né un proprio watcher. Test `framework_test.go`, `TestDebugArgumentsDropTheReloader`, `pythonDebug.test.ts`.)* Campi guidati host/porta/args, dipendenza mancante visibile, sviluppo con reload esplicito; debug senza reload inizialmente. Riutilizzare readiness e restart comuni evitando doppio riavvio.
- [x] PY-7.3 *(2026-10-21: `lib/code-studio/runServerURL.ts` rileva gli URL locali nell'output della console (uvicorn/Django/Flask/Vite; `0.0.0.0` e `[::1]` diventano `localhost`, gli host remoti escono) e la barra del pannello Run mostra "Open in browser" solo quando un URL c'è — apertura con `openExternal` **su azione esplicita**, nessun `CustomEvent`, nessun fetch, nessuna apertura automatica al rilevamento. Test `runServerURL.test.ts` (4). L'import OpenAPI FastAPI ("eventuale" nella voce) non è implementato e non è un requisito.)* URL locale pronto verso preview/browser esistente solo su azione; eventuale OpenAPI FastAPI verso import esistente tramite entity router, niente nuovo `CustomEvent`, fetch o apertura automatica al semplice rilevamento.
- [x] PY-7.4 *(2026-10-21: template integrati `python-script` (script con guard `__main__`) e `python-pytest` (modulo + `pyproject.toml` con `testpaths`/`pythonpath`, test in `tests/`) in `projecttemplates/`, registrati con `Language: "python"`: la creazione scrive solo file (nessun comando, nessun `go.mod`, nessuna installazione — lo dice anche il README del template), target creato nuovo dal `CreateProjectDirectory` quindi nessun file utente viene sovrascritto; framework opzionali non inclusi di proposito. Test `TestNonGoTemplatesCreateFilesWithoutGo` esteso ai due template (file attesi, segnaposto `__NAME__` sostituiti in README e pyproject, PATH senza `go`).)* Template minimi Script e progetto pytest; framework opzionali separati. Creare file non installa pacchetti, non esegue codice e non sovrascrive file esistenti; manifest e istruzioni coerenti col gestore scelto.
- [ ] PY-7.5 *(parziale 2026-10-21: suggerimenti e argv verificati con fixture (Django, FastAPI, Flask, entry point); porta occupata, startup fallito e readiness con server locale reale non verificati.)* Testare suggerimenti/argv con fixture, porta occupata, startup fallito, stop e readiness con server locale reale. Nessuna esigenza Docker/cloud per il primo supporto Python.

#### PY-8 — Sicurezza, persistenza e risorse

- [x] PY-8.1 *(2026-10-21: run, test, debug, installazioni e probe dell'interprete passano dal layer trust/process; `process_launch_guard_test.go` copre anche run/test/debug Python e nessuna esecuzione avviene su cartella non fidata; la discovery legge solo nomi e manifest.)* Tutti i processi passano da trust/process layer esistente, compresi probe interprete, Poetry/uv, discovery pytest e installazioni; nessuna esecuzione all'apertura di una cartella non fidata. Lettura statica non richiede esecuzione del progetto.
- [x] PY-8.2 *(2026-10-21: persistenza additiva — nessuno schema esistente modificato; gli interpreti assoluti vivono solo in `.adomnia/python.local.json` (macchina), le configurazioni condivise non serializzano né segreti né env risolti e il campo `interpreter` resta opzionale.)* Persistenza additiva/loader compatibili: config precedenti Go/Java/web intatte, interpreti assoluti solo locali, riferimenti portabili alle unità nei file condivisi. Non serializzare segreti/env risolti; definire migrazione solo se cambia davvero uno schema.
- [ ] PY-8.3 *(parziale 2026-10-21: versioni pinnate (`basedpyright==1.40.2`, `debugpy==1.8.22`), destinazione isolata per basedpyright (`pip --target` nella cartella strumenti), conferma esplicita con comando visibile, funzionamento offline dopo l'installazione; debugpy viene installato nell'interprete scelto solo su richiesta esplicita (serve al programma debuggato). Mancano la verifica hash degli artefatti e la gestione esplicita delle dipendenze transitive oltre al bundle di pip.)* Installer: versioni pinnate, destinazioni isolate, hash/artefatti verificati e policy rete comune; niente `pip install` globale, aggiornamenti o download transitive silenziosi. Supportare strumenti già presenti e messaggio utile offline.
- [ ] PY-8.4 *(parziale 2026-10-21: Stop/Low resources libera LSP, DAP e figli gestiti tramite il lifecycle comune (sweep dei figli registrati); nessuna misura di startup/idle/RAM su workspace misto: resta il collaudo PY-M con la stessa fixture.)* Stop/Low resources libera LSP, DAP e figli delle run gestite senza chiudere progetto o perdere modifiche. Misurare startup, idle e RAM di workspace misto prima/dopo con stessa fixture; niente percentuali senza misure.
- [x] PY-8.5 *(2026-10-21: limiti di parsing/riga/output nel parser e nei tipi albero comuni, un parser per esecuzione, cache del plugin condivisa in sola lettura; `internal/ide/architecture_test.go` e gli architetturali core/adapter verdi.)* Verificare limiti parsing/file/report, concorrenza, cache per ambiente e nessuna contaminazione tra unità; mantenere verdi i test architetturali core/adapter.

#### PY-9 — Verifiche e documentazione

- [x] PY-9.1 *(2026-10-21: per blocco `go test ./internal/languages/python/...` più host/core toccati (`internal/ide/dap`, `internal/codestudio` mirati), Vitest mirati e `npx tsc --noEmit`; test reali (`TestRealPytestRunProducesTree`, `TestRealDebugpyStopsAtBreakpoint`) separati dai deterministici con skip motivato via `ADOMNIA_TEST_PYTHON`.)* Per blocco: `go test ./internal/languages/python/...` e package host/core toccati; Vitest mirati e `npx tsc --noEmit` per modifiche TS. Test reali dipendenti da strumenti separati dai test deterministici, con skip motivati.
- [x] PY-9.2 *(2026-10-21: binding rigenerati con la Wails del repo (`wails3 generate bindings -ts`, come da Taskfile), `go build ./...`, `npm run build` e `npm run check:startup` verdi; suite completa Go eseguita al checkpoint.)* Checkpoint integrazione: binding con versione Wails del repo se cambia API, `go build ./...`, `npm run build`, `npm run check:startup`; suite complete frontend/Go solo al checkpoint finale o per regressioni estese.
- [x] PY-9.3 *(2026-10-21: `docs/CODE-STUDIO.md` (sezione Python con limiti dichiarati), catalogo, `docs/ISSUES.md`, README aggiornati distinguendo supporto IDE dal runtime plugin rimosso; nessun annuncio Rust.)* Aggiornare `docs/CODE-STUDIO.md`, catalogo, `docs/ISSUES.md`, README e istruzioni architetturali: distinguere supporto IDE da runtime plugin, tool esterni richiesti e limiti provati. Non annunciare Rust prima del suo adapter.
- [x] PY-9.4 *(2026-10-21: registro compilato sotto, con Impl/Test/Manuale/Doc per blocco; i collaudi PY-M* sono in `mds/MANUAL-CHECK.md`; revisione indipendente NON eseguita e non spuntata.)* Compilare registro per fase: Impl / Test (comandi, esito, tool/versioni, skip) / Manuale (riferimenti PY-M*) / Doc; revisione indipendente resta non spuntata finché avvenuta. Collaudi solo in `MANUAL-CHECK.md`, sezione PY.

**Uscite incrementali:** PY-0–PY-4 = editing e Run Python; PY-5–PY-6 = test/debug; PY-7–PY-9 = framework e chiusura. Ogni uscita indica chiaramente i limiti: un adapter registrato o una build verde non equivalgono a supporto completo.

**Fuori primo perimetro:** Jupyter/notebook, debugger remoto, Conda manager completo, installazione automatica di Python, pubblicazione PyPI, gestione grafica universale dei pacchetti, runtime plugin Python. Un interprete Conda selezionato manualmente può essere valutato come eseguibile, senza promettere lifecycle Conda.

**Rust dopo Python (9.6):** usare lo stesso contratto con `internal/languages/rust`, detection Cargo workspace/target, rustup/toolchain esplicita, schema run bin/example/test/bench, rust-analyzer, test Cargo strutturati e CodeLLDB. Dettagliare versioni/protocolli e gate con documentazione ufficiale quando parte quel blocco; non introdurre adesso astrazioni Rust speculative. Correzioni generiche emerse da Python devono restare riusabili.

**Fonti ufficiali consultate per il piano (2026-10-21; versioni da pinnare in PY-0):** [basedpyright installazione](https://docs.basedpyright.com/dev/installation/command-line-and-language-server/), [configurazione LSP](https://docs.basedpyright.com/latest/configuration/language-server-settings/), [uv ambienti](https://docs.astral.sh/uv/pip/environments/), [uv comandi e sync](https://docs.astral.sh/uv/reference/cli/), [debugpy CLI](https://github.com/microsoft/debugpy/wiki/Command-Line-Reference), [debugpy configurazione](https://github.com/microsoft/debugpy/wiki/Debug-configuration-settings), [pytest documentazione](https://docs.pytest.org/en/stable/). Verificare nuovamente i contratti quando si implementano i relativi blocchi.

---

## Fase 10 — Qualità trasversale e chiusura

- [x] 10.1 *(2026-10-21: `architecture_test.go` aggiunge la regola "gli adapter non si importano tra loro" (`TestLanguageAdaptersDoNotImportEachOther`) oltre a core→nessun adapter e adapter→nessun host; verde con Go, web, Java e Python.)* `internal/ide/architecture_test.go` esteso: il core non importa nessun adapter né librerie specifiche di linguaggio (resta verde a ogni fase).
- [x] 10.2 *(2026-10-21: `internal/languages/contracttest` — una suite parametrica con una `Case` per linguaggio: identità stabile e univoca, selettore dei documenti, unità rilevata nella cartella attesa con manifest confinato, suggerimenti completi e validi, schema per ogni kind del runner. Copre Go, TypeScript/Node, HTML, CSS/SCSS, JSON, Java e Python; nessun processo avviato.)* Test di contratto *condivisi*: una suite parametrica che ogni adapter deve passare (detect → suggest → command → validate), invece di suite scritte a mano per linguaggio.
- [ ] 10.3 Prestazioni di avvio: Code Studio resta lazy; nessun server di linguaggio parte senza un file di quel linguaggio aperto; misurare memoria con 3 server attivi.
- [ ] 10.4 Cross-platform: Windows (processi nascosti, DPAPI), Linux (WebKitGTK: controlli form in tema scuro), macOS (compila).
- [ ] 10.5 Accessibilità e tema: tastiera sulla barra Run/wizard, light + dark verificati.
- [ ] 10.6 Docs: `docs/CODE-STUDIO.md` (guida), `docs/RELEASE.md` (breaking: rename + migrazione chiavi), `docs/BUILD.md` se cambiano dipendenze di build, release notes in `docs/releases/`.
- [ ] 10.7 Release: `develop` → ff `main` → tag, controllando ogni push (vedi memoria `reference_git_commit_hook`).

---

### Nuovi TODO condivisi dal confronto funzionale

- [x] 10.8 *(2026-10-21: `codeStudioCommitFormat.ts` — preferenza locale (`adomnia.codeStudio.commitFormat`, default Conventional Commits, quindi compatibile con chi non l'ha mai impostata), tre formati (Conventional, prosa libera, template con `{{summary}}`/`{{body}}`), template vuoto o senza `{{summary}}` normalizzato, prompt senza più "Go project" e con la lingua del progetto; la bozza resta modificabile e nessun commit è automatico. Test `codeStudioCommitFormat.test.ts`: round-trip, JSON corrotto, formato ignoto, template vuoto/incompleto e prompt neutro su diff Go, Java e misto. Prova in app: ML-10.M1.)* **Commit AI con formato personalizzabile (P1).** Rendere neutro il prompt che oggi cita un progetto Go; scegliere tra Conventional Commits, formato libero e template personale con anteprima modificabile. Preferenza locale con default compatibile; redazione e policy AI invariate, nessun commit automatico. Test su diff Java/Go/misti e template vuoto/non valido. Prova in app: ML-10.M1.
- [x] 10.9 *(2026-10-21: preferenza `multilineTabs` in `GoIDEEditorPreferences` (default spenta, persistita con le altre e importabile/esportabile), comando View → Multi-Row Editor Tabs con spunta, tablist con `flex-wrap` e altezza massima 70 px (due righe, poi scroll) nella stessa riga di tab di split/preview; pin, preview, chiusura, tastiera e scroll della tab attiva invariati. Test store per default e persistenza; prova in app: ML-10.M2.)* **Tab editor multilinea (P1).** Opzione una riga/più righe, comune a linguaggi e split. Conservare pin, preview, riordino, chiusura, tastiera e visibilità della tab attiva; limitare l'altezza occupata. Preferenza persistita con migrazione/default compatibili. Test mirati e prova in app ML-10.M2.
- [ ] 10.10 **Homebrew: verificare pubblicazione e aggiornamento (P2/distribuzione).** Template Cask/Formula e workflow esistono: verificare tap pubblicato, asset/checksum della release, installazione e upgrade su macOS; documentare comandi e limiti. Distinguere template da canale distribuito e provato; nessun updater parallelo. Verifica nativa ML-10.M3.

**Entry point:** mantenere 9.2 (JS/TS), 9.5 (Python), 9.6 (Cargo/Rust) come sedi del lavoro; includere Procfile nel completamento delle proposte generiche, con parsing locale e avvio solo su azione. Make/Compose/shell disponibili si verificano nel flusso Detected, senza nuovi runner duplicati.

---

## Rischi

| Rischio | Livello | Mitigazione |
| --- | --- | --- |
| Rename di ~800 file rompe import/binding/branch aperti | **Alto** | Fase 1 (solo UI) isolata e rilasciabile; rename in Fase 2 meccanico da mappa, un commit per sotto-fase, `tsc` + `go vet` ad ogni step |
| Perdita di stato utente (layout, impostazioni LSP, run config) | **Alto** | Migrazione in lettura, vecchie chiavi non cancellate per un rilascio, test idempotenza |
| Formato `.adomnia/run-configurations.json` condiviso via Git rotto tra versioni | **Alto** | 3.4: scrittura doppia (campi piatti Go + `languageOptions`) per un rilascio |
| Download automatici di server/debugger violano il local-first | Medio | 9.3: installazione solo esplicita, pinnata e verificata |
| Più language server attivi insieme saturano RAM | Medio | Avvio lazy per (linguaggio, unità), spegnimento per inattività, 10.3 |
| Lo schema dinamico produce una UI generica e brutta | Medio | 4.1: direzione visuale prima del codice; componenti di campo curati; verifica visiva in app |
| Scope enorme (9 linguaggi) | Medio | Contratto minimo + gate per linguaggio; P0 prima, P2 solo dopo; C/C++/PHP/Ruby fuori piano |
| Estrazione prematura di interfacce | Basso | Regola del piano: capability solo con primo consumatore reale |

## Fuori perimetro (deliberato)

- Run target **Remote** (solo voce disabilitata e documentata).
- C/C++, PHP, Ruby (su domanda).
- Marketplace di estensioni di linguaggio di terze parti.
- Spostare in massa codice Go-specifico (profiler, race, goroutine…) in moduli generici: resta nell'adapter Go.

## Ordine di esecuzione consigliato

1 → 2 → 3 → 4 → 5 (rilasciabili: l'utente vede nome nuovo + run UI nuova, ancora solo Go/web) → 6 → 7 → 8 → 9 (P0 → P1 → P2) → 10.
Le Fasi 7 e 8 possono procedere in parallelo dopo la 4–5; la 9 non parte prima del gate della 3.

## Registro avanzamento

| Data | Fase | Nota |
| --- | --- | --- |
| 2026-10-17 | — | Piano creato, nessun task iniziato |
| 2026-10-17 | 2 | 2.1–2.7 fatti: regola unica prefisso `GoStudio`→`CodeStudio` (i file davvero Go restano `CodeStudioGo*`); `components/goide`→`components/code-studio`, `lib/goide`→`lib/code-studio`, `stores/goide*`→`stores/codeStudio*`; `internal/goide`→`internal/codestudio`, `goidewindow`→`codestudiowindow`, `goide_*_bindings.go`→`code_studio_*_bindings.go`; rail id `goide`→`codestudio` con alias in `normalizeRailItem`; localStorage `adomnia.goide.*` migrato in `adomnia.codestudio.*` (`lib/legacyStorageMigration.ts`, vecchie chiavi conservate); eventi `goide:*`→`code-studio:*`; binding rigenerati; docs/GO-STUDIO*.md→CODE-STUDIO*.md. **Tenuti di proposito** (contratti persistiti): service Wails `GoIDE`, bucket e data dir `goide`, label Docker `adomnia.goide.session`. Resta 2.8 (prova in app + gate grep). |
| 2026-10-17 | 1 | 1.1–1.7 fatti: ~200 file (frontend/src, internal, root *.go) "Go Studio/gO Studio/Go IDE" → "Code Studio"; hub "Build. Run. Debug." + glifo `</>`; tsc, go vet, Vitest 600/600, go test goide/copilot/milk/goidewindow verdi. Aperta solo 1.8 (prova in app). `frontend/bindings` non toccati: i commenti si rigenerano con i binding |
| 2026-10-17 | 3, 5, 6, 8 | Fase 3: `run.SchemaProvider`/`ConfigValidator`, `GetRunSchema`/`GetRunSuggestions`, compatibilità file provata (3.4). Fase 5: `Suggest` Go e web, dedup/saved (5.3–5.4), card Detected. Fase 6: unità derivata dalla working directory, lista raggruppata per unità. Fase 8: riavvio al salvataggio per linguaggio/cwd, Run di app Node apre la Live Preview. Restano le voci parziali indicate. |
| 2026-10-17 | 9 | Java (9.4.1–9.4.7): adapter, JDT LS 1.60.0 con install visibile (`lsp.ServerProvider`), JUnit strutturato, form Main Class, Java Debug Server, debug JUnit/Spring/remote, gutter ▶, Lombok, navigazione JDK, Optimize Imports. JS/TS: test Vitest/Jest strutturati (9.2 parziale). Aperto 9.4.8. |
| 2026-10-18 | — | Piano riallineato al codice: 2.1 chiusa, 9.4 spezzata in sotto-voci, registro completato. |
| 2026-10-18 | 6, 7, 8 | Chiusi nel codice: monorepo go.work+npm+Java (6.1/6.8), `workspaceFolders` per unità (6.3), guardia di autorizzazione su tutti i provider (6.7), menu Run raggruppato per unità (6.2), readiness a porta del compound (8.5/6.6), niente riavvio per comandi con reload nativo e file generati (8.6), SQL verso Database (7.3), script come proposte Detected (7.4). Aperti solo UI/app: 6.5, icona 6.2, 7.2, 8.7, 8.8 e le prove in app. go vet, go test mirati, tsc, Vitest (1110) e `check:startup` verdi. |

| 2026-10-18 | 9.4.8 | Verifica automatica reale offline Spring Boot/Maven e Gradle/JUnit: breakpoint, variabili, VM options e ambiente. Test mirati Java/LSP/run/security Maven e 30 test frontend verdi; build frontend verde. Nessun gate desktop chiuso; import Gradle Buildship e bootRun del plugin Spring restano aperti. |

| 2026-10-18 | Priorità / 7 / 10 | Nuovi TODO dal confronto: JS-14 P0 immediato (Java locale: completamento e outline), JS-15 datasource Spring; 10.8 formati commit AI, 10.9 tab multilinea, 7.6 Markdown/Yuque, 10.10 verifica Homebrew. Nessuna implementazione dichiarata. |

### Python — primo incremento implementato, 2026-10-21

Impl: adapter Python registrato, marker e script sciolti rilevati con scansione condivisa; sottoprogetti espliciti conservati, ambienti/cache ignorati. Run script/module con interprete assoluto esplicito, argv senza shell, script confinato anche dopo risoluzione symlink, output non bufferizzato; form schema-driven e debug/LSP non pubblicizzati. Nessuna modifica agli schemi persistiti.

Test: `go test ./internal/languages/python ./internal/ide -count=1` PASS; test host Python e workspace misti PASS dopo aggiornamento dell'asserzione storica che escludeva Python (ora l'adapter esiste). Esecuzione reale script/modulo con Python 3.11 locale PASS. `npx vitest run src/components/ide/languages.test.ts` PASS (5 test), `npx tsc --noEmit`, `go build ./...`, `npm run build` PASS. Nessuna suite completa richiesta per questo incremento circoscritto.

Manuale: PY-M1/PY-M3 aperti; nessuna prova nativa eseguita. Doc: CODE-STUDIO, catalogo, ISSUES, README e CLAUDE aggiornati. PY-1/PY-3 restano parziali: niente parsing TOML, suggerimenti Detected, selettore per unità o auto-discovery interprete; le altre fasi sono aperte. Nessuna casella di supporto completo spuntata e nessuna revisione indipendente dichiarata.

### Python — run, test, debug e editor, 2026-10-21

Impl: `internal/languages/python` completo — `toml.go`/`pyproject.go` (parser TOML tollerante e manifest, mai codice eseguito), `interpreter.go` (scoperta e scelta interprete per unità: salvata → ambiente del progetto → PATH, probe solo su progetto autorizzato, `.adomnia/python.local.json`), `runner.go` (script/module con interprete risolto e confinamento), `suggest.go` (proposte verificabili: script di avvio, Django/FastAPI/Flask prudenti, entry point, pytest), `test_runner.go` + `adomnia_pytest_events.py` (plugin pytest embedded con node ID veri) + `pytest_events.go` (parser albero), `server.go` (basedpyright 1.40.2 pinnato, installazione esplicita `pip --target` isolata nella cartella strumenti), `debug.go` (debugpy con porta di loopback riservata). Host: `service_python.go` (report/sonda interpreti, selezione, `InstallPythonTool` pinnato e confermato) e `service_python_debug.go`. Core DAP esteso in modo generico: `LaunchRequest.Root`, avvio del processo con endpoint già noto (`Address` + `Executable`) e handshake che non si blocca sulla risposta di launch/attach (debugpy la dà dopo `configurationDone`). Frontend: contribuzione `languages/python` (editor, LSP provided, menu, comandi `python.selectInterpreter`/`python.installDebugpy`), dialogo interpreti, `startPython` nel debug store, rami python nell'albero test (node ID, rerun failed, debug del test), `testTargets` pytest, dispatch dei comandi. Guardia di autorizzazione estesa a run/test/debug Python.

Test: `go test ./internal/languages/python ./internal/ide/dap ./internal/ide ./internal/codestudio` (intera suite codestudio compresa) PASS; **test reali** con Python 3.11 locale + pytest 9.1.1 + debugpy 1.8.22 (`ADOMNIA_TEST_PYTHON`): `TestRealPytestRunProducesTree` (albero da pytest reale con parametrizzati/fallimenti) e `TestRealDebugpyStopsAtBreakpoint` (breakpoint reale, frame, evaluate `x == 1`) PASS; senza quel interprete i due test si saltano con motivo. Frontend: `npx tsc --noEmit` pulito, 82 Vitest mirati verdi (codeStudioTestTree, testTargets, pythonDebug, languages, commands, debug store), `npm run build` e `npm run check:startup` verdi; binding rigenerati con `wails3 generate bindings -ts`. Versioni verificate: basedpyright 1.40.2 (PyPI, avvio reale del langserver), debugpy 1.8.22, pytest 9.1.1.

Manuale: PY-M1–PY-M8 aperti in `mds/MANUAL-CHECK.md` (nessuna prova su app avviata in questo incremento). Aperti e dichiarati: matrice piattaforme/hash artefatti (PY-0.2), gestori uv/Poetry e azioni venv (PY-2.3/2.4), due ambienti in un server multi-root (PY-4.2), formattazione Python (PY-4.5), coverage pytest (PY-5.5), exception breakpoint e attach (PY-6), campi guidati framework/preview/template (PY-7.2–7.5), misure risorse (PY-8.4), `--reload` non ancora rimosso nel debug dei config framework (PY-6.4). Doc: CODE-STUDIO, catalogo, ISSUES, README aggiornati. Revisione indipendente non eseguita.

### RC-UI — Run configurations (2026-10-21)

- [ ] RC-UI.1 **IMPLEMENTATO, collaudo nativo aperto:** finestra ridisegnata con ricerca, gruppi per unità, tipi pertinenti al progetto prima degli altri, precompilazione cwd solo univoca, revisione Detected prima del salvataggio, sezioni compatte e protezione draft. Schema/provider condivisi; nessuna modifica persistita o backend. Impl: `CodeStudioRunConfigurations`, `CodeStudioRunWizard`, `RunConfigForm`, `codeStudioRunConfigurations.css`, helper `runConfigurationCatalog`. Test: 21 test mirati (catalog, unit grouping, form, language contributions), typecheck/build frontend e startup check PASS. Verifica browser con fixture chiara/scura: ricerca, default cwd e annullamento discard PASS; binding assenti nella fixture, niente dichiarazione di salvataggio/rilevamento reale. Manuale: RC-UI.M1. Doc: CODE-STUDIO, catalogo, ISSUES e README aggiornati. Revisione indipendente non eseguita.

### EDIT-MODE — Tastiera editor (2026-10-21)

- [ ] EDIT-MODE.1 **IMPLEMENTATO, gate desktop aperto:** indicatore Vim/Emacs visibile con istruzioni e azione di ritorno alla scrittura standard. Eventi `vim-mode-change` sull'adapter, con unsubscribe al dispose. Riproduzione reale in browser: Normal + Invio/Space cambia solo posizione; Insert e standard scrivono `x ` e newline. Test regressione lifecycle rosso prima del fix, verde dopo; test indicatore e contesto tastiera verdi. Nessun file/profilo utente modificato durante la diagnosi. Stato della sessione nativa dell'utente non verificato. Manuale: EDIT-MODE.M1.

### Python — ▶ nel gutter Run/Debug (2026-10-21)

Impl: `codeStudioPythonTargets.ts` (riga del ▶: guard `if __name__ == "__main__":`, prima riga senza guard), `CodeStudioRunTargetMenu` (Run/Debug), `CodeStudioPanel.runTarget` (guardia di autorizzazione, run con `languageOptions.script` relativo al progetto, debug con debugpy sullo stesso script via `startPython`), hover e glifo in `CodeStudioCodeEditor`, tipo `python-main` in `codeStudioRunTargets`. `GoIDEQuickRunKind` aggiunge `script` e `startRun` inoltra `languageOptions`, prima perso nel quick run. Nessuna modifica backend: lo script era già il target del Runner Python.

Test: `codeStudioPythonTargets.test.ts` (guard, fallback prima riga, integrazione con `findRunTargets`); `npx vitest run src/components/code-studio/` = 135 file / 631 test verdi (prima esecuzione con errore di worker transitorio, ripetuta due volte verde); `npx tsc --noEmit` pulito.

Manuale: PY-M10 aperta (`mds/MANUAL-CHECK.md`). Doc: nessun documento toccato — Run/Debug Python sono già descritti in `docs/CODE-STUDIO.md` e il gutter rientra nella voce citata. Revisione indipendente non eseguita.

### Python — interpreti: probe, compatibilità e fixture (2026-10-21)

Impl: probe dell'interprete esteso con l'architettura (`platform.machine()` + bits, `architecture` in `Interpreter`/`InterpreterInfo` e nella riga di dettaglio del dialogo); `CheckRequiresPython` (sottoinsieme PEP 440: `>=`, `>`, `<=`, `<`, `==`, `!=`, `~=`, `===`, clausole con virgola e `*`) + `FlagIncompatible` segnalano nel report la versione che non soddisfa `requires-python` dell'unità (badge `problem` già nel dialogo, nessuna UI nuova). `readInterpreterInfo` rispetta il timeout anche quando un figlio tiene lo stdout aperto e termina l'albero con `process.TerminateTree` invece di lasciare processi orfani.

Test: `interpreter_test.go` — `TestCheckRequiresPython` (20 casi), `TestFlagIncompatibleMarksOnlyTheProbedCandidates`, `TestProbeReportsVersionPackagesAndArchitecture` (probe reale, Python 3.11 locale), `TestProbeTimesOutOnAStuckInterpreter` (**rosso→verde**: prima il probe restava appeso ~29 s su uno script bloccato, ora esce in ~1,4 s), `TestTwoUnitsWithDifferentEnvironmentsRunInIsolation` (fixture PY-0.4: due unità con venv proprio e modulo installato solo nel proprio, eseguite nello stesso test), `TestSavedInterpreterFromAnotherMachineFallsBack`. `go test ./internal/languages/python/` intera suite verde; `go test ./internal/codestudio/ -run "Python|Interpreter"` verdi; binding rigenerati (`wails3 generate bindings -clean=true -ts ./...`, solo `languages/python/models.ts`); `npx tsc --noEmit` pulito; `npx vitest run src/components/code-studio/` = 135 file / 631 test verdi.

Manuale: nessun collaudo nuovo — architettura e segnalazione di incompatibilità compaiono nel dialogo già coperto da PY-M2. Doc: `docs/CODE-STUDIO.md` (sezione Python). Revisione indipendente non eseguita.

### Python — debug senza reloader, cattura pytest, ambiente esplicito; contratto condiviso (2026-10-21)

Impl: `debugProgramArguments` rimuove `--reload`, `--reload-*` (con il valore separato), `--debugger`, `--debug` di Flask e impone un solo `--noreload` a `manage.py runserver` (PY-6.4). Il plugin pytest riporta `capstdout`/`capstderr` per fase e il parser li conserva nell'output del singolo test, anche quando passa (PY-5.4); `testRunMessages.ts` distingue run in corso, interrotto, comando fallito prima dei risultati e nessun test. Nuovo `internal/languages/python/environment.go`: `DetectEnvironmentManager` (uv/poetry/pip, lockfile, `.python-version`) e `PlanEnvironment` con i due comandi espliciti e separati (crea `.venv`, installa le dipendenze con il pip dell'ambiente), esposti dall'host come `PythonEnvironment`/`CreatePythonEnvironment`/`InstallPythonDependencies` (autorizzazione + conferma, nessun sync o download implicito; PY-2.3/2.4). Il dialogo interprete ha il percorso manuale e le due azioni con il comando visibile. Icona del linguaggio nella barra Run e nella lista configurazioni (6.2), condivisa da `LanguageBrandIcon` e `ContextMenu.iconElement`. Contratto: `internal/languages/contracttest` (una `Case` per linguaggio, detect → suggest → schema) e nuova regola architetturale "gli adapter non si importano tra loro" (10.1/10.2).

Test: `go test ./internal/languages/python ./internal/languages/contracttest ./internal/ide` verdi; test reali con Python 3.11 + debugpy 1.8.22 (`ADOMNIA_TEST_PYTHON`, debugpy installato in una cartella temporanea): `TestRealDebugpyStopsAtBreakpoint` copre breakpoint, evaluate, step e secondo avvio; `TestRealPytestRunProducesTree` verifica la cattura dello stdout reale. `go test ./internal/codestudio/ -run "TestNoLaunchWithoutToolAuthorization|TestPythonEnvironmentPlanIsReadOnly"` verdi; `go vet`, `go build ./...`, binding rigenerati (`wails3 generate bindings -clean=true -ts ./...`), `npx tsc --noEmit`, `npx vitest run` mirati (7 `languages`, 4 `runUnits`+`catalog`, 4 `testRunMessages`), `npm run build` e `npm run check:startup` (nessun modulo differito nel percorso iniziale) verdi.

Manuale: PY-M2/ML-6.M1 restano aperti per la prova nativa; nessuna prova su app avviata. Doc: questa sezione e le voci 6.2, PY-2.3/2.4, PY-5.4, PY-6.4/6.5, 10.1/10.2. Revisione indipendente non eseguita.

### Python — exception breakpoint e coperture DAP (2026-10-21)

Impl: `dap` generico — `ExceptionBreakpointSettings`/`ExceptionBreakpointsView`, `SetExceptionBreakpoints` invia `setExceptionBreakpoints` ai debug attivi e lo rimanda all'handshake, filtri normalizzati (dedupe, max 20) pubblicati come `debug.exceptionBreakpoints`; persistenza per progetto in `SessionView.ExceptionBreakpoints` e `SaveSessionView` che non li azzera. UI: le contribuzioni linguaggio dichiarano `exceptionFilters` (debugpy: `raised`/`uncaught`), il dialog Breakpoints mostra la sezione Exceptions con lo stato `exceptionBreakpoints` dello store debug. Il test DAP reale copre anche step e **due sessioni contemporanee** (porte distinte); `debugAddressTimeout` è variabile per i test.

Test: `TestExceptionBreakpointsReachTheAdapter` (fake adapter che riecheggia i filtri ricevuti: handshake e cambio a sessione viva), `TestExceptionBreakpointsAreSavedAndRestored` (normalizzazione, sopravvivenza al salvataggio del layout, ripristino alla riapertura), `TestDebugAdapterCrashEndsTheSession`, `TestAdapterThatNeverOpensTheEndpointEndsTheSession`, `TestRealDebugpyStopsAtBreakpoint` esteso (debugpy 1.8.22 reale, `ADOMNIA_TEST_PYTHON`). Go `./internal/ide/dap` e `./internal/codestudio` verdi; frontend `npx tsc --noEmit` pulito e `npx vitest run src/components/code-studio/ src/components/ide/` = 141 file / 666 test verdi (nuovi: `toggleExceptionFilter`, `exceptionFiltersFor`); binding rigenerati.

Manuale: PY-M6 (exception breakpoint, due sessioni) resta il collaudo nativo. Doc: questa sezione e `docs/CODE-STUDIO.md` (pannello debug). Revisione indipendente non eseguita.

### Python — template New Project (2026-10-21)

Impl: `python-script` e `python-pytest` in `internal/codestudio/projecttemplates/` (linguaggio `python`: la creazione scrive solo file, senza comandi né `go.mod`); `python-pytest` porta `pyproject.toml` con `[tool.pytest.ini_options]` (`testpaths`, `pythonpath`) e un test in `tests/`. I README dichiarano che adOmnia non installa pacchetti e non esegue codice; i framework restano template opzionali separati.

Test: `TestNonGoTemplatesCreateFilesWithoutGo` esteso ai due template (file attesi, `__NAME__` sostituito in README e `pyproject.toml`, PATH senza `go`); suite template verde (`go test ./internal/codestudio/ -run "TestNonGoTemplates|TestBuiltinTemplates|TestCustomTemplate"`). Manuale: nessun collaudo nuovo — la creazione di progetto è già nei controlli New Project. Doc: nessun documento utente da toccare. Revisione indipendente non eseguita.

### Python — integrazione LSP reale (2026-10-21)

Impl: `server_lsp_test.go` con `TestRealBasedpyrightAnalysesProjectImports` — langserver reale (`basedpyright-langserver --stdio`) parlato con `lsp.Conn`: initialize, `workspace/didChangeConfiguration` dalle `pyrightSettings` del progetto, diagnostica, `textDocument/definition` e `textDocument/rename`. Lo scenario copre PY-4.6 con un solo venv (il gate "due ambienti nello stesso server multi-root" di PY-4.2 resta aperto): venv del progetto con un modulo marcato, import irrisolto segnalato, import dell'ambiente risolto (definition verso `site-packages`), rename con dichiarazione + uso.

Test: eseguito con l'interprete della verifica (`ADOMNIA_TEST_PYTHON`, Python 3.11 + basedpyright 1.40.2): PASS in ~0,8 s; senza interprete con basedpyright salta con il motivo. Suite completa `go test ./internal/languages/python/` verde. Manuale: PY-M4 resta il collaudo nativo dell'editor. Doc: nessun documento utente da toccare. Revisione indipendente non eseguita.

### Python — URL del server dal pannello Run (2026-10-21)

Impl: `runServerURL.ts` (`localServerURLs`/`firstLocalServerURL`) + bottone "Open in browser" nella barra del pannello Run, visibile solo quando l'output dichiara un URL locale e attivo solo su click (`openExternal`). Nessuna apertura automatica, nessun fetch, nessun `CustomEvent` nuovo; l'import OpenAPI FastAPI resta non fatto (era "eventuale").

Test: `runServerURL.test.ts` (uvicorn/Django/Flask/Vite, wildcard e IPv6 → localhost, host remoti ignorati, dedupe e punteggiatura); `npx tsc --noEmit` pulito, `npx vitest run src/components/code-studio/ src/lib/code-studio/` = 199 file / 928 test verdi. Manuale: PY-M7 (URL/preview) resta il collaudo nativo. Doc: nessun documento utente da toccare. Revisione indipendente non eseguita.

## AG — Workflow agenti in Code Studio e Teams (pianificato 2026-10-21)

**Obiettivo:** affidare ad agenti distinti implementazione, correzioni e analisi, eseguire task indipendenti in parallelo e revisionare risultati verificabili prima di integrarli. Il flusso utente è **Task → AI Agent → Code + Tests → Review → Merge**. L'agente implementa e propone; lo sviluppatore supervisiona, richiede correzioni e decide cosa integrare.

Il riferimento funzionale fornito dall'utente è il workflow di JetBrains Air; qui si pianificano funzioni di adOmnia, senza assumere integrazioni JetBrains, web o CLI già disponibili. Questa sezione autorizza solo la pianificazione: nessun task di implementazione è iniziato o completato.

### Base da riusare e confini

- `internal/ide/agentreview`, `stores/codeStudioAgentReview.ts`, `CodeStudioAgentReviewBar/Dialog`: esistono snapshot e review dei file con accettazione/rifiuto e protezione contro file modificati dopo il diff. Lo stato attuale è in memoria: non equivale a una review persistente per task/worktree con commenti e merge.
- Riusare i percorsi agenti/ACP e contesto AI già presenti, Git/diff, process manager, trust, Docker e task console. All'inizio di ogni blocco verificare i contratti correnti: presenza di una funzione non significa workflow completo.
- **Teams** è la sede richiesta per gestione del lavoro e automazioni. Prima dell'implementazione identificare il modulo e il relativo storage; se manca, pianificare un'estensione minima del coordinamento esistente. Non confonderlo con Microsoft Teams e non creare dipendenze cloud implicite.
- Pilastri: **Local-first** (task, log e artefatti locali/esportabili) e **User-extensible** (provider agenti, ACP e workflow configurabili). Servizi esterni solo quando selezionati dall'utente, con contesto e destinazione visibili.
- Motore in `internal/<dominio>/`, host Wails sottile; nessuna dipendenza da provider concreti in `internal/ide`. Nuove navigazioni tramite entity router, dialog/palette Code Studio comuni, UI lazy e neutra rispetto al linguaggio.

### AG-1 — Task e agenti distinti

- [ ] AG-1.1 Definire un task locale con ID stabile, progetto/unità, obiettivo, criteri di accettazione, file/aree assegnate, dipendenze, agente/provider e limiti di tempo/costo/risorse. Supportare implementazione, bugfix e analisi come intenzioni dello stesso modello.
- [ ] AG-1.2 Definire stati osservabili: bozza, in coda, preparazione, in esecuzione, richiesta intervento, verifica, in review, correzioni richieste, pronto da integrare, completato, fallito e annullato. Terminazione dell'agente e completamento del task sono eventi distinti.
- [ ] AG-1.3 Selettore agente per task con disponibilità, capacità effettive, modello/configurazione, origine locale/remota e prerequisiti. Ammettere agenti diversi per task diversi; dichiarare read-only quando è richiesto solo analizzare.
- [ ] AG-1.4 Rendere visibili piano, attività, modifiche e comandi; streaming con Stop, timeout, ripresa dove supportata e richiesta di intervento senza chiudere il task o perdere il diagnostico. Un errore provider non deve risultare come successo.
- [ ] AG-1.5 Conservare cronologia locale di prompt, decisioni, risultati e artefatti con limiti/retention, redazione dei segreti ed export. Versionare il formato e migrare in lettura senza cambiare sessioni/chat esistenti.

### AG-2 — Esecuzione parallela e Git worktree

- [ ] AG-2.1 Preparare un branch/worktree distinto per ogni task di scrittura, registrando repository, base commit, branch, directory e proprietario. Non condividere la stessa cartella di scrittura tra agenti concorrenti.
- [ ] AG-2.2 Prima di creare il worktree verificare stato Git e lavori non salvati. Rendere esplicito se si parte da un commit o da uno snapshot delle modifiche locali; niente stash/reset automatici o perdita di file utente.
- [ ] AG-2.3 Scheduler con concorrenza configurabile, coda, dipendenze, ownership dei percorsi e rilevamento sovrapposizioni. Task dipendenti attendono il risultato del predecessore; limiti separati per agenti, test e container.
- [ ] AG-2.4 Isolare anche porte, directory temporanee, report test e processi; mostrare CPU/RAM/task attivi e rendere Stop/Low resources selettivi. Chiudere un task non deve fermare gli altri o l'IDE.
- [ ] AG-2.5 Gestire repository non Git, worktree già esistente, branch occupato, submodule, Git LFS, spazio insufficiente e avvio parziale. Analisi read-only consentita senza worktree; scrittura condivisa mai usata come fallback silenzioso.
- [ ] AG-2.6 Cleanup esplicito e recuperabile: conservare diff/commit/artefatti prima della rimozione; distinguere annullamento, archiviazione e cancellazione. Verificare directory e ownership e non rimuovere checkout estranei.

### AG-3 — Review, commenti e richieste di correzione

- [ ] AG-3.1 Estendere Agent Review esistente con associazione task/agente/worktree/base SHA, elenco file e diff affidabile di aggiunte/modifiche/rimozioni/rinomine; gestire binari e file grandi con limiti dichiarati.
- [ ] AG-3.2 Aggiungere commenti sul diff con file, lato, intervallo e revisione di riferimento; thread aperti/risolti e commenti generali. Dopo nuove modifiche segnalare commenti obsoleti invece di agganciarli alla riga sbagliata.
- [ ] AG-3.3 “Richiedi correzioni” invia all'agente assegnato commenti selezionati e contesto minimo, nello stesso worktree; registrare il nuovo tentativo e mostrare il delta rispetto alla review precedente. Nessun invio a un provider diverso senza scelta esplicita.
- [ ] AG-3.4 Collegare evidenze Code + Tests: comandi, cwd, versioni, esito, durata, log e artefatti; distinguere test passati, falliti, non eseguiti e saltati. Legare l'esito al commit/diff verificato: modifiche successive invalidano il verde precedente.
- [ ] AG-3.5 Implementare “Pronto da integrare” e anteprima integrazione: base aggiornata, conflitti, file interessati e verifiche richieste. Merge/cherry-pick/applicazione diff soltanto su azione dello sviluppatore; nessun push, merge o approvazione automatica.
- [ ] AG-3.6 Conflitti e checkout sporco mantengono la review aperta; proporre risoluzione in un'area isolata e richiedere nuova review. Accettare un file nella review non equivale a un merge Git del task.

### AG-4 — Contesto progetto per gli agenti

- [ ] AG-4.1 Compositore del contesto con file/selezione, simboli, diagnostica, documentazione, regole progetto e metadati di build/test. Riusare devcontext, registry editor/LSP e filtri AI esistenti; niente seconda indicizzazione globale.
- [ ] AG-4.2 Anteprima di ciò che verrà fornito: origine, percorso/simbolo, quantità, limiti e destinazione. Applicare ignore, esclusioni segreti e budget prima dell'invio; cartelle vendor/cache/build escluse per default.
- [ ] AG-4.3 Snapshot coerente con il commit/worktree del task. Buffer non salvati inclusi solo con scelta esplicita e identificati come tali; non mescolare contenuto dell'editor principale e filesystem del worktree.
- [ ] AG-4.4 Recupero incrementale su richiesta dell'agente, cancellabile e confinato al progetto autorizzato; risposte troncate/negate spiegate. Documenti e output degli strumenti sono dati, non istruzioni che ampliano i permessi.
- [ ] AG-4.5 Contesto multi-linguaggio con capability effettive; assenza LSP non blocca file/documentazione. Cache invalidata su cambio revisione e task/sessioni isolati, senza credenziali o contenuti di altri progetti.

### AG-5 — Agent Client Protocol (ACP)

- [ ] AG-5.1 Inventariare ed estendere il client ACP esistente; verificare versione negoziata e capability dai contratti ufficiali al momento dell'implementazione. Non duplicare trasporto/session manager per ogni agente.
- [ ] AG-5.2 Registrazione agenti compatibili con comando/eseguibile, argomenti, ambiente redatto e verifica disponibilità; installazione esplicita quando necessaria. Supportare il percorso locale già esistente senza account o download automatici.
- [ ] AG-5.3 Collegare sessioni ACP al task e alla cwd del worktree/sandbox: streaming, tool calls, permission request, cancel e riconnessione. Funzioni non supportate restano indisponibili con motivo visibile.
- [ ] AG-5.4 Gestire crash, timeout, protocollo incompatibile, output malformato e provider che termina a metà modifica. Log tecnici redatti, retry esplicito e nessuna ripetizione automatica di operazioni con effetti non idempotenti.
- [ ] AG-5.5 Test di contratto con agente simulato e integrazione con almeno due implementazioni compatibili disponibili; matrice capability/protocollo documentata. Non chiamare universale una compatibilità provata su un solo agente.

### AG-6 — Sandbox e Docker

- [ ] AG-6.1 Definire profili visibili: worktree locale con permessi dichiarati e container Docker isolato. **Un worktree isola i file Git, non è una sandbox di sicurezza**; esprimere chiaramente la differenza nella scelta di esecuzione.
- [ ] AG-6.2 Container per task con worktree montato secondo i permessi, utente non privilegiato, limiti CPU/RAM/processi/tempo e filesystem temporanei. Niente mount della home o socket Docker nel container per default.
- [ ] AG-6.3 Politiche rete, eseguibili, filesystem e segreti per task: deny/restrict dove supportato e richieste di ampliamento esplicite. Credenziali solo quando necessarie, temporanee, redatte nei log e mai inserite nel repository o nelle immagini.
- [ ] AG-6.4 Immagini/template per linguaggio con versione/digest e dipendenze dichiarati; pull/build solo su azione. Docker assente, daemon fermo e ambiente offline hanno diagnostico e retry; nessun passaggio automatico a esecuzione host.
- [ ] AG-6.5 Mappare percorsi host/container per diff, test e diagnostica; gestire Windows/macOS/Linux e cleanup di container/volumi/processi anche dopo crash. Conservare prima i risultati necessari alla review.

### AG-7 — Automazioni nella componente Teams

- [ ] AG-7.1 Definire la UI Teams per elencare, creare, modificare, sospendere e rimuovere automazioni. Ogni automazione indica progetto, trigger, task template, agente, contesto, isolamento, limiti e destinatario della review; nessun modulo o servizio Teams considerato già implementato senza audit.
- [ ] AG-7.2 Trigger iniziali: avvio manuale e pianificazione locale con fuso orario; poi eventi Git espliciti. Dichiarare cosa accade ad app chiusa/offline, riavvio, cambio ora e run saltate: nessuna promessa di scheduler remoto o servizio sempre acceso.
- [ ] AG-7.3 Template per code review, proposta aggiornamenti dipendenze e manutenzione/test/documentazione. Gli aggiornamenti producono un worktree con diff e verifiche: non modificano direttamente il branch di lavoro e non vengono integrati da soli.
- [ ] AG-7.4 Deduplicazione trigger, lock per progetto/task, concorrenza, retry limitato e backoff; impedire loop in cui commit/output dell'automazione riattivano la stessa automazione indefinitamente.
- [ ] AG-7.5 Storico run con stati, log, costi se disponibili, artefatti e inbox “Da revisionare”. Notifiche locali configurabili; condivisione con altri membri, messaggi esterni o accesso a repository remoti richiedono destinatari e permessi espliciti.
- [ ] AG-7.6 Teams multiutente, se richiesto: definire ruoli proprietario/esecutore/revisore, controllo accessi e audit prima di aggiungere sincronizzazione. Primo rilascio local-first; nessun account/cloud obbligatorio per utilizzare task e automazioni locali.

### AG-8 — Sequenza, verifiche e criteri di uscita

**Sequenza:** AG-1 + AG-4 + AG-5 per un task singolo con contesto → AG-2 per task concorrenti → AG-3 per review/correzioni/integrazione → AG-6 per isolamento Docker → AG-7 per ricorrenze Teams. AG-2 e AG-6 restano requisiti dei task che dichiarano rispettivamente parallelismo in scrittura e sandbox; non sono simulati da etichette UI. Le priorità Python/Rust e i gate IDE esistenti restano separati.

- [ ] AG-8.1 Per incremento test mirati su stato task, confini filesystem, permessi, lifecycle processi, protocollo ACP, revisioni diff e scheduler; typecheck/build pertinenti. Suite complete solo al checkpoint finale o su modifiche trasversali.
- [ ] AG-8.2 Fixture end-to-end automatizzata con due task indipendenti in worktree distinti, test reali, commento → correzione → nuova review e conflitto rilevato. Verificare che il checkout iniziale e le modifiche utente restino intatti.
- [ ] AG-8.3 Documentare persistenza/migrazioni, requisiti Git/Docker/agenti, limiti di piattaforma, segreti/rete, consumo e recupero dopo crash. Aggiornare guida Code Studio, catalogo e ISSUES soltanto quando le funzioni sono implementate, distinguendo roadmap da prodotto disponibile.
- [ ] AG-8.4 Registrare Impl / Test / Manuale / Doc per ogni blocco; accettazione desktop AG-M1–AG-M7 esclusivamente in `MANUAL-CHECK.md`. Non spuntare il workflow completo se manca un passaggio o il merge avviene senza decisione dello sviluppatore.

**Criterio di uscita prodotto:** lo sviluppatore crea un task, sceglie agente/contesto/isolamento, osserva codice e test, commenta il diff, richiede una correzione e integra esplicitamente il risultato verificato. Può interrompere ogni fase senza perdere il proprio lavoro. Le automazioni consegnano risultati nello stesso percorso di review.

### AI-CHAT — Claude Code/milk: contesto, modelli, allegati (2026-10-21)

- [ ] **AI-CHAT.1 IMPLEMENTATO, manuale aperto:** contesto condiviso con file non salvato/selezione/regole/indice/unità; selettore modelli restituiti dall'agente, legacy incluso; graffetta file UTF-8 e immagini supportate; bozza/allegati conservati su errore. Backend valida immagini e policy AI prima delle sessioni. Non dichiara lettura completa del repository o disponibilità reale di Opus sull'account. Manuale AI-CHAT.M1–M2.
- [ ] **AI-CHAT.2 IMPLEMENTATO per milk 0.7, manuale aperto:** selezione agente/modello configurato con cambio `agent` globale, backup, campi ignoti preservati e nuova chat; routing/think via configId e discriminante di tipo v2; piani `plan_update`; nuove sessioni `fresh` per evitare resume invisibile. Versione installata 0.5.4 lasciata invariata, ultima stabile 0.7.0 verificata dalle fonti ufficiali. Manuale AI-CHAT.M3.
- [ ] **AI-CHAT.3 BLOCCATO upstream per immagini milk ACP 0.7:** `cmd/milk/acp_session.go` legge soltanto blocchi testo. UI/backend rifiutano immagini non supportate con errore; non inviano byte fingendo un'analisi visiva. Sblocco: ingresso multimodale annunciato dall'agente o estensione upstream verificata; riprovare trasporto e modelli, poi AI-CHAT.M4. File esterni testuali già supportati.
- [ ] **AI-CHAT.4 DA FARE, collegato ad AG:** valutare session/list/resume con replay/upsert, piani multipli con identità, follow-up dei job in background e board/workflow `team` introdotti da milk. Non duplicare il workflow multi-agente pianificato né considerare la sola inoltrabilità dei comandi slash una UI integrata.

Evidenza automatica: suite milk/claudecode/opencode e build Go PASS; controlli mirati race su sessioni/allegati/config PASS; 23 test frontend mirati e typecheck PASS; binding generati con Wails beta.32, build frontend e startup check PASS. Browser con fixture: scelta Sonnet→Opus, selezione file esterno e PNG tramite picker, rimozione dopo invio simulato riuscito, chiaro/scuro. Nessun prompt reale inviato a un provider e nessun esito nativo/account dichiarato. Snapshot/configuration e formati esistenti conservati; il cambio primary milk usa il writer atomico e backup esistenti.
