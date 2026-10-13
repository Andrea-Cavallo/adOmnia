# TODO — Go Studio integrato in adOmnia

Questo file raccoglie il collaudo ancora aperto e conserva le evidenze automatiche già registrate. Allineamento documentale: 2026-10-11; nessuna nuova prova desktop eseguita in questo aggiornamento. Le 347 voci completate delle Fasi 0–5 sono state rimosse il 2026-09-29: la loro storia è in git, nel `CHANGELOG.md`, nelle note di rilascio `docs/releases/v0.9.35.md`–`v0.9.38.md` e nella guida [`docs/GO-STUDIO.md`](../docs/GO-STUDIO.md), che documenta il prodotto com'è oggi.

## Documenti collegati

- [Piano 2027](gO-Studio-2027-todo.md): funzionalità residue e obiettivi; P0/P1 chiusi non chiudono i gate manuali qui sotto.
- [Audit di accettazione](../docs/GO-STUDIO-ACCEPTANCE-2026-10-11.md): risultati automatici e limiti della baseline sintetica.
- [Perimetro v1](V1-RELEASE-SCOPE-TODO.md): gate di pubblicazione e piattaforme realmente collaudate.

Le prove numerate correnti sono M1–M34; i blocchi successivi coprono anche risorse, runtime, ripristino e multiwindow. Una prova specifica già registrata non chiude automaticamente un intero gate.

## Stato

- **Implementato e coperto da test automatici**: Fasi 0–5, comprese le finestre separate (5.8), Fix with AI e le icone dei file. Le evidenze storiche includono suite Go (`-race`, gopls e Delve reali) e frontend su Windows, e CI Linux; non attestano automaticamente il working tree corrente.
- **Documentazione**: completata il 2026-09-29 (README, catalogo funzioni, ISSUES, ARCHITECTURE, CLAUDE.md e `docs/GO-STUDIO.md` con persistenza, dipendenze, versioni, scorciatoie e modello di sicurezza).
- **Manca**: le prove manuali nell'app avviata (sotto) e, dopo di queste, la chiusura dei gate e la dichiarazione delle finestre separate nelle note di rilascio. Per il criterio di uscita della **Fase 1 “Real IDE”** vedi il blocco dedicato più sotto.

---

# ▶ FASE 1 — “REAL IDE” (exit criteria)

> **Criterio di uscita:** *Posso lavorare una giornata senza aprire un secondo IDE per funzioni base.*

Stato: **parziale**. Le funzioni base esistono e sono coperte da test automatici (Fasi 0–5); manca la verifica manuale nell'app avviata. La chiusura del criterio dipende dalle prove raccolte più sotto:

| Blocco | Prove | Cosa sblocca |
| --- | --- | --- |
| Base end-to-end (minimo per dichiarare la fase) | M1, M2, M4, M6 | Gate Fase 1 |
| Barra di qualità (una giornata intera senza secondo IDE) | M8, M24–M27 | Gate finale |
| Flussi quotidiani su progetto reale | M15–M30 | Gate finale |
| Intelligenza, test/debug, VCS, integrazioni | M5, M9–M14, M19–M21, M31, M32 | Gate Fasi 2–5 |
| Piattaforme | Rendering font e scrolling su Linux/WebKitGTK; verifica su macOS | Dichiarazione piattaforme |
| AI (P4) e Copilot | P4, C1–C4 | Roadmap Copilot |

**Cosa manca, in ordine di priorità per chiudere la Fase 1:**

1. **M1, M2, M4, M6** — base end-to-end su un progetto Go reale: flusso apri → autorizza → modifica → salva → Build → Run con stdin → Stop/Restart; nessun processo orfano; aspetto dark/light; installazione strumenti mancanti dal menu. È il minimo che sblocca il **Gate Fase 1**.
2. **M8** — confronto con i due mock approvati e verifica fluido/veloce/moderno/stabile su un progetto di dimensioni reali. Senza questo, il criterio “una giornata intera” non è dimostrato.
3. **M24–M27, M15–M30** — navigazione da tastiera, contrasto/zoom/temi/densità, coesione con rail e command palette, prestazioni su progetto grande: sono le prove che misurano l'uso reale per una giornata.
4. **M5, M9–M14, M19–M21, M31, M32** — intelligenza del codice, refactor, test/debug, VCS e integrazioni adOmnia: necessarie per non dover aprire un secondo IDE sulle attività non banali.
5. **Piattaforme** — rendering font e scrolling su Linux/WebKitGTK e verifica reale su macOS, se la fase va dichiarata su quelle piattaforme (su Windows le suite automatiche passano).

