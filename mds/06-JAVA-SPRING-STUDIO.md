# 06 — Java/Spring Studio (profondità JVM)

Aggiornato: 2026-10-18 (piano creato da analisi comparata con **Lithe-IDEA**; JS-1 e JS-2 fatti in codice, prove in app aperte). Indice: [README.md](README.md).

> **Continua, non duplica.** [MULTILANGUAGE-IDE](MULTILANGUAGE-IDE.md) Fase 9.4 porta Java al *contratto minimo* (adapter, JDT LS, run, test, debug) ed è quasi chiusa: restano 9.4.8 (debug di `spring-boot:run` e dei task Gradle) e il collegamento completo al Security Center; parent/BOM e scansione Gradle sono già implementati (JS-8/JS-12). Questo piano prende **da dove 9.4 finisce**: la profondità "da IntelliJ" su Java/Spring/JVM. Le voci 9.4.8 e 9.4.9 restano in `MULTILANGUAGE-IDE.md`, non vengono ricopiate qui; qui se ne indicano solo i collegamenti.
>
> **Le verifiche che richiedono l'app in esecuzione stanno solo in [MANUAL-CHECK.md](MANUAL-CHECK.md)** (sezioni `JS-1`…`JS-8`). In questo file: codice, test automatici, evidenze di build e riferimenti `JS-n.M*`.

---

## Scopo

Portare in Code Studio il tooling Java/Spring che oggi distingue un vero IDE da "Monaco + JDT LS", usando come termine di paragone il motore di Lithe-IDEA (`rust/lithe-core`, per la parte JVM) e il suo livello Spring/MyBatis.

Termine di paragone scelto perché copre **esattamente il perimetro richiesto** — Java, Spring, Maven, Gradle, JUnit, JVM — e perché la sua documentazione interna (`.agents/notes/implemented/`, `shared/fixtures/`) descrive soluzioni a problemi che adOmnia non ha ancora incontrato.

## Stato verificato — 2026-10-18

Nel codice di adOmnia (percorsi letti, non eseguiti):

| Area | C'è oggi | Fonte |
|---|---|---|
| JDT LS 1.60.0 + Lombok 1.18.42 + Java Debug Server 0.53.1 | Installazione esplicita (`InstallPlan`, `curl && tar` visibile), workspace per progetto, navigazione su classi JDK (`jdt://`), Optimize Imports | `internal/languages/java/server.go` |
| Java adapter | Maven/Gradle con wrapper-first, JDK da `JAVA_HOME`/PATH, unità e moduli | `internal/languages/java/detect.go`, `jdk.go` |
| Run | kind `main` (classe + VM options) e `attach`; proposte `spring-boot:run`, `exec:java`, `run`, test/build | `runner.go`, `maincmd.go`, `mains.go`, `suggest.go` |
| Test JUnit | `TestCommand` Maven/Gradle, report Surefire/Gradle XML → albero test, ▶ su `@Test`, rerun failed | `test_runner.go`, `junit.go` |
| Debug | launch main, debug test/Spring Boot via JDWP, attach remoto; breakpoint condizionali, hit condition, logpoint, evaluate | `internal/languages/java/debug.go`, `debugcmd.go`, `internal/codestudio/service_java_debug.go`, `internal/ide/dap/` |
| pom.xml intelligente | CodeLens update/CVE, marker OSV, quick fix su `<version>`/property | `pomdeps.go`, `mavencentral.go`, `frontend/src/components/code-studio/codeStudioPom.ts` |
| Frontend Java | Icona `openjdk`, semantic tokens, ▶ gutter su `main`/`@Test` | `frontend/src/components/ide/languages/java/index.ts`, `codeStudioJavaTargets.ts` |

Mancavano del tutto all'inizio (Spring tooling e menu/comandi Java sono poi arrivati con JS-1/JS-2; verificato con ricerca nel repo: nessun riferimento a `hotswap`, `redefineClasses`, `configuration-metadata`, `ConfigurationProperties`, `actuator`, `initializr`):

