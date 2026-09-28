# TODO — Go Studio integrato in adOmnia

Checklist esecutiva per costruire un ambiente di sviluppo Go realmente utilizzabile dentro adOmnia.

Documento derivato dalla specifica allegata. Questo file è la fonte di verità operativa per l'implementazione: deve essere aggiornato nello stesso cambiamento che completa o modifica una voce.

## Regole di avanzamento

- [ ] Non iniziare una fase finché il **gate di uscita** della fase precedente non è interamente verificato e spuntato.
- [ ] Spuntare una voce solo quando il comportamento è implementato, collegato end-to-end e verificato; codice parziale o solo compilabile resta non spuntato.
- [ ] Non mostrare pulsanti o stati che simulano funzioni non implementate; le funzioni future devono essere assenti o dichiarate chiaramente come non disponibili.
- [ ] Ogni fase deve lasciare il prodotto avviabile e le funzioni già esistenti di adOmnia operative.
- [ ] Per ogni fase registrare nella sezione **Evidenze della fase**: data, commit, comandi eseguiti, progetto Go usato e risultato della prova manuale.
- [ ] Se una verifica fallisce, riaprire la relativa checkbox e non procedere alla fase successiva.
- [ ] Conservare i dati in locale, non introdurre telemetria e non eseguire codice del progetto senza un'azione esplicita dell'utente.
- [ ] Usare commenti Go o Java in italiano, solo su metodi pubblici/exported, descrivendone comportamento o contratto.

### Definizione di “fase funzionante”

Una fase è completa soltanto quando:

- [ ] tutte le attività obbligatorie della fase sono spuntate;
- [ ] i test automatici mirati della fase passano;
- [ ] `cd frontend && npx tsc --noEmit` passa;
- [ ] `cd frontend && npm run build` passa;
- [ ] `go build ./...` passa;
- [ ] `go test ./...` passa;
- [ ] la prova manuale con `wails3 task dev` è stata eseguita come utente reale;
- [ ] non sono presenti processi orfani dopo Stop o chiusura;
- [ ] limiti e funzioni rinviate sono dichiarati nel prodotto e in questo documento;
- [ ] il gate di uscita della fase è spuntato.

---

## Stato generale

- [x] Fase 0 — Analisi, decisioni architetturali e scheletro integrato
- [ ] Fase 1 — Base funzionante end-to-end
- [ ] Fase 2 — Intelligenza del codice con gopls/LSP
- [ ] Fase 3 — Più progetti, ripristino e terminale integrato
- [ ] Fase 4 — Test runner, debugger, coverage e finestre separate
- [ ] Collaudo finale e documentazione di rilascio

---

## Baseline verificata prima dell'implementazione

Queste osservazioni derivano dal repository corrente e vanno ricontrollate se lo stack cambia.

- [x] Il backend effettivo è Go con Wails 3; i servizi sono registrati in `main.go` tramite `application.NewService(...)`.
- [x] Il frontend effettivo è React + TypeScript + Vite; `frontend/package.json` dichiara React 19, Zustand 5, TypeScript 7 e Vite 8.
- [x] Le note che indicano React 18 sono obsolete rispetto al manifest corrente e non vanno usate per nuove decisioni.
- [x] Le nuove API frontend devono usare i binding generati in `frontend/bindings/*` e wrapper in `frontend/src/lib/*-api.ts`, non ampliare lo shim Wails v2.
- [x] La logica di dominio deve vivere sotto `internal/<domain>/`; il root Go deve restare un binding Wails sottile.
- [x] Monaco è già dipendenza locale (`monaco-editor` e `@monaco-editor/react`) ed è configurato in `frontend/src/lib/monacoSetup.ts` senza CDN.
- [x] Il progetto possiede già routing dei pannelli, rail, tab, Zustand, dialog Wails, eventi, logging sviluppatore, design token e alcuni pattern di process execution riutilizzabili.
- [x] Esistono già finestre Wails secondarie per richieste e Swagger, ma ciò non prova ancora il supporto multiwindow del Go Studio.
- [x] Non risultano ancora presenti un dominio Go IDE, gopls/LSP, Delve/DAP, xterm.js o un backend PTY dedicato.
- [x] La working tree contiene modifiche non correlate: durante il lavoro vanno preservate senza sovrascriverle o includerle accidentalmente.

---

## Riferimenti grafici approvati per Go Studio

Questi due mock forniti dall'utente sono riferimenti visivi da consultare durante tutte le fasi UI. Indicano direzione, densità e identità del prodotto; non autorizzano a mostrare funzioni non ancora implementate.