Finché queste caselle non sono spuntate con un'evidenza registrata, la Fase 1 resta **parziale** e la dichiarazione nelle note di rilascio è rinviata. La sessione di collaudo va registrata nel **registro del criterio di uscita**, sotto `## Evidenze`.

---

# ▶ PROVE MANUALI DA FARE

### P4 — Analisi AI dei test falliti

- [ ] Nell'app desktop, eseguire un test fallito, selezionarlo e usare **Analyze failure**: bozza nella chat milk/Copilot con output, posizione e comando della run; nessuna chiamata AI prima di Send. Controllare errore leggibile con policy `off`/`local-only` o file escluso e cambio di progetto/test durante la preparazione. Inviare esplicitamente a un provider configurato e verificare la risposta sul caso reale.

Quando una prova passa: spuntala qui, registra l'esito nelle **Evidenze** in fondo e spunta i gate che sblocca.

**Setup**: Windows, `wails3 task dev` (CLI `wails3` alla versione di `go.mod`), un progetto Go reale (più package, test, `go.mod` con dipendenze, repository Git con modifiche non committate), Task Manager aperto.

**Già verificato in automatico su Windows** (2026-09-29, Go 1.26.5, gopls v0.23.0, Delve 1.27.2), come copertura backend, senza sostituire le prove UI M2, M3 e M7: stop dell'albero di processi, terminale ConPTY, debugger (breakpoint, step, variabili, evaluate, singolo test, attach, remoto, nessun `dlv`/`__debug_bin` orfano), navigazione gopls verso altri package, isolamento fra sessioni. Restano manuali solo le parti che richiedono la finestra reale o il Task Manager.

### Rendering font (Linux/WebKitGTK)

- [ ] Confrontare gli stessi font, dimensioni, pesi e ligature con il browser sullo stesso schermo e scala, in dark/light; verificare testo fermo e in scrolling, allineamento cursore/selezione dopo cambio font, editor principale/split/separato. Verificare che la rimozione del layer hinting non peggiori lo scrolling di file grandi.

### Scrolling dell'editor (Linux/WebKitGTK)

- [ ] Su un file lungo, verificare l'inerzia Monaco con touchpad e mouse a scorrimento continuo, verticale e orizzontale; provare editor principale, split e finestra separata. Nessuna inerzia touchpad forzata sulla rotella a scatti. Verificare anche movimento e lampeggio smooth del cursore durante digitazione, navigazione con frecce e click. Attivare/disattivare «movimento ridotto» a editor aperto: scrolling e cursore senza animazioni, cursore fisso.

### A. Collaudo Fasi 1–4 (sblocca i gate 1, 2, 3 e 4)

