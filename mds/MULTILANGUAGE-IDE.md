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
- Service Wails `GoIDE`: **resta il nome del binding** finché non c'è motivo forte di rompere i call-site; si aggiunge l'alias/nuovo nome `CodeStudio` e si migra i call-site in modo graduale. _Se_ si rinomina, si rigenerano i binding con `go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28 generate bindings`.
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
- [ ] 6.2 *(parziale 2026-10-17: scelta di design = l'unità si **deriva** dalla working directory (`lib/code-studio/runUnits.ts`, 4 test) invece di aggiungere `unitId` al formato persistito; la lista di Run configurations è raggruppata per `cartella · Linguaggio`, prova in app = ML-6.M1; 2026-10-18: anche il menu della barra Run raggruppa per unità con `orders · Go` a destra della voce; manca solo l'icona di linguaggio)* Ogni `RunConfiguration` porta `unitId` (modulo di appartenenza) e cwd derivata dall'unità; la barra Run raggruppa per unità (`orders · Go`, `billing · Java`…) con icona di linguaggio (Simple Icons, già nel flusso `generate-brand-icons.mjs`).
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
- [ ] 9.5 **P1 Python**: rilevamento interprete/venv/uv/poetry per unità, basedpyright, provider script/module/uvicorn/Django/Flask, pytest strutturato, debugpy.
- [ ] 9.6 **P1 Rust**: Cargo (bin/example/test/bench), rust-analyzer, CodeLLDB.
- [ ] 9.7 **P2 C# e Kotlin**: solo dopo che P0 e P1 passano il contratto minimo; Kotlin riusa il lavoro Gradle/JVM di Java.
- [ ] 9.8 Per ogni linguaggio chiuso: aggiornare `docs/CODE-STUDIO.md`, `docs/adomnia-feature-catalog.en.md`, `docs/ISSUES.md`, `README.md`, e ricordarsi di verificare l'AI (contesto minimo, cache) se il linguaggio la usa.

**Gate per linguaggio:** progetto reale piccolo (clone di un esempio ufficiale) → aperto, indicizzato, eseguito, testato, debuggato con breakpoint in app avviata, **senza** modifiche al core.

---

## Fase 10 — Qualità trasversale e chiusura

- [ ] 10.1 `internal/ide/architecture_test.go` esteso: il core non importa nessun adapter né librerie specifiche di linguaggio (resta verde a ogni fase).
- [ ] 10.2 Test di contratto *condivisi*: una suite parametrica che ogni adapter deve passare (detect → suggest → command → validate), invece di suite scritte a mano per linguaggio.
- [ ] 10.3 Prestazioni di avvio: Code Studio resta lazy; nessun server di linguaggio parte senza un file di quel linguaggio aperto; misurare memoria con 3 server attivi.
- [ ] 10.4 Cross-platform: Windows (processi nascosti, DPAPI), Linux (WebKitGTK: controlli form in tema scuro), macOS (compila).
- [ ] 10.5 Accessibilità e tema: tastiera sulla barra Run/wizard, light + dark verificati.
- [ ] 10.6 Docs: `docs/CODE-STUDIO.md` (guida), `docs/RELEASE.md` (breaking: rename + migrazione chiavi), `docs/BUILD.md` se cambiano dipendenze di build, release notes in `docs/releases/`.
- [ ] 10.7 Release: `develop` → ff `main` → tag, controllando ogni push (vedi memoria `reference_git_commit_hook`).

---

### Nuovi TODO condivisi dal confronto funzionale

- [ ] 10.8 **Commit AI con formato personalizzabile (P1).** Rendere neutro il prompt che oggi cita un progetto Go; scegliere tra Conventional Commits, formato libero e template personale con anteprima modificabile. Preferenza locale con default compatibile; redazione e policy AI invariate, nessun commit automatico. Test su diff Java/Go/misti e template vuoto/non valido. Prova in app: ML-10.M1.
- [ ] 10.9 **Tab editor multilinea (P1).** Opzione una riga/più righe, comune a linguaggi e split. Conservare pin, preview, riordino, chiusura, tastiera e visibilità della tab attiva; limitare l'altezza occupata. Preferenza persistita con migrazione/default compatibili. Test mirati e prova in app ML-10.M2.
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
