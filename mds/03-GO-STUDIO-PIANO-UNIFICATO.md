# gO Studio — Piano unico: collaudo, lavoro aperto e idee

> **Visione:** non “un IDE Go dentro adOmnia”, ma un ambiente di sviluppo Go in cui **codice, runtime, API, database, broker, log, trace, profiler e Git sono collegati tra loro**.
>
> **North Star:** _Write the service. Run it. Call it. Debug it. Inspect its database, messages, logs and runtime — without leaving the workspace._
>
> **Principio chiave:** **From code to runtime, everything is connected.**

Aggiornato il 2026-10-16. Questo file **unisce** il vecchio piano 2027 e il vecchio `todo-ide.md` (collaudo desktop M1–M34, gate, evidenze, Copilot). L'originale di `todo-ide.md` è conservato in `archivio/todo-ide-originale-2026-10-11.md` (solo consultazione).

## 1. Dove siamo davvero

**L'implementazione è davanti alla prova.** Il lavoro funzionale pianificato è chiuso nel codice; ciò che manca è dimostrare che l'app avviata, usata da una persona su un progetto reale, regge una giornata di lavoro.

| Fatto | Stato |
| --- | --- |
| Fasi 0–5, P0–P4 del vecchio piano | Chiusi nel codice (storia: `CHANGELOG.md`, `docs/releases/`). |
| Le sei voci P2 che il piano dava per aperte (dev container, gRPC, goroutine, retry → policy, cache hit/miss, genera unit test) | **Già nel codice**, rilasciate in 1.0.1 (2026-10-12). Verificato il collegamento alla UI per dev container (`GoStudioRunTarget.tsx`), unit test (`UnitTestModal.tsx`), retry → policy (`RetryPolicyLink.tsx`) e cache hit/miss (tooltip Runtime Lens, `runtimeLens.ts`); goroutine e gRPC verificati solo come presenza di codice (`internal/devsession/goroutines.go`, `requests.go`) e voce di CHANGELOG. Non esercitati nell'app. Il vecchio piano non era stato aggiornato. |
| Prove desktop M1–M34 | **Nessuna registrata.** È il collo di bottiglia. |
| Piattaforme | Windows: suite automatiche ok. Linux: CI ok, desktop non provato. macOS: compila, mai eseguito. |

**Regola di congelamento:** finché il Gate Fase 1 (sessione 1) non è chiuso con evidenze, nessuna feature nuova di P1–P3. Si accettano solo fix emersi dal collaudo.

## 2. Priorità

Criterio d'ordine: **fiducia** (provare ciò che esiste) → **lacune reali** → **effetto wow** → **funzioni 2027** → **qualità continua**.

| Priorità | Tema | Stato |
| --- | --- | --- |
| **P0** | Dimostrare: collaudo desktop, gate, rilascio v1 | Aperto — 8 sessioni di prova |
| **P1** | Chiudere le lacune reali (voci “parziali” che sono lavoro vero) | Aperto — 6 blocchi |
| **P2** | Effetti wow (vetrina e unicità) | Idee, nessuna avviata |
| **P3** | Funzioni 2027, Copilot Edit/Agent, idee per l'editor | Ricerca, nessun perimetro |
| **P4** | Qualità continua: Definition of Done, KPI, “do not build badly” | Criteri, non bloccano il rilascio |

## 3. Regole

- Una voce si chiude solo se **verificata** (codice per il lavoro funzionale, app avviata per le prove). Chiusa, si cancella da qui e va nel CHANGELOG. Se una verifica fallisce, si riaprono prova e gate.
- Un test automatico o una build **non** chiudono una prova desktop.
- *Parziale:* dice cosa esiste e cosa manca; si riparte da lì.
- Niente funzioni simulate. Dati sempre locali, niente telemetria, nessun processo avviato senza un'azione dell'utente.
- Nuove funzioni: ricetta *Add a language/IDE feature* in `CLAUDE.md`; aggiornare `docs/CODE-STUDIO.md`.
- Gli obiettivi di riferimento e le idee Wow non bloccano il rilascio v1 né l'eventuale adapter JS/TS ([proposta separata](../../docs/architecture/ide-web-languages-action-plan.md)).

## 4. Documenti collegati

- [Audit di accettazione 2026-10-11](../../docs/GO-STUDIO-ACCEPTANCE-2026-10-11.md) — risultati automatici e limiti della baseline sintetica.
- [Registro P2 2026-10-11](../../docs/GO-STUDIO-P2-PARTIALS-2026-10-11.md) — debug distribuito, confini OTLP, integrazioni enterprise.
- [Perimetro v1](01-RILASCIO-V1.md) — gate di pubblicazione e piattaforme.
- [`docs/CODE-STUDIO.md`](../../docs/CODE-STUDIO.md) — il prodotto com'è oggi.

---

# P0 — Dimostrare: collaudo desktop e rilascio v1

> **Criterio di uscita Fase 1 “Real IDE”:** *posso lavorare una giornata senza aprire un secondo IDE per funzioni base.*

**Setup comune:** Windows, `wails3 task dev` (CLI alla versione di `go.mod`), un progetto Go reale (più package, test, `go.mod` con dipendenze, repository Git con modifiche non committate), Task Manager aperto.

**Già verificato in automatico su Windows** (2026-09-29, Go 1.26.5, gopls v0.23.0, Delve 1.27.2), come copertura backend che non sostituisce le prove UI: stop dell'albero di processi, terminale ConPTY, debugger (breakpoint, step, variabili, evaluate, singolo test, attach, remoto, nessun `dlv`/`__debug_bin` orfano), navigazione gopls fra package, isolamento fra sessioni. Restano manuali le parti che richiedono la finestra reale o il Task Manager.