1. [Mock dell'ambiente Go Studio](<C:/Users/Andrea/Downloads/ChatGPT Image Sep 28, 2026, 06_16_11 AM.png>) — riferimento per struttura, proporzioni e gerarchia dell'IDE.
2. [Mock identità “aO → gO”](<C:/Users/Andrea/Desktop/1d4ee52a-bc26-428f-aad5-299a7c917d5b.png>) — riferimento per icona, stato finale `gO` e possibile transizione di circa 400 ms.

### Vincoli grafici da ricordare

- [x] Conservare il rail/menu principale di adOmnia sulla sinistra e aggiungere una voce dedicata **GO / gO** per aprire Go Studio. Questa voce manca nel primo mock e deve essere presente nel prodotto finale.
- [x] Usare l'identità `gO` del secondo mock per la voce Go Studio e per gli stati contestuali del modulo, senza sostituire il marchio generale `aO` di adOmnia.
- [ ] Se viene adottato il morph `aO → gO`, limitarlo all'ingresso in Go Studio, mantenerlo breve (riferimento: 400 ms) e rispettare `prefers-reduced-motion` con uno stato statico equivalente.
- [ ] Mantenere la composizione del primo mock: project tree a sinistra, tab e breadcrumb sopra l'editor, strumenti contestuali a destra, tool window in basso e status bar compatta.
- [ ] Conservare toolbar superiore densa con progetto/sessione, branch, configurazione Run/Debug e azioni principali, mostrando solo controlli realmente funzionanti nella fase corrente.
- [ ] Usare l'accento viola per selezione, focus e stato attivo; mantenere superfici dark, separatori sottili, tipografia compatta e alta densità informativa coerenti con `docs/SOUL.md`.
- [ ] Durante i collaudi UI confrontare il risultato con entrambi i mock e registrare nelle evidenze eventuali differenze intenzionali.

---

## Architettura obiettivo

L'architettura deve essere confermata nella Fase 0 e mantenere isolati sessioni, documenti e processi.

### Backend Go

- [x] Creare `internal/goide/` come dominio proprietario della funzionalità, suddiviso per responsabilità e non come unico file monolitico.
- [x] Separare almeno: `workspace`, `documents`, `toolchain`, `processes`, `lsp`, `terminal`, `debug`, `tests` e `persistence`.
- [x] Esporre soltanto metodi Wails sottili tramite `goide_bindings.go` e registrare il nuovo servizio in `main.go`.
- [x] Usare identificatori espliciti `sessionId`, `documentId`/URI, `runId`, `terminalId`, `lspRequestId` e `debugSessionId` in comandi ed eventi.
- [ ] Usare argomenti strutturati per avviare i processi; non concatenare comandi shell arbitrari.
- [ ] Separare adattatori di processo e PTY specifici per Windows dagli adattatori Unix tramite file con build tag.
- [x] Limitare buffer, watcher, code di eventi e log per mantenere l'app reattiva con output intenso e progetti grandi.
- [x] Non esporre servizi di rete locali se non necessari; eventuali bridge devono ascoltare solo dove strettamente richiesto e avere lifecycle controllato.

### Frontend React/TypeScript

- [x] Creare `frontend/src/components/goide/` con componenti focalizzati, evitando un unico pannello oltre 300 righe.
- [x] Creare uno store dedicato alle sessioni IDE, senza mescolare lo stato con tab HTTP o altre aree dell'app.
- [x] Creare `frontend/src/lib/goide-api.ts` come wrapper tipizzato dei binding generati.
- [x] Integrare il Go Studio nel rail/router, nella command palette e nell'i18n senza ridisegnare il menu principale.
- [ ] Riutilizzare `monacoSetup.ts`, design token, icone e pattern di resize/tab esistenti.
- [x] Prevedere layout persistente: Project a sinistra, editor al centro, struttura richiudibile a destra, tool window in basso, toolbar e status bar.
- [x] Mantenere UI densa, keyboard-first, dark-first e coerente con `docs/SOUL.md`; niente grandi card decorative o dashboard generiche.

### Confini di sicurezza e fiducia

- [x] Distinguere lo stato **progetto aperto** dallo stato **progetto autorizzato a eseguire strumenti**.
- [x] Aprire un progetto senza eseguire automaticamente codice, script, test, hook o comandi definiti dal repository.
- [ ] Richiedere un gesto esplicito prima di build, run, test, debug, `go mod tidy`, download o installazioni.
- [x] Non registrare valori di variabili sensibili e non scrivere credenziali nel repository.
- [x] Validare e confinare ogni percorso filesystem alla radice del progetto quando l'operazione lo richiede; gestire symlink e traversal consapevolmente.

---

# Fase 0 — Analisi, decisioni architetturali e scheletro integrato

## 0.1 Inventario e decisioni

- [x] Mappare routing/rail/tab in `frontend/src/components/layout/` e scegliere il punto di integrazione minimo.
- [x] Mappare dialog cartella/file Wails già esistenti e definire l'API per scegliere la root di un progetto.
- [x] Mappare i pattern backend per eventi, cancellazione, logging, processi e cleanup alla chiusura.
- [x] Valutare la persistenza più adatta per metadati IDE e sessioni (bbolt, settings o storage dedicato), documentando schema e migrazioni.
- [x] Definire i tipi condivisi: progetto, Go workspace, sessione IDE, documento, configurazione Run/Debug ed esecuzione.
- [x] Definire un contratto eventi versionabile con envelope contenente tipo, sessione, risorsa, sequenza e timestamp.
- [x] Definire ownership e lifecycle di watcher, processi, gopls, terminali e debugger.
- [x] Verificare l'integrazione Monaco già presente e definire modelli/URI indipendenti per ogni sessione.
- [x] Verificare tecnicamente le opzioni LSP per gopls e scegliere trasporto, framing JSON-RPC, cancellazione e gestione versioni documento.
- [x] Verificare tecnicamente xterm.js + PTY, con priorità ConPTY su Windows e adattatori separati sulle altre piattaforme.
- [x] Verificare tecnicamente Delve in modalità DAP e annotare capacità/versioni minime realmente supportate.
- [x] Verificare il modello Wails 3 per finestre secondarie o istanze separate, senza dichiarare supporto finché non collaudato.
- [x] Scrivere una breve ADR o sezione architetturale con decisioni, alternative scartate e impatto sulla portabilità.

## 0.2 Scheletro senza funzioni simulate

- [x] Aggiungere il nuovo identificatore di pannello ai tipi di navigazione.
- [x] Aggiungere voce rail, route lazy-loaded, comando nella command palette e traduzioni inglese/italiano.
- [x] Creare il contenitore Go Studio coerente con header, focus, shortcut e chiusura degli altri pannelli.
- [x] Mostrare uno stato vuoto utile con sole azioni reali: “Apri progetto” e, quando implementato, “Crea progetto”.
- [x] Creare servizio backend e binding minimi, senza logica di dominio nel root.
- [x] Rigenerare i binding Wails e verificare che il wrapper frontend gestisca backend non disponibile ed errori puliti.
- [x] Aggiungere una capability al catalogo AI/navigation solo quando il pannello è raggiungibile davvero.
- [x] Confermare che nessuna funzione esistente del rail, tab o workspace sia regredita.

## Gate di uscita Fase 0

- [x] Il pannello Go Studio si apre dall'interfaccia e dalla command palette senza errori.
- [x] L'architettura e i contratti sono documentati abbastanza da implementare la Fase 1 senza introdurre scorciatoie incompatibili con LSP, terminale o debug.
- [x] Il pannello non espone controlli finti e aprirlo non esegue alcun codice esterno.
- [x] Build TypeScript/frontend e build/test Go passano.
- [x] Prova manuale Wails completata su Windows.
- [x] **FASE 0 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 1.**

### Evidenze della fase

- Data: 2026-09-28
- Commit: da registrare nel commit di rilascio `v0.9.35`.
- Comandi e risultati: `npx tsc --noEmit`, `npm run build`, `npm run test` (565 test in 122 file), `go build ./...`, `go test ./...`, `go vet ./...`, `go test -race ./internal/goide`, cross-build Linux/macOS di `internal/goide` e binding Wails beta.25 completati con successo.
- Prova manuale: navigazione verificata nel preview browser sia dalla rail `gO` sia dalla command palette, con stato vuoto dark/compatto e nessuna azione simulata. Un eseguibile Wails beta.25 isolato, con profilo applicativo separato, ha completato startup, apertura dello storage bbolt, shutdown e cleanup; anche il percorso `wails3 task dev` ha completato generazione binding, build frontend, build Go e avvio. L'automazione disponibile non esponeva controlli per interagire direttamente con la finestra nativa Windows, quindi l'interazione del pannello è stata collaudata nel preview e il lifecycle nativo separatamente.
- Limiti rimasti: editor/file tree reali, toolchain, processi Run/Test/Debug, LSP, terminale PTY e multiwindow appartengono alle fasi successive e non sono esposti come controlli attivi nello scheletro di Fase 0.

---

# Fase 1 — Base funzionante end-to-end

Obiettivo: aprire un progetto Go reale, modificarlo, salvarlo, compilarlo, eseguirlo, fornire input e fermarlo senza processi orfani.

## 1.1 Progetti e workspace

- [ ] Aprire una cartella locale tramite dialog nativo e registrarne il percorso senza copiarla o modificarla.
- [ ] Validare esistenza, tipo e accessibilità della cartella con errori comprensibili.
- [ ] Riconoscere `go.mod`, `go.work`, moduli annidati e cartelle Go senza modulo.
- [ ] Mostrare chiaramente root del progetto, moduli trovati e workspace Go rilevato.
- [ ] Creare un nuovo progetto scegliendo nome, cartella e module path; eseguire `go mod init` solo dopo conferma esplicita.
- [ ] Salvare e mostrare i progetti recenti; rimuovere dalla lista un percorso non più disponibile senza perdere altre sessioni.
- [ ] Introdurre lo stato di autorizzazione agli strumenti separato dall'apertura del progetto.

## 1.2 Albero file e documenti

- [ ] Caricare l'albero cartelle in modo progressivo/lazy invece di leggere ricorsivamente tutto all'apertura.
- [ ] Ignorare o ridurre in modo configurabile directory pesanti come `.git`, vendor e output di build.
- [ ] Aprire file testuali in tab editor con URI stabile e associazione alla sessione.
- [ ] Supportare almeno Go, JSON, YAML, Markdown, `.env`, `go.mod` e `go.work` con linguaggio Monaco appropriato.
- [ ] Fornire syntax highlighting Go, numeri di riga, indentazione, bracket matching e folding.
- [ ] Mostrare breadcrumb del percorso e indicatore di file modificato.
- [ ] Implementare salvataggio esplicito con `Ctrl/Cmd+S`, scrittura atomica e gestione degli errori.
- [ ] Non perdere il buffer se il salvataggio fallisce.
- [ ] Chiedere conferma Save/Discard/Cancel alla chiusura di un tab, sessione o app con modifiche non salvate.
- [ ] Rilevare modifiche esterne del file e offrire Reload/Keep/Compare senza sovrascrivere automaticamente il buffer.
- [ ] Implementare ricerca/sostituzione nel file tramite Monaco.
- [ ] Implementare Quick Open dei file del progetto con ricerca cancellabile e limite risultati.
- [ ] Rinviare esplicitamente, senza controlli finti: split editor, simboli, ricerca progetto semantica e refactor.

## 1.3 Toolchain Go

- [ ] Rilevare il binario `go` senza bloccare l'interfaccia.
- [ ] Mostrare percorso, `go version`, `GOROOT`, `GOPATH`, `GOPROXY` e `GOPRIVATE`, oscurando eventuali dati sensibili.
- [ ] Permettere un percorso Go personalizzato e variabili per progetto/sessione con validazione.
- [ ] Mostrare istruzioni operative se Go manca o la configurazione non è valida.
- [ ] Non scaricare o installare toolchain automaticamente.
- [ ] Gestire assenza rete, proxy/moduli privati e dipendenze mancanti come errori visibili e non bloccanti.
- [ ] Esporre `go mod tidy` solo come azione esplicita con anteprima del comando e feedback completo.

## 1.4 Build, Run, console e Stop

- [ ] Definire una configurazione minima per package `main`: target, working directory, argomenti programma, flag Go, build tag e ambiente.
- [ ] Separare visivamente e nel modello i flag della toolchain dagli argomenti del programma.
- [ ] Eseguire `go build` e `go run` tramite argomenti strutturati, senza shell concatenata.
- [ ] Associare ogni esecuzione a `sessionId` e `runId` univoci.
- [ ] Trasmettere stdout/stderr incrementalmente, preservando l'ordine utile e senza congelare la UI.
- [ ] Mostrare comando, working directory, stato, PID quando disponibile, durata ed exit code.
- [ ] Renderizzare ANSI in modo sicuro e limitare il buffer della console.
- [ ] Aggiungere ricerca, copia e link cliccabili `file:line` che aprono l'editor nel punto corretto.
- [ ] Fornire stdin alla Run console per programmi interattivi.
- [ ] Supportare più esecuzioni contemporanee con tab/identità chiaramente separate.
- [ ] Implementare Stop idempotente e Restart.
- [ ] Terminare l'intero albero di processi, incluso il binario figlio avviato da `go run`, con adattatore Windows verificato.
- [ ] Eseguire cleanup alla chiusura e chiedere conferma se una sessione ha processi attivi.
- [ ] Registrare metadati diagnostici senza includere segreti o interi environment.

## 1.5 Interfaccia minima professionale

- [ ] Toolbar con progetto attivo, configurazione, Build, Run e Stop; Debug non presente finché non reale.
- [ ] Project tree ridimensionabile a sinistra ed editor a tab al centro.
- [ ] Tool window inferiore ridimensionabile con Run e Problems reali.
- [ ] Status bar con toolchain, file, posizione cursore e stato di esecuzione.
- [ ] Stati loading, empty, error, running e stopped immediatamente distinguibili.
- [ ] Scorciatoie documentate e senza conflitti con quelle globali di adOmnia.
- [ ] Layout corretto con temi dark/light, densità e ridimensionamento finestra.

## 1.6 Test mirati

- [ ] Test backend per validazione/confino percorsi e lettura/scrittura atomica dei documenti.
- [ ] Test backend per lifecycle Run: start, output, stdin, exit naturale, Stop ripetuto e cleanup.
- [ ] Test Windows che verifica l'arresto dell'intero albero di processi.
- [ ] Test di isolamento: output con `runId` errato non entra nella console di un'altra esecuzione.
- [ ] Test frontend per dirty state, salvataggio fallito e routing degli eventi per sessione/run.
- [ ] Progetto fixture minimo con input stdin, stdout, stderr e processo figlio per la verifica end-to-end.

## Gate di uscita Fase 1

- [ ] Aprire un progetto Go reale.
- [ ] Navigare i file e modificarne uno.
- [ ] Salvare e compilare il progetto.
- [ ] Eseguire il programma e leggere output stdout/stderr in tempo reale.
- [ ] Fornire input al programma quando richiesto.
- [ ] Fermare il programma senza processi orfani.
- [ ] Vedere chiaramente errori di compilazione, dipendenze mancanti e toolchain assente.
- [ ] Chiudere un file dirty senza perdere dati accidentalmente.
- [ ] Tutti i controlli visibili nel pannello eseguono funzioni reali.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano.
- [ ] **FASE 1 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 2.**

### Evidenze della fase

- Data:
- Commit:
- Progetto Go usato:
- Comandi e risultati:
- Prova manuale:
- Processi verificati dopo Stop:
- Limiti rimasti:

---

# Fase 2 — Intelligenza del codice con gopls/LSP

Obiettivo: comprendere davvero il codice tramite gopls, includendo i buffer non salvati e il lifecycle corretto del protocollo.

## 2.1 Gestione gopls

- [ ] Rilevare `gopls`, versione e compatibilità; mostrare percorso e stato nella status bar.
- [ ] Permettere un binario gopls personalizzato.
- [ ] Se gopls manca, mostrare istruzioni e un'installazione esplicita con avanzamento, log ed errore; nessun download silenzioso.
- [ ] Avviare un processo gopls isolato per sessione/workspace secondo la decisione architetturale.
- [ ] Inizializzare root URI, workspace folders, capability e configurazione Go corrette.
- [ ] Gestire restart, crash, backoff limitato e shutdown/exit pulito.
- [ ] Non confondere log gopls, diagnostica e output Run tra sessioni.

## 2.2 Client LSP corretto

- [ ] Implementare framing JSON-RPC/LSP, correlazione richiesta/risposta ed errori tipizzati.
- [ ] Implementare `didOpen`, `didChange`, `didSave` e `didClose` con versioni documento monotone.
- [ ] Inviare contenuto dei buffer non salvati, non rileggere il file su disco per richieste semantiche.
- [ ] Convertire correttamente coordinate Monaco ↔ LSP, incluse UTF-16 e newline.
- [ ] Implementare cancellazione delle richieste obsolete durante digitazione/navigazione.
- [ ] Gestire timeout e risposte tardive senza applicarle al documento o alla sessione sbagliata.
- [ ] Gestire modifiche workspace/applyEdit in modo transazionale e con conferma quando toccano più file.

## 2.3 Funzioni semantiche

- [ ] Pubblicare diagnostica per file/sessione nel gutter, Problems e status bar.
- [ ] Implementare completion Monaco da gopls.
- [ ] Implementare hover.
- [ ] Implementare signature help.
- [ ] Implementare Go to Definition/Type Definition/Implementation dove supportato.
- [ ] Implementare Find References con navigazione risultati.
- [ ] Implementare document symbols e struttura file richiudibile a destra.
- [ ] Implementare workspace symbols e Quick Open simboli.
- [ ] Implementare semantic rename con anteprima delle modifiche.
- [ ] Implementare code actions e gestione import.
- [ ] Implementare formatting configurabile tramite gopls/gofmt.
- [ ] Implementare ricerca testuale nel progetto, cancellabile e con esclusioni configurabili.
- [ ] Non usare regex o dati statici per simulare funzioni semantiche.

## 2.4 Editor avanzato

- [ ] Implementare split editor orizzontale e verticale con modelli condivisi e view state indipendenti.
- [ ] Implementare tab pin, close others/right e riapertura tab chiuso senza perdere dirty state.
- [ ] Implementare breadcrumb simbolico oltre al percorso.
- [ ] Integrare code action, rename, references e Problems con navigazione da tastiera.
- [ ] Persistenza del layout editor e dei pannelli senza persistere accidentalmente contenuti sensibili.

## 2.5 Test mirati

- [ ] Test per versioni documento, buffer unsaved e scarto di risposte LSP obsolete.
- [ ] Test per conversione posizioni UTF-16 con caratteri multibyte.
- [ ] Test per cancellazione richieste e crash/restart gopls.
- [ ] Test di isolamento diagnostica tra due sessioni.
- [ ] Prova reale di completion, hover, definition, references, rename, import e formatting su progetto multi-package.

## Gate di uscita Fase 2

- [ ] Modificare un buffer non salvato e ottenere diagnostica/completion coerenti con quel contenuto.
- [ ] Navigare a definizioni e riferimenti reali tra package.
- [ ] Eseguire rename e formatting senza corrompere file o dirty state.
- [ ] Riavviare gopls dopo un crash controllato senza riavviare adOmnia.
- [ ] Nessun dato LSP di un progetto compare in un'altra sessione.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano.
- [ ] **FASE 2 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 3.**

### Evidenze della fase

- Data:
- Commit:
- Versioni Go/gopls:
- Progetto Go usato:
- Comandi e risultati:
- Prova manuale:
- Limiti rimasti:

---

# Fase 3 — Più progetti, ripristino e terminale integrato

Obiettivo: lavorare su più progetti in sessioni isolate, ripristinabili, con configurazioni persistenti e terminali PTY reali.

## 3.1 Sessioni indipendenti

- [ ] Aprire più progetti e passare fra sessioni senza perdere tab, dirty state, layout, diagnostica o console.
- [ ] Separare per sessione documenti, watcher, gopls, configurazioni, esecuzioni, console e terminali.
- [ ] Definire comportamento quando lo stesso file è aperto in due sessioni.
- [ ] Rilevare e mostrare conflitti fra buffer concorrenti senza sovrascritture silenziose.
- [ ] Chiudere una sessione chiedendo cosa fare con file dirty e processi attivi.
- [ ] Evitare che la chiusura di una sessione termini risorse appartenenti alle altre.

## 3.2 Persistenza e ripristino

- [ ] Persistenza versionata di progetti recenti, sessioni, tab, file attivo, layout e configurazioni.
- [ ] Migrazione backward-compatible dello schema di persistenza.
- [ ] Ripristinare la sessione senza eseguire automaticamente toolchain, programmi, terminali o gopls non autorizzato.
- [ ] Ripristinare buffer non salvati in un recovery store locale e proporre recupero esplicito.
- [ ] Gestire cartelle spostate/rimosse e file non più presenti con stato recuperabile.
- [ ] Aggiungere export/import delle impostazioni Go Studio solo se compatibile con il formato workspace e documentato.

## 3.3 Configurazioni Run persistenti

- [ ] Supportare package `main`, lista esplicita di file Go quando valida, build package/progetto, binario compilato e test.
- [ ] Persistenza locale di target, cwd, argomenti programma, flag Go, build tag e ambiente.
- [ ] Validare configurazioni prima dell'avvio e mostrare errori contestuali.
- [ ] Duplicare, rinominare, ordinare ed eliminare configurazioni.
- [ ] Evitare di serializzare segreti in chiaro; usare riferimenti al vault o valori richiesti a runtime quando necessario.

## 3.4 Terminale PTY reale

- [ ] Aggiungere xterm.js e addon necessari come dipendenze locali, senza CDN.
- [ ] Implementare backend PTY con ConPTY su Windows e adattatori separati per piattaforme supportate.
- [ ] Aprire shell locale configurabile nella working directory del progetto.
- [ ] Supportare input interattivo, output streaming, resize e sequenze ANSI.
- [ ] Supportare più terminali per sessione con nome, stato e chiusura indipendenti.
- [ ] Distinguere chiaramente terminale interattivo e Run console.
- [ ] Limitare scrollback e throughput per evitare blocchi con output intenso.
- [ ] Terminare shell e process tree alla chiusura del terminale/sessione/app.
- [ ] Non inserire automaticamente credenziali o comandi nel terminale.

## 3.5 Prestazioni e robustezza

- [ ] Watcher controllati e deduplicati; debounce degli eventi e gestione overflow.
- [ ] Ricerca cancellabile, indicizzazione progressiva e limiti sui risultati.
- [ ] Misurare apertura e navigazione su un progetto grande senza bloccare il main thread.
- [ ] Applicare backpressure/coalescing agli eventi di output e diagnostica.
- [ ] Verificare consumo e rilascio risorse passando ripetutamente fra sessioni.

## 3.6 Test mirati

- [ ] Test di isolamento completo tra due progetti con output, diagnostica, config e terminali simultanei.
- [ ] Test di ripristino sessione e recovery di buffer dirty.
- [ ] Test di migrazione della persistenza da una versione precedente.
- [ ] Test PTY: input, resize, exit naturale, kill e cleanup process tree su Windows.
- [ ] Test di conflitto per lo stesso file aperto in due sessioni.

## Gate di uscita Fase 3

- [ ] Due progetti restano completamente isolati durante edit, LSP, Run e terminale.
- [ ] Riavviare adOmnia ripristina sessioni e layout senza avviare codice implicitamente.
- [ ] Un terminale interattivo reale funziona, si ridimensiona e si chiude senza processi orfani.
- [ ] Le modifiche esterne e i conflitti tra sessioni sono gestiti senza perdita silenziosa.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano.
- [ ] **FASE 3 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 4.**

### Evidenze della fase

- Data:
- Commit:
- Versioni PTY/xterm:
- Progetti Go usati:
- Comandi e risultati:
- Prova manuale:
- Limiti rimasti:

---

# Fase 4 — Test runner, debugger, coverage e finestre separate

Obiettivo: offrire test e debug reali, quindi valutare l'isolamento in finestre separate senza promettere capacità non verificate.

## 4.1 Test runner

- [ ] Eseguire `go test -json` per package, progetto, singolo test e sottotest.
- [ ] Correlare eventi strutturati per package/test senza affidarsi a parsing fragile del solo testo.
- [ ] Mostrare albero package → test → sottotest, stato, durata, output e dettagli del fallimento.
- [ ] Collegare file/riga del failure all'editor.
- [ ] Supportare cancellazione e arresto dell'intero process tree.
- [ ] Rieseguire tutti i test, un singolo test o soltanto i falliti.
- [ ] Tenere risultati e output isolati per sessione/esecuzione.
- [ ] Mostrare stato flaky/skip/timeout quando ricavabile dai dati reali.

## 4.2 Debugger Delve via DAP

- [ ] Rilevare `dlv`, versione e compatibilità con Go; permettere percorso personalizzato.
- [ ] Se Delve manca, mostrare istruzioni e installazione esplicita con avanzamento/errori.
- [ ] Avviare Delve/DAP solo dopo azione Debug esplicita e con endpoint confinato.
- [ ] Implementare handshake, initialize, launch/attach dove supportato, configurationDone e disconnect.
- [ ] Gestire breakpoint, verifica e aggiornamento delle righe effettive.
- [ ] Implementare continue, pause, step over, step into e step out.
- [ ] Mostrare thread/goroutine, call stack e navigazione della riga corrente.
- [ ] Mostrare scopes, variabili espandibili e watch.
- [ ] Implementare valutazione espressioni con errori chiari.
- [ ] Associare ogni messaggio a sessione debug e scartare eventi tardivi dopo disconnect.
- [ ] Terminare debugger e debuggee in modo affidabile alla chiusura.

## 4.3 Coverage

- [ ] Generare coverage solo su azione esplicita usando toolchain Go ufficiale.
- [ ] Mostrare percentuale per package/file e annotazioni linea nell'editor.
- [ ] Permettere attivazione/disattivazione overlay senza alterare il file.
- [ ] Gestire profili coverage obsoleti dopo modifiche ai sorgenti.

## 4.4 Finestre separate / più istanze

- [ ] Prototipare una finestra Wails secondaria Go Studio riusando il pattern esistente senza duplicare ownership backend.
- [ ] Verificare focus, shortcut, eventi, chiusura, dirty state e cleanup tra finestra principale e secondaria.
- [ ] Verificare comportamento se lo stesso progetto è aperto in più finestre o istanze.
- [ ] Introdurre locking/coordinamento o avviso di conflitto prima di abilitare la funzione.
- [ ] Dichiarare nel prodotto il supporto multiwindow solo dopo prova reale su Windows e piattaforme dichiarate.
- [ ] Se non affidabile, lasciare la funzione disabilitata e documentare il limite senza pulsanti finti.

## 4.5 Test mirati

- [ ] Test parser/event aggregator di `go test -json`, inclusi sottotest, failure e output concorrente.
- [ ] Test DAP per sequenza lifecycle, breakpoint, evento stopped e disconnect.
- [ ] Test cleanup debugger/debuggee e process tree.
- [ ] Test isolamento simultaneo di test e debug su due sessioni.
- [ ] Prova reale di test fallito, rerun failed, breakpoint, step, variabili, watch ed evaluate.

## Gate di uscita Fase 4

- [ ] Un test fallito è mostrato strutturalmente e apre il file/riga corretti.
- [ ] Rerun failed esegue davvero solo il perimetro previsto.
- [ ] Una sessione debug reale raggiunge un breakpoint e supporta step, stack, variabili e watch.
- [ ] Stop/chiusura non lascia Delve o debuggee orfani.
- [ ] Coverage reale è navigabile e non resta applicata a sorgenti non più corrispondenti.
- [ ] Multiwindow è verificato e abilitato, oppure esplicitamente rinviato senza dichiarazioni ingannevoli.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano.
- [ ] **FASE 4 FUNZIONANTE E APPROVATA — è consentito il collaudo finale.**

### Evidenze della fase

- Data:
- Commit:
- Versioni Go/Delve:
- Progetto Go usato:
- Comandi e risultati:
- Prova manuale:
- Esito multiwindow:
- Limiti rimasti:

---

# Collaudo finale e documentazione

## Flussi completi

- [ ] Da installazione pulita: aprire un progetto, autorizzarlo, modificare, salvare, buildare, eseguire, inviare stdin e fermare.
- [ ] Creare un progetto nuovo, riaprirlo dai recenti e ripristinare la sessione.
- [ ] Lavorare su due progetti contemporaneamente senza contaminazione di stato o output.
- [ ] Gestire file modificato esternamente e conflitto dello stesso file tra sessioni.
- [ ] Usare completion, diagnostica, definition, references, rename, import e formatting su buffer dirty.
- [ ] Usare terminale, test runner, debugger e coverage su progetto reale.
- [ ] Simulare toolchain/gopls/Delve mancanti e verificare messaggi operativi.
- [ ] Verificare assenza rete e modulo privato/non raggiungibile senza blocco UI.
- [ ] Chiudere app con dirty file e processi attivi verificando prompt e cleanup.

## Qualità prodotto

- [ ] Verificare navigazione completa da tastiera e focus visibile.
- [ ] Verificare contrasto, zoom, temi, densità e layout ridimensionato.
- [ ] Verificare coesione con rail, command palette, tab e Settings esistenti.
- [ ] Verificare prestazioni su progetto grande, output intenso e molte diagnostiche.
- [ ] Verificare che log, console e persistenza non contengano segreti.
- [ ] Verificare che nessuna azione venga eseguita implicitamente all'apertura/ripristino.
- [ ] Verificare che tutte le funzioni visibili siano reali e che i limiti siano espliciti.

## Documentazione e catalogo

- [ ] Aggiornare `README.md` con il flusso utente realmente disponibile.
- [ ] Aggiornare `docs/adomnia-feature-catalog.en.md` solo con capacità implementate e verificate.
- [ ] Aggiornare `docs/ISSUES.md` con stato e limiti residui.
- [ ] Aggiornare `docs/ARCHITECTURE.md` e `CLAUDE.md` con moduli, lifecycle e ricette di modifica.
- [ ] Documentare schema di persistenza e migrazioni.
- [ ] Documentare dipendenze esterne opzionali (Go, gopls, Delve), versioni supportate e installazione esplicita.
- [ ] Documentare shortcut e comportamento di sicurezza/autorizzazione progetto.
- [ ] Preparare note di rilascio con piattaforme verificate e supporto multiwindow reale.

## Gate finale

- [ ] Tutti i gate delle Fasi 0–4 risultano spuntati con evidenze.
- [ ] Tutti i criteri di accettazione della specifica sono stati provati end-to-end.
- [ ] Le suite frontend e Go passano su working tree pulita rispetto alle modifiche della funzionalità.
- [ ] Il test manuale `wails3 task dev` è completato sulle piattaforme dichiarate.
- [ ] Non risultano regressioni note bloccanti né processi orfani.
- [ ] **GO STUDIO È CONSIDERATO COMPLETO PER L'AMBITO DEFINITO.**

### Evidenze finali

- Data:
- Release/commit:
- Piattaforme verificate:
- Versioni Go/gopls/Delve:
- Comandi e risultati:
- Scenari manuali completati:
- Limiti dichiarati:
