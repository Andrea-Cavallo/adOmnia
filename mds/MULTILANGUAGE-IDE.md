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

Decisioni (da confermare, default sotto):
- Rail id `goide` → `code-studio`. Il valore persistito è **migrato in lettura** (loader che accetta `goide` e riscrive `code-studio`).
- Chiavi storage `adomnia.goide.*` → `adomnia.codestudio.*` con **migrazione one-shot** (copia + non cancellare subito la vecchia per un rilascio, per poter tornare indietro).
- Service Wails `GoIDE`: **resta il nome del binding** finché non c'è motivo forte di rompere i call-site; si aggiunge l'alias/nuovo nome `CodeStudio` e si migra i call-site in modo graduale. _Se_ si rinomina, si rigenerano i binding con `go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28 generate bindings`.
- File `.adomnia/run-configurations.json` (formato condiviso via Git): **invariato**, solo caricato con migrazione.

Sotto-fasi (un commit ciascuna, in quest'ordine):
- [ ] 2.1 Classificare i 188 file `GoStudio*` in tre liste: **GENERICO** (→ `CodeStudio*`), **GO-SPECIFICO** (→ `Go*` senza "Studio", es. `GoFlameGraph`), **da dividere**. Salvare la lista in questo file (tabella sotto) prima di toccare nulla.
- [ ] 2.2 Script di rename mirato (`git mv` + sostituzione simboli/import), un file di mappa `old→new`, eseguito in modo deterministico; **mai** sed globale cieco (cfr. `reference_inline_script_backslashes`). Lo script resta in `scripts/` solo se riusabile, altrimenti nello scratchpad.
- [ ] 2.3 Cartelle frontend: `components/goide/` → `components/code-studio/`; `lib/goide/` → `lib/code-studio/`; `stores/goide*.ts` → `stores/codeStudio*.ts`; `lib/goide-api.ts` → `lib/code-studio-api.ts`. Lasciare re-export temporanei solo se serve per non rompere branch aperti.
- [ ] 2.4 Backend: package host `internal/goide` → `internal/codestudio`; `goide_bindings.go` → `code_studio_bindings.go`; `internal/goidewindow` → `internal/codestudiowindow`. Aggiornare `architecture_test.go` (la regola "il core non importa adapter" deve restare verde) e import in `main.go`.
- [ ] 2.5 Chiavi di storage + rail id + eventi Wails: introdurre i nuovi nomi, loader di migrazione, test di migrazione (stato vecchio → stato nuovo, idempotente).
- [ ] 2.6 `docs/`: `GO-STUDIO.md` → `CODE-STUDIO.md` (con sezione "Go" per le parti Go); aggiornare `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/adomnia-feature-catalog.en.md`, `docs/architecture/ide-multilanguage-refactor.md`, `docs/ISSUES.md`, `internal/**/CLAUDE.md`, `frontend/src/components/**/CLAUDE.md`. Non toccare `CHANGELOG.md` e `docs/releases/*` (storia).
- [ ] 2.7 `npm run check:startup`: Code Studio resta **lazy**, mai importato da `App.tsx`/startup.
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
- [ ] 3.1 Spec del contratto in `internal/ide/run` (o `language`): `RuntimeProvider` con soli metodi che hanno **un consumatore reale subito** — `Suggest(ctx, unit) []Suggestion`, `Schema(kind) FieldSchema`, `Validate(cfg) error`, `Command(cfg, action) Command` con `action ∈ {run, debug, test, build}`, `Capabilities()`. Il Go adapter è il primo implementatore, web il secondo.
- [ ] 3.2 `FieldSchema` serializzabile (JSON): sezioni `basic` / `advanced`, campi tipizzati (`text`, `path`, `select`, `list`, `keyvalue`, `toggle`), `visibleWhen`, `required`, `default`, `help`. La UI genera i campi da qui. Test: snapshot dello schema Go e web.
- [ ] 3.3 Spostare i rami Go di `normalizeConfiguration` nell'adapter: validazione `.go`, `RunKindGoTool`, `GOOS/GOARCH/BuildTags/GoArguments/Race/Coverage/Profile/DebugFlags` diventano `golang.RunOptions` dentro `LanguageOptions` (il tipo esiste già: `golang.RunOptions`). Il core non ha più `case ... .go`.
- [ ] 3.4 **Compatibilità file**: il DTO `.adomnia/run-configurations.json` continua a leggere i campi Go piatti e li migra in `languageOptions` al load; in scrittura emette il formato nuovo **e** (per un rilascio) i campi piatti per Go, così una versione precedente non perde dati. Test: round-trip vecchio→nuovo→vecchio.
- [ ] 3.5 `kind` generici (`run`, `test`, `build`, `command`, `compound`, `docker-*`) nel core; i kind propri di un linguaggio (es. `go-tool`, `maven-goal`, `npm-script`) vivono nell'adapter e arrivano dallo schema.
- [ ] 3.6 Binding: `GetRunSuggestions(sessionId, unitId)`, `GetRunSchema(language, kind)`, invariato il resto. Rigenerare i binding. Wrapper in `lib/code-studio-api.ts`.
- [ ] 3.7 Test mirati: `go test ./internal/ide/run/... ./internal/languages/golang/... ./internal/codestudio/...`.

**Gate Fase 3:** una configurazione Go esistente (file reale di un workspace) si carica, si esegue e si salva identica a prima; il core non contiene stringhe `go`/`.go`/`GOOS` (verifica con grep + `architecture_test.go`).

---

## Fase 4 — UI Run unica con sezioni dinamiche

Obiettivo: eliminare l'effetto "form amministrativo". Una sola interfaccia, generata dallo schema del provider.

- [ ] 4.1 Direzione visuale (prima di scrivere codice, cfr. `docs/SOUL.md` e `rules/web/design-quality`): campi compatti, gerarchia tipografica netta, bordi sottili, icone dal set già presente, **niente scroll infinito**, token CSS (`--color-*`) e zero palette Tailwind hardcoded. Mock a bassa fedeltà in questo file o in `mds/archivio/`.
- [ ] 4.2 **Separare creare da eseguire**: la barra Run (selettore configurazione + ▶ Run / 🐞 Debug / ✓ Test) non mostra mai il form; il form si apre in un popover/pannello "Edit". Salva, **duplica**, rinomina, elimina, fissa (pin), condividi (Git) senza ricompilare i campi.
- [ ] 4.3 **Wizard "Nuova configurazione"**: parte dal rilevamento (Fase 5). L'utente vede proposte ("Go · cmd/api", "Vite · npm run dev", "Maven · Spring Boot") e le conferma con un click; "Generico → Shell Command / Executable" sempre disponibile.
- [ ] 4.4 `RunConfigForm` che renderizza `FieldSchema`: sezione base sempre visibile, **Avanzate** collassata. `GOOS`, `GOARCH`, build tags, Go tool flags compaiono **solo** nelle avanzate Go (arrivano dallo schema, non dal JSX).
- [ ] 4.5 Sezioni trasversali (uguali per tutti, componenti riusati): **Environment** (profili `.env` dev/test/prod + override per configurazione), **Before launch** (lista ordinabile di task/altre configurazioni), **Run target** (Local / Dev Container / futuro Remote — `GoStudioRunTarget.tsx` esiste: va generalizzato, non copiato), **Restart** (Fase 8).
- [ ] 4.6 Validazione inline dallo `validate` del provider; messaggi puliti, nessun output grezzo di terminale.
- [ ] 4.7 Stato vuoto / errore / caricamento / successo per ogni azione (feedback percepibile su hover, active, loading).
- [ ] 4.8 Componenti < 300 righe (split di `GoStudioRunConfigurations.tsx` e `GoStudioRunParameters.tsx`), nessun `any`.
- [ ] 4.9 Prova in app (Windows + verifica WebKitGTK per i controlli nativi `select`/`input` in tema scuro, vedi CLAUDE.md) con: Go, web, e una configurazione generica.

**Gate Fase 4:** stesso componente `RunConfigForm` serve Go, web e generico; nessun `if (language === ...)` nel JSX del form (solo nelle contribuzioni di linguaggio).

---

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

- [ ] 5.1 Capability `ProjectDetector` esiste già; estenderla per riportare `Ecosystem` (es. `vite`, `spring-boot`) e `PackageManager` come metadati dell'`Unit` — **solo se** il primo consumatore (le suggestion) li usa in questa fase.
- [ ] 5.2 Rilevamento **del package manager reale** (lockfile: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`) e del wrapper (`mvnw`, `gradlew`) prima del binario di sistema. Un solo helper condiviso "trova lo strumento nel PATH / nel progetto" (ne esistono già copie sparse: **estrarre, non aggiungere una sesta**).
- [ ] 5.3 `Suggest()` per Go e web (web: script `dev`/`start`/`build`/`test` letti da `package.json`).
- [ ] 5.4 Ordinamento e deduplicazione: una proposta per (unità, azione); marcare quelle già salvate.
- [ ] 5.5 Test con fixture minime in `testdata/` per ogni marker (cartelle di 2–3 file, niente progetti veri).
- [ ] 5.6 UI: card suggerimenti nel wizard e nello stato vuoto della barra Run ("Trovato Vite · `pnpm dev` → Aggiungi").

**Gate Fase 5:** aprendo ognuna delle fixture, le suggestion attese compaiono e sono eseguibili con un click.

---

## Fase 6 — Workspace multi-modulo / microservizi misti

Caso d'uso: una cartella con `orders/` (Go), `billing/` (Java), `ml/` (Python), `web/` (React). Un solo Code Studio, quattro unità, ognuna col suo linguaggio.

- [ ] 6.1 Verificare che `project.Project` produca *N unità con linguaggi diversi* nello stesso root, anche annidate e con `go.work`/workspaces npm; correggere i punti in cui un rilevatore "vince" sugli altri.
- [ ] 6.2 Ogni `RunConfiguration` porta `unitId` (modulo di appartenenza) e cwd derivata dall'unità; la barra Run raggruppa per unità (`orders · Go`, `billing · Java`…) con icona di linguaggio (Simple Icons, già nel flusso `generate-brand-icons.mjs`).
- [ ] 6.3 LSP/DAP **per unità**: un language server per (linguaggio, root dell'unità), avviato lazy alla prima apertura di un file di quel linguaggio, spento per inattività. Verificare l'instradamento per `sessionId`/`language` negli store (nessuno stato che attraversa sessioni).
- [ ] 6.4 SDK/toolchain per unità (JDK per `billing`, Python venv per `ml`, Node per `web`): l'`ide/sdk` rileva per unità; tool-version cache resta process-wide (decisione già presa, non toccare).
- [ ] 6.5 Albero progetto, ricerca, problemi e test raggruppati per unità con filtro; i risultati di ricerca non mescolano linguaggi senza etichetta.
- [ ] 6.6 **Compound configuration** (Fase 8) che avvia più unità diverse insieme: ordine, readiness, log separati per processo con colore/etichetta.
- [ ] 6.7 Sicurezza: ogni avvio di processo controlla `session.Project.Authorization == AuthorizationPermitted` (già regola del core; test `process_launch_guard_test.go` deve coprire i nuovi provider).
- [ ] 6.8 Fixture di test: monorepo con 3 unità (Go + Node + Python finto) in `testdata/`; test di rilevamento, di routing LSP e di compound.

**Gate Fase 6:** in un monorepo misto, aprire un file per linguaggio avvia il server giusto con la root giusta; Run di una unità non tocca le altre; compound avvia le unità scelte.

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

- [ ] 7.1 Tabella unica `fileSupport` (estensione/nome file → Monaco language + LSP opzionale + azioni) in `components/ide/`, **non** una cartella per formato.
- [ ] 7.2 Verifica per ciascun formato: apre, evidenzia, formatta, outline dove sensato. Segnare i buchi qui sotto invece di inventare feature.
- [ ] 7.3 SQL: azione "Esegui nella connessione…" che riusa `internal/database` (nessun nuovo client); credenziali sempre sigillate come da CLAUDE.md.
- [ ] 7.4 Script (Bash/PowerShell): "Run file" come configurazione *generica* (Shell Command) proposta in automatico; su Windows i processi spawnati nascosti salvo uso interattivo.
- [ ] 7.5 Server dei linguaggi di config: solo se assenti in Monaco; nessun download silenzioso (local-first, vedi 9.3).

**Gate Fase 7:** apro un file per formato nella fixture "polyglot": evidenziato, formattabile, nessun errore in console.

---

## Fase 8 — Funzioni di run trasversali

Ognuna è una sezione di UI/engine **comune**, non per linguaggio.

- [ ] 8.1 **Run / Debug / Test come tre azioni distinte**, sempre visibili quando il provider le dichiara in `Capabilities()`, disabilitate con *motivo* quando no (es. "Debug non disponibile: manca `debugpy`" + azione "Installa…").
- [ ] 8.2 **Before Launch**: `PreRun` esiste; trasformarlo in lista tipizzata (comando | altra configurazione | build | install), con fallimento che blocca l'avvio e mostra *quale* step è fallito.
- [ ] 8.3 **Run targets**: Local e Dev Container (esistono, generalizzare l'UI); Remote lasciato come voce disabilitata documentata, *non* implementata.
- [ ] 8.4 **Environment Profiles**: `.env`, profili dev/test/prod, override per configurazione; segreti marcati `Secret` mai mostrati né loggati; precedenza documentata (profilo < `.env` < override).
- [ ] 8.5 **Compound Configurations**: `Compound` esiste; aggiungere ordine/dipendenze e *readiness* (porta aperta o log pattern — `composeready.go` ha già la base) così il frontend parte dopo il backend.
- [ ] 8.6 **Auto Restart**: `RestartOnSave`/`RestartPolicy` esistono; renderli valori per provider (`Capabilities().Restart`: `native` come `vite`/`air`, `process` = riavvio del processo, `none`), con debounce e senza loop su file generati/`node_modules`/`target`.
- [ ] 8.7 **Live Preview** per frontend: premendo Run su un'unità Vite/HTML la preview si apre in Code Studio (`internal/ide/preview` esiste; collegare il run al preview URL rilevato dall'output, p.es. "Local: http://localhost:5173").
- [ ] 8.8 Test mirati per ogni voce (engine: Go test; UI: Vitest) + prova in app di un compound reale (frontend + backend).

**Gate Fase 8:** scenario completo in app — apro React/Vite, vedo la proposta `pnpm dev`, premo Run, vedo l'app nella Live Preview; salvo un file e si ricarica; in un monorepo avvio il compound frontend + backend Go.

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
- [ ] 9.1 **Decisione di struttura JS/TS**: un adapter `web` (editor) + un adapter `node` (runtime/test/debug)? o `web` esteso? Scrivere la decisione in `docs/architecture/ide-multilanguage-refactor.md` prima di codare.
- [ ] 9.2 **P0 JS/TS**: provider `npm-script`/`node-script`, rilevamento package manager (5.2), test runner (Vitest/Jest/`node --test` con output strutturato), debug via js-debug, suggerimenti Vite/Next/Angular/Nest, Live Preview agganciata (8.7).
- [ ] 9.3 **Politica download tool** (decisione trasversale, prima del primo server): niente download silenziosi (local-first). Ogni server/debugger mancante → stato "non installato" con pulsante **Installa** esplicito, versione pinnata, checksum verificato, cartella tool per-utente, funzionamento offline se già installato. Riusare `ide/sdk` e il pattern di `sdk_install.go`.
- [ ] 9.4 **P0 Java**: rilevamento JDK (per unità), Maven/Gradle (wrapper prima del sistema), JDT LS, Main Class + Spring Boot run, JUnit con risultati strutturati, Java Debug Server (via JDT LS).
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
| 2026-10-17 | 1 | 1.1–1.7 fatti: ~200 file (frontend/src, internal, root *.go) "Go Studio/gO Studio/Go IDE" → "Code Studio"; hub "Build. Run. Debug." + glifo `</>`; tsc, go vet, Vitest 600/600, go test goide/copilot/milk/goidewindow verdi. Aperta solo 1.8 (prova in app). `frontend/bindings` non toccati: i commenti si rigenerano con i binding |
