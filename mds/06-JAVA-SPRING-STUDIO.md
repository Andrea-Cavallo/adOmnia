# 06 — Java/Spring Studio (profondità JVM)

Aggiornato: 2026-10-20 (JS-14 chiuso in codice; JS-17: console, output e JDT LS su progetti JVM grandi, verificati su `quarkus-super-heroes-main`). Indice: [README.md](README.md).

> **Continua, non duplica.** [MULTILANGUAGE-IDE](MULTILANGUAGE-IDE.md) Fase 9.4 porta Java al *contratto minimo* (adapter, JDT LS, run, test, debug) ed è quasi chiusa: restano 9.4.8 (debug di `spring-boot:run` e dei task Gradle) e il collegamento completo al Security Center; parent/BOM e scansione Gradle sono già implementati (JS-8/JS-12). Questo piano prende **da dove 9.4 finisce**: la profondità completa su Java/Spring/JVM. Le voci 9.4.8 e 9.4.9 restano in `MULTILANGUAGE-IDE.md`, non vengono ricopiate qui; qui se ne indicano solo i collegamenti.
>
> **Le verifiche che richiedono l'app in esecuzione stanno solo in [MANUAL-CHECK.md](MANUAL-CHECK.md)** (sezioni `JS-1`…`JS-8`). In questo file: codice, test automatici, evidenze di build e riferimenti `JS-n.M*`.

---

## Scopo

Portare in Code Studio il tooling Java/Spring che oggi distingue un vero IDE da "Monaco + JDT LS", coprendo l'intero livello JVM e Spring/MyBatis.

