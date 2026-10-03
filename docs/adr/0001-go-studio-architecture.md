# ADR 0001 — Architettura del Go Studio

- Stato: accettata per la Fase 0 · **superata (2026-10-03)** dall'architettura multi-language in [`docs/architecture/ide-multilanguage-refactor.md`](../architecture/ide-multilanguage-refactor.md)
- Data: 2026-09-28
- Ambito: nuova sezione Go Studio integrata in adOmnia

## Contesto verificato

Il runtime corrente è Go 1.26.5 su Windows/amd64, Wails 3 beta.25 e React 19 con TypeScript/Vite. Monaco 0.56 è già incluso nel bundle e configurato senza CDN. `gopls` e `dlv` non sono installati sulla macchina di verifica.

Il repository possiede già rail e command palette alimentati da `featureRegistry.ts`, routing lazy-loaded in `MainAreaRouter.tsx`, persistenza bbolt, dialog Wails, eventi applicativi e finestre secondarie. Le nuove API devono usare binding Wails 3 generati e wrapper frontend dedicati.

## Decisioni

### Confine del dominio

La logica appartiene a `internal/goide`. Il servizio root `GoIDE` si limita a collegare dialog ed eventi Wails e a delegare al dominio. Le responsabilità sono separate in file e manager per workspace, documenti, toolchain, processi, LSP, terminali, debugger, test e persistenza.

Ogni risorsa asincrona porta identificatori espliciti: `sessionId`, `documentId`, `runId`, `terminalId`, `lspRequestId` o `debugSessionId`. Gli eventi usano un envelope versione 1 con tipo, sessione, risorsa, sequenza e timestamp.

### Fiducia ed esecuzione

Una cartella aperta parte nello stato `opened`. Lo stato `tooling-permitted` richiede un gesto esplicito e separato. Aprire o ripristinare un progetto non avvia Go, gopls, Delve, terminali, test, hook o script del repository.

Tutti i processi non interattivi ricevono eseguibile e argomenti strutturati. Non si costruiscono comandi shell concatenando input dell'utente. I valori dell'environment non entrano nei log. I percorsi dei documenti vengono risolti anche attraverso symlink e devono restare sotto la root reale del progetto.

### Persistenza

I metadati Go Studio usano il bucket bbolt dedicato `goide`, chiave `state`, con schema JSON versionato. La versione 1 persiste soltanto metadati di progetto/sessione e consenso; non copia sorgenti, buffer o credenziali. Le migrazioni future devono leggere le versioni precedenti e rifiutare versioni future non comprese.

Questa scelta riusa il database locale e il lifecycle già esistenti, mantiene una transazione per aggiornamento e non espone un nuovo servizio di rete. localStorage è scartato per i metadati canonici perché ha limiti di capacità e ownership meno chiara.

### Monaco e documenti

Il frontend riusa `monacoSetup.ts`. Ogni modello avrà un URI stabile derivato da sessione e percorso reale; i view state resteranno separati. Il backend resta proprietario dell'accesso filesystem. Letture, scritture atomiche e watcher saranno confinati alla root del progetto.

### gopls e LSP

`gopls` sarà avviato come processo locale tramite stdio, senza porta di rete. Il client implementerà JSON-RPC/LSP con framing `Content-Length`, correlazione e cancellazione delle richieste, versioni documento monotone e conversione Monaco/LSP in UTF-16. I buffer non salvati saranno sincronizzati con `didOpen`, `didChange`, `didSave` e `didClose`.

L'ownership iniziale è un processo gopls per sessione IDE/Go workspace. Il manager deve poterlo riavviare e chiudere senza interferire con altre sessioni. La documentazione ufficiale conferma che gopls è il language server ufficiale e offre navigazione, completion, diagnostica, analisi e refactoring: <https://go.dev/gopls/> e <https://go.dev/gopls/features/>.

Non viene fissato oggi un numero di versione gopls: la compatibilità sarà verificata in Fase 2 contro la toolchain configurata, applicando la policy delle due release Go principali documentata dal progetto gopls.

### Terminale e PTY

xterm.js sarà solo il renderer frontend; non sostituisce shell o PTY. La documentazione ufficiale richiede il collegamento a un backend pseudoterminale: <https://github.com/xtermjs/xterm.js/>.

Su Windows l'adattatore userà ConPTY, disponibile da Windows 10 versione 1809 e capace di input/output UTF-8 e resize: <https://learn.microsoft.com/windows/console/pseudoconsoles> e <https://learn.microsoft.com/windows/console/ResizePseudoConsole>. Su sistemi Unix verrà usato un PTY nativo dietro la stessa interfaccia. La libreria Go concreta verrà scelta in Fase 3 dopo una prova di lifecycle, resize, cwd, environment e chiusura dell'albero processi; nessuna dipendenza PTY viene introdotta nel solo scheletro.

### Delve e DAP

Il debugger userà `dlv dap`, non un protocollo proprietario. Delve espone un server DAP single-use che supporta launch in modalità debug/test/exec e attach locale. La documentazione ufficiale indica DAP disponibile da Delve 1.6.1 e restart da 1.25.1: <https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md>.

Poiché DAP usa uno stream TCP, Delve ascolterà soltanto su `127.0.0.1:0`, con controllo same-user predefinito, porta effimera e processo posseduto dalla sessione. Nessun listener sopravvive al debug. La versione minima operativa verrà fissata in Fase 4 in base alle capability realmente implementate; se si include Restart sarà almeno 1.25.1.

### Processi e limiti

Il manager possiede tutti i processi figli. Windows crea un nuovo process group e usa un arresto dell'intero albero; Unix usa un process group separato. I limiti iniziali sono 4 MiB per console, 256 eventi output pendenti, 128 richieste LSP pendenti e 10.000 righe di scrollback terminale. Questi valori saranno configurabili soltanto se emergerà un caso d'uso reale.

### Finestre Wails

Wails 3 supporta più `WebviewWindow` e comunicazione tramite eventi: <https://v3alpha.wails.io/features/windows/basics/>. Il repository usa già finestre secondarie per richieste e Swagger. Questo dimostra la disponibilità dell'API, non l'affidabilità di una finestra Go Studio con documenti dirty e risorse backend condivise.

La prima implementazione usa sessioni interne nella finestra principale. Una finestra separata rimane disabilitata finché la Fase 4 non verifica ownership, focus, shortcut, sincronizzazione, conflitti e cleanup su ogni piattaforma dichiarata. L'app resta single-instance perché bbolt ha ownership esclusiva del file.

## Alternative scartate

- LSP o semantica simulati con regex: non comprendono davvero Go e non rispettano buffer/versioni.
- Compilatore o debugger proprietari: duplicano toolchain ufficiali e aumentano rischio e manutenzione.
- Un unico componente React o file Go: rende impossibile isolare lifecycle e testare le risorse.
- Sidecar HTTP generale per LSP: aggiunge superficie locale senza necessità; stdio è sufficiente.
- Persistenza canonica in localStorage: limiti di capacità e transazioni meno robuste.
- Abilitare subito multiwindow: l'API esiste, ma il flusso Go Studio non è ancora verificato.

## Conseguenze

L'architettura richiede più tipi e manager fin dall'inizio, ma consente di implementare le fasi successive senza spostare ownership o mischiare output fra progetti. Le capability esposte al frontend devono essere conservative: una funzione diventa visibile solo quando il relativo flusso è reale e collaudato.