**Come si registra:** quando una prova passa, spuntarla qui e aggiungere una riga nel [registro](#registro-delle-sessioni-di-collaudo) in fondo alla sezione; spuntare poi i gate sbloccati.

## Prerequisito: un progetto di collaudo ripetibile  — *idea*

Oggi ogni sessione dipende da “un progetto Go reale” scelto al momento, quindi i risultati non sono confrontabili. Proposta: un piccolo servizio demo (`orders-service`: handler HTTP, un database, un topic Kafka, un `docker-compose.yml`, test e un benchmark) mantenuto nel repo sotto `workspaces/` o `docker/adomnia-lab/`. Serve a tre cose insieme: fixture di collaudo uguale per tutti, scenario del North Star e materiale per README/video (Wow #5). Va costruito prima della sessione 1; è piccolo e sblocca il resto.

- [ ] Servizio demo con route, SQL, topic Kafka, test, benchmark e compose; documentato in una pagina.

## Sessione 1 — Smoke base (Gate Fase 1) — *fare per prima*

Il minimo che sblocca la dichiarazione della Fase 1.

- [ ] **M1 — Flusso base**: apri il progetto, autorizza, modifica, salva, Build, Run con stdin, Stop e Restart.
- [ ] **M2 — Nessun processo orfano**: dopo Stop, chiusura sessione e chiusura app, in Task Manager non restano `go`, il programma, `gopls`, il linter o la shell del terminale.
- [ ] **M4 — Aspetto**: temi dark e light, finestra piccola e ridimensionata, stati loading/empty/error/running/stopped ben distinguibili.
- [ ] **M6 — Strumenti mancanti**: senza Go, installazione dall'IDE; senza gopls, linter o Delve, installazione dal menu Go; messaggi operativi chiari.
- [ ] **M15** — Da installazione pulita: apri, autorizza, modifica, salva, builda, esegui, invia stdin e ferma.
- [ ] **M16** — Crea un progetto nuovo, riaprilo dai recenti e ripristina la sessione.

## Sessione 2 — Run, terminale, test, debug (Gate Fase 4)

- [ ] **M3 — Terminale ConPTY nella finestra reale**: input, resize trascinando il pannello, uscita naturale (`exit`), chiusura del tab con un processo figlio attivo (es. `go run .`) e Task Manager pulito; output lungo con accenti ed emoji intatto. *(Il test automatico dell'output multibyte è solo POSIX.)*
- [ ] **M7 — Debugger dalla UI**: breakpoint, step, watch, Stop e chiusura progetto dalla finestra reale.
- [ ] **M11 — Go Tools**: `go vet`/`go generate`/`go mod why` producono output reale nella Run console e Stop non lascia orfani.
- [ ] **M20** — Terminale, test runner, benchmark, debugger e coverage su progetto reale.

## Sessione 3 — Intelligenza del codice e refactor (Gate Fase 2 + parte Fase 5)

- [ ] **M5 — Signature help** visibile mentre si scrive una chiamata.
- [ ] **M19** — Completion, diagnostica, definition, references, rename, import e formatting su buffer dirty.
- [ ] **M21** — Semantic highlighting, inlay hints, quick documentation, exit points e generazione metodi di interfaccia su codice reale.
- [ ] **M9 — Extract function** reale su codice multi-package: anteprima corretta e progetto che compila ancora.
- [ ] **M10 — Gutter I↓/I↑** su un'interfaccia con più implementazioni: una destinazione si apre subito, più destinazioni aprono il popup.
- [ ] **M32 — Menu contestuale Project**: su un file `.go`, il click destro espone e aziona Find Usages, Inspect Code, Refactor This, bookmark, Reformat, Optimize Imports, Run, Debug e Reload from Disk; su cartelle e file non-Go solo le azioni applicabili, senza voci finte. Refresh Folder / Project rilegge l'albero e lascia i buffer sporchi in Reload / Keep / Compare.

## Sessione 4 — Progetti, finestre, ripristino (Gate Fase 3)

- [ ] **M14 — Workspace Go Studio**: creazione, cambio e riavvio dell'app con due workspace e lo stesso progetto aperto in entrambi.
- [ ] **M17** — Due progetti contemporaneamente senza contaminazione di stato o output.
- [ ] **M18** — File modificato esternamente e conflitto dello stesso file tra sessioni.
- [ ] **M23** — Chiusura app con file dirty e processi attivi: compare il prompt (anche subito dopo l'avvio, ora che la guardia è lazy) e il cleanup è completo.
- [ ] **M29** — Nessuna azione eseguita implicitamente all'apertura o al ripristino.
- [ ] **M31 — Finestre separate (5.8)**: File → Open Project in New Window su un progetto senza modifiche; la nuova finestra ripristina i tab e mostra solo quel progetto; la principale mostra “is open in a separate window” con Show Window / Move Back Here; shortcut, Run, terminale e debugger funzionano nella finestra separata; chiudere con un file modificato chiede conferma e il progetto torna alla principale; chiudere adOmnia con una finestra separata modificata porta in primo piano quella finestra; Task Manager pulito. Superata la prova, dichiarare il supporto nelle note di rilascio.
- [ ] **Ripristino ultimo progetto attivo** (memoria locale per workspace; le finestre staccate non sovrascrivono la scelta principale): selezionare il secondo progetto, chiudere e riaprire adOmnia e verificare progetto/editor attivi. *(Test backend e build già passati.)*
- [ ] **Progetti multipli nella stessa istanza**: due progetti, API Workspace condiviso, navigazione handler, chiusura/rientro delle finestre. *(Open Project in New Window è anche nel menu progetto della toolbar.)*

## Sessione 5 — Barra di qualità e prestazioni (Gate “Barra di qualità”)

Misura l'uso reale per una giornata intera.

- [ ] **M8 — Mock e barra di qualità**: confronto con i due mock approvati (vedi [Riferimenti grafici](#riferimenti-grafici-approvati-per-m8)); fluido/veloce/moderno/stabile su un progetto di dimensioni reali; registrare le differenze intenzionali.
- [ ] **M24** — Navigazione completa da tastiera e focus visibile.
- [ ] **M25** — Contrasto, zoom, temi, densità e layout ridimensionato.
- [ ] **M26** — Coesione con rail, command palette, tab e Settings esistenti.
- [ ] **M27** — Prestazioni su progetto grande, output intenso e molte diagnostiche.
- [ ] **M22** — Assenza di rete e modulo privato/non raggiungibile senza blocco della UI.
- [ ] **M28** — Log, console e persistenza non contengono segreti.
- [ ] **M30** — Tutte le funzioni visibili sono reali e i limiti sono espliciti.
- [ ] **Monitor consumi e gopls** — RAM/CPU nell'app desktop confrontati con il monitor di sistema (incluse WebView e gopls); chiudere un progetto e verificare l'uscita del suo PID. *(Misura locale e test del ciclo di vita già passati.)*
  - [ ] Cinque minuti senza editor, poi riaprire un file: completamento, hover, diagnostica e refactoring tornano operativi.
  - [ ] Documenti dirty, finestre separate, stop manuale e autorizzazione revocata.
  - [ ] Monorepo/`go.work` con filtri o ambito ristretto: ricerca, diagnostiche e rename tra package; default conservati.
- [ ] **Benchmark su repository reali** e latenza UI/gopls: la baseline attuale (10/100/1000 file sintetici, 2026-10-11) è solo backend e non equivale a un monorepo reale.

## Sessione 6 — Integrazioni adOmnia e scenario North Star

- [ ] **Scenario North Star end-to-end** *(ricostruito: il testo originale della sezione era vuoto)*: sul progetto demo, scrivere/modificare un handler → Run → inviare la richiesta dall'API Workspace → pausa sul breakpoint → vedere SQL, messaggio Kafka, log e trace della stessa richiesta → Save reproduction → riaprire la reproduction. Tutto senza uscire dal workspace.
- [ ] **M12 — VCS**: gutter diff, revert di un hunk, blame e cronologia riflettono il repository reale; Git Sync senza regressioni.
- [ ] **M13 — Integrazioni adOmnia**: Project Services apre Docker Lab, Database Studio e Broker Studio già compilati; il CodeLens di una route apre la richiesta precompilata nell'API Client; gli eventi `onGoStudio*` compaiono in Plugin DevTools.
- [ ] **M33 — Vulnerabilities (govulncheck)** con rete verso vuln.go.dev: scan su un progetto con dipendenza vulnerabile nota; un finding *Called* mostra il percorso di chiamata, ogni passo apre il sorgente (progetto nell'editor; dipendenza e stdlib in sola lettura); *Upgrade…* mostra l'anteprima go.mod, chiede conferma ed esegue `go get`; un nuovo scan non riporta più il finding. In modalità Offline lo scan è bloccato con un messaggio chiaro.
- [ ] **M34 — Security → Code** su un progetto reale: scan offline e veloce; segreto mascherato; il finding si apre nell'editor; *Suppress with reason* è disabilitato senza motivazione, con motivazione scrive `.adomnia/security.json` e il finding sparisce; `// adomnia:security-ignore <rule>: <motivo>` lo sopprime anche spostando il codice; *Save baseline* nasconde i finding esistenti e ne compare uno nuovo; Ask Copilot apre la chat con il report.
- [ ] **Analyze failure (AI)**: eseguire un test fallito, selezionarlo e usare **Analyze failure**: bozza nella chat milk/Copilot con output, posizione e comando della run; nessuna chiamata AI prima di Send. Errore leggibile con policy `off`/`local-only` o file escluso e con cambio di progetto/test durante la preparazione. Invio esplicito a un provider configurato e verifica sul caso reale.
- [ ] **Why is this running?** (implementazione verificata con 2 test `goroutineWhy`): in Delve, confrontare route/consumer riconosciuti con request e messaggio reali, anche una goroutine figlia senza handler nello stack; verificare il tempo dalla prima osservazione (anche con attach; non presentarlo come tempo dalla creazione); ispezionare Context, WithCancel, WithTimeout, WithoutCancel (contesto illeggibile o catena troncata restano esplicitamente sconosciuti); cambiare goroutine e riprendere durante la lettura senza mostrare risultati di una pausa precedente.
- [ ] **Context a livello di riga** (verifica desktop aperta dal 2026-10-10): su `go worker()`, canali/lock reali delle goroutine create e navigazione al thread; in pausa su un errore, leggere il valore e risolvere Unwrap su richiesta, poi riprendere e verificare che i valori non restino visibili; da Trace Studio aprire Runtime context in gO (anche finestra separata, cancellando la selezione); valori opzionali del frame attivabili senza letture automatiche che eseguano codice del servizio.
- [ ] **Debug distribuito su due servizi Go strumentati**: armare da una trace, inviare request A → B, pausa/continua B e A, aprire stack e timeline nel progetto corretto; richieste concorrenti e arresto di un membro. Ripetere con Trace Studio e API Workspace staccati; disarmare il gruppo e verificare una normale request.
- [ ] **Passaggi enterprise dal Project tree**: WSDL, envelope SOAP non salvato, WS-Security e XML Tools (errori XML ed endpoint esplicito); `.jks/.p12/.pfx` con metadata e split JKS con password errata/corretta e tool assenti (nessuna promessa di estrazione PKCS12); PEM combinato cert+key per mTLS proposto, applicato e inviato al server di prova, con passphrase e percorso non valido.
- [ ] **Voci P2 rilasciate in 1.0.1 e mai esercitate**: dev container (`StartDevContainer` con la CLI `devcontainer` reale), generazione unit test da una route, retry → policy da un click, cache hit/miss in Runtime Lens (richiede span con `cache.hit` o `cache.result`), cattura goroutine e gRPC di una request.

## Sessione 7 — Piattaforme

- [ ] **Rendering font (Linux/WebKitGTK)**: stessi font, dimensioni, pesi e ligature confrontati con il browser sullo stesso schermo e scala, dark/light; testo fermo e in scrolling; allineamento cursore/selezione dopo cambio font; editor principale/split/separato. La rimozione del layer hinting non deve peggiorare lo scrolling di file grandi.
- [ ] **Scrolling dell'editor (Linux/WebKitGTK)**: su file lungo, inerzia Monaco con touchpad e mouse a scorrimento continuo, verticale e orizzontale; editor principale, split, finestra separata. Nessuna inerzia touchpad forzata sulla rotella a scatti. Cursore smooth in digitazione, frecce e click. Con «movimento ridotto» attivo/disattivo a editor aperto: niente animazioni, cursore fisso.
- [ ] **Monitor consumi** nativo su Linux e macOS.
- [ ] **macOS**: il pacchetto compila ma nulla è stato eseguito; dichiararlo supportato solo dopo una prova reale (sessioni 1 e 2 almeno).

## Sessione 8 — GitHub Copilot

Architettura: Copilot Language Server ufficiale per completamento, login ed enterprise; chat Ask presente. UI sempre adOmnia, nessuna estensione esterna. Regola: nessun componente assume `github.com`, tutto passa da `GitHubProfile`. **Fatto** (dettagli in git e `docs/CODE-STUDIO.md`): profili GitHub/GHE/GHES, impostazioni senza token con proxy e CA aziendale, installazione verificata del Language Server, crash recovery, device flow, sync documenti, ghost text, filtro segreti/`aiignore`, status bar e menu, chat Ask con contesto e streaming (`internal/copilot/chat.go`).

- [ ] **C1** — Install, enable, sign in su github.com, ghost text in un file Go, Tab/Esc.
- [ ] **C2** — Profilo `company.ghe.com`, sign in enterprise, progetto legato al profilo Work.
- [ ] **C3** — Proxy aziendale + CA bundle; kill di `copilot-language-server` e riavvio automatico.
- [ ] **C4** — Chat laterale (Ask) nella finestra Wails: contesto file/selezione/workspace, streaming, Stop.

## Gate (si spuntano quando le prove indicate sono passate e registrate)

| Gate | Prove richieste | Stato |
| --- | --- | --- |
| **Fase 1** — base end-to-end | M1, M2, M4, M6 (sessione 1) | [ ] |
| **Barra di qualità** — fluido, veloce, moderno, stabile, completo | M8, M24–M27 (sessione 5) | [ ] |
| **Fase 2** — intelligenza del codice | M5, M19, M21 (sessione 3) | [ ] |
| **Fase 3** — più progetti, ripristino, terminale | M3, M17, M18, M29 (sessioni 2 e 4) | [ ] |
| **Fase 4** — test runner, debugger, coverage | M7, M20 (sessione 2) | [ ] |
| **Fase 5** — parità funzionale, VCS, integrazioni | M9–M14, M31; nessuna funzione simulata → M30 | [ ] |
| **Finale** | Tutti i gate sopra, flussi M15–M30, nessuna regressione nota né processo orfano, `wails3 task dev` sulle piattaforme dichiarate | [ ] |

## Dopo le prove

- [ ] **Dichiarare le finestre separate** nel prodotto e nelle note di rilascio dopo M31 (oggi `docs/CODE-STUDIO.md` e `docs/ISSUES.md` le indicano come verificate solo in automatico).
- [ ] **Note di rilascio finali** con le piattaforme realmente verificate a mano e il supporto multiwindow reale.
- [ ] **Aggiornare i riferimenti ai vecchi M1–M31** in `docs/ISSUES.md`, `docs/CODE-STUDIO.md` e `CLAUDE.md` (ora M1–M34 in questo file).

## Riferimenti grafici approvati (per M8)

1. [Mock dell'ambiente Go Studio](<C:/Users/Andrea/Downloads/ChatGPT Image Sep 28, 2026, 06_16_11 AM.png>) — struttura, proporzioni e gerarchia dell'IDE. *Presente.*
2. [Mock identità “aO → gO”](<C:/Users/Andrea/Desktop/1d4ee52a-bc26-428f-aad5-299a7c917d5b.png>) — icona, stato `gO` e transizione di ~400 ms. ***Assente** dal 2026-10-11: va recuperato prima di dichiarare chiuso il confronto con entrambi i mock.*

- [ ] **Mettere i due mock nel repo** (es. `docs/assets/go-studio-mocks/`): oggi M8 dipende da file nelle cartelle personali di una sola macchina, uno dei quali è già andato perso. *(idea)*

Registrare nelle evidenze le differenze intenzionali rispetto ai mock.

## Registro delle sessioni di collaudo

Una riga per sessione. Il Gate Fase 1 si chiude solo con una sessione reale registrata qui.

| Data | Commit / release | Piattaforma | Go / gopls / Delve | Progetto | Prove passate | Esito | Note e differenze dai mock |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | ⬜ parziale | |

### Evidenze automatiche già registrate (non chiudono prove desktop)

- **Audit 2026-10-11:** duplicati obsoleti rimossi, conteggi ricalcolati; test di recupero dati/crash/kill durante snapshot e viste profiler/trace superati; benchmark offline apertura/ricerca su fixture 10/100/1000 file (risultati e limiti in `docs/GO-STUDIO-ACCEPTANCE-2026-10-11.md`).
- **Crash con 10 file dirty:** `TestKillDuringSnapshotWritesKeepsEveryBuffer` (kill reale, 10 buffer su due workspace integri) e `TestRecoveryLatencyWithTenDirtyFiles` (snapshot più lenta ~13 ms in locale e ~160 ms su CI Linux contro budget 500 ms, sotto il debounce di 750 ms; ripristino di 10 buffer ~6 ms).
- **Debug distribuito e passaggi enterprise (P2):** TypeScript, build frontend, suite frontend completa (312 file / 1363 test), check startup (~599 kB, limite 650 kB), test distribuiti backend, lettura keystore confinata al progetto; `go build ./...` e `go test ./... -timeout 10m` passati; build nativa Wails beta.28 e avvio riusciti (WebView2 e sidecar), senza interazioni manuali.
- **Monitor consumi/gopls:** misura locale RAM e delta CPU del processo reale (prima lettura CPU sconosciuta); test del ciclo di vita (stesso PID con avvii ripetuti, nessuna sospensione con editor aperto, timer obsoleto ignorato, riavvio dopo sospensione).
- **Why is this running?:** 2 test `goroutineWhy`, TypeScript e build frontend passati.
- **Ripristino ultimo progetto:** test di ripristino, isolamento workspace, progetto chiuso e storage indisponibile; build frontend e budget startup passati.
- **Altre:** verificata l'architettura delle finestre IDE (create da `app.Window` nella stessa applicazione, una finestra per sessione, backend condiviso).

---

# P1 — Chiudere le lacune reali

_Il vecchio piano le nascondeva come note “Parziale” dentro la sezione Riferimento. Sono lavoro vero e non dipendono dal collaudo, ma partono solo dopo il Gate Fase 1 (regola di congelamento). Ordinate per impatto sul flusso North Star._

## A. Unified local environment

> *Esiste:* Project Services, Docker Lab (`GoStudioProjectServicesDialog.tsx`) e Run → Start Workspace rilevano e avviano Compose + servizi Go in una compound condivisa. Dev container avviabile dal Run target.

- [ ] Vista unica con **health** di ogni servizio, **migrations**, **seed** e **log** insieme.
- [ ] _Idea:_ pulsante “reset to known state” (down + volumi + migrations + seed) per ripartire pulito prima di una reproduction.

## B. Reproduction Studio completo

> *Esiste:* **Save reproduction** (API Workspace e tab Request del debug) scrive `repro/<data>-<request>/` con README, `request.http`, test Go di regressione, `queries.sql`, fixture Kafka, `.env.example`, `logs.txt`, `stack.txt`, `config.md`, `trace.json`, `db/tables.md` (tabelle toccate e schema), `flags.md` e `docker-compose.yml`. Segreti rimossi, valori non deterministici elencati. Genera unit test dal handler.

- [ ] **Snapshot dei dati DB** rilevanti (oggi solo lo schema, non una copia dei dati) con ripristino.
- [ ] **Replay coordinato** di una sessione salvata, inclusi i messaggi broker (oggi si rinvia la request e Trace Studio carica `trace.json`).
- [ ] **Confronto tra sessioni** di reproduction.
- [ ] _Idea:_ **reproduction → test eseguibile in CI**: unire il test di regressione già generato con il compose e le fixture della cartella, così `go test ./repro/...` riproduce il bug senza adOmnia.

## C. Code → Everything: ogni passaggio navigabile verso il codice

- [ ] **Log → source** per ogni riga di log (oggi il Log Inspector risolve solo gli stack frame).
- [ ] **DB**: durate delle query correlate alla request (oggi SQL da log/proxy associato alla request, senza durate) e navigazione integrata allo schema.
- [ ] **Runtime Lens: DB timings e broker timings** sopra la riga di codice (oggi: chiamate, p50/p95, errori, cache hit/miss, costi CPU/allocazioni).
- [ ] SQL, Kafka e log si aprono solo nei rispettivi tool, non nell'editor alla riga che li ha generati.

## D. Kafka

- [ ] **Schema Registry** (oggi schemi Avro/JSON locali).
- [ ] Kafka watch oggi **solo plaintext e singolo servizio**: TLS/SASL, e watch dei messaggi tra più servizi.

## E. Benchmark e dipendenze

> *Esiste:* gutter ▶, benchmem, confronto con variazione %, storico, export CSV, baseline fissata, significatività statistica. Dependency Graph (versioni duplicate, licenze, peso, unused/indirect, govulncheck), Binary Inspector, “Why is this dependency here?”.

- [ ] **Profiling del singolo benchmark** (workflow dal gutter al profilo). *Da verificare nel codice: `internal/goide/pprof.go` e `profile_capture_test.go` toccano già i profili dei test.*
- [ ] Benchmark su checkout storici: oggi si confrontano misure archiviate per commit, non si esegue su revisioni passate.

## F. Definition of Done: lacune note

- [ ] **Toggle per ogni feature costosa**: oggi Low-Resource Mode disattiva solo highlighting, inlay e lint.
- [ ] Audit su tutti i pannelli di keyboard navigation, stato error/empty/loading e cancellazione (vedi checklist in P4).

---

# P2 — Effetti wow

Costruiscono sopra pezzi già esistenti: l'effetto nasce dal collegarli. Ordine consigliato: **#4** (impatto rapido, usa la matrice degli environment) → **#5** (vetrina per README e video; usa il progetto demo) → **#1 / #2** (unicità).

## Wow #4 — Collaudo contro Produzione dal vivo

La stessa richiesta parte in parallelo verso due fasi; si vedono diff semantico del JSON, header e tempi, e a richiesta il diff degli schemi DB.

- [ ] Azione “Compare stages” sulla richiesta: scelta di due environment, invio in parallelo.
- [ ] Diff semantico del JSON (campi mancanti, tipi, valori), di status, header e tempi.
- [ ] Diff dello schema DB tra due connessioni risolte con environment diversi.
- [ ] Campi volatili (id, timestamp) ignorabili, configurabili e salvati con la collection.
- [ ] Salva il confronto come asserzione o test di regressione.

**Base:** matrice e fasi degli environment, `{{VAR}}` in tutti i moduli, Database Studio, diff JSON. **Messaggio:** _“Works in test, fails in prod?” — answered in three seconds._

## Wow #5 — Mappa dei servizi che si accende

Premendo Send, sulla Service Map la richiesta viaggia tra servizi, topic e database con i tempi sulle frecce; il nodo che fallisce diventa rosso e apre il codice.

- [ ] Animazione degli span in arrivo, in ordine e con durata.
- [ ] Tempi e errori sulle frecce; nodo in errore evidenziato.
- [ ] Clic su nodo o freccia → codice del servizio (Architecture Explorer / handler).
- [ ] Modalità “demo”: replay animato di una trace salvata, esportabile come GIF o video per il README.

**Base:** Service Map, ricevitore OTLP locale, Trace Studio, Architecture Explorer. **Messaggio:** _Watch your request travel through your system._

## Wow #1 — Rewind della richiesta

Dopo Send, una timeline da trascinare mostra in ordine richiesta HTTP, riga del handler, query SQL, messaggi Kafka e log; si va avanti e indietro come in un video.

- [ ] Timeline unica per request run con eventi ordinati (HTTP, hit del handler, SQL, Kafka, log, span).
- [ ] Scrubber: ogni posizione apre la riga di codice e lo stato di quel momento.
- [ ] Rewind da una reproduction salvata (`repro/…`), non solo dall'ultima richiesta.
- [ ] Eventi multi-servizio legati dal `traceparent`.
- [ ] Export della timeline nella reproduction condivisibile.

**Base:** traceparent sulle live request, Trace Studio, Runtime Lens, Save reproduction, breakpoint Delve, debug distribuito. **Messaggio:** _Rewind any request through your whole system._

## Wow #2 — Ispeziona elemento → codice Go

Nel browser integrato, un clic su un elemento mostra la chiamata partita, apre il handler Go con il breakpoint e la query eseguita.

- [ ] Modalità “inspect” nel Browser Debug: clic → richieste XHR/fetch che scatena.
- [ ] Richiesta → route → handler Go nel progetto aperto (riuso del collegamento route → handler).
- [ ] “Break on this click”: breakpoint sul handler e sessione Delve pronta prima del clic successivo.
- [ ] Pannello unico: elemento DOM, richiesta, handler, SQL e log della stessa azione.

**Base:** debug via CDP, Live Development Session, route → handler, Code → API. **Messaggio:** _Click the UI, land on the Go line that answers it._

## Wow #3 — Stacca il backend in un clic

Dal traffico registrato dall'Interceptor, adOmnia genera mock server, OpenAPI, collection e test; passando l'environment a “Mock” il frontend continua a funzionare senza backend.

- [ ] Sessione di cattura nel Proxy con selezione degli endpoint da tenere.
- [ ] Generazione in un passo: mock (path parametrici), OpenAPI, collection, test di regressione.
- [ ] Environment/fase “Mock” creato in automatico con `base_url` sul mock.
- [ ] Rimozione di segreti e dati personali dai payload generati.
- [ ] Demo verificata: backend spento, frontend funzionante.

**Base:** Interceptor, Mock Control Room, import/export OpenAPI, fasi e matrice environment. **Messaggio:** _Unplug the backend. Nothing breaks._

## Nuove idee (2026-10-13), da valutare prima di avviarle

- **Self-check di accettazione** (Help → Go Studio → Self-check): esegue da solo ciò che è automatizzabile delle prove (strumenti presenti e versioni, nessun processo orfano dopo Stop — è esattamente M2 —, gopls vivo, permessi, storage scrivibile) e scrive una riga nel registro di collaudo. Riduce il lavoro manuale di sessione 1 e rende le evidenze confrontabili. Locale, nessuna rete.
- **Metriche locali di salute** (Diagnostics): trasforma i KPI tecnici di P4 (tempo al primo editor, primi diagnostics, latenza go-to-definition, riavvii gopls, fallimenti Delve) in un pannello con export per le segnalazioni di bug. Misurazione sulla macchina dell'utente, niente invio. Oggi esiste solo il contatore `Restarts` per sessione.
- **Bundle di diagnostica redatto**: un clic per raccogliere versioni, log e configurazione senza segreti (stesso filtro di Save reproduction), da allegare a una issue.
- **Etichette di goroutine con l'id della request** (`runtime/pprof` labels): taggare le goroutine create da una request permetterebbe di raggrupparle in Delve e nel profilo; da valutare sopra la cattura goroutine esistente, solo se non richiede di modificare il codice dell'utente.
- **Contratti dal confronto tra fasi**: il diff di Wow #4 può diventare un controllo ripetibile (stessa richiesta, due fasi, diff atteso) lanciabile da Flow Builder.

---

# P3 — Funzioni 2027 e Copilot Edit/Agent

_Da progettare: ognuna richiede prima un perimetro e criteri verificabili. Non bloccano nulla._

- [ ] **Automatic bug reproduction** (oltre Save reproduction manuale).
- [ ] **Performance regression detection oltre i benchmark**: definire baseline e criteri per profili, trace e runtime; correlare con modifiche del codice (oggi: confronto statistico e soglia sui benchmark).
- [ ] **Smart regression tests** (oggi solo lo starter di test per i race) e **Automatic reproducer**.
- [ ] **Smart refactoring multi-service** / multi-service refactoring assistance.
- [ ] **Continuous background code intelligence** locale.
- [ ] **Replay di richieste/eventi** (oltre la reproduction).
- [ ] **Time-travel debugging** dove tecnicamente possibile.
- [ ] **Runtime architecture** (architettura ricostruita dal runtime).
- [ ] **AI**: il sistema spiega perché suggerisce una correzione; le modifiche sono sempre previewabili (oggi diff nei refactor e nel Fix with AI, non universale); verifica con provider reali che l'AI usi informazioni vere di workspace e runtime e non sia “solo chat”.
- [ ] **Copilot — Edit mode** con diff (accept/reject per hunk, file, tutto).
- [ ] **Copilot — Agent mode** con Tool Registry adOmnia (workspace, go build/test/vet/fmt, git, terminal con CommandPolicy) e Permission Manager.
- [ ] **Copilot — tool aggiuntivi**: debugger (Delve), API Workspace, database (read-only di default), Kafka, SOAP/gRPC, log.
- [ ] **Copilot — governance**: context bar, context preview, audit locale dell'agent, policy per ambiente (LOCAL…PROD).
- [ ] **Adapter JS/TS**: proposta separata, successiva alla baseline Go collaudata.

## Idee per l'editor e l'AI (2026-10-15), da progettare

Raccolta di lacune verificate sul prodotto il 2026-10-15. Valgono la regola di congelamento (§1) e la ricetta *Add a language/IDE feature*: quello che è generico va in `internal/ide/*` e `components/ide`, non nell'adapter Go.

**Già presenti, da non rifare:** vim mode, agenti ACP (milk e Claude Code), collab Yjs, Extend Selection, sticky scroll, Structure (outline), blame, keymap predefinita, zen mode, dev container.

### Z1 — AI dell'IDE affidabile (ordine consigliato: Z1.1 → Z1.2 → Z1.3)

- [ ] **Z1.1 Revisione delle modifiche dell'agente.** A fine turno di milk o Claude Code si apre una vista con tutte le modifiche e accetti o rifiuti ogni hunk, ogni file o tutto. Oggi esiste solo Allow/Deny prima della scrittura. Usa lo stesso componente della voce *Copilot Edit mode* qui sopra: una sola vista di review per tutti gli agenti.
  - *Accettazione:* l'agente cambia 3 file, ne rifiuti uno e accetti un solo hunk di un altro. Sul disco resta esattamente quello che hai accettato, e il diff Git lo conferma.
  - *Parziale (2026-10-16):* codice presente. `internal/ide/agentreview` (baseline in memoria a inizio turno, confronto a fine turno, accetta/rifiuta per blocco, file e tutto, scrittura solo se il file è ancora quello mostrato), barra nella chat, dialog *Tools → Review Agent Changes…*, test Go e Vitest. Manca la prova desktop con un turno reale di Claude Code e di milk.
- [ ] **Z1.2 Checkpoint dell'agente.** Ogni messaggio dell'utente salva uno snapshot dei file del progetto toccati dall'agente. *Restore checkpoint* annulla tutto quello che è successo dopo. Il punto di partenza è Local History, da riusare.
  - *Accettazione:* dopo 3 turni ripristini il checkpoint del primo. I file tornano identici, i file creati dall'agente spariscono e quelli modificati a mano fuori dall'agente vengono segnalati, mai sovrascritti in silenzio.
- [ ] **Z1.3 MCP server passati agli agenti ACP.** Oggi `internal/milk/manager.go` invia `mcpServers: []`. Serve un elenco unico di server MCP configurati dall'utente, passato a ogni sessione ACP. Il valore aggiunto per adOmnia è esporre come MCP locali le collection API, il mock server, Kafka e il database in sola lettura. Rispetta la AI policy di progetto e `.adomnia/aiignore`, e non avvia nessun processo senza un'azione dell'utente.
  - *Accettazione:* Claude Code chiama una request di una collection tramite MCP e la risposta compare nella chat. Con la policy `off` il server non viene passato.
  - *Parziale (2026-10-16):* elenco unico (`acp-mcp-servers.json`) e server integrato `adomnia mcp` (collection e mock) presenti; il passaggio in `session/new` è stato corretto solo ora (prima partiva sempre vuoto). Mancano: milk (protocollo proprio, non accetta ancora `mcpServers`), controllo della AI policy prima di passare i server, tool per Kafka e database in sola lettura, prova desktop.
- [ ] **Z1.4 Rules file automatici.** `AGENTS.md`, `CLAUDE.md`, `.rules` e `.cursorrules` alla radice del progetto vengono inclusi nel contesto delle azioni AI e della chat. Un indicatore mostra quali file sono inclusi, con un toggle per escluderli. — **IMPLEMENTATO nelle chat, verifica desktop aperta (2026-10-16):** lettura root bounded/filtrata, toggle per provider e nomi nei messaggi; Copilot/milk/Claude usano il preparatore comune. Test Go privacy/limiti e test frontend preparazione/invio verdi; Z1.4.M1 in `MANUAL-CHECK.md`. Le azioni AI che aprono la chat ereditano le regole; le azioni dirette via AI gateway restano un percorso separato da allineare.
  - *Parziale (2026-10-16):* `internal/copilot/rules.go` e il toggle nelle chat (Agent e Copilot). Mancano le azioni AI dell'editor e la prova desktop.
- [ ] **Z1.5 Follow mode.** L'editor segue l'agente mentre modifica (file e riga). Il meccanismo dei cursori remoti del collab è riusabile.

### Z2 — Editor e workflow

- [ ] **Z2.1 Multibuffer.** Estratti di file diversi in un solo editor modificabile. I primi consumer sono Find in Files, References, Problems del progetto e la review di Z1.1. È il lavoro più grande (modello Monaco con estratti, mappatura delle righe, salvataggio verso i file d'origine), quindi va prima uno spike.
  - *Accettazione:* rinomini a mano 10 occorrenze in 6 file da un solo multibuffer di References. Il salvataggio scrive 6 file e l'undo funziona su tutti.
- [ ] **Z2.2 Task leggeri con variabili** (`.adomnia/tasks.json`, condivisibile via Git). Comandi shell con `${file}`, `${line}`, `${symbol}`, `${selection}` e `${projectRoot}`, lanciabili dal command palette e dal gutter, più *Rerun last task*. Sono indipendenti dal linguaggio e affiancano le Run Configurations senza sostituirle. Anche questi avviano processi, quindi solo con `AuthorizationPermitted`.
- [ ] **Z2.3 Inline Assistant** (Ctrl+Enter sulla selezione). Scrivi un'istruzione e ottieni il diff inline nell'editor, da accettare o scartare. Oggi le azioni AI preparano soltanto un prompt in chat. — **IMPLEMENTATO (2026-10-16); verifica manuale in `MANUAL-CHECK.md` GS-13 (M1…M6).** Comando `goStudio.ai.inlineAssistant` (Ctrl+Enter + menu contestuale), popup di istruzione ancorato alla selezione, diff inline con ✓/✗ per hunk e Accept all / Reject all; ogni accettazione è un edit non salvato e annullabile. Le 18 AI actions continuano a preparare il prompt in chat. Codice, test e docs: `mds/FIX.md` GS-13.
- [ ] **Z2.4 Messaggio di commit generato dall'AI.** Un pulsante nel Commit Dialog che riassume lo staged diff, con la stessa redazione dei segreti e le stesse policy delle azioni AI. — **IMPLEMENTATO (2026-10-16); verifica manuale in `MANUAL-CHECK.md` GS-14 (M1…M4).** Bottone *Draft message with AI* nel Commit Dialog (Ctrl+K): riassume il diff HEAD → working copy dei file spuntati e i simboli cambiati in un messaggio Conventional Commits, modificabile prima del commit. Segreti redatti (e mai ripristinati nel messaggio), `.adomnia/aiignore` senza contenuto, policy `off`/`local-only` rifiutate. Codice, test e docs: `mds/FIX.md` GS-14.
- [ ] **Z2.5 Stage e unstage di singoli hunk e righe** dal gutter e dall'hunk popup. — **IMPLEMENTATO (2026-10-16); verifica manuale in `MANUAL-CHECK.md` GS-15 (M1…M5).** L'hunk popup (clic sul gutter) ha Stage / Unstage del blocco — salvataggio del buffer prima di toccare l'index — e *Stage/Unstage single lines…* che apre la dialog per hunk e righe già pronta (`HunkStageDialog`, prima orfana); la stessa dialog è raggiungibile dalla riga del Git workbench con l'icona forbici. Solo `git apply --cached` sulle parti scelte; nessuna modifica Go (backend `FileDiff`/`ApplyHunk` già testato). Codice, test e docs: `mds/FIX.md` GS-15.
- [ ] **Z2.6 Settings e keymap in JSON con schema**, a livelli (utente, poi progetto `.adomnia/settings.json`) e con autocompletamento. Il keymap supporta contesti (per esempio `editor && vim.normal`). Va migrata la persistenza attuale nei loader, senza rompere nulla. — **IMPLEMENTATO (2026-10-16); verifica manuale in `MANUAL-CHECK.md` GS-16 (M1…M5).** `.adomnia/settings.json` (format/version, sezioni `editor` e `keymap`) con schema, autocompletamento e marker nell'editor, layering progetto → utente → `.editorconfig`; keymap con condizioni `when` (`&&`/`||`/`!`, termini `editor`, `input`, `terminal`, `vim.*`) e risoluzione a livelli con fall-through; migrazione v15 della chiave `adomnia.goide.keymap` nelle impostazioni (doppia scrittura per il rollback); nessuna modifica Go. Scelte dichiarate: il livello utente resta la persistenza attuale (form Settings + export JSON), le chiavi con effetto reale sono quelle dello schema. Codice, test e docs: `mds/FIX.md` GS-16.

### Z3 — Rifiniture di prodotto

- [ ] **Z3.1 Budget di velocità esplicito.** Per esempio apertura progetto sotto 1 s e primo editor sotto 300 ms su un progetto di collaudo, misurati in locale (si collega a *Metriche locali di salute* in P2).
- [ ] **Z3.2 Command palette** con ricerca fuzzy e ranking per uso recente, partendo dal registry di `goStudioCommands.ts`. — **IMPLEMENTATO (2026-10-16); verifica manuale in `MANUAL-CHECK.md` GS-17 (M1…M3).** Su Search Everywhere (Shift Shift): corrispondenza fuzzy graduata (prefisso > inizio parola > sottostringa > sottosequenza pesata per contiguità e inizi di parola) e boost per uso recente sui comandi eseguiti davvero (tasti, menu, palette), senza far apparire non-match. Codice, test e docs: `mds/FIX.md` GS-17.
- [ ] **Z3.3 Import dei temi esterni** (JSON) nei temi adOmnia, per rafforzare le skin importabili.
- [ ] **Z3.4 Edit prediction** (prossima modifica, non solo completamento) con un provider locale, per esempio Ollama, per restare local-first. Da valutare dopo il completamento Copilot esistente.

### Da non copiare

- **Rendering GPU (GPUI):** non applicabile con Wails e Monaco.
- **Collaborazione cloud e Channels:** contro il local-first. Il collab LAN con Yjs resta l'approccio giusto.
- **Remote development SSH con server headless:** costo alto, pochi utenti oggi.
- **Extension WASM:** esiste già un sistema di extension, un secondo runtime sarebbe over-engineering.

---

# P4 — Qualità continua (criteri, non lavoro a sé)

## Obiettivi di prodotto (si chiudono con i gate di P0)

- [ ] gO Studio può sostituire un IDE Go tradizionale per il lavoro quotidiano → Gate Fase 1 + Barra di qualità.
- [ ] Funziona su repository piccoli, monorepo e workspace multi-module → sessione 5 (oggi `go.work`, multi-modulo e folder mode; baseline sintetica 10/100/1000 file; monorepo reale da misurare).
- [ ] Usa i tool ufficiali Go (`go test`, `vet`, `list`, `tool`, `pprof`, `trace`, `govulncheck`, race) → sessioni 2 e 6 (viewer pprof/trace e govulncheck verificati nel codice e nei test).
- [ ] Rende visuali dati che oggi finiscono nel terminale → sessioni 2 e 6.
- [ ] Collega codice ↔ API ↔ DB ↔ broker ↔ runtime → scenario North Star (sessione 6).
- [ ] UX coerente con il resto di adOmnia → M8, M26.

## Exit criteria per fase (letti come domande di collaudo)

- [ ] Un bug concorrente è più facile da capire in gO che dal terminale (Concurrency View con diagnosi e race card; nessuna misura di usabilità).
- [ ] Una sessione di profiling porta dal dato alla riga di codice in pochi click.
- [ ] Benchmark prima/dopo leggibili senza tool esterni.
- [ ] Una richiesta può essere seguita dall'ingresso API al DB/broker (anche tra servizi: debug distribuito rilasciato, da collaudare).
- [ ] Un cambiamento mostra quali parti del sistema può impattare (Change Impact Analysis rilasciata).

## “Do not build badly”: da rileggere a ogni revisione

- [ ] Non creare un clone incompleto di un altro IDE.
- [ ] Non creare una chat AI gigante come feature principale.
- [ ] Non mostrare 20 pannelli contemporaneamente.
- [ ] Non riempire l'editor di badge.
- [ ] Non rendere Runtime Lens sempre acceso.
- [ ] Non introdurre astrazioni magiche impossibili da debuggare.

## Definition of Done per feature

Una feature gO è finita solo se: funziona su Windows (suite automatiche ok con gopls e Delve reali; manuale aperto), macOS (mai provato) e Linux (CI ok; manuale aperto); non blocca la UI; ha keyboard navigation, error / empty / loading state e cancellazione; ha log diagnostici e setting dedicati se servono; è disattivabile se costosa (parziale: Low-Resource Mode); funziona su repository medio/grande; ha test e documentazione minima; si integra visivamente con adOmnia e si collega alle altre aree quando utile.

## KPI tecnici (misura locale, nessuna telemetria)

Time to first usable editor · time to first diagnostics · time to first completion · workspace indexing time · memoria · CPU a riposo · latenza di ricerca · latenza di go-to-definition · debug startup latency · test discovery latency · performance su repository grande · sessioni senza crash · frequenza di riavvio di gopls (parziale: contatore `Restarts` per sessione e limite `maxCrashRestarts` in `internal/goide/lsp.go`, nessuna metrica aggregata) · tasso di fallimento di Delve. → vedi l'idea “Metriche locali di salute” in P2.

## KPI di prodotto (solo valutazione, mai raccolta automatica)

Proposte per sessioni locali di collaudo o studi volontari con consenso, con campione e protocollo dichiarati; non bloccano il rilascio. % utenti che usano gO senza altro IDE · % sessioni con Run / Debug / Test · % utenti che usano Code → API / DB / Kafka, Concurrency View, Runtime Lens, Distributed Debugger · % bug riprodotti con Reproduction Studio · tempo medio code → running · error → relevant source · request → root cause.

## Layout di riferimento

Riferimento visivo, non una voce operativa. Verifica di densità, focus, temi e finestre: M8, M24–M27, M31.

```text
┌───────────────────────────────────────────────────────────────────────┐
│                           gO STUDIO                                   │
├──────────────┬─────────────────────────────────────┬──────────────────┤
│ WORKSPACE    │               CODE                  │     CONTEXT      │
│ Files        │                                     │ API              │
│ Symbols      │                                     │ DB               │
│ Services     │                                     │ Kafka            │
│ Endpoints    │                                     │ Runtime          │
│ Tests        │                                     │ AI               │
│ Modules      │                                     │ Architecture     │
├──────────────┴─────────────────────────────────────┴──────────────────┤
│ RUN │ TEST │ DEBUG │ LOGS │ TERMINAL │ PROFILE │ TRACE │ PROBLEMS    │
└───────────────────────────────────────────────────────────────────────┘
```

---

# Archivio — già chiuso (la storia è in git, `CHANGELOG.md`, `docs/releases/`)

| Chiusura | Cosa |
| --- | --- |
| 2026-10-05 | P1: profiler, trace, sicurezza, Context Propagation Inspector (anche fra package, con grafo e trace ID runtime), Architecture Explorer, Documentation Intelligence. |
| 2026-10-06 | P0: crash con 10 file dirty (vedi evidenze automatiche). |
| 2026-10-07 | §34: le 18 azioni AI dell'editor (0.9.64). |
| 2026-10-10 | P3: adapter dei plugin con rilevamento vero (framework → route/handler, broker → topic, database → tabelle; rescan all'attivazione). §36 Semantic Workspace Graph. §37 Change Impact Analysis. §34 Runtime-Aware AI (grafo + quadro runtime del file attivo in ogni chat). §35 AI Debugging (Debug with AI con 7 azioni, race card, diff di heap profile). |
| 2026-10-11 | §38 Architectural Drift Detection (`.adomnia/architecture.json`, tab *Rules & drift*, confronto con branch/commit). §56 A–J: Live Dependency Heatmap, API Contract Drift, Event Contract Drift, Runtime Snapshot, “Why is this running?”, “Why is this dependency here?”, Binary Inspector, Startup Analyzer, Shutdown Analyzer, Go Memory Model Helper. P2: debug distribuito su 2–16 servizi, confini OTLP parent/child, sei passaggi enterprise dal Project tree (mTLS, JKS/PKCS12, SOAP, WSDL, XML, WS-Security). |
| 2026-10-12 (1.0.1) | Dev container, generazione unit test dai handler, cattura goroutine e gRPC della request, retry → policy, cache hit/miss in Runtime Lens; Reproduction Studio con `db/tables.md`, `flags.md`, `docker-compose.yml`. |

Limiti dichiarati in UI da “Why is this running?” e Startup Analyzer: la durata è un limite inferiore (prima pausa osservata); request/message indicano route/topic serviti, non la singola richiesta; il context è letto dai locali dei frame del progetto; connessioni e porta sono campionate dai socket ogni 100 ms (netstat su Windows può aggiungere ~0,5 s).