Il perimetro è **esattamente** Java, Spring, Maven, Gradle, JUnit, JVM. Le voci seguenti descrivono soluzioni a problemi che adOmnia non ha ancora incontrato, quindi vanno verificate una per una sul campo prima di diventare codice.

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
- **Stepping filters** (si entra in CGLIB, ByteBuddy, Mockito, proxy JDK).
- **Error navigation** dal log di build Maven/Gradle (il parsing si ferma ai marker `BUILD SUCCESS/FAILURE`).
- **Esiti test per metodo** con roll-up a classe (l'albero c'è, l'iconografia per metodo e il roll-up no).
- **JDK di progetto**, scelta esplicita della toolchain.
- **Inlay hints e Code Vision**: `heavyFeatures: false` in `java/index.ts`, dichiarato non verificato con JDT LS.
- **Dependency tree / classpath browser**, equivalente Gradle del pom intelligente.
- **Performance JVM** (adOmnia ha PPROF/trace, Go-only).
- **MyBatis**, run config generate a livelli, Spring Initializr, coverage Java.

---

## Principi da non scordare

1. **La semantica Java la decide JDT, non noi.** JS-14 aggiunge solo il supporto sintattico locale al buffer corrente quando JDT non è pronto: non risolve tipi, overload o simboli di dipendenze e non sostituisce i risultati semantici del server. Niente regex locali come fonte di verità su "cos'è una main" o "cos'è un test": si interroga JDT LS (`vscode.java.resolveMainClass`, `vscode.java.resolveMainMethod`, `vscode.java.test.findTestTypesAndMethods`) e le regex di `mains.go` diventano **fallback quando il server non c'è**. Il vincolo va fatto rispettare da un check di CI dedicato, come previsto in JS-6.
2. **Una sola verità per ogni fatto**, e stato esplicito quando non è pronto (`idle/loading/ready/stale/failed`, "mostra ultimo risultato + refreshing"). Mai inventare un risultato.
3. **Gli esiti si distinguono**: "compilato / classi sostituite / contesto riavviato", non un generico "fatto".
4. **Cache content-addressed** quando un tooling JVM ignora le modifiche: un cambio di contenuto diventa un cambio di path (vale anche per i `settings.xml`).
5. **Niente doppie architetture**: tutto dentro il modello capability già usato da Java (`internal/ide/language`), una riga in `languages.go`, contribuzione UI in `components/ide/languages/java/`. Se serve toccare il core per una feature Java, il contratto è sbagliato: si corregge il contratto.

---

## Priorità corrente — completamento e outline prima di tutto

Richiesta utente del 2026-10-18: **JS-14 è il prossimo blocco P0**, prima delle altre estensioni Java e dei nuovi linguaggi. Le funzioni già presenti (Git/diff, ricerca, cronologia, progetti/file multipli, monitor RAM, controlli LSP) non vanno ricostruite.

**Aggiornamento 2026-10-20:** JS-14 è implementato e verificato con test (restano `JS-14.M1`–`M3` nell'app). Con la stessa data, JS-17 ha chiuso i tre problemi reali su progetti JVM grandi (console, output/UI, toolchain multi-modulo + JDT automatico). Prossimo in ordine: le prove in app aperte (`JS-1.M*`…`JS-17.M*` su `MANUAL-CHECK.md`), poi JS-15 (datasource → Database Studio) e il backlog di `MULTILANGUAGE-IDE.md`.

## JS-14 — Java locale: completamento e outline senza JDT LS (P0, prossimo)

**Obiettivo:** aprire e modificare un `.java` con completamento di base e Structure immediati, anche senza JDK/JDT installato o con il server spento. Nessun processo, rete o download per questa modalità.

**Stato (2026-10-20)** — implementato e verificato con test automatici: vedi le note su ogni voce e le evidenze in fondo alla sezione.

- [x] **JS-14.1 Analisi condivisa del buffer corrente.** Riusare dove applicabile il lettore/tokenizzatore Java esistente; distinguere codice, commenti, stringhe e text block. Estrarre package/import, classi/interfacce/enum/record annidati, costruttori, metodi anche sovraccarichi, campi/costanti, parametri e variabili locali con scope e range UTF-16. Gestire codice incompleto durante la digitazione. Nessuna scansione dell'intero progetto per ogni tasto. *Fatto: `components/ide/languages/java/javaLocalLexer.ts` (tokenizzatore tollerante, offset UTF-16 di Monaco, commenti/stringhe/text block in `excluded`) + `javaLocalAnalysis.ts` (tipi annidati, record, classi anonime, enum constant, overload con firma, parametri anche lambda, campi/costanti/locali con `scopeStart/scopeEnd` e `hoisted`).*
- [x] **JS-14.2 Completamento locale Monaco.** Keyword/snippet Java e nomi dichiarati nel file, rispettando scope e ordine delle dichiarazioni; distinguere variabili, costanti, parametri, metodi e tipi. Sostituire solo la parola digitata, deduplicare e non suggerire simboli dentro commenti/stringhe. Non inventare membri di tipi esterni, overload risolti o import automatici senza una fonte verificata. *Fatto: `javaLocalCompletion.ts` + provider Monaco in `codeStudioLanguageFeatures.ts` (solo quando JDT non è pronto); shadowing dei nomi interni, overload deduplicati per nome, nessun suggerimento in commenti/stringhe (`excluded`).*
- [x] **JS-14.3 Outline locale.** Alimentare la Structure e la navigazione del file/breadcrumb con lo stesso risultato: gerarchia dei tipi annidati, campi, costruttori e metodi con firme distinguibili; clic → dichiarazione corretta, simbolo sotto il cursore evidenziato, aggiornamento su buffer non salvato e cambio file. Funzionamento con JDT assente, spento o in avvio. *Fatto: `javaLocalOutline.ts` → `codeStudioSymbols.ts` (stessa analisi del completamento); `selectionRange` per il simbolo attivo, range completi per il clic.*
- [x] **JS-14.4 Passaggio locale ↔ JDT.** Stato esplicito della fonte: analisi locale oppure server Java. Quando JDT è pronto prevalgono i suoi risultati; niente provider concorrenti con suggerimenti duplicati, né outline cancellato durante l'import. Se il server si ferma, ripristinare il risultato locale del buffer corrente; scartare risposte obsolete per documento/versione/sessione. JDT resta responsabile di semantica, hover risolto e navigazione tra file/dipendenze. *Fatto: un solo provider per funzione con gate su `isServerReady` (`codeStudioLanguageFeatures.ts`); la fonte è esplicita nella status bar (`localAnalysisLabel`: `Local Java analysis (Eclipse JDT LS …)` con il server non pronto); l'analisi locale è sincrona sul model attivo, quindi nessuna risposta obsoleta può arrivare da un altro documento.*
- [x] **JS-14.5 Prestazioni e regressioni.** Cache per versione del buffer, debounce delle analisi, limiti dichiarati sui file grandi. Test su scope omonimi, costanti, classi anonime/annidate, record, generics, lambda, overload, commenti/stringhe con parentesi, Unicode UTF-16 e codice incompleto. Test di collegamento dei provider e della Structure nelle transizioni JDT off/starting/ready/stopped e tra due progetti. Verificare che non si avvii alcun processo e che Code Studio resti lazy. *Fatto: cache LRU per contenuto (8 buffer), limiti dichiarati (`MAX_JAVA_LOCAL_CHARS` 256.000, `MAX_JAVA_LOCAL_TOKENS` 50.000: oltre, `limited` e nessun suggerimento), niente debounce perché il lavoro è sul solo buffer. Tutti i casi elencati hanno test in `javaLocalAnalysis.test.ts`/`javaLocalCompletion.test.ts`; le transizioni JDT valgono perché il gate è sincrono sullo stato del server. Nessun processo avviato (solo frontend).* 
- [x] **JS-14.6 Documentazione.** Aggiornare `docs/CODE-STUDIO.md`, catalogo e issue con il perimetro del supporto locale e i limiti rispetto a JDT. Controlli: Vitest mirati, TypeScript, build e startup; Go mirati solo se viene toccato il parser backend. *Fatto: sezione "Java locale" in `docs/CODE-STUDIO.md` e voce nel catalogo feature.*

**Evidenze (2026-10-20):** `npx vitest run src/components/ide/languages/java/ src/components/code-studio/codeStudioSymbols.test.ts` → 24 verdi; `npx vitest run CodeStudioStatusBar.test.tsx` → 8 verdi (fonte esplicita); `npx tsc --noEmit` → pulito. Nessun processo o server avviato dall'analisi locale.

**Accettazione desktop:** `JS-14.M1`–`JS-14.M3` in `MANUAL-CHECK.md` — **aperte**: il codice e i test automatici ci sono, manca la prova nell'app avviata.

## JS-15 — Datasource Spring verso Database Studio (P1)

**Obiettivo:** riusare il workspace database esistente a partire dalla configurazione Spring, senza creare un secondo client SQL.

- [x] **JS-15.1 Rilevamento locale** *(2026-10-22: `internal/languages/java/spring_datasource.go` lavora sui valori già letti dall'indice Spring, senza una seconda scansione: `url`, `host`, `port`, `database`, `username`, `password`, `driver-class-name`. Base più profili con la precedenza di Spring, `spring.profiles.active` marca il profilo selezionato, vendor dal sottoprotocollo JDBC o dalla classe del driver, `sslmode` dall'URL, SQLite relativo all'unità reso assoluto, placeholder `${…}` lasciati `unresolved`. Capability generica del core `language.ConfiguredDatabases` con consumatore reale in `ProjectServices`, come `DirectDependencies`: nessun linguaggio nominato nell'host.)* Estendere l'integrazione Project services oltre `go.mod`, riusando Spring Index per `spring.datasource.*` e i profili in properties/YAML. Distinguere valori effettivi, placeholder non risolti e profilo selezionato; nessuna connessione automatica.
- [x] **JS-15.2 Apertura guidata** *(2026-10-22: una riga per datasource con nome, host:porta/database, utente, profilo e `file:riga`; `configuredDatabaseHandoff` costruisce la connessione parziale con i soli valori noti e la consegna al Database Studio con `DATABASE_PENDING_CONNECTION_KEY`, riusando connessioni, driver, storico SQL e browser tabelle esistenti. Ciò che manca è elencato ("Still needed from you: …"); un vendor non supportato è mostrato senza pulsante, con il motivo.)* Azione verso Database Studio tramite entity router; compilare solo dati conosciuti e chiedere quelli mancanti. Riutilizzare connessioni, driver, storico SQL, browser tabelle e operazioni già presenti.
- [x] **JS-15.3 Segreti e compatibilità** *(2026-10-22: `spring.datasource.password` viene letto solo per sapere se esiste (`PasswordConfigured`): il valore non entra in nessun struct, binding, log o file. Test `TestDatasourcesNeverSerializeThePassword` e `TestProjectServicesReadsTheSpringDatasource` verificano che il segreto non compaia nel payload. La connessione proposta ha la password vuota e un `credentialWarning` che dice da quale file viene e che le credenziali non sono importate; il Database Studio le sigilla con il Vault. Nessun processo, connessione o rete all'apertura del progetto.)* Credenziali tramite Vault/riferimenti esistenti, mai plaintext nel renderer persistito, log o file condivisi. Test di redazione e di profili con variabili mancanti; nessun processo o collegamento al DB all'apertura del progetto.

**Accettazione desktop:** `JS-15.M1` in `MANUAL-CHECK.md` — **aperta**: serve l'app avviata per aprire la connessione in Database Studio e provare il completamento dei placeholder. L'ORM/JPA avanzato resta fuori perimetro.

---

## JS-1 — Spring Index (P0) — *la feature più differenziante*

**Obiettivo:** sapere tutto di un progetto Spring senza eseguirlo: proprietà di configurazione note, bean, iniezioni, endpoint.

**Cosa deve coprire l'indice Spring** (comando `spring.index`):
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
- [x] **Code Vision Java** *(2026-10-22: `codeVision` è una capability della contribuzione, indipendente da `heavyFeatures`: Java la accende con `heavyFeatures: false`, Go resta come prima. Il provider è quello già generico (document symbols JDT + `textDocument/references` + blame) e `VISION_KINDS` include anche gli enum (10). `languages.test.ts` verifica Code Vision su Go+Java e inlay hints solo su Go.)* Inlay hints e Code Vision: serve JDT LS reale; `heavyFeatures` resta `false`.
- [ ] **Inlay hints Java — non abilitati, motivo verificato.** Con JDT LS 1.60 reale (fixture Eclipse, `ADOMNIA_TEST_JAVA_TOOLS`) il server risponde `[]` a `textDocument/inlayHint` anche inviando `java.inlayHints.parameterNames.enabled` in initializationOptions e in `workspace/didChangeConfiguration`, nelle tre forme provate (annidata sotto `java`, piatta `java.*`, POJO `inlayhints`). Le impostazioni raggiungono il server, ma `Preferences.getInlayHintsParameterMode()` resta `NONE`. Non si spedisce un toggle inerte: `heavyFeatures` resta `false` per Java e il limite è dichiarato in `docs/CODE-STUDIO.md`. Da riprovare con una versione di JDT LS che applichi la preferenza nel nostro client; `JS-2.M2` registra l'esito.
- [x] **Marker gutter override/implements con contatore** *(2026-10-22: nuova capability `language.ImplementationMarkers`: l'adapter dichiara la direzione di `textDocument/implementation` per kind LSP — gopls sui tipi concreti risponde con le interfacce (`implements`), JDT LS sempre "in basso" con sottotipi e override (`implementedBy`). `implementationTargets` visita ricorsivamente i figli (un override vive nella classe), i metodi non solo dentro le interfacce; il fallback senza capability è la vecchia semantica Go, invariata. Java: Class/Method/Enum/Interface/Struct → `implementedBy`; Go: Class/Method/Struct → `implements`, Interface → `implementedBy`. Frontend: contribuzione `implementationMarkers` (Go e Java), filtro sul linguaggio del file invece di `.go`, tooltip "N implementations/overrides" valido per tipi e metodi. **Verificato con JDT LS reale** (`TestJavaImplementationMarkers`: Shape → Circle+Square, `area()` → due override) e con `lsp_markers_test.go` + Vitest.)* Marker gutter override/implements con contatore.

**Test automatici:** `frontend/src/components/ide/languages/java/commands.test.ts` (ogni comando ha `requires` e id univoco); estendere `codeStudioJavaTargets.test.ts` ai nuovi marker.
**Verifica comandi:** `npx vitest run commands.test.ts` · `npx tsc --noEmit`
**Prova in app:** `JS-2.M1`–`JS-2.M5`

---

## JS-3 — Test JUnit completi (P0)

**Obiettivo:** un vero pannello test Java, non un "log colorato".

- **Esiti per metodo con roll-up a classe**: `junit.go` già converte i report Surefire/Gradle XML negli eventi dell'albero; manca la proiezione su icone passed/failed per metodo **con roll-up alla classe** e i contatori per classe.
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
- [x] **Error navigation dal log** (2026-10-20, `GIÀ OK` con la strada della voce sopra): `internal/languages/java/buildlog.go` esiste ma non serve più: i problemi navigabili arrivano dalle stesse righe di console (`parseConsoleLocation` → `buildProblems`), un solo parser. La voce resta documentata per storia.
- [x] **JDK di progetto** (implementato, verificato sul campo 2026-10-20): `internal/languages/java/jdks.go` — `DiscoverJDKs` (JAVA_HOME, PATH, `Program Files`, SDKMAN, `.jdks`), `PickJDK` (il più piccolo che soddisfa la versione richiesta), `RequiredJava` (release/source/target e toolchain dichiarate dal progetto), `JavaEnvironment` (stessa toolchain per Run, Debug e Test); scelta persistuta in `.adomnia/java.local.json` via `JavaJDKs`/`SetJavaJDK` (`internal/codestudio/service_java_jdk.go`) e passata a JDT LS come execution environment (`JDTSettings`). **Correzione 2026-10-20:** `RequiredJava` leggeva solo il pom dell'unità: in un progetto **multi-modulo** la release si dichiara nei moduli e risultava 0 (nessuna proposta di JDK). Ora segue `<modules>` di Maven e `include` di Gradle entro la cartella dell'unità (`TestRequiredJavaReadsModulesOfAMultiModuleProject`, rosso→verde). Prova reale su `quarkus-super-heroes-main`: `required Java=25` letto da adOmnia come dall'oracolo indipendente del test, JDK 25 suggerito tra i 9 installati.
- [x] **Finestra "project preparation"** (2026-10-18: il `$/progress` di JDT LS ("Importing Maven project(s)") era già pubblicato come `lsp.progress` ma la status bar lo nascondeva per i server provided; ora lo mostra anche per Java, con il nome del server come titolo di ripiego; tsc e Vitest `code-studio` verdi, prova in app = JS-4.M3): stato `starting → importing → building → ready` durante l'import di JDT LS. Senza questo l'utente pensa che il server sia rotto.

**Test automatici:** `buildlog_test.go` (casi Maven/Gradle/multi-modulo/UTF-8/Windows); `jdk_test.go` (selezione, versione, fallback); stato di preparazione esposto e testato.
**Verifica comandi:** `go test ./internal/languages/java/...`
**Prova in app:** `JS-4.M1`–`JS-4.M3`

---

## JS-5 — Debug profondo (P1)

**Obiettivo:** debuggare un'app Spring senza attraversare il framework a ogni step.

- **Stepping filters**: skip synthetics, skip static initializers, classi saltate di default `$JDK`, `$Libraries`, `com.sun.proxy.*`, `net.bytebuddy.*`, `net.sf.cglib.*`, `org.springframework.cglib.*`, `org.springframework.aop.framework.*`, `org.mockito.*`, `junit.*`/`org.junit.*`, più **nascondere i frame filtrati** dal call stack. Il Java Debug Server accetta `stepFilters` nel launch: verificare il supporto del bundle 0.53.1 e, in subordine, filtrare lato client in `internal/ide/dap/`. UI: sezione nei settings di debug + toggle "Hide framework frames".
- **Breakpoint relocation**: dopo un edit, il breakpoint spostato dal server mantiene **condizione, hit condition e logpoint**. Oggi adOmnia li perde. Da gestire in `internal/ide/dap/breakpoints.go` sull'evento `breakpoint` del DAP.
- **Hot update dei servizi in esecuzione**:
  - **Run** → Spring Boot DevTools ("Compile changes", rileva `spring-boot-devtools-*` tra le dipendenze);
  - **Debug** → hot swap classi (richiesta `redefineClasses` verso il Java Debug Server; verificare quale il bundle 0.53.1 espone davvero) con **`-Dspring.devtools.restart.enabled=false`** in debug per non perdere la sessione;
  - **esiti distinti**: compilato / classi sostituite / contesto riavviato, con la riga di log corrispondente.
- **Espressioni della riga corrente valutate automaticamente** selezionando uno stack frame — da abbinare all'evaluate già presente.

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
- [x] **Contratto di possesso** (2026-10-20): `internal/languages/java/semantics_contract_test.go` — check di CI che le regole locali di semantica Java (`findMainClasses`, `readMainClass`, `ScanMainClasses` e ogni funzione che usa la regex `mainMethod`) siano marcate `// fallback: JDT decide quando è ready`: una regola non marcata fa fallire il test (verificato rosso→verde: catturava `mains.go` non marcato).

**Test automatici:** `mains_test.go` (stesso risultato tra JDT e fallback sulle fixture), `java_test.go` (annotation custom), test del contratto di possesso.
**Verifica comandi:** `go test ./internal/languages/java/... ./internal/ide/...`
**Prova in app:** `JS-6.M1`–`JS-6.M2`
**Collegamento:** parte della soluzione di `9.4.8` (classpath e main per Gradle).

---

## JS-7 — Launch diretto e command-line lunghe (P1)

**Obiettivo:** lanciare Java senza dipendere da `exec-maven-plugin` e senza morire sul limite di Windows.

- **Launch diretto**: `resolveMainClass` → build → `vscode.java.resolveClasspath` (**l'argomento deve essere testo JSON** `{"scope":"runtime"}`, altrimenti il server fallisce) → `java` diretto con `mainClass`, `classPaths`, `modulePaths` (`modulo/nome.Tipo` → `-m modulo/nome.Tipo`). Pre-step Maven `resources:resources` (`resources:testResources` per il test), con `mvnw` risolto dal reactor. Oggi adOmnia usa `exec-maven-plugin:3.5.0:java` (`maincmd.go`) e un init script Gradle: restano come fallback quando JDT LS non c'è.
- [x] **Collegato al Run** (2026-10-18): `runCommandSpec` e il ▶ del gutter provano `javaDirectLaunch` (`service_java_launch.go`): `resolveJavaRuntime` (build + classpath + JDK di JDT, stesso del Debug) → `java.DirectLaunch` → `BuildLaunch` (argfile/jar oltre i 30 000 caratteri, pulizia a fine processo). JDT non pronto, errore di build o app modulare → fallback a Maven/Gradle. Le VM options diventano `-Xmx` veri. Non fatto: pre-step `resources:resources` (le risorse le copia il builder di JDT). Test: `TestDirectLaunchNeedsResolvedRuntime`.
- **Command-line oltre 32.767 caratteri** (problema reale su Windows con centinaia di jar): argfile `java @file` (JDK 9+) con testo Unicode, e per JDK 8 un **JAR con solo `META-INF/MANIFEST.MF`** e header `Class-Path` (URL `file:` percent-encoded, wrap a 72 byte).
- **Spremitura `MAVEN_OPTS`** per le VM options: oggi le VM options finiscono in `MAVEN_OPTS` (`maincmd.go`) — con il launch diretto diventano `-Xmx` veri del processo Java.

**Test automatici:** `launchcmd_test.go` (soglia 32K, argfile, JDK 8, moduli), `maincmd_test.go` (fallback invariato).
**Verifica comandi:** `go test ./internal/languages/java/...`
**Prova in app:** `JS-7.M1`–`JS-7.M2`

---

## JS-8 — Dipendenze JVM: tree, classpath browser, Gradle (P1)

**Obiettivo:** chiudere il "manca" di `9.4.9` e dare a Gradle la parità con il pom.

- **Dependency tree Maven**: `maven-dependency-plugin:tree` con versione pinnata e `-DoutputFile` → parsing dei nodi `resolved` / `omittedDuplicate` / `omittedConflict`. UI ad albero con evidenza dei conflitti.
- **Dependency browser del workspace**: jar e cartelle del classpath di ogni modulo, da `vscode.java.project.getAll` / `java.project.getClasspaths` (sempre come **testo JSON**), con apertura del sorgente/virtuale `jdt://`. *Forme verificate su JDT LS 1.60 il 2026-10-20 con il test reale `TestJdtImportsARealMultiModuleProject`: `java.project.getAll` senza argomenti elenca i progetti importati (URI `file:` per cartella); `java.project.getClasspaths` vuole `arguments[0]` = cartella progetto come **URI `file:`** e `arguments[1]` = **testo JSON** dei parametri (`{"scope":"runtime","projectFolderPaths":[…]}`); un oggetto strutturato al posto del testo, una lista o un percorso nudo falliscono in modi diversi.*
- **Gradle allo stesso livello del pom**: parsing di `build.gradle`/`.kts` per dipendenze con versioni e property, **CVE** tramite `internal/securityintel` (come già per il pom), lens "Check for updates"/"Scan vulnerabilities". Oggi `build.gradle` non ha nessun equivalente di `pomInsights`.
- **Riconoscimento framework dai plugin del build script** senza eseguire Gradle (`bootRun`, `quarkusDev`, `run`, task path `:modulo:bootRun`) e dal plugin Maven applicato (`spring-boot-maven-plugin` di `org.springframework.boot`, con il groupId come parte dell'identità) — oggi `usesSpringBoot()` è più grossolano.
- [x] **Versioni gestite da parent/BOM** (2026-10-18): `PomManagedVersions` riusa il resolver di Security Intelligence (offline, parent per `relativePath` e dal repository Maven locale, BOM importati); la dipendenza senza `<version>` mostra la versione reale e il marker dice che va aggiornata dove è definita (nessuna modifica proposta nel file).
- [x] **CVE su Gradle** (2026-10-18): l'adapter Maven di `securityintel` scopre e legge staticamente i `build.gradle(.kts)` (`maven/gradle.go`, stesse coordinate OSV); "Scan vulnerabilities" funziona anche sugli script Gradle. Solo dipendenze con versione scritta, niente transitive (warning esplicito).

**Test automatici:** `dependencytree_test.go` (nodi, conflitti, multi-modulo), `gradledeps_test.go` (dipendenze, property, plugin framework), `pomdeps_test.go` (parent/BOM), test di `securityintel` estesi a Gradle.
**Verifica comandi:** `go test ./internal/languages/java/... ./internal/securityintel/...`
**Prova in app:** `JS-8.M1`–`JS-8.M3`

---

## JS-9 — Performance JVM (P2)

**Obiettivo:** l'equivalente Java del PPROF Go, che oggi non esiste.

- **Heap reale durante Run/Debug/Test**: `jstat -gc -t` del JDK target (young/old, escluso metaspace), CPU dai contatori di processo, identificazione della JVM vera (JUnit / Surefire / Gradle Test Executor / worker).
- **Registrazione JFR esplicita** con "Mostra risultati" negli strumenti JDK (`jfr`/`jcmd JFR.start`).
- Posizionamento UI: pannello accanto a Performance Studio, ma **solo per unità Java** — non generalizzare il codice Go di `pprof.go`.

**Test automatici:** parsing dell'output `jstat` (fixture di esempi reali), selezione del PID, stato registrazione JFR.
**Prova in app:** `JS-9.M1`–`JS-9.M2`

---

## JS-10 — MyBatis: mapper ↔ XML (P2)

**Obiettivo:** navigazione bidirezionale tra interfaccia mapper e statement XML (`select/insert/update/delete`), con range precisi su entrambi i lati. Comando `mybatis.index`. Feature assente nella maggior parte degli editor, quindi molto differenziante.

- `internal/languages/java/mybatis_index.go` + comando host `MybatisIndex`, UI: link "vai all'XML"/"vai al metodo", sezione nel pannello struttura.

**Test automatici:** `mybatis_index_test.go` con fixture mapper+XML (naming convention, `@Param`, statement multipli, XML senza mapper).
**Prova in app:** `JS-10.M1`

---

## JS-11 — Run configuration a livelli e altri framework (P2)

- **Configurazioni generate + override a livelli**: `generated` → `project` → `local`, con rigenerazione automatica e revisione versionata. **Stato 2026-10-18:** i tre livelli esistono già di fatto — le proposte (`run_suggestions.go`) sono `generated`, le configurazioni con *Share (Git)* vivono in `.adomnia/run-configurations.json` (`project`), le altre nel bbolt locale (`local`). **Aperto di proposito:** l'override personale di una configurazione condivisa senza toccare il file (servirebbe un file `.local` o un campo nel formato condiviso): non c'è un consumatore reale, quindi non si costruisce; **non rompere il formato condiviso via Git** (visto già in `MULTILANGUAGE-IDE.md` 3.4).
- **Framework oltre Spring**: Quarkus e Micronaut (proporre `quarkusDev`/`micronaut` come run). Oggi adOmnia riconosce solo Spring Boot.
- **Maven settings per JDT LS**: passare all'utente e al server lo stesso `settings.xml` (localRepository, mirrors), con cache content-addressed per forzare il reload senza restart. Oggi adOmnia non lo fa: un progetto con repository privata non risolve le dipendenze.

**Test automatici:** migrazione formato run config (idempotente), detectors Quarkus/Micronaut, settings content-addressed.
**Prova in app:** `JS-11.M1`–`JS-11.M2`

---

## JS-12 — Oltre il minimo (P2)

Cose che adOmnia può avere per primo, sfruttando ciò che già possiede:

- **Test coverage Java (JaCoCo)** — nessun tooling JVM diffuso la offre al proprio interno; adOmnia ha già `coverage_base.go` + `coverage_branches.go` da usare come modello per la copertura Java.
- **Spring Initializr** — il launcher che già riconosce Spring Boot può creare il progetto.
- **Actuator e grafo dei bean** — oggi ci sono solo liste (beans/injections). Un grafo visuale costruito sullo stesso schema di JS-1 è un salto di qualità.
- [x] **Security su Gradle** — fatto, vedi JS-8 (`securityintel/maven/gradle.go`).

*Voci aperte a richiesta: qui si scrive solo quando una di queste diventa lavoro concreto.*

---

## JS-16 — Quarkus e MicroProfile (P0)

**Obiettivo:** che Quarkus sia un framework di primo livello come Spring Boot, non una riga nei suggerimenti.

**Cosa serve:** riconoscere `quarkus-maven-plugin`
sotto **entrambi i groupId** (`io.quarkus` e `io.quarkus.platform`, dove il plugin viene ripubblicato),
generare la run configuration `quarkus.maven` con `jvmArguments`/`quarkus.args`, e tenere conto che
**`quarkus:dev` ha già JDWP in ascolto sulla porta di default senza suspending**: il debug è un attach,
non un launch con agent iniettato.

**Stato (2026-10-19)** — implementato e verificato:
- [x] Riconoscimento framework: `usesGroup("io.quarkus")` usa `HasPrefix`, quindi copre già
  `io.quarkus.platform` (verificato in `detect.go`); `suggest.go` propone `quarkus:dev`, `quarkusDev`,
  `mn:run` (`TestSuggestRecognizesQuarkusAndMicronaut`).
- [x] **Endpoint JAX-RS** (`spring_extract.go`): `@Path` su classe e metodo, `@GET/@POST/@PUT/@DELETE/
  @PATCH/@HEAD/@OPTIONS`, `@Produces`/`@Consumes` come annotation a sé → gli endpoint Quarkus entrano
  nell'indice Spring, nel pannello e nelle route del Developer Context. Test
  `TestJaxRsEndpointsAndMicroProfileConfig`.
- [x] **Config property MicroProfile** (`@ConfigProperty(name, defaultValue)`) → `propertyReferences`
  con navigazione, come gli `@Value` di Spring.
- [x] **Bean MicroProfile**: `@ApplicationScoped`, `@RequestScoped`, `@Singleton`, `@Named` riconosciuti
  come bean.
- [x] **Debug `quarkus:dev`/`quarkusDev`** (`debugcmd.go`, `javaDebug.ts`): argomenti **lasciati
  intatti** — nessun agent JDWP iniettato, nessun `--debug-jvm` — e porta `QuarkusDebugPort` (5005);
  `listenWatcher` rileva già la porta occupata, quindi il collegamento funziona senza stringhe
  nell'output. Test `TestDebugArgumentsLeaveQuarkusDevModeAlone` + `javaDebug.test.ts`.

**Verifica comandi:** `go test ./internal/languages/java/` · `npx vitest run javaDebug.test.ts`
**Prova in app:** `JS-16.M1`–`JS-16.M3` (MANUAL-CHECK.md)

### Stato Quarkus dopo il secondo passaggio (2026-10-19)

- [x] **Template progetto Quarkus (Maven)** — `internal/codestudio/projecttemplates/quarkus-maven/`:
  `pom.xml` sulla piattaforma `io.quarkus.platform:quarkus-bom` (3.15.1), endpoint JAX-RS con
  `@ConfigProperty`, test REST Assured, `.gitignore` con `.quarkus/`. Registrato in `templates.go`
  come "Quarkus (Maven)"; coperto da `TestNonGoTemplatesCreateFilesWithoutGo`.
- [x] **Proprietà `quarkus.*` note** — `quarkus_builtin.go`: le ~30 proprietà di configurazione Quarkus
  più usate (http, log, datasource, hibernate-orm, package, native, debug) con tipo, descrizione e
  default. Entrano nell'indice **solo** quando il progetto si rivela Quarkus (`quarkus.*` scritto o
  `@ConfigProperty`): un progetto Spring non viene inondato di chiavi che non lo riguardano.
- [x] **`quarkus.http.port` come porta del server** — `serverPortOf` considera sia `server.port` sia
  `quarkus.http.port`, quindi le chiamate API del Developer Context puntano alla porta giusta.
- [x] **Endpoint JAX-RS nel Developer Context** — `EndpointsInFile` riusa `endpointsOf`, quindi API
  Workspace, Mock, cURL e OpenAPI valgono per Quarkus come per Spring. Test
  `TestJaxRsEndpointsReachTheDeveloperContext`.

**Rimane per Quarkus:** solo le prove in app (`JS-16.M1`–`M3`) e i Dev Services (che Quarkus gestisce
da solo: il restart del dev mode non passa dall'IDE). Il metadata delle `quarkus.*` dagli JAR non è
stato fatto di proposito: Quarkus non pubblica un `spring-configuration-metadata.json` equivalente e
estrarre le proprietà dal bytecode delle `@ConfigItem` sarebbe una complessità senza un beneficio
proporzionato, visto che la tabella built-in copre l'uso quotidiano.

## JS-17 — Affidabilità su progetti JVM grandi (P0)

**Obiettivo:** che un progetto multi-modulo grande si usi in adOmnia senza console incolonnata male,
UI bloccata durante `mvn test` o toolchain sbagliata. Nato dai tre problemi del 2026-10-20 su
`quarkus-super-heroes-main` (10 moduli, `maven.compiler.release=25`, test Quarkus con Dev Services).

- [x] **JS-17.1 Console Run allineata** (2026-10-20): `frontend/src/components/code-studio/codeStudioConsoleLines.ts`
  — la console non spezza più una riga quando il chunk di output finisce a metà (prima ogni lettura
  di pipe diventava una riga nuova a margine sinistro: "le scritte incolonnate male tutte verso
  sinistra"), applica i `\r` di ridisegno con la semantica del terminale (`abcdef\rXY` → `XYcdef`,
  un `\r` finale non cancella la riga) e toglie tutte le escape ANSI tranne i colori SGR. Analisi
  incrementale per identità dei chunk (un evento `run.output` analizza solo il chunk nuovo) e cache
  per console, così due progetti aperti non si scalzano. Test: `codeStudioConsoleLines.test.ts` (12 casi).
- [x] **JS-17.2 UI reattiva durante i test lunghi** (2026-10-20): `internal/ide/run/processes.go`
  coalesce l'output di ogni flusso in **un evento ogni 50 ms** (`outputFlushInterval`, con flush
  garantito prima di `run.finished`): prima ogni scrittura di pipe era un evento `run.output` — con
  `mvn test` migliaia di eventi saturavano il webview e l'albero progetto non apriva più le cartelle
  né lo Stop rispondeva. Lato frontend: selettore dei chunk solo per l'esecuzione attiva
  (`CodeStudioRunPanel.tsx`), `matchingLines` memoizzato. Test: `TestProcessOutputIsCoalescedIntoFewEvents`
  (**rosso→verde**: 100 eventi senza coalescing, ~10 con). 
- [x] **JS-17.3 JDT LS parte da solo sui progetti Java** (2026-10-20): `watchServerDocuments`
  (`stores/ideLanguageServers.ts`) avvia il server anche **senza file aperti** quando il progetto ha
  unità Java (`autoStartLanguagesFor`): l'import Maven multi-modulo dura minuti e deve partire con il
  Code Studio, non al primo `.java`. Gli altri linguaggi restano pigri come prima. In più il PTY del
  terminale parte con le colonne reali del pannello (prima 80×24: ConPTY impaginava a 80 colonne e
  l'output prodotto prima del fit restava spezzato).

**Verifiche reali su `quarkus-super-heroes-main` (2026-10-20)** — non fixture:

| Prova | Esito |
|---|---|
| `mvnw test-compile` (reactor completo) | **BUILD SUCCESS, 10/10 moduli** con JDK 25 (Temurin 25.0.4.1 installato in `~/.jdks`). Con il solo JDK 21 della macchina: `release version 25 not supported` — era la causa prima di "non compila". |
| `mvnw -pl rest-villains test` (Docker + Dev Services) | 75 test eseguiti su container Postgres reale; 6 fallimenti **solo per la lingua del JVM** (messaggi Hibernate Validator in italiano contro attese in inglese): con `-Duser.language=en` `VillainServiceTests` = 23/23, BUILD SUCCESS. |
| JDT LS su tutto il reactor (`TestJdtImportsARealMultiModuleProject`) | Import di **9/9 moduli** (docs, event-statistics, grpc-locations, scripts/jmeter, rest-fights, rest-heroes, rest-narration, rest-villains, ui-super-heroes) come progetti distinti; `required Java=25` letto da adOmnia = oracolo indipendente; tra i 9 JDK installati viene suggerito il 25; `java.project.getClasspaths` risponde con il classpath del modulo. |
| Debug | La catena Run/Debug Java è coperta dal test di integrazione reale `TestJavaDebugBuildsFreshMainAndStopsAtBreakpoint` (breakpoint, stack, evaluate, step su JDT LS + DAP veri); il debug **di un modulo Quarkus** (`quarkus:dev` + attach 5005) resta da provare nell'app: `JS-16.M2` in `MANUAL-CHECK.md`. |

**Altri due difetti trovati e chiusi durante la prova nell'app (2026-10-20, stessa storia: "il JDK del progetto non arriva")**:

- [x] **JS-17.5 Le impostazioni non arrivavano a JDT LS** — `workspace/configuration` rispondeva con l'**intero albero** `{"java": {…}}` a ogni sezione richiesta, mentre LSP chiede il **sottoalbero** della sezione (per `java` → il contenuto di `java`). JDT non vedeva mai `java.configuration.runtimes`, ricadeva sul rilevamento proprio (JAVA_HOME + `Program Files\Java`) e ogni modulo Java 25 diceva *"The project was not built due to release 25 is not found in the system"*. Fix in `internal/codestudio/lsp.go` (`sectionSettings`, con fallback all'oggetto intero per i server — gopls, web — che già si aspettano il contenuto della sezione) + `settings` in `initializationOptions` come fa vscode-java + il JDK scelto per il progetto come **primo runtime** (`JDTSettingsFor`). Test: `TestWorkspaceConfigurationResolvesTheRequestedSection` (**rosso→verde**), `TestJDTSettingsCarryTheProjectJDKFirst`. Prova reale: il workspace JDT riscritto da zero registra `~/.jdks/temurin-25.0.4.1` e `corretto-17.0.11` (`libraryInfos.xml`), il log non ha più "release 25", `>> build jobs finished`.
- [x] **JS-17.6 I comandi liberi non usavano il JDK del progetto** — una run configuration *Command* (`./mvnw.cmd test`) partiva con il JDK di sistema: `testCompile` moriva con *"release version 25 not supported"* dopo pochi secondi. Fix in `executionEnvironment` (`internal/codestudio/service.go`): il JDK scelto vale per **ogni** esecuzione, anche i comandi senza linguaggio. Test: `TestEveryRunUsesTheProjectJDK` (**rosso→verde**). Prova reale: lo stesso `./mvnw test` nell'app passa `testCompile` con `release 25` e il log mostra il Kotlin daemon avviato con `…\temurin-25.0.4.1\bin\java`.

**Test automatici:** `codeStudioConsoleLines.test.ts`; `TestProcessOutputIsCoalescedIntoFewEvents`
(+ i test di processo esistenti: coda non persa, UTF-8 spezzato, stop); `TestRequiredJavaReadsModulesOfAMultiModuleProject`
e `TestRequiredJavaNeverReadsOutsideTheUnitRoot`; `TestWorkspaceConfigurationResolvesTheRequestedSection`;
`TestEveryRunUsesTheProjectJDK`; `TestJDTSettingsCarryTheProjectJDKFirst`; `autoStartLanguagesFor` in `ideLanguageServers.test.ts`;
`localAnalysisLabel` in `CodeStudioStatusBar.test.tsx`. Prove reali opt-in: `TestJdtImportsARealMultiModuleProject`
(`ADOMNIA_TEST_JAVA_TOOLS` + `ADOMNIA_TEST_JAVA_PROJECT`).

**Verifica comandi:** `go test ./internal/codestudio/ -run "TestProcess|TestEveryRun|TestWorkspaceConfiguration|TestRequiredJava"` · `go test ./internal/languages/java/` · `npx vitest run codeStudioConsoleLines.test.ts ideLanguageServers.test.ts CodeStudioStatusBar.test.tsx` · `npx tsc --noEmit`
**Prova in app:** `JS-17.M1`–`JS-17.M4` **chiuse il 2026-10-20** nell'app avviata (`wails3 task dev`, build nuova) su `quarkus-super-heroes-main` — vedi le evidenze per voce in `MANUAL-CHECK.md`. Nella stessa sessione: `./mvnw test` del reactor nell'app = event-statistics **4/4**, rest-heroes **40/40**, rest-fights **103 con 2 fallimenti** (le asserzioni upstream attese `"must not be null"` contro il validator in italiano: **i 2 fallimenti sono la locale del JVM**, non adOmnia — con `-Duser.language=en` il progetto è verde). Nota per l'utente: i test Quarkus aprono porte e Windows Firewall chiede conferma per "OpenJDK Platform binary" (Eclipse Adoptium) a ogni JVM nuova.

## Gap residui (aggiornati al 2026-10-19)

Ciò che resta utile da portare, oltre a Quarkus:

| Feature | Perché serve |
|---|---|
| **JDT build coordinator** | Una build alla volta per sessione, stall detection (120 s), deadline (10 min), esiti distinti (errori di compilazione / fallimento interno / cancellato). Oggi ogni build è indipendente. |
| **Project preparation state** | `starting → importing → configuring → building → ready`. JDT LS importa per minuti: senza stato l'utente pensa che sia rotto. |
| **Breakpoint relocation** | Dopo un edit i breakpoint si ricollocano **preservando condizione e logpoint**. Oggi adOmnia li perde. |
| **Run config generate a livelli** | `generated → project → local` con rigenerazione automatica (JS-11 resta aperto proprio su questo). |
| **Maven settings content-addressed** | Le copie di `settings.xml` sono nominate per hash: un cambio di contenuto diventa cambio di path e **JDT LS stesso fa il reload**, senza restart. |
| **JDT cache retention** | `java.jdtCacheRetention` (30 giorni): la cache di JDT non cresce all'infinito. |
| **mvnd** | Maven daemon come alternativa a `mvn`, per build ripetute veloci. |

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
| La UI Java resta un sottoinsieme incompleto del tooling reale | Medio | Ordine P0 → P1: prima ciò che si usa ogni giorno (Spring index, comandi, test), poi il resto |
| Duplicità con `MULTILANGUAGE-IDE.md` 9.4 | Basso | Testa di questo file: 9.4.8/9.4.9 restano lì; qui se ne indicano solo i collegamenti |

## Fuori perimetro (deliberato)

- **Eclipse PDE/OSGi** (`internal/eclipsepde`): resta lavoro separato, come deciso in `docs/architecture/ide-multilanguage-refactor.md` §24. La convivenza JDT LS + Maven/Gradle + PDE è una decisione da prendere prima di mescolare.
- **Kotlin** oltre l'LSP: nessun tooling proprio.
- **Jakarta EE / application server (Tomcat)**: nessuno dei due lo copre; non è il perimetro Spring Boot.
- **Plugin dichiarativi con bundle firmato**: adOmnia ha già `InstallPlan` esplicito, coerente col local-first. Non sostituire.
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
| 2026-10-18 | — | Piano creato. Nessuna voce iniziata. |
| 2026-10-18 | JS-1 | **Spring Index implementato**: parser Java + `.properties`/`.yml` con profili, scan JAR della repository Maven locale con cache, binding `SpringIndex`/`SpringEndpoints`/`SpringMetadataRefresh` rigenerati, store + provider Monaco + pannello endpoint collegati. Test Go e vitest verdi, `tsc --noEmit` pulito (prova del collegamento tipizzato), smoke test su `spring-openai-master` e su 500 JAR reali. **Restano aperte le prove in app `JS-1.M1`–`JS-1.M4`** su `MANUAL-CHECK.md`. |
| 2026-10-18 | JS-2 | **Comandi e menu Java**: menu "Java", 14 comandi con `requires`, New Java Class/Package, Build Maven dal martello, comandi Go-only spenti nei progetti Java. tsc e vitest verdi; prove `JS-2.M1`–`M5` aperte. |
| 2026-10-18 | JS-3 / JS-4 | Debug dei test JUnit dal pannello Tests, motivo dei test ignorati, errori Maven/Gradle cliccabili in console e terminale. Vitest (51 file) e `go test ./internal/languages/java/` verdi, tsc pulito. Restano roll-up per classe, JDK per unità, problemi nel pannello Problems, stato di preparazione JDT LS. |
| 2026-10-18 | JS-5…JS-12 | Codice e test: stepping filters e hot code replace (JS-5), main class decise da JDT con fallback marcato (JS-6, backend), helper per command line lunghe (JS-7, non ancora collegato al Run), lens sulle dipendenze Gradle e albero Maven provato su spring-openai-master (JS-8), monitor JVM con heap/GC/JFR provato su una JVM reale (JS-9), navigazione MyBatis (JS-10), goal Quarkus/Micronaut e JDK/settings.xml a JDT LS (JS-11), coverage JaCoCo provata su un progetto Spring generato, template Spring Boot Maven/Gradle e Java Maven, grafo dei bean, iniezioni Lombok e per interfaccia (JS-12). Aperti: roll-up per classe e rerun multi-metodo (JS-3), JDT-owned nel frontend e launch diretto (JS-6/7), run config a livelli (JS-11), Gradle security (JS-12, securityintel), parent/BOM, template Gradle da compilare. Tutte le prove in app restano aperte. |
| 2026-10-18 | JS-3/6/7/8/12 | Chiusi: roll-up per classe e rerun multi-metodo (JS-3), main class JDT nel gutter (JS-6), launch diretto collegato a Run e ▶ (JS-7), parent/BOM del pom e CVE su Gradle (JS-8/JS-12). JS-11 resta aperto solo per l'override personale di una configurazione condivisa. In più: le `@RestController` Spring diventano route del Developer Context (`devcontext/javaroutes.go`), quindi API Workspace, Mock, cURL, OpenAPI, Open API e Live Session valgono come per Go; lens sul sorgente Java e bottone "Open API" negli endpoint. Go test (java, devcontext, securityintel, ide) e vitest (177 file) verdi, tsc pulito. Prove in app aperte: `MANUAL-CHECK.md`. |

| 2026-10-18 | JS-14/JS-15 | Aggiunti i TODO dal confronto funzionale: completamento e outline Java senza processi hanno priorità P0 assoluta; integrazione datasource Spring verso Database Studio P1. Nessuna implementazione dichiarata; prove native in MANUAL-CHECK. |
| 2026-10-19 | JS-16 | **Quarkus e MicroProfile**: endpoint JAX-RS (`@Path`, `@GET`…, `@Produces`/`@Consumes`) nell'indice Spring, `@ConfigProperty` come property reference, bean MicroProfile (`@ApplicationScoped`…), debug `quarkus:dev`/`quarkusDev` senza agent JDWP iniettato (porta `QuarkusDebugPort`, `listenWatcher` rileva già la porta occupata). `usesGroup` copriva già `io.quarkus.platform`. Test Go e vitest verdi. Restano: template Quarkus, metadata `quarkus.*` dagli JAR, dev services. Aggiunta la tabella dei gap residui (build coordinator, project preparation, breakpoint relocation, run config a livelli, settings content-addressed, cache retention, mvnd). |
| 2026-10-19 | JS-16 | **Quarkus completato**: template "Quarkus (Maven)" (`projecttemplates/quarkus-maven`, piattaforma `io.quarkus.platform:quarkus-bom` 3.15.1, endpoint JAX-RS, test REST Assured, `.quarkus/` nel gitignore) coperto da `TestNonGoTemplatesCreateFilesWithoutGo`; proprietà `quarkus.*` note in `quarkus_builtin.go` (http, log, datasource, hibernate-orm, package, native, debug) attive **solo** nei progetti Quarkus; `quarkus.http.port` accettato come porta del server; endpoint JAX-RS nel Developer Context via `EndpointsInFile`. Restano solo le prove in app `JS-16.M1`–`M3`; i metadata `quarkus.*` dagli JAR esclusi di proposito (Quarkus non pubblica un equivalente di `spring-configuration-metadata.json`). |
| 2026-10-20 | JS-14 | **Java locale completato e verificato**: `javaLocalLexer/Analysis/Completion/Outline` (completamento e Structure senza processi, scope, overload, record, UTF-16, limiti dichiarati), fonte esplicita nella status bar (`localAnalysisLabel`), JS-14.1–14.6 spuntati con le evidenze in sezione. Vitest mirati verdi, `tsc --noEmit` pulito. Prove in app `JS-14.M1`–`M3` aperte. |
| 2026-10-20 | JS-17 | **Affidabilità su progetti JVM grandi** (da tre problemi reali su `quarkus-super-heroes-main`): console Run con righe non più spezzate fra chunk e `\r` di ridisegno applicati (`codeStudioConsoleLines.ts`, 12 test); output di processo coalescito a 50 ms con flush finale (`processes.go`, `TestProcessOutputIsCoalescedIntoFewEvents` **rosso→verde**: 100 → ~10 eventi) e parse incrementale/selectori per run in UI; JDT LS parte da solo all'apertura del Code Studio sui progetti Java (`autoStartLanguagesFor`) e il PTY parte alla larghezza reale. **Verifiche reali sul progetto**: `mvnw test-compile` BUILD SUCCESS 10/10 con JDK 25 (con il solo JDK 21 era `release version 25 not supported`), `mvnw -pl rest-villains test` = 75 test su Dev Services Docker (6 falliscono solo per la locale IT del JVM; con `-Duser.language=en` 23/23 BUILD SUCCESS), JDT LS importa **9/9 moduli** del reactor con `required Java=25` letto correttamente dai moduli. |
| 2026-10-20 | JS-4 | **Toolchain multi-modulo**: `RequiredJava` segue `<modules>` di Maven e `include` di Gradle (prima leggeva solo il pom dell'unità: un reactor risultava senza requisiti e non proponeva il JDK corretto). Test rosso→verde + prova reale (`required Java=25` = oracolo indipendente su quarkus-super-heroes). `buildlog.go` dichiarato non necessario (la navigazione errori passa da `parseConsoleLocation`). |
| 2026-10-20 | JS-6 | **Contratto di possesso**: `semantics_contract_test.go` — check di CI che ogni regola locale di semantica Java (`findMainClasses`, `readMainClass`, `ScanMainClasses`, chi usa la regex `mainMethod`) sia marcata `// fallback: JDT decide quando è ready`. Rosso→verde (catturava `mains.go` non marcato). In più, forma verificata dei comandi JDT `java.project.getAll` / `java.project.getClasspaths` (URI `file:` + testo JSON dei parametri) registrata in JS-8 per il classpath browser. |
| 2026-10-22 | JS-15 | **Datasource Spring → Database Studio**, JS-15.1–15.3 chiuse nel codice. Capability generica `language.ConfiguredDatabases` (+ `ConfiguredDatabase`) con il primo consumatore reale, `ProjectServices`; adapter `spring_datasource.go` legge solo i file di configurazione dell'unità: URL JDBC o host/porta/database separati, vendor dal sottoprotocollo o da `driver-class-name`, `sslmode`, base+profili con la precedenza di Spring, profilo attivo, SQLite assoluto. La password non viene copiata (solo `PasswordConfigured`): i test verificano che non compaia nel JSON né nel payload del binding; i placeholder restano `unresolved`. Frontend: riga per datasource con profilo/`file:riga`, pulsante *Database Studio* solo con host e database noti, `credentialWarning` che spiega cosa manca, vendor non supportato mostrato con il motivo. Test: `spring_datasource_test.go` (9 casi), `integrations_test.go` (merge per driver e fine a fine Maven reale), `codeStudioIntegrations.test.ts` (8). Go/Vitest/tsc/build/binding verdi. Doc `docs/CODE-STUDIO.md`. Desktop `JS-15.M1` aperta. |
| 2026-10-22 | JS-2 | **Code Vision Java e marcatori I↓**; inlay hints Java **non** abilitati con motivo verificato. Code Vision è una capability della contribuzione (`codeVision`, indipendente da `heavyFeatures`). Nuova capability core `language.ImplementationMarkers`: l'adapter dichiara la direzione di `textDocument/implementation` per kind (gopls tipi concreti = `implements`, JDT LS sempre `implementedBy`); `implementationTargets` visita i figli ricorsivamente e il fallback senza capability è la semantica Go invariata. Marker frontend guidati dal linguaggio del file, tooltip valido per tipi e metodi. Inlay hints: JDT LS 1.60 reale risponde `[]` anche con la preferenza inviata in initializationOptions e `workspace/didChangeConfiguration` nelle tre forme provate, quindi niente toggle inerte e limite dichiarato. Test: `TestJavaImplementationMarkers` con JDT LS reale, `lsp_markers_test.go`, Vitest `codeStudioImplementationMarkers.test.ts` e `languages.test.ts`. Desktop `JS-2.M2`/`M3` aperte. |
| 2026-10-20 | JS-17 | **Prove nell'app avviata** (`wails3 task dev` + build nuova, `quarkus-super-heroes-main`): `JS-17.M1`–`M4` **chiuse** con screenshot e catture. Dalla prova sono usciti altri due difetti reali, entrambi "il JDK del progetto non arriva": `workspace/configuration` rispondeva con l'albero intero invece della sezione (JDT non vedeva i `runtimes` → *"release 25 is not found in the system"* su ogni modulo; **rosso→verde** `TestWorkspaceConfigurationResolvesTheRequestedSection`, prova reale: `libraryInfos.xml` riscritto con temurin-25 e log senza errori), e i comandi liberi (`./mvnw test`) partivano col JDK di sistema (*"release version 25 not supported"*; **rosso→verde** `TestEveryRunUsesTheProjectJDK`). Aggiunti `settings` in `initializationOptions` (canale provato dal test reale) e il JDK del progetto come primo runtime JDT. Nell'app: JDT LS parte 1 s dopo l'avvio **senza file `.java` aperti** (auto-start), il dialogo Project JDK dichiara *"The build declares Java 25"* e suggerisce temurin-25, `./mvnw test` del reactor compila con `release 25` e va fino ai test (event-statistics 4/4, rest-heroes 40/40, rest-fights 103 con 2 fallimenti di locale: `"non deve essere null"` vs `"must not be null"`), Stop ferma il run in corso con la coda della console intatta e l'albero resta navigabile durante i test. |

### 2026-10-20 — Maven dal menu cartelle e diagnostica durante import

- [x] Tasto destro sulla radice o su una cartella con `pom.xml`: sottomenu Maven con clean, compile, test, package, verify, install, clean package e clean install. Caricamento lazy dei figli anche su cartella chiusa; niente azioni Go Package nei progetti senza moduli Go.
- [x] Runner Maven nell'adapter Java: working directory della cartella scelta, wrapper locale o del reactor entro la radice autorizzata, fallback Maven nel PATH, ambiente/JDK della sessione, console Run e Stop esistenti. Test della facade con processo wrapper reale e rifiuto del progetto non autorizzato.
- [x] Diagnostica: burst aggregati per 50 ms, ultimo report per file/sessione e una copia dello stato per sessione. Test del collegamento: 1.000 file producono un solo aggiornamento dello store, cancellazioni preservate. Gli eventi non diagnostici scaricano prima la coda per mantenere l'ordine.
- [x] Test mirati frontend: 33 casi; adapter Java, test facade Maven, TypeScript, build frontend, check startup (642.430 byte), `go build ./...` verdi.
- [x] `TestJdtImportsARealMultiModuleProject` sul vero `C:\Users\Andrea\Desktop\quarkus-super-heroes-main`: PASS, 9 progetti importati, 6/6 moduli con sorgenti riconosciuti, classpath event-statistics 41.804 byte. JDT initialize ~2,5 s; import workspace ~82,7 s, ~85,2 s dall'avvio. Workspace JDT temporaneo isolato; autobuild disattivato dal test. Corretto l'ordine di cleanup Windows del test, arrestando il server prima di eliminare la directory.
- [ ] Verifica manuale della nuova build Wails: tasto destro su modulo chiuso, clean/package, Stop e navigazione durante indicizzazione. I tempi sopra misurano il backend nel test, non la latenza della UI; non dimostrano una riduzione dei tempi d'import Maven né parità prestazionale con Go.