- [ ] **M1 — Flusso base**: apri il progetto, autorizza, modifica, salva, Build, Run con stdin, Stop e Restart. *(Fase 1)*
- [ ] **M2 — Nessun processo orfano**: dopo Stop, chiusura sessione e chiusura app, in Task Manager non restano `go`, il programma, `gopls`, il linter o la shell del terminale. *(Fasi 1–3)*
- [ ] **M3 — Terminale ConPTY nella finestra reale**: input, resize trascinando il pannello, uscita naturale (`exit`), chiusura del tab con un processo figlio attivo (es. `go run .` nella shell) e Task Manager pulito; output lungo con accenti ed emoji mostrato intatto. *(Fase 3; il test automatico dell'output multibyte è solo POSIX)*
- [ ] **M4 — Aspetto**: temi dark e light, finestra piccola e ridimensionata, stati loading/empty/error/running/stopped ben distinguibili. *(Fase 1, 1.5)*
- [ ] **M5 — Signature help** visibile mentre si scrive una chiamata. *(Fase 2)*
- [ ] **M6 — Strumenti mancanti**: senza Go, installazione dall'IDE; senza gopls, linter o Delve, installazione dal menu Go; messaggi operativi chiari. *(Fasi 1–2, collaudo finale)*
- [ ] **M7 — Debugger dalla UI**: breakpoint, step, watch, Stop e chiusura progetto dalla finestra reale. *(Fase 4; l'assenza di `dlv`/`__debug_bin` orfani dopo Stop è ora verificata in automatico su Windows)*
- [ ] **M8 — Mock e barra di qualità**: confronto con i due mock approvati e verifica fluido/veloce/moderno/stabile su un progetto di dimensioni reali; registrare differenze intenzionali. *(tutte le fasi)*

### B. Collaudo Fase 5 (sblocca il gate 5)

- [ ] **M9 — Extract function** reale su codice multi-package: anteprima corretta e progetto che compila ancora.
- [ ] **M10 — Gutter I↓/I↑** su un'interfaccia con più implementazioni: una destinazione si apre subito, più destinazioni aprono il popup.
- [ ] **M11 — Go Tools**: `go vet`/`go generate`/`go mod why` producono output reale nella Run console e Stop non lascia orfani.
- [ ] **M12 — VCS**: gutter diff, revert di un hunk, blame e cronologia riflettono il repository reale; Git Sync senza regressioni.
- [ ] **M13 — Integrazioni adOmnia**: Project Services apre Docker Lab, Database Studio e Broker Studio già compilati; il CodeLens di una route apre la richiesta precompilata nell'API Client; gli eventi `onGoStudio*` compaiono in Plugin DevTools.
- [ ] **M14 — Workspace Go Studio**: creazione, cambio e riavvio dell'app con due workspace e lo stesso progetto aperto in entrambi.
- [ ] **M31 — Finestre separate (5.8)**: File → Open Project in New Window su un progetto senza modifiche; la finestra nuova ripristina i tab e mostra solo quel progetto; la principale mostra "is open in a separate window" con Show Window / Move Back Here; shortcut, Run, terminale e debugger funzionano nella finestra separata; chiudere la finestra con un file modificato chiede conferma e il progetto torna alla principale; chiudere adOmnia con una finestra separata modificata porta in primo piano quella finestra; Task Manager pulito dopo la chiusura. Superata la prova, dichiarare il supporto nelle note di rilascio.
- [ ] **M32 — Menu contestuale Project**: su un file `.go`, il click destro espone e aziona Find Usages, Inspect Code, Refactor This, bookmark, Reformat, Optimize Imports, Run, Debug e Reload from Disk; su cartelle e file non-Go restano solo le azioni applicabili, senza voci finte. Refresh Folder / Project deve rileggere l'albero e lasciare i buffer sporchi in Reload / Keep / Compare.

### C. Collaudo finale (flussi completi e qualità prodotto)

- [ ] **M15** — Da installazione pulita: apri, autorizza, modifica, salva, builda, esegui, invia stdin e ferma.
- [ ] **M16** — Crea un progetto nuovo, riaprilo dai recenti e ripristina la sessione.
- [ ] **M17** — Due progetti contemporaneamente senza contaminazione di stato o output.
- [ ] **M18** — File modificato esternamente e conflitto dello stesso file tra sessioni.
- [ ] **M19** — Completion, diagnostica, definition, references, rename, import e formatting su buffer dirty.
- [ ] **M20** — Terminale, test runner, benchmark, debugger e coverage su progetto reale.
- [ ] **M21** — Semantic highlighting, inlay hints, quick documentation, exit points e generazione metodi di interfaccia su codice reale.
- [ ] **M22** — Assenza di rete e modulo privato/non raggiungibile senza blocco della UI.
- [ ] **M23** — Chiusura app con file dirty e processi attivi: compare il prompt (anche subito dopo l'avvio, ora che la guardia è caricata in modo lazy) e il cleanup è completo.
- [ ] **M24** — Navigazione completa da tastiera e focus visibile.
- [ ] **M25** — Contrasto, zoom, temi, densità e layout ridimensionato.
- [ ] **M26** — Coesione con rail, command palette, tab e Settings esistenti.
- [ ] **M27** — Prestazioni su progetto grande, output intenso e molte diagnostiche.
- [ ] **M28** — Log, console e persistenza non contengono segreti.
- [ ] **M29** — Nessuna azione eseguita implicitamente all'apertura o al ripristino.
- [ ] **M30** — Tutte le funzioni visibili sono reali e i limiti sono espliciti.
- [ ] **M33** — Vulnerabilities (govulncheck) con rete verso vuln.go.dev: scan su un progetto con una dipendenza vulnerabile nota; un finding *Called* mostra il percorso di chiamata, ogni passo apre il sorgente (progetto nell'editor, dipendenza e stdlib in sola lettura); *Upgrade…* mostra l'anteprima go.mod, chiede conferma ed esegue `go get`; un nuovo scan non riporta più il finding. In modalità Offline lo scan viene bloccato con un messaggio chiaro.
- [ ] **M34** — Security → Code su un progetto reale: lo scan è offline e veloce; un segreto è mascherato; un finding si apre nell'editor; *Suppress with reason* senza motivazione è disabilitato, con motivazione scrive `.adomnia/security.json` e il finding sparisce; un commento `// adomnia:security-ignore <rule>: <motivo>` lo sopprime anche dopo aver spostato il codice; *Save baseline* nasconde i finding esistenti e uno nuovo compare; Ask Copilot apre la chat con il report.

---

# ▶ GATE DA CHIUDERE (dopo le prove manuali)

Ogni gate si spunta quando tutte le prove indicate sono passate e registrate nelle Evidenze.

- [ ] **Barra di qualità** (fluido, veloce, moderno, stabile alla percezione, completo come IDE Go) verificata su un progetto reale → M8, M24–M27.
- [ ] **Gate Fase 1** — base end-to-end → M1, M2, M4, M6.
- [ ] **Gate Fase 2** — intelligenza del codice → M5, M19, M21.
- [ ] **Gate Fase 3** — più progetti, ripristino, terminale → M3, M17, M18, M29.
- [ ] **Gate Fase 4** — test runner, debugger, coverage → M7, M20.
- [ ] **Gate Fase 5** — parità GoLand, VCS, integrazioni → M9–M14, M31; nessuna funzione di parità simulata → M30.
- [ ] **Gate finale** — tutti i gate precedenti spuntati con evidenze, flussi completi M15–M30 passati, nessuna regressione nota né processi orfani, `wails3 task dev` provato sulle piattaforme dichiarate.

# ▶ ANCORA DA FARE DOPO LE PROVE

- [ ] **Dichiarare le finestre separate** nel prodotto e nelle note di rilascio, dopo M31 (oggi `docs/GO-STUDIO.md` e `docs/ISSUES.md` le indicano come verificate solo in automatico).
- [ ] **Note di rilascio finali** con le piattaforme realmente verificate a mano e il supporto multiwindow reale.
- [ ] **Verifica su macOS**: il pacchetto compila, ma nulla è stato eseguito su macOS; dichiararlo supportato solo dopo una prova reale.

---

---

# ▶ GITHUB COPILOT — ROADMAP

Architettura: Copilot Language Server ufficiale per completamento, login ed enterprise; chat Ask già presente. Edit/Agent e relativa integrazione ACP/SDK restano nella roadmap sotto. UI sempre adOmnia, nessuna estensione VS Code. Regola: nessun componente assume `github.com`; tutto passa da `GitHubProfile`.

**Fatto** (dettagli in git e `docs/GO-STUDIO.md`): profili GitHub/GHE/GHES, impostazioni senza token con proxy e CA aziendale, installazione verificata del Language Server, ciclo di vita con crash recovery, login device flow, sync documenti, ghost text, filtro segreti/`aiignore`, status bar e menu; chat laterale Ask con contesto e streaming (`internal/copilot/chat.go`).

**Prove manuali**
- [ ] **C1** — Install, enable, sign in su github.com, ghost text in un file Go, Tab/Esc
- [ ] **C2** — Profilo `company.ghe.com`, sign in enterprise, progetto legato al profilo Work
- [ ] **C3** — Proxy aziendale + CA bundle; kill del processo `copilot-language-server` e riavvio automatico
- [ ] **C4** — Chat laterale (Ask) nella finestra Wails: contesto file/selezione/workspace, streaming, Stop

**Prossime fasi**
- [ ] Edit mode con diff (accept/reject hunk, file, tutto)
- [ ] Agent mode con Tool Registry adOmnia (workspace, go build/test/vet/fmt, git, terminal con CommandPolicy) e Permission Manager
- [ ] Tool debugger (Delve), API Workspace, database (read-only di default), Kafka, SOAP/gRPC, log
- [ ] Context bar, context preview, audit locale dell'agent, policy per ambiente (LOCAL…PROD)

## Regole

- Spuntare una voce solo quando è verificata davvero; se una verifica fallisce, riaprire la prova e il gate relativo.
- Non mostrare funzioni simulate: ciò che non è implementato resta assente o dichiarato.
- Dati sempre in locale, niente telemetria, nessun codice del progetto eseguito senza un'azione esplicita dell'utente.
- Nuove funzioni: seguire la ricetta *Add a Go Studio feature* in `CLAUDE.md` e aggiornare `docs/GO-STUDIO.md`.

## Riferimenti grafici approvati (per M8)

1. [Mock dell'ambiente Go Studio](<C:/Users/Andrea/Downloads/ChatGPT Image Sep 28, 2026, 06_16_11 AM.png>) — struttura, proporzioni e gerarchia dell'IDE.
2. [Mock identità “aO → gO”](<C:/Users/Andrea/Desktop/1d4ee52a-bc26-428f-aad5-299a7c917d5b.png>) — icona, stato `gO` e transizione di circa 400 ms.

Registrare nelle evidenze le differenze intenzionali rispetto ai mock.

## Evidenze

### Fase 1 — “Real IDE”: registro del criterio di uscita

Criterio: *posso lavorare una giornata senza aprire un secondo IDE per funzioni base.*
Si spunta solo quando le prove minime (M1, M2, M4, M6) e la barra di qualità (M8, M24–M27) sono passate e registrate qui sotto con una sessione reale di collaudo.

| Data | Piattaforma | Progetto usato | Prove passate | Esito | Note (differenze dai mock / blocchi) |
| --- | --- | --- | --- | --- | --- |
| | | | | ⬜ parziale | |

### Monitor consumi e gopls (2026-10-11)

- [x] Misurazione locale RAM e delta CPU del processo reale; prima lettura CPU sconosciuta.
- [x] Test lifecycle: stesso PID con avvii ripetuti, nessuna sospensione con editor aperto, timer obsoleto ignorato, riavvio dopo sospensione.
- [ ] Nell'app desktop confrontare RAM/CPU con il monitor di sistema, inclusi WebView e gopls; chiudere un progetto e verificare l'uscita del suo PID.
- [ ] Attendere cinque minuti senza editor e riaprire un file: completamento, hover, diagnostica e refactoring devono tornare operativi.
- [ ] Verificare documenti dirty, finestre separate, stop manuale e autorizzazione revocata.
- [ ] Con filtri o ambito ristretto, collaudare monorepo/go.work: ricerca, diagnostiche e rename tra package. Default conservati.
- [ ] Verifica nativa del monitor su Linux e macOS.


### P4 — Why is this running? (2026-10-11)

- [x] Verifica automatica della prima implementazione: 2 test `goroutineWhy`, TypeScript e build frontend passati.
- [ ] In Delve, confrontare route/consumer riconosciuti con request e messaggio reali; provare una goroutine figlia senza handler nello stack.
- [ ] Verificare il tempo dalla prima osservazione, anche con attach; evitare di presentarlo come tempo dalla creazione.
- [ ] Ispezionare Context, WithCancel, WithTimeout e WithoutCancel; un contesto illeggibile o una catena troncata devono restare esplicitamente sconosciuti.
- [ ] Cambiare goroutine e riprendere durante la lettura: non mostrare risultati di una pausa precedente.

### P2 Context — verifica desktop ancora aperta (2026-10-10)

- [ ] Su una riga `go worker()`, verificare i canali/lock reali delle goroutine create e la navigazione al thread.
- [ ] In pausa su un errore, leggere il valore e risolvere Unwrap su richiesta; riprendere e verificare che i valori della pausa non restino visibili.
- [ ] Da Trace Studio aprire Runtime context in gO sul progetto del servizio; provare anche una finestra separata e cancellare la selezione.
- [ ] Attivare/disattivare i valori opzionali del frame; nessuna lettura automatica che esegue codice del servizio.

Da compilare man mano che passano le prove (una riga per sessione di collaudo).

| Data | Commit / release | Piattaforma | Versioni Go / gopls / Delve | Progetto usato | Prove passate | Note e differenze dai mock |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

### Ripristino ultimo progetto attivo (2026-10-11)
- [x] Memoria locale del progetto selezionato per workspace, senza modifiche al formato workspace. Finestre staccate non sovrascrivono la scelta principale.
- [x] Test ripristino, isolamento workspace, progetto chiuso e storage indisponibile; build frontend e budget startup passati.
- [ ] Smoke desktop: selezionare il secondo progetto, chiudere e riaprire adOmnia e verificare progetto/editor attivi.

### Progetti multipli nella stessa istanza adOmnia
- [x] Verificata architettura: finestre IDE create da app.Window nella stessa applicazione, con una finestra per sessione e backend condiviso.
- [x] Azione Open Project in New Window esposta anche nel menu del progetto della toolbar; riusa il controllo dei buffer non salvati.
- [ ] Smoke desktop con due progetti, API Workspace condiviso, navigazione handler e chiusura/rientro delle finestre.

### Audit, recovery e baseline prestazioni 2026-10-11
- [x] Audit Riferimento: rimossi duplicati obsoleti verificati, conteggi ricalcolati e affermazioni profiler/trace/govulncheck aggiornate.
- [x] Test recupero dati/crash/kill durante snapshot e viste profiler/trace superati.
- [x] Benchmark offline apertura/ricerca su fixture 10/100/1000 file con risultati e limiti in docs/GO-STUDIO-ACCEPTANCE-2026-10-11.md.
- [ ] Collaudo interattivo desktop e benchmark repository reali/UI/gopls: non equivalgono ai test backend, restano aperti.

## Integrità dei riferimenti — 2026-10-11

Il secondo mock approvato punta al file locale `C:/Users/Andrea/Desktop/1d4ee52a-bc26-428f-aad5-299a7c917d5b.png`, oggi assente. Il collegamento storico è conservato; M8 resta aperto e il riferimento va recuperato prima di dichiarare concluso il confronto con entrambi i mock. Il primo riferimento in Downloads è presente.


## P2 — chiusura delle otto integrazioni parziali (2026-10-11)

Implementati debug distribuito su 2–16 servizi con origine del breakpoint/goroutine, confini parent/child acquisiti via OTLP e sei handoff enterprise dal Project tree (mTLS, JKS/PKCS12, SOAP, WSDL, XML, WS-Security). Il gruppo è transitorio, condiviso tra pannelli, e non modifica il formato workspace.

Evidenze: TypeScript, build frontend, suite frontend completa (312 file / 1363 test), check startup (~599 kB, limite 650 kB), test distribuiti backend e lettura keystore confinata al progetto. Build nativa Wails beta.28 e avvio riusciti (WebView2 e sidecar), senza attestare interazioni manuali.

- [ ] Su due servizi Go strumentati: arma da una trace, invia request A → B, pausa/continua B e A, apri stack e timeline nel progetto corretto; prova richieste concorrenti e arresto di un membro.
- [ ] Ripeti tra Trace Studio e API Workspace staccati; disarma il gruppo e verifica una normale request.
- [ ] Apri WSDL, envelope SOAP non salvato, WS-Security e XML Tools dal Project tree; prova errori XML e endpoint esplicito.
- [ ] Apri .jks/.p12/.pfx; controlla metadata e split JKS con password errata/corretta e tool assenti; nessuna promessa di estrazione PKCS12.
- [ ] Proponi e applica PEM combinato cert+key per mTLS, invia al server di prova; verifica passphrase e percorso non valido.

Verifica finale: `go build ./...` e `go test ./... -timeout 10m` passati; frontend 312 file / 1363 test, TypeScript e build passati; startup 599359 byte.