- **Hot reload / hot swap** dei servizi in esecuzione.
- **Stepping filters** stile IntelliJ (si entra in CGLIB, ByteBuddy, Mockito, proxy JDK).
- **Error navigation** dal log di build Maven/Gradle (il parsing si ferma ai marker `BUILD SUCCESS/FAILURE`).
- **Esiti test per metodo** con roll-up a classe (l'albero c'è, l'iconografia per metodo e il roll-up no).
- **JDK di progetto**, scelta esplicita della toolchain.
- **Inlay hints e Code Vision**: `heavyFeatures: false` in `java/index.ts`, dichiarato non verificato con JDT LS.
- **Dependency tree / classpath browser**, equivalente Gradle del pom intelligente.
- **Performance JVM** (adOmnia ha PPROF/trace, Go-only).
- **MyBatis**, run config generate a livelli, Spring Initializr, coverage Java.

---

## Principi da non scordare (da Lithe)

1. **La semantica Java la decide JDT, non noi.** JS-14 aggiunge solo il supporto sintattico locale al buffer corrente quando JDT non è pronto: non risolve tipi, overload o simboli di dipendenze e non sostituisce i risultati semantici del server. Niente regex locali come fonte di verità su "cos'è una main" o "cos'è un test": si interroga JDT LS (`vscode.java.resolveMainClass`, `vscode.java.resolveMainMethod`, `vscode.java.test.findTestTypesAndMethods`) e le regex di `mains.go` diventano **fallback quando il server non c'è**. Lithe fa rispettare questo con un check di CI (`scripts/verify-java-semantic-ownership.mjs`): ne riprendiamo l'idea in JS-6.
2. **Una sola verità per ogni fatto**, e stato esplicito quando non è pronto (`idle/loading/ready/stale/failed`, "mostra ultimo risultato + refreshing"). Mai inventare un risultato.
3. **Gli esiti si distinguono**: "compilato / classi sostituite / contesto riavviato", non un generico "fatto".
4. **Cache content-addressed** quando un tooling JVM ignora le modifiche (lo stesso trucco dei `settings.xml` di Lithe: un cambio di contenuto diventa un cambio di path).
5. **Niente doppie architetture**: tutto dentro il modello capability già usato da Java (`internal/ide/language`), una riga in `languages.go`, contribuzione UI in `components/ide/languages/java/`. Se serve toccare il core per una feature Java, il contratto è sbagliato: si corregge il contratto.

---

## Priorità corrente — completamento e outline prima di tutto

Richiesta utente del 2026-10-18: **JS-14 è il prossimo blocco P0**, prima delle altre estensioni Java e dei nuovi linguaggi. Le funzioni già presenti (Git/diff, ricerca, cronologia, progetti/file multipli, monitor RAM, controlli LSP) non vanno ricostruite.

## JS-14 — Java locale: completamento e outline senza JDT LS (P0, prossimo)

**Obiettivo:** aprire e modificare un `.java` con completamento di base e Structure immediati, anche senza JDK/JDT installato o con il server spento. Nessun processo, rete o download per questa modalità.

- [ ] **JS-14.1 Analisi condivisa del buffer corrente.** Riusare dove applicabile il lettore/tokenizzatore Java esistente; distinguere codice, commenti, stringhe e text block. Estrarre package/import, classi/interfacce/enum/record annidati, costruttori, metodi anche sovraccarichi, campi/costanti, parametri e variabili locali con scope e range UTF-16. Gestire codice incompleto durante la digitazione. Nessuna scansione dell'intero progetto per ogni tasto.
- [ ] **JS-14.2 Completamento locale Monaco.** Keyword/snippet Java e nomi dichiarati nel file, rispettando scope e ordine delle dichiarazioni; distinguere variabili, costanti, parametri, metodi e tipi. Sostituire solo la parola digitata, deduplicare e non suggerire simboli dentro commenti/stringhe. Non inventare membri di tipi esterni, overload risolti o import automatici senza una fonte verificata.
- [ ] **JS-14.3 Outline locale.** Alimentare la Structure e la navigazione del file/breadcrumb con lo stesso risultato: gerarchia dei tipi annidati, campi, costruttori e metodi con firme distinguibili; clic → dichiarazione corretta, simbolo sotto il cursore evidenziato, aggiornamento su buffer non salvato e cambio file. Funzionamento con JDT assente, spento o in avvio.
- [ ] **JS-14.4 Passaggio locale ↔ JDT.** Stato esplicito della fonte: analisi locale oppure server Java. Quando JDT è pronto prevalgono i suoi risultati; niente provider concorrenti con suggerimenti duplicati, né outline cancellato durante l'import. Se il server si ferma, ripristinare il risultato locale del buffer corrente; scartare risposte obsolete per documento/versione/sessione. JDT resta responsabile di semantica, hover risolto e navigazione tra file/dipendenze.
- [ ] **JS-14.5 Prestazioni e regressioni.** Cache per versione del buffer, debounce delle analisi, limiti dichiarati sui file grandi. Test su scope omonimi, costanti, classi anonime/annidate, record, generics, lambda, overload, commenti/stringhe con parentesi, Unicode UTF-16 e codice incompleto. Test di collegamento dei provider e della Structure nelle transizioni JDT off/starting/ready/stopped e tra due progetti. Verificare che non si avvii alcun processo e che Code Studio resti lazy.
- [ ] **JS-14.6 Documentazione.** Aggiornare `docs/CODE-STUDIO.md`, catalogo e issue con il perimetro del supporto locale e i limiti rispetto a JDT. Controlli: Vitest mirati, TypeScript, build e startup; Go mirati solo se viene toccato il parser backend.

**Accettazione desktop:** `JS-14.M1`–`JS-14.M3` in `MANUAL-CHECK.md`. Nessuna voce manuale si chiude con la sola build.

## JS-15 — Datasource Spring verso Database Studio (P1)

**Obiettivo:** riusare il workspace database esistente a partire dalla configurazione Spring, senza creare un secondo client SQL.

- [ ] **JS-15.1 Rilevamento locale.** Estendere l'integrazione Project services oltre `go.mod`, riusando Spring Index per `spring.datasource.*` e i profili in properties/YAML. Distinguere valori effettivi, placeholder non risolti e profilo selezionato; nessuna connessione automatica.
- [ ] **JS-15.2 Apertura guidata.** Azione verso Database Studio tramite entity router; compilare solo dati conosciuti e chiedere quelli mancanti. Riutilizzare connessioni, driver, storico SQL, browser tabelle e operazioni già presenti.
- [ ] **JS-15.3 Segreti e compatibilità.** Credenziali tramite Vault/riferimenti esistenti, mai plaintext nel renderer persistito, log o file condivisi. Test di redazione e di profili con variabili mancanti; nessun processo o collegamento al DB all'apertura del progetto.

**Accettazione desktop:** `JS-15.M1` in `MANUAL-CHECK.md`. L'ORM/JPA avanzato resta fuori perimetro.

---

## JS-1 — Spring Index (P0) — *la feature più differenziante*

**Obiettivo:** sapere tutto di un progetto Spring senza eseguirlo: proprietà di configurazione note, bean, iniezioni, endpoint.

**Cosa fa Lithe** (`rust/lithe-core/src/languages/spring.rs`, comando `spring.index`):
- **`properties`**: chiavi con tipo, descrizione, default e posizione della dichiarazione Java. Sorgenti: proprietà built-in, **`spring-configuration-metadata.json` estratti dagli JAR della repository Maven locale** (lettura ZIP con cache, limite 20.000 artefatti), classi `@ConfigurationProperties` (record component, setter, kebab-case).
- **`values`**: occorrenze in `application.properties`/`.yml`/`.yaml` **con i profili** (`overridesBaseValue`) e il campo Java di destinazione.
- **`propertyReferences`**: `@Value("${…}")` in Java.
- **`diagnostics`**: problemi di configurazione con gravità e posizione.
- **`beans`** (`@Component/@Service/@Repository/@Controller/@Configuration`, `@Bean("nome")`, supertipi) e **`injections`** (`@Autowired/@Inject`, parametri costruttore, `@Qualifier`) → **navigazione iniezione ↔ bean**.
- **`endpoints`**: endpoint MVC (`@RequestMapping`, `@GetMapping`…) con route, controller, metodo.
- **`java.serverPort`**: `server.port` effettivo.

**Dove in adOmnia**
- `internal/languages/java/spring_index.go` (+ `spring_metadata.go` per lo scan JAR, `spring_java.go` per le classi): accanto a `pomdeps.go`, stessa filosofia (analisi statica, nessun server).
- `internal/codestudio/service_java_spring.go`: binding `SpringIndex` / `SpringEndpoints`, gemello di `service_java_pom.go`.
- Frontend: `frontend/src/lib/code-studio/springInsights.ts` (indice + cache), `components/code-studio/codeStudioSpring.ts` (completion e hover Monaco su `application.properties`/`.yml`, navigazione `@Value`), pannello endpoint con filtro (`codeStudioSpringEndpoints.ts`).
- Scansione JAR: `~/.m2/repository` (e `gradle/caches/modules-2` in JS-8) per `META-INF/spring-configuration-metadata.json`, con cache per hash del file. **Nessuna rete.**

**Test automatici**
- `internal/languages/java/spring_index_test.go`: fixture con pom + `application.properties` (con profilo) + classe `@ConfigurationProperties` + controller + `@Value`; attesi valori/posizioni esatti.
- `internal/languages/java/spring_metadata_test.go`: mini-JAR ZIP di fixture con `spring-configuration-metadata.json`, cache, limite artefatti, JAR corrotti ignorati.
- Frontend: `springInsights.test.ts` (completion con profili, ordine, override).

**Stato (2026-10-18)** — codice e test fatti, prova in app aperta:
- [x] `internal/languages/java/spring_index.go` — tipi (`SpringIndex`, `SpringProperty`, `SpringValue`, `SpringPropertyReference`, `SpringDiagnostic`, `SpringBean`, `SpringInjection`, `SpringEndpoint`) e `BuildSpringIndex` con i limiti di scansione.
- [x] `internal/languages/java/spring_java.go` + `spring_extract.go` — parser Java leggero (annotation, campi, metodi, costruttori, record component) e derivazione bean/iniezioni/endpoint/`@Value`/`@ConfigurationProperties`.
- [x] `internal/languages/java/spring_config.go` — `application.properties` (con continuazioni) e `.yml`/`.yaml` per documenti, con profili e flag `overridesBase`.
- [x] `internal/languages/java/spring_metadata.go` — scan degli JAR della repository Maven locale con cache per `size+modTime`, checkpoint, limite artefatti, jar corrotti ignorati.
- [x] `internal/codestudio/service_java_spring.go` + wrapper in `code_studio_bindings.go` → binding `SpringIndex` / `SpringEndpoints` / `SpringMetadataRefresh` rigenerati (`wails3 generate bindings`, 797 metodi).
- [x] `frontend/src/lib/code-studio/springInsights.ts` — logica pura (chiavi digitate, completion, documentazione, navigazione, filtro endpoint) + `stores/codeStudioSpring.ts` che chiama davvero `getSpringIndex`.
- [x] `frontend/src/components/code-studio/codeStudioSpring.ts` — provider Monaco (completion, hover, definition) su `properties`/`ini`/`yaml` e navigazione `@Value`/`@Autowired` nei `.java`, marker delle diagnostiche.
- [x] `frontend/src/components/code-studio/CodeStudioSpringEndpoints.tsx` — pannello endpoint con filtro e apertura del metodo, più "Index Maven libraries"; montato in `CodeStudioPanel.tsx` accanto agli altri dialog.
- [x] `internal/languages/java/spring_sample_test.go` — smoke test su un progetto Spring reale (`SPRING_SAMPLE_DIR`), che è la prova che l'indice lavora sul codice degli utenti.

**Evidenze (2026-10-18)**
- `go test ./internal/languages/java/` → `ok` (fixture: proprietà, profili, bean, iniezioni, endpoint, metadata, cache).
- `npx vitest run src/lib/code-studio/springInsights.test.ts` → 14 verdi; suite esistenti non toccate: 154 verdi.
- `npx tsc --noEmit` → pulito: i binding Go↔TS combaciano (è la prova che il frontend chiama davvero i metodi Go).
- `go vet ./internal/languages/java/ ./internal/codestudio/` → pulito.
- **Progetto reale** `spring-openai-master` (`SPRING_SAMPLE_DIR`): `POST /v1/request → AiController.askToAi`, 8 bean, 19 valori, 3 `@Value`, `serverPort` vuoto (nessun `server.port` nel progetto) → coerente.
- **JAR reali** (`SPRING_SAMPLE_METADATA=1`, limite 500): 500 artifact → 19.394 proprietà dai metadata, 3.272 note dopo dedup, `state=partial` come previsto al limite.

**Verifica comandi:** `go test ./internal/languages/java/...` · `npx vitest run springInsights.test.ts` · `npx tsc --noEmit`
**Prova in app:** `JS-1.M1`–`JS-1.M4` (MANUAL-CHECK.md) — **aperte**: il codice c'è, manca la prova nell'app avviata.

---

## JS-2 — Editor e comandi Java (P0)

**Obiettivo:** che Java abbia la stessa presenza di Go nell'interfaccia.

- [x] **`ide/languages/java/commands.ts`** (2026-10-18): 13 comandi `java.*` con `requires: { language: 'java' }` (Run/Debug Main, Run/Debug Test at cursor, Spring Boot Run, Maven test/package/clean install, Optimize Imports, Generate, Go to Test/Source, Check updates, Scan vulnerabilities), registrati in `CODE_STUDIO_COMMANDS` come Go e web. Gestore `codeStudioJavaCommands.ts`: i goal passano da `getRunSuggestions` (wrapper scelto dal backend, unità più interna del file), main/test riusano `runTarget` del gutter, Optimize Imports/Generate riusano i comandi editor, pom → store `usePomStore`. Helper puri in `lib/code-studio/javaCommands.ts`.
- [x] **Menu "Java"** (2026-10-18): voce di menu accanto a "Go" con tutti i comandi `java.*` (più Build/compile); il tasto Build e Ctrl+Shift+B nei progetti senza Go lanciano `mvnw compile`; i comandi Run Go-only (Build/Test/Vet Package/All…) si spengono con il motivo se il progetto non ha moduli Go.
- [x] **Menu contestuale** (2026-10-18): New → Java Class/Interface/Enum/Record/Package (solo se il progetto ha un'unità Java), package dedotto da `src/main|test/java/...`, validazione nomi (maiuscola, keyword, package minuscolo) nel dialog.
- [ ] **Inlay hints e Code Vision**: serve JDT LS reale; `heavyFeatures` resta `false`. Da chiudere con `JS-2.M2`.
- [ ] **Marker gutter override/implements** con contatore: non iniziato (richiede candidati verificati via JDT LS).

**Test automatici:** `frontend/src/components/ide/languages/java/commands.test.ts` (ogni comando ha `requires` e id univoco); estendere `codeStudioJavaTargets.test.ts` ai nuovi marker.
**Verifica comandi:** `npx vitest run commands.test.ts` · `npx tsc --noEmit`
**Prova in app:** `JS-2.M1`–`JS-2.M5`

---

## JS-3 — Test JUnit completi (P0)

**Obiettivo:** il pannello test Java come IntelliJ, non come "log colorato".

- **Esiti per metodo con roll-up a classe**: `junit.go` già converte i report Surefire/Gradle XML negli eventi dell'albero; manca la proiezione su icone passed/failed per metodo **con roll-up alla classe** e i contatori per classe. Riferimento: `java_run_markers.rs` + `maven_test_reports.rs` di Lithe.
- [x] **Debug dal pannello Tests** (2026-10-18): `javaDebugRequestForNode` (`codeStudioTestTree.ts`) instrada il nodo Java alla stessa richiesta del ▶ del gutter (`startJava`); bottone Bug sulla riga e Debug della suite, test in `codeStudioDebug.test.ts`.
- **Rerun failed** esteso ai metodi selezionati (oggi file/metodo).
- [x] **Test ignorati con motivo** (2026-10-18): `<skipped message=…>` diventa l'output "Skipped: …" del test (`junit.go`, `TestSkippedTestKeepsItsReason`). Il timeout resta da fare.
- [x] **Roll-up per classe e rerun multi-metodo** (2026-10-18): `rollupOf` (`codeStudioTestTree.ts`) conta passati/falliti/ignorati sulle foglie e li mostra sulla riga della classe; il rerun failed di una classe con più metodi falliti passa `Run: "a,b"` (Maven `-Dtest=Classe#a+b`, Gradle un `--tests` per metodo; `methodsOf` in `test_runner.go`). Nomi display (`test[0]`) → classe intera. Test: `codeStudioTestTree.test.ts`, `TestMultiMethodFilter`.

**Test automatici:** `junit_test.go` (roll-up, skip con motivo, classi multi-modulo); `codeStudioTestTree.test.ts` (`isJavaTestRun`, debug request dal nodo, rerun failed multi-metodo).
**Verifica comandi:** `go test ./internal/languages/java/...` · `npx vitest run codeStudioTestTree.test.ts`
**Prova in app:** `JS-3.M1`–`JS-3.M3`
**Collegamento:** chiude insieme a `ML-9.M11` e a 9.4.8 per il debug dei test Gradle.

---

## JS-4 — Build: error navigation e JDK di progetto (P0)

**Obiettivo:** che un errore di compilazione sia cliccabile, e che la toolchain sia scelta e visibile.

- [x] **Errori cliccabili nella console Run e nel terminale** (2026-10-18): `lib/code-studio/consoleLocation.ts` riconosce `Foo.java:[12,34]` (Maven), `Foo.java:12:` (javac/Gradle) e `.kt/.groovy`, oltre a Go; stesso schema nel terminale (`codeStudioTerminalLinks.ts`). I problemi nel pannello Problems arrivano dalle stesse righe di console (`buildProblems` in `CodeStudioRunPanel.tsx`, "Last build output"), quindi `buildlog.go` non serve: nessun secondo parser.
- **Error navigation dal log**: `internal/languages/java/buildlog.go` — da output Maven/Gradle a problemi navigabili (`[ERROR] /path/Foo.java:[12,34]`, `error: cannot find symbol` con contesto). Oggi il parsing si ferma ai marker `BUILD SUCCESS/FAILURE` usati dal test runner. Riferimento: `project/maven.rs::maven.diagnostics` di Lithe. Da agganciare alla console Run (click → editor) e al pannello problemi.
- **JDK di progetto**: `jdk.go` oggi parte solo da `JAVA_HOME`/PATH. Aggiungere la **selezione esplicita per unità** (JDK home, versione richiesta dal progetto), persistita nelle run configuration, con la stessa toolchain usata da Run **e** Debug. Riferimento: `execution/java_selection.rs` di Lithe; il bug che Lithe ha registrato (`java-debug-uses-the-run-jdk`) è la prova che i due devono coincidere.
- [x] **Finestra "project preparation"** (2026-10-18: il `$/progress` di JDT LS ("Importing Maven project(s)") era già pubblicato come `lsp.progress` ma la status bar lo nascondeva per i server provided; ora lo mostra anche per Java, con il nome del server come titolo di ripiego; tsc e Vitest `code-studio` verdi, prova in app = JS-4.M3): stato `starting → importing → building → ready` durante l'import di JDT LS (Lithe: `project_preparation.rs`). Senza questo l'utente pensa che il server sia rotto.

**Test automatici:** `buildlog_test.go` (casi Maven/Gradle/multi-modulo/UTF-8/Windows); `jdk_test.go` (selezione, versione, fallback); stato di preparazione esposto e testato.
**Verifica comandi:** `go test ./internal/languages/java/...`
**Prova in app:** `JS-4.M1`–`JS-4.M3`

---

## JS-5 — Debug profondo (P1)

**Obiettivo:** debuggare un'app Spring senza attraversare il framework a ogni step.

- **Stepping filters stile IDEA** (Lithe: `DebugSteppingFilters::default` in `rust/lithe-core/src/debug/mod.rs`): skip synthetics, skip static initializers, classi saltate di default `$JDK`, `$Libraries`, `com.sun.proxy.*`, `net.bytebuddy.*`, `net.sf.cglib.*`, `org.springframework.cglib.*`, `org.springframework.aop.framework.*`, `org.mockito.*`, `junit.*`/`org.junit.*`, più **nascondere i frame filtrati** dal call stack. Il Java Debug Server accetta `stepFilters` nel launch: verificare il supporto del bundle 0.53.1 e, in subordine, filtrare lato client in `internal/ide/dap/`. UI: sezione nei settings di debug + toggle "Hide framework frames".
- **Breakpoint relocation**: dopo un edit, il breakpoint spostato dal server mantiene **condizione, hit condition e logpoint** (Lithe: `debug/breakpoint_relocation.rs`). Oggi adOmnia li perde. Da gestire in `internal/ide/dap/breakpoints.go` sull'evento `breakpoint` del DAP.
- **Hot update dei servizi in esecuzione** (Lithe: `2026-09-30-running-java-service-updates.md`, `windows/tauri/src/features/run/services/java-service-update.ts`):
  - **Run** → Spring Boot DevTools ("Compile changes", rileva `spring-boot-devtools-*` tra le dipendenze);
  - **Debug** → hot swap classi (richiesta `redefineClasses` verso il Java Debug Server; verificare quale il bundle 0.53.1 espone davvero) con **`-Dspring.devtools.restart.enabled=false`** in debug per non perdere la sessione;
  - **esiti distinti**: compilato / classi sostituite / contesto riavviato, con la riga di log corrispondente.
- **Espressioni della riga corrente valutate automaticamente** selezionando uno stack frame (Lithe: `DebugAutomaticExpressionProjection.swift`) — da abbinare all'evaluate già presente.

**Test automatici:** `internal/ide/dap/stepfilters_test.go` (default, override utente, frame nascosti); `breakpoints_test.go` (preservazione condizioni/logpoint); `internal/languages/java/devtools_test.go` (rilevamento dipendenza, comando aggiornamento, esiti distinti).
**Verifica comandi:** `go test ./internal/ide/dap/... ./internal/languages/java/...`
**Prova in app:** `JS-5.M1`–`JS-5.M4`

---

## JS-6 — Semantica Java owned by JDT (P1)

**Obiettivo:** una sola verità su main, test e classi lanciabili; le regex diventano fallback.

- Quando JDT LS è `ready`, delegare:
  - `vscode.java.resolveMainClass` → elenco classi lanciabili (copre `static void main()` senza `public` di Java 25, main istanza, compact source file);
  - `vscode.java.resolveMainMethod` → main per file + range del nome (per i marker del gutter);
  - `vscode.java.test.findTestTypesAndMethods` → test JUnit/TestNG **con annotation definite dall'utente** (serve il bundle **java-test**, oggi non incluso: solo java-debug è in `server.go`).
- Le regex di `mains.go` (`findMainClasses`, 3000 file) e la discovery dei test restano **fallback quando il server non è installato/avviato**, con stato esplicito.
- [x] **Frontend** (2026-10-18): `stores/codeStudioJavaMains.ts` chiede `JavaMainClasses` (TTL 30 s); `findJavaTargets(…, jdtMains)` mette il ▶ sulle classi che JDT elenca (anche `void main()` di Java 25) e ignora la regex quando JDT ha risposto; senza risposta vale la regex marcata `// fallback`. Test: `codeStudioJavaTargets.test.ts`.
- **Contratto di possesso**: estendere `internal/ide/architecture_test.go` (o un test dedicato in `internal/languages/java`) affinché le regole locali di semantica Java siano marcate `// fallback: JDT decide quando è ready`, come fa il check di CI di Lithe (`scripts/verify-java-semantic-ownership.mjs`).

**Test automatici:** `mains_test.go` (stesso risultato tra JDT e fallback sulle fixture), `java_test.go` (annotation custom), test del contratto di possesso.
**Verifica comandi:** `go test ./internal/languages/java/... ./internal/ide/...`
**Prova in app:** `JS-6.M1`–`JS-6.M2`
**Collegamento:** parte della soluzione di `9.4.8` (classpath e main per Gradle).

---

## JS-7 — Launch diretto e command-line lunghe (P1)

**Obiettivo:** lanciare Java senza dipendere da `exec-maven-plugin` e senza morire sul limite di Windows.

- **Launch diretto** (Lithe: `2026-09-18-java-project-build-and-launch-boundary.md`): `resolveMainClass` → build → `vscode.java.resolveClasspath` (**l'argomento deve essere testo JSON** `{"scope":"runtime"}`, altrimenti il server fallisce) → `java` diretto con `mainClass`, `classPaths`, `modulePaths` (`modulo/nome.Tipo` → `-m modulo/nome.Tipo`). Pre-step Maven `resources:resources` (`resources:testResources` per il test), con `mvnw` risolto dal reactor. Oggi adOmnia usa `exec-maven-plugin:3.5.0:java` (`maincmd.go`) e un init script Gradle: restano come fallback quando JDT LS non c'è.
- [x] **Collegato al Run** (2026-10-18): `runCommandSpec` e il ▶ del gutter provano `javaDirectLaunch` (`service_java_launch.go`): `resolveJavaRuntime` (build + classpath + JDK di JDT, stesso del Debug) → `java.DirectLaunch` → `BuildLaunch` (argfile/jar oltre i 30 000 caratteri, pulizia a fine processo). JDT non pronto, errore di build o app modulare → fallback a Maven/Gradle. Le VM options diventano `-Xmx` veri. Non fatto: pre-step `resources:resources` (le risorse le copia il builder di JDT). Test: `TestDirectLaunchNeedsResolvedRuntime`.
- **Command-line oltre 32.767 caratteri** (problema reale su Windows con centinaia di jar): argfile `java @file` (JDK 9+) con testo Unicode, e per JDK 8 un **JAR con solo `META-INF/MANIFEST.MF`** e header `Class-Path` (URL `file:` percent-encoded, wrap a 72 byte). Riferimento: `execution/launch_command.rs` e `classpath_jar.rs` di Lithe.
- **Spremitura `MAVEN_OPTS`** per le VM options: oggi le VM options finiscono in `MAVEN_OPTS` (`maincmd.go`) — con il launch diretto diventano `-Xmx` veri del processo Java.

**Test automatici:** `launchcmd_test.go` (soglia 32K, argfile, JDK 8, moduli), `maincmd_test.go` (fallback invariato).
**Verifica comandi:** `go test ./internal/languages/java/...`
**Prova in app:** `JS-7.M1`–`JS-7.M2`

---

## JS-8 — Dipendenze JVM: tree, classpath browser, Gradle (P1)

**Obiettivo:** chiudere il "manca" di `9.4.9` e dare a Gradle la parità con il pom.

- **Dependency tree Maven** (Lithe: `maven_dependency_tree.rs`): `maven-dependency-plugin:tree` con versione pinnata e `-DoutputFile` → parsing dei nodi `resolved` / `omittedDuplicate` / `omittedConflict`. UI ad albero con evidenza dei conflitti.
- **Dependency browser del workspace** (Lithe: `DependencySidebarView.swift`): jar e cartelle del classpath di ogni modulo, da `vscode.java.project.getAll` / `java.project.getClasspaths` (sempre come **testo JSON**), con apertura del sorgente/virtuale `jdt://`.
- **Gradle allo stesso livello del pom**: parsing di `build.gradle`/`.kts` per dipendenze con versioni e property, **CVE** tramite `internal/securityintel` (come già per il pom), lens "Check for updates"/"Scan vulnerabilities". Oggi `build.gradle` non ha nessun equivalente di `pomInsights`.
- **Riconoscimento framework dai plugin del build script** senza eseguire Gradle (Lithe: `execution/detectors/gradle.rs` → `bootRun`, `quarkusDev`, `run`, task path `:modulo:bootRun`) e dal plugin Maven applicato (`spring-boot-maven-plugin` di `org.springframework.boot`, con il groupId come parte dell'identità) — oggi `usesSpringBoot()` è più grossolano.
- [x] **Versioni gestite da parent/BOM** (2026-10-18): `PomManagedVersions` riusa il resolver di Security Intelligence (offline, parent per `relativePath` e dal repository Maven locale, BOM importati); la dipendenza senza `<version>` mostra la versione reale e il marker dice che va aggiornata dove è definita (nessuna modifica proposta nel file).
- [x] **CVE su Gradle** (2026-10-18): l'adapter Maven di `securityintel` scopre e legge staticamente i `build.gradle(.kts)` (`maven/gradle.go`, stesse coordinate OSV); "Scan vulnerabilities" funziona anche sugli script Gradle. Solo dipendenze con versione scritta, niente transitive (warning esplicito).

**Test automatici:** `dependencytree_test.go` (nodi, conflitti, multi-modulo), `gradledeps_test.go` (dipendenze, property, plugin framework), `pomdeps_test.go` (parent/BOM), test di `securityintel` estesi a Gradle.
**Verifica comandi:** `go test ./internal/languages/java/... ./internal/securityintel/...`
**Prova in app:** `JS-8.M1`–`JS-8.M3`

---

## JS-9 — Performance JVM (P2)

**Obiettivo:** l'equivalente Java del PPROF Go, che oggi non esiste.

- **Heap reale durante Run/Debug/Test**: `jstat -gc -t` del JDK target (young/old, escluso metaspace), CPU dai contatori di processo, identificazione della JVM vera (JUnit / Surefire / Gradle Test Executor / worker). Riferimento: `TestJVMPerformanceFeatureModel.swift`, `MacTestJVMPerformance.swift`, nota `2026-10-14-local-jvm-performance-monitoring.md` di Lithe.
- **Registrazione JFR esplicita** con "Mostra risultati" negli strumenti JDK (`jfr`/`jcmd JFR.start`).
- Posizionamento UI: pannello accanto a Performance Studio, ma **solo per unità Java** — non generalizzare il codice Go di `pprof.go`.

**Test automatici:** parsing dell'output `jstat` (fixture di esempi reali), selezione del PID, stato registrazione JFR.
**Prova in app:** `JS-9.M1`–`JS-9.M2`

---

## JS-10 — MyBatis: mapper ↔ XML (P2)

**Obiettivo:** navigazione bidirezionale tra interfaccia mapper e statement XML (`select/insert/update/delete`), con range precisi su entrambi i lati. Riferimento: `rust/lithe-core/src/languages/mybatis.rs` (`mybatis.index`), fixture in `shared/fixtures/mybatis/`. Feature tipica di IntelliJ Ultimate, assente in tutti gli editor liberi.

- `internal/languages/java/mybatis_index.go` + comando host `MybatisIndex`, UI: link "vai all'XML"/"vai al metodo", sezione nel pannello struttura.

**Test automatici:** `mybatis_index_test.go` con fixture mapper+XML (naming convention, `@Param`, statement multipli, XML senza mapper).
**Prova in app:** `JS-10.M1`

---

## JS-11 — Run configuration a livelli e altri framework (P2)

- **Configurazioni generate + override a livelli** (Lithe: `execution/configuration.rs`): `generated` → `project` → `local`, con rigenerazione automatica e revisione versionata. **Stato 2026-10-18:** i tre livelli esistono già di fatto — le proposte (`run_suggestions.go`) sono `generated`, le configurazioni con *Share (Git)* vivono in `.adomnia/run-configurations.json` (`project`), le altre nel bbolt locale (`local`). **Aperto di proposito:** l'override personale di una configurazione condivisa senza toccare il file (servirebbe un file `.local` o un campo nel formato condiviso): non c'è un consumatore reale, quindi non si costruisce; **non rompere il formato condiviso via Git** (visto già in `MULTILANGUAGE-IDE.md` 3.4).
- **Framework oltre Spring**: Quarkus e Micronaut (Lithe li riconosce e propone `quarkusDev`/`micronaut` run). Oggi adOmnia riconosce solo Spring Boot.
- **Maven settings per JDT LS**: passare all'utente e al server lo stesso `settings.xml` (localRepository, mirrors) — il trucco content-addressed di Lithe (`jdt_maven_settings.rs`) per forzare il reload senza restart. Oggi adOmnia non lo fa: un progetto con repository privata non risolve le dipendenze.

**Test automatici:** migrazione formato run config (idempotente), detectors Quarkus/Micronaut, settings content-addressed.
**Prova in app:** `JS-11.M1`–`JS-11.M2`

---

## JS-12 — Oltre Lithe (P2)

Cose che Lithe **non** ha e che adOmnia può avere per primo, sfruttando ciò che già possiede:

- **Test coverage Java (JaCoCo)** — Lithe non ha coverage per nessun linguaggio; adOmnia ha già `coverage_base.go` + `coverage_branches.go` da usare come modello per la copertura Java.
- **Spring Initializr** — assente in entrambi; il launcher che già riconosce Spring Boot può creare il progetto.
- **Actuator e grafo dei bean** — Lithe ha solo liste (beans/injections). Un grafo visuale costruito sullo stesso schema di JS-1 è un salto di qualità.
- [x] **Security su Gradle** — fatto, vedi JS-8 (`securityintel/maven/gradle.go`).

*Voci aperte a richiesta: qui si scrive solo quando una di queste diventa lavoro concreto.*

---

## Valutazione language server alternativi (2026-10-18)

- **Eclipse JDT LS 1.60 resta il server principale**: è l'unico maturo (Lombok agent, Java Debug Server, Maven/Gradle import, semantic tokens). Pin già su una milestone recente; non c'è un sostituto più moderno.
- **Apache NetBeans LS**: attivo, ma più debole su Lombok/debug e import Maven pesante: non conviene come sostituto.
- **java-language-server (georgewfraser)**: abbandonato, scartato.
- **Spring Tools 4 Language Server (`spring-boot-language-server`)**: *complementare*, non sostitutivo. Dà bean navigation, `@Value`/`application.properties`, completamento delle proprietà, live hover dei bean. Il nostro `springInsights` ne copre già parte, in modo leggero.
- [ ] Adottarlo = secondo processo LSP sullo stesso workspace Java (serve multiplexing delle richieste nel core `ide/lsp`) + download fissato + `InstallPlan` visibile. Decidere dopo JS-2/JS-3 solo se `springInsights` non basta: per ora non c'è un secondo consumatore reale.

## Rischi

| Rischio | Livello | Mitigazione |
|---|---|---|
| Scansione della repository Maven locale troppo lenta (decine di migliaia di JAR) | **Alto** | JS-1: cache per hash del file, limite artefatti, lavoro in background con stato esplicito; nessun lavoro al primo avvio |
| Le richieste DAP/`vscode.java.*` non esistono nella versione pinnata dei bundle | **Alto** | Ogni voce che dipende da JDT/java-debug/java-test parte da una **prova del comando reale** sul bundle attuale; se manca, fallback documentato e voce spuntata con la nota |
| Rompere `.adomnia/run-configurations.json` condiviso via Git | **Alto** | JS-11: scrittura doppia per un rilascio, come già fatto in 3.4 |
| Introdurre regole locali che duplicano la semantica di JDT | Medio | JS-6: contratto di possesso + fallback marcati; una sola fonte di verità |
| Troppi server/tooling attivi → RAM | Medio | Tutto on-demand: l'indice Spring è statico, `jstat` solo su richiesta, niente processi extra a riposo |
| La UI Java diventa un sottoinsieme scadente di IntelliJ | Medio | Ordine P0 → P1: prima ciò che si usa ogni giorno (Spring index, comandi, test), poi il resto |
| Duplicità con `MULTILANGUAGE-IDE.md` 9.4 | Basso | Testa di questo file: 9.4.8/9.4.9 restano lì; qui se ne indicano solo i collegamenti |

## Fuori perimetro (deliberato)

- **Eclipse PDE/OSGi** (`internal/eclipsepde`): resta lavoro separato, come deciso in `docs/architecture/ide-multilanguage-refactor.md` §24. La convivenza JDT LS + Maven/Gradle + PDE è una decisione da prendere prima di mescolare.
- **Kotlin** oltre l'LSP: nessun tooling proprio (Lithe non ne ha).
- **Jakarta EE / application server (Tomcat)**: nessuno dei due lo copre; non è il perimetro Spring Boot.
- **Plugin dichiarativi con bundle firmato** (modello di distribuzione di Lithe): adOmnia ha già `InstallPlan` esplicito, coerente col local-first. Non sostituire.
- **Database/JPA tooling**: il client Database esistente si riusa con JS-15; ORM/JPA avanzato resta fuori perimetro.
- **Agenti AI / AI commit / MCP**: fuori dal perimetro Java/Spring richiesto.

## Ordine di esecuzione consigliato

**Priorità aggiornata:** `JS-14` (completamento + outline locali) → chiusura dei gap P0 e collaudi Java già aperti → `JS-15` e backlog condiviso di `MULTILANGUAGE-IDE.md`. La numerazione storica non determina la priorità.

Ordine storico delle sezioni: `JS-1` → `JS-2` → `JS-3` → `JS-4` (P0, rilasciabili da soli) → `JS-5` → `JS-6` → `JS-7` → `JS-8` (P1) → `JS-9` → `JS-10` → `JS-11` → `JS-12` (P2).
`JS-2` e `JS-3` sono indipendenti da `JS-1` e possono procedere in parallelo; `JS-6` è il prerequisito di `JS-7`.

**Gate del piano:** un progetto Spring Boot reale (multi-modulo Maven, poi Gradle) si apre, si indica con le proprietà note e gli endpoint elencati, si esegue, si testa, si debugga con gli stepping filters attivi, si aggiorna a caldo, e gli errori di build sono cliccabili — **senza modifiche al core** (`internal/ide/architecture_test.go` resta verde).

## Registro avanzamento

| Data | Fase | Nota |
| --- | --- | --- |
| 2026-10-18 | — | Piano creato da analisi comparata con Lithe-IDEA. Nessuna voce iniziata. |
| 2026-10-18 | JS-1 | **Spring Index implementato**: parser Java + `.properties`/`.yml` con profili, scan JAR della repository Maven locale con cache, binding `SpringIndex`/`SpringEndpoints`/`SpringMetadataRefresh` rigenerati, store + provider Monaco + pannello endpoint collegati. Test Go e vitest verdi, `tsc --noEmit` pulito (prova del collegamento tipizzato), smoke test su `spring-openai-master` e su 500 JAR reali. **Restano aperte le prove in app `JS-1.M1`–`JS-1.M4`** su `MANUAL-CHECK.md`. |
| 2026-10-18 | JS-2 | **Comandi e menu Java**: menu "Java", 14 comandi con `requires`, New Java Class/Package, Build Maven dal martello, comandi Go-only spenti nei progetti Java. tsc e vitest verdi; prove `JS-2.M1`–`M5` aperte. |
| 2026-10-18 | JS-3 / JS-4 | Debug dei test JUnit dal pannello Tests, motivo dei test ignorati, errori Maven/Gradle cliccabili in console e terminale. Vitest (51 file) e `go test ./internal/languages/java/` verdi, tsc pulito. Restano roll-up per classe, JDK per unità, problemi nel pannello Problems, stato di preparazione JDT LS. |
| 2026-10-18 | JS-5…JS-12 | Codice e test: stepping filters e hot code replace (JS-5), main class decise da JDT con fallback marcato (JS-6, backend), helper per command line lunghe (JS-7, non ancora collegato al Run), lens sulle dipendenze Gradle e albero Maven provato su spring-openai-master (JS-8), monitor JVM con heap/GC/JFR provato su una JVM reale (JS-9), navigazione MyBatis (JS-10), goal Quarkus/Micronaut e JDK/settings.xml a JDT LS (JS-11), coverage JaCoCo provata su un progetto Spring generato, template Spring Boot Maven/Gradle e Java Maven, grafo dei bean, iniezioni Lombok e per interfaccia (JS-12). Aperti: roll-up per classe e rerun multi-metodo (JS-3), JDT-owned nel frontend e launch diretto (JS-6/7), run config a livelli (JS-11), Gradle security (JS-12, securityintel), parent/BOM, template Gradle da compilare. Tutte le prove in app restano aperte. |
| 2026-10-18 | JS-3/6/7/8/12 | Chiusi: roll-up per classe e rerun multi-metodo (JS-3), main class JDT nel gutter (JS-6), launch diretto collegato a Run e ▶ (JS-7), parent/BOM del pom e CVE su Gradle (JS-8/JS-12). JS-11 resta aperto solo per l'override personale di una configurazione condivisa. In più: le `@RestController` Spring diventano route del Developer Context (`devcontext/javaroutes.go`), quindi API Workspace, Mock, cURL, OpenAPI, Open API e Live Session valgono come per Go; lens sul sorgente Java e bottone "Open API" negli endpoint. Go test (java, devcontext, securityintel, ide) e vitest (177 file) verdi, tsc pulito. Prove in app aperte: `MANUAL-CHECK.md`. |

| 2026-10-18 | JS-14/JS-15 | Aggiunti i TODO dal confronto funzionale: completamento e outline Java senza processi hanno priorità P0 assoluta; integrazione datasource Spring verso Database Studio P1. Nessuna implementazione dichiarata; prove native in MANUAL-CHECK. |
