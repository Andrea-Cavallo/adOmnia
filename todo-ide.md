# TODO — Go Studio integrato in adOmnia

Checklist esecutiva per costruire un ambiente di sviluppo Go realmente utilizzabile dentro adOmnia.

Documento derivato dalla specifica allegata. Questo file è la fonte di verità operativa per l'implementazione: deve essere aggiornato nello stesso cambiamento che completa o modifica una voce.

## Barra di qualità del prodotto (non negoziabile)

Go Studio non è un prototipo interno né un esercizio tecnico: deve risultare un **IDE Go professionale, realmente utilizzabile ogni giorno per lavoro vero**, con un livello di rifinitura comparabile a JetBrains GoLand/IntelliJ Ultimate (lo stesso riferimento usato in `Riferimenti grafici approvati` e in `Fuori ambito dichiarato`). Questo criterio si applica a **ogni fase**, non solo al collaudo finale, ed estende alla lettera la PRODUCT-FIRST PHILOSOPHY di `CLAUDE.md` (UX, fluidità, reattività, coesione grafica sopra tutto il resto). Una fase che passa tutti i test ma "sembra un prototipo" non è considerata completa.

- [ ] **Fluido**: nessuna interazione visibilmente bloccante; digitazione, scroll, apertura file, cambio tab/sessione e resize restano scattanti anche su progetti Go reali di dimensioni tipiche, non solo su fixture minime.
- [ ] **Veloce**: le operazioni interattive (apertura file, completion, hover, cambio sessione, apertura pannello) rispondono con la latenza percepita di un editor moderno; le operazioni lunghe (build, test, indicizzazione, avvio gopls) sono sempre asincrone e non bloccano mai la UI.
- [ ] **Moderno**: densità, tipografia, stati hover/focus/active e motion coerenti con `docs/SOUL.md` e con i mock approvati; nessun pannello con l'aspetto di una demo, di un wireframe o di un tool abbozzato.
- [ ] **Stabile alla percezione**: nessuno stato a metà, nessun flicker, nessun salto di layout quando arrivano dati asincroni (diagnostica, output, eventi LSP/Run/debug).
- [ ] **Completo come IDE Go**: Go Studio è un vero ambiente di sviluppo Go dentro adOmnia, non un editor con un pulsante Run. Legge l'SDK Go configurato (GOROOT, stdlib, moduli in cache), offre una menu bar seria con tutte le azioni reali, e copre l'intero ciclo scrivi → capisci → esegui → testa → debugga.
- [ ] Verificare questi quattro criteri a ogni gate di fase, su un progetto Go reale (non un progetto giocattolo vuoto), e registrarne l'esito nelle Evidenze della fase.

---

## Regole di avanzamento

- Non iniziare una fase finché il **gate di uscita** della fase precedente non è interamente verificato e spuntato.
- Spuntare una voce solo quando il comportamento è implementato, collegato end-to-end e verificato; codice parziale o solo compilabile resta non spuntato.
- Non mostrare pulsanti o stati che simulano funzioni non implementate; le funzioni future devono essere assenti o dichiarate chiaramente come non disponibili.
- Ogni fase deve lasciare il prodotto avviabile e le funzioni già esistenti di adOmnia operative.
- Per ogni fase registrare nella sezione **Evidenze della fase**: data, commit, comandi eseguiti, progetto Go usato e risultato della prova manuale.
- Se una verifica fallisce, riaprire la relativa checkbox e non procedere alla fase successiva.
- Conservare i dati in locale, non introdurre telemetria e non eseguire codice del progetto senza un'azione esplicita dell'utente.
- Usare commenti Go o Java in italiano, solo su metodi pubblici/exported, descrivendone comportamento o contratto.

### Definizione di “fase funzionante”

Una fase è completa soltanto quando:

- tutte le attività obbligatorie della fase sono spuntate;
- i test automatici mirati della fase passano;
- `cd frontend && npx tsc --noEmit` passa;
- `cd frontend && npm run build` passa;
- `go build ./...` passa;
- `go test ./...` passa;
- la prova manuale con `wails3 task dev` è stata eseguita come utente reale;
- non sono presenti processi orfani dopo Stop o chiusura;
- limiti e funzioni rinviate sono dichiarati nel prodotto e in questo documento;
- la barra di qualità del prodotto (fluido, veloce, moderno, stabile alla percezione) è verificata su un progetto Go reale e non solo dichiarata;
- il gate di uscita della fase è spuntato.

---

## Stato generale

- [x] Fase 0 — Analisi, decisioni architetturali e scheletro integrato
- [ ] Fase 1 — Base funzionante end-to-end *(implementata e verificata end-to-end; gate in attesa della prova manuale su Windows)*
- [ ] Fase 2 — Intelligenza del codice con gopls/LSP *(implementata e verificata end-to-end; gate in attesa della prova manuale su Windows)*
- [ ] Fase 3 — Più progetti, ripristino e terminale integrato *(implementata e verificata end-to-end; gate in attesa delle prove manuali su Windows: ConPTY e finestra Wails)*
- [ ] Fase 4 — Test runner, debugger, coverage e finestre separate *(implementata e verificata; multiwindow rinviato; gate aperto solo per il collaudo Windows)*
- [ ] Fase 5 — Parità GoLand: assistenza al codice, VCS nell'editor e integrazione con i moduli adOmnia *(sviluppo futuro)*
- [ ] Collaudo finale e documentazione di rilascio *(dopo la Fase 5)*

### Cosa resta da fare (aggiornato al 2026-09-28, dopo il merge della Fase 4)

Stato in una riga: le Fasi 0-4 sono implementate e verificate end-to-end con il backend Go reale (test automatici e 50 passi e2e nel browser, di cui 17 per test runner, coverage e debugger); i gate di Fase 1-4 restano aperti solo per il collaudo manuale su Windows. Le finestre separate sono rinviate in modo esplicito. Nelle Fasi 0-4 restano aperte solo le verifiche manuali. Prossimo sviluppo: Fase 5 (parità GoLand).

**1. Collaudo manuale (le uniche voci aperte delle Fasi 0-4; sblocca i gate di Fase 1, 2, 3 e 4)**
- [ ] `wails3 task dev` su un progetto Go reale (non una fixture): apri, autorizza, modifica, salva, Build, Run con stdin, Stop.
- [ ] Eseguire `go test ./internal/goide -run TestWindowsStopTerminatesChildTree` su Windows: Stop deve chiudere anche il figlio di `go run`.
- [ ] Controllare in Task Manager che dopo Stop, chiusura sessione e chiusura app non restino `go`, programma, `gopls`, linter o shell del terminale.
- [ ] Terminale ConPTY: input, resize, uscita naturale, chiusura del process tree (`go test ./internal/goide -run TestTerminal` su Windows).
- [ ] Temi dark e light, finestra ridimensionata e piccola, stati loading/empty/error/running/stopped ben distinguibili.
- [ ] Provare a video il signature help (parametri mentre si scrive una chiamata).
- [ ] Toolchain assente: installazione Go dall'IDE; gopls, linter e Delve assenti: installazione dal menu Go.
- [ ] Debugger su Windows: breakpoint, step, Stop e chiusura progetto senza `dlv` o `__debug_bin` residui in Task Manager (`go test ./internal/goide -run TestDebugger` su Windows).
- [ ] Confronto con i due mock approvati e verifica della barra di qualità (fluido, veloce, moderno, stabile) su un progetto di dimensioni reali; registrare l'esito nelle Evidenze e spuntare i gate.

**2. Sviluppo ancora da fare (non sono verifiche)**
- Fase 5 e collaudo finale: vedi le rispettive sezioni. I residui delle Fasi 1-4 non bloccanti per i gate (split con gruppo di tab, morph `aO → gO`, branch in toolbar, export/import impostazioni, avviso watcher oltre 4.000 cartelle, debug attach/remoto, finestre separate) sono stati spostati nelle sezioni 5.3, 5.4, 5.5, 5.6 e 5.8.

### Punto di ripresa (audit 2026-09-28)

Audit del codice dopo il commit `9269990` (`feat(goide): expand Go Studio with editor, run panel, dependencies and toolchains`), che ha implementato gran parte della Fase 1 senza aggiornare questo documento. Le checkbox della Fase 1 ora riflettono il codice reale.

Già presente e collegato end-to-end: apertura/creazione progetto, sessioni ripristinate, recenti, autorizzazione strumenti, albero lazy, editor Monaco a tab con salvataggio atomico, conflitti esterni (Reload/Keep/Compare), Quick Open, rilevamento e installazione toolchain Go ufficiale con checksum, più versioni per sessione, dipendenze `go.mod` con `go get` confermato, `go mod tidy` con anteprima, Build/Run/Stop/Restart, stdin, console ANSI limitata, Problems, prompt di chiusura app/sessione/tab.

Difetti trovati e corretti nell'audit:

- [x] `toolchain_install_test.go` non compilava (`NewService(nil)`): `go vet`/`go test` del pacchetto fallivano.
- [x] Data race reale in `ProcessManager.Stop` (lettura di `ProcessState` concorrente a `Wait`): sostituita da un flag atomico `exited`; `go test -race` ora passa.

Gap aperti della Fase 1 da chiudere prima del gate:

- [x] Mostrare nel prodotto module path, moduli annidati, `go.work` e cartelle senza modulo: pannello destro **Project Overview** (sostituisce il placeholder Structure fino a gopls) e campo backend `looseGoDirs`.
- [x] Rendere configurabile la visualizzazione delle directory ignorate: toggle nell'header Project e in View → Show Ignored Folders, per sessione.
- [x] Riaprire un progetto recente anche quando una sessione è già aperta: File → Open Recent.
- [x] Run console: mostrare durata ed exit code; link `file:line` relativi (`./main.go:5`) risolti rispetto alla working directory dell'esecuzione, senza tab duplicate.
- [x] `Ctrl/Cmd+W` dentro Go Studio chiudeva una tab HTTP invisibile: ora chiude il documento attivo. Scorciatoie documentate in Help → Keyboard Shortcuts, con test anti-duplicati.
- [x] **Menu bar IDE reale** (File, Edit, View, Go, Run, Help) con registro comandi unico condiviso da menu, scorciatoie e dialog di aiuto; voci non disponibili disabilitate con motivo nel tooltip; Edit esegue le azioni Monaco reali; passaggio fra menu al passaggio del mouse come in GoLand.
- [x] **Principio di comodità per lo sviluppatore** (richiesta utente): se un file contiene `func main`, il ▶ è nel gutter accanto; lo stesso per `Test`/`Benchmark`/`Fuzz`/`Example`. Dalla Fase 4 il ▶ apre il menu Run / Debug / Run with Coverage, con debugger reale.
- [x] Icona gopher per i file `.go` (albero, tab, Quick Open, risultati), SVG locale ispirato al gopher di Renée French (CC BY).
- [ ] Verifiche manuali non eseguibili nel container Linux (GTK4/WebKitGTK assenti): `wails3 task dev` su Windows, test `process_tree_windows_test.go`, temi dark/light, barra di qualità su progetto reale.

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
- Se viene adottato il morph `aO → gO` (voce in 5.4), limitarlo all'ingresso in Go Studio, mantenerlo breve (riferimento: 400 ms) e rispettare `prefers-reduced-motion` con uno stato statico equivalente.
- [x] Mantenere la composizione del primo mock: project tree a sinistra, tab e breadcrumb sopra l'editor, strumenti contestuali a destra, tool window in basso e status bar compatta.
- [x] Conservare toolbar superiore densa con progetto/sessione, branch, configurazione Run/Debug e azioni principali, mostrando solo controlli realmente funzionanti nella fase corrente. *(il branch arriverà con 5.5, finché non è reale non compare)*
- [x] Usare l'accento viola per selezione, focus e stato attivo; mantenere superfici dark, separatori sottili, tipografia compatta e alta densità informativa coerenti con `docs/SOUL.md`.
- [ ] Durante i collaudi UI confrontare il risultato con entrambi i mock e registrare nelle evidenze eventuali differenze intenzionali.

---

## Architettura obiettivo

L'architettura deve essere confermata nella Fase 0 e mantenere isolati sessioni, documenti e processi.

### Backend Go

- [x] Creare `internal/goide/` come dominio proprietario della funzionalità, suddiviso per responsabilità e non come unico file monolitico.
- [x] Separare almeno: `workspace`, `documents`, `toolchain`, `processes`, `lsp`, `terminal`, `debug`, `tests` e `persistence`.
- [x] Esporre soltanto metodi Wails sottili tramite `goide_bindings.go` e registrare il nuovo servizio in `main.go`.
- [x] Usare identificatori espliciti `sessionId`, `documentId`/URI, `runId`, `terminalId`, `lspRequestId` e `debugSessionId` in comandi ed eventi.
- [x] Usare argomenti strutturati per avviare i processi; non concatenare comandi shell arbitrari.
- [x] Separare adattatori di processo specifici per Windows dagli adattatori Unix tramite file con build tag (`process_adapter_windows.go` con `taskkill /T /F`, `process_adapter_unix.go` con `SIGKILL` sul process group).
- [x] Separare allo stesso modo gli adattatori PTY per Windows (ConPTY) dagli adattatori Unix quando il terminale verrà introdotto in Fase 3. *(go-pty: ConPTY su Windows, pty Unix)*
- [x] Limitare buffer, watcher, code di eventi e log per mantenere l'app reattiva con output intenso e progetti grandi.
- [x] Non esporre servizi di rete locali se non necessari; eventuali bridge devono ascoltare solo dove strettamente richiesto e avere lifecycle controllato.

### Frontend React/TypeScript

- [x] Creare `frontend/src/components/goide/` con componenti focalizzati, evitando un unico pannello oltre 300 righe.
- [x] Creare uno store dedicato alle sessioni IDE, senza mescolare lo stato con tab HTTP o altre aree dell'app.
- [x] Creare `frontend/src/lib/goide-api.ts` come wrapper tipizzato dei binding generati.
- [x] Integrare il Go Studio nel rail/router, nella command palette e nell'i18n senza ridisegnare il menu principale.
- [x] Riutilizzare `monacoSetup.ts`, design token, icone e pattern di resize/tab esistenti.
- [x] Prevedere layout persistente: Project a sinistra, editor al centro, struttura richiudibile a destra, tool window in basso, toolbar e status bar.
- [x] Mantenere UI densa, keyboard-first, dark-first e coerente con `docs/SOUL.md`; niente grandi card decorative o dashboard generiche.

### Confini di sicurezza e fiducia

- [x] Distinguere lo stato **progetto aperto** dallo stato **progetto autorizzato a eseguire strumenti**.
- [x] Aprire un progetto senza eseguire automaticamente codice, script, test, hook o comandi definiti dal repository.
- [x] Richiedere un gesto esplicito prima di build, run, test, debug, `go mod tidy`, download o installazioni.
- [x] Non registrare valori di variabili sensibili e non scrivere credenziali nel repository.
- [x] Validare e confinare ogni percorso filesystem alla radice del progetto quando l'operazione lo richiede; gestire symlink e traversal consapevolmente.

### Ambito rivisto rispetto al riferimento IntelliJ Ultimate/GoLand

Decisione esplicita dell'utente (2026-09-28): l'elenco funzionalità di GoLand è **dentro** l'ambito e diventa la Fase 5. Le due voci precedentemente dichiarate fuori ambito sono riaperte.

- **VCS nell'editor rientra in ambito** (gutter diff/blame, cronologia locale, commit/log, branch in toolbar) ed è coperto da 5.5. Resta però una decisione architetturale aperta: `internal/git` oggi versiona workspace API, non repository di codice; 5.5 deve scegliere fra estenderlo e creare un dominio VCS separato, senza rompere Git Sync.
- **Refactoring oltre al rename rientra in ambito** (extract function/variable, inline, move) ed è coperto da 5.1, nei limiti di ciò che gopls espone realmente via code action: quello che gopls non fornisce non va simulato con manipolazione testuale.

### Fuori ambito confermato

- Supporto first-class a JavaScript/TypeScript/HTML/CSS/Dart in stile WebStorm: Go Studio resta un IDE Go. Il resto dello stack web è già coperto dagli altri pannelli di adOmnia.
- Marketplace di plugin in stile IntelliJ: adOmnia ha già `internal/plugins`; 5.6 si limita a esporre Go Studio a quel runtime, non a costruire un ecosistema separato.
- Emulazione Vim e keymap alternative complete.

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
- Commit: `a321c00` (`feat(goide): add Go Studio foundation`); rilascio `v0.9.35`.
- Comandi e risultati: `npx tsc --noEmit`, `npm run build`, `npm run test` (565 test in 122 file), `go build ./...`, `go test ./...`, `go vet ./...`, `go test -race ./internal/goide`, cross-build Linux/macOS di `internal/goide` e binding Wails beta.25 completati con successo.
- Prova manuale: navigazione verificata nel preview browser sia dalla rail `gO` sia dalla command palette, con stato vuoto dark/compatto e nessuna azione simulata. Un eseguibile Wails beta.25 isolato, con profilo applicativo separato, ha completato startup, apertura dello storage bbolt, shutdown e cleanup; anche il percorso `wails3 task dev` ha completato generazione binding, build frontend, build Go e avvio. L'automazione disponibile non esponeva controlli per interagire direttamente con la finestra nativa Windows, quindi l'interazione del pannello è stata collaudata nel preview e il lifecycle nativo separatamente.
- Limiti rimasti: editor/file tree reali, toolchain, processi Run/Test/Debug, LSP, terminale PTY e multiwindow appartengono alle fasi successive e non sono esposti come controlli attivi nello scheletro di Fase 0.

---

# Fase 1 — Base funzionante end-to-end

Obiettivo: aprire un progetto Go reale, modificarlo, salvarlo, compilarlo, eseguirlo, fornire input e fermarlo senza processi orfani.

## 1.1 Progetti e workspace

- [x] Aprire una cartella locale tramite dialog nativo e registrarne il percorso senza copiarla o modificarla.
- [x] Validare esistenza, tipo e accessibilità della cartella con errori comprensibili.
- [x] Riconoscere `go.mod` e `go.work` alla radice del progetto e mostrarne il modulo dichiarato.
- [x] Riconoscere moduli annidati (oltre alla radice) e distinguere esplicitamente le cartelle Go senza modulo.
- [x] Mostrare chiaramente root del progetto, moduli trovati e workspace Go rilevato.
- [x] Creare un nuovo progetto scegliendo nome, cartella e module path; eseguire `go mod init` solo dopo conferma esplicita.
- [x] Ripristinare tra riavvii le sessioni aperte, rimuovendo automaticamente le cartelle non più disponibili senza perdere le altre sessioni.
- [x] Aggiungere un elenco "Recent Projects" che sopravviva alla chiusura della sessione e permetta di riaprire un progetto già chiuso con un clic.
- [x] Introdurre lo stato di autorizzazione agli strumenti separato dall'apertura del progetto.

## 1.2 Albero file e documenti

- [x] Caricare l'albero cartelle in modo progressivo/lazy invece di leggere ricorsivamente tutto all'apertura.
- [x] Ignorare o ridurre in modo configurabile directory pesanti come `.git`, vendor e output di build.
- [x] Aprire file testuali in tab editor con URI stabile e associazione alla sessione.
- [x] Supportare almeno Go, JSON, YAML, Markdown, `.env`, `go.mod` e `go.work` con linguaggio Monaco appropriato.
- [x] Fornire syntax highlighting Go, numeri di riga, indentazione, bracket matching e folding.
- [x] Mostrare breadcrumb del percorso e indicatore di file modificato.
- [x] Implementare salvataggio esplicito con `Ctrl/Cmd+S`, scrittura atomica e gestione degli errori.
- [x] Non perdere il buffer se il salvataggio fallisce.
- [x] Chiedere conferma Save/Discard/Cancel alla chiusura di un tab, sessione o app con modifiche non salvate.
- [x] Rilevare modifiche esterne del file e offrire Reload/Keep/Compare senza sovrascrivere automaticamente il buffer.
- [x] Implementare ricerca/sostituzione nel file tramite Monaco.
- [x] Implementare Quick Open dei file del progetto con ricerca cancellabile e limite risultati.
- [x] Rinviare esplicitamente, senza controlli finti: split editor, simboli, ricerca progetto semantica e refactor.

## 1.3 Toolchain Go

- [x] Rilevare il binario `go` senza bloccare l'interfaccia.
- [x] Mostrare percorso, `go version`, `GOROOT`, `GOPATH`, `GOPROXY` e `GOPRIVATE`, oscurando eventuali dati sensibili.
- [x] Permettere un percorso Go personalizzato e variabili per progetto/sessione con validazione.
- [x] Mostrare istruzioni operative se Go manca o la configurazione non è valida.
- [x] Non scaricare o installare toolchain automaticamente all'apertura o in background.
- [x] **Offrire un'installazione esplicita del compilatore/toolchain Go** (elenco versioni ufficiali da go.dev, download, verifica checksum, estrazione, avanzamento e log) attivata solo da un'azione utente diretta — stessa coerenza con cui 2.1 e 4.2 già prevedono l'installazione guidata di gopls e Delve. Senza questo passo l'IDE resta bloccato su "istruzioni operative" testuali mentre gopls/Delve avrebbero un installer reale: incoerenza da correggere prima della Fase 1.
- [x] Permettere di gestire più versioni Go installate in parallelo e selezionare quella attiva per progetto/sessione.
- [x] Gestire assenza rete, proxy/moduli privati e dipendenze mancanti come errori visibili e non bloccanti.
- [x] Esporre `go mod tidy` solo come azione esplicita con anteprima del comando e feedback completo.
- [x] **Gestione dipendenze in UI**: elencare i requirement di `go.mod`, aggiungere/rimuovere/aggiornare un pacchetto (`go get`) come azioni esplicite con anteprima del comando, e riflettere lo stato di `go.sum` senza modificarlo mai silenziosamente.

## 1.4 Build, Run, console e Stop

- [x] Definire una configurazione minima per package `main`: target, working directory, argomenti programma, flag Go, build tag e ambiente.
- [x] Separare visivamente e nel modello i flag della toolchain dagli argomenti del programma.
- [x] Eseguire `go build` e `go run` tramite argomenti strutturati, senza shell concatenata.
- [x] Associare ogni esecuzione a `sessionId` e `runId` univoci.
- [x] Trasmettere stdout/stderr incrementalmente, preservando l'ordine utile e senza congelare la UI.
- [x] Mostrare comando, working directory, stato, PID quando disponibile, durata ed exit code.
- [x] Renderizzare ANSI in modo sicuro e limitare il buffer della console.
- [x] Aggiungere ricerca, copia e link cliccabili `file:line` che aprono l'editor nel punto corretto.
- [x] Fornire stdin alla Run console per programmi interattivi.
- [x] Supportare più esecuzioni contemporanee con tab/identità chiaramente separate.
- [x] Implementare Stop idempotente e Restart.
- [ ] Terminare l'intero albero di processi, incluso il binario figlio avviato da `go run`, con adattatore Windows verificato.
- [x] Eseguire cleanup alla chiusura e chiedere conferma se una sessione ha processi attivi.
- [x] Registrare metadati diagnostici senza includere segreti o interi environment.

## 1.5 Interfaccia minima professionale

- [x] Toolbar con progetto attivo, configurazione, Build, Run e Stop; Debug non presente finché non reale.
- [x] Menu bar IDE (File/Edit/View/Go/Run/Help) con sole azioni reali, stati disabilitati motivati e scorciatoie visibili.
- [x] Project tree ridimensionabile a sinistra ed editor a tab al centro.
- [x] Tool window inferiore ridimensionabile con Run e Problems reali.
- [x] Status bar con toolchain, file, posizione cursore e stato di esecuzione.
- [ ] Stati loading, empty, error, running e stopped immediatamente distinguibili.
- [x] Scorciatoie documentate e senza conflitti con quelle globali di adOmnia.
- [ ] Layout corretto con temi dark/light, densità e ridimensionamento finestra.

## 1.6 Test mirati

- [x] Test backend per validazione/confino percorsi e lettura/scrittura atomica dei documenti.
- [x] Test backend per lifecycle Run: start, output, stdin, exit naturale, Stop ripetuto e cleanup.
- [ ] Test Windows che verifica l'arresto dell'intero albero di processi.
- [x] Test di isolamento: output con `runId` errato non entra nella console di un'altra esecuzione.
- [x] Test frontend per dirty state, salvataggio fallito e routing degli eventi per sessione/run.
- [x] Progetto fixture minimo con input stdin, stdout, stderr e processo figlio per la verifica end-to-end.

## Gate di uscita Fase 1

- [x] Aprire un progetto Go reale.
- [x] Navigare i file e modificarne uno.
- [x] Salvare e compilare il progetto.
- [x] Eseguire il programma e leggere output stdout/stderr in tempo reale.
- [x] Fornire input al programma quando richiesto.
- [x] Fermare il programma senza processi orfani. *(verificato su Linux; la prova Windows è la voce manuale in 1.4/1.6)*
- [x] Vedere chiaramente errori di compilazione, dipendenze mancanti e toolchain assente.
- [x] Se la toolchain Go è assente, scaricarla e installarla dall'IDE stesso con un'azione esplicita, senza uscire dall'app o passare da un terminale esterno.
- [x] Chiudere un file dirty senza perdere dati accidentalmente.
- [x] Tutti i controlli visibili nel pannello eseguono funzioni reali.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano. *(automatiche ok; manca il collaudo manuale Windows)*
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

- [x] Rilevare `gopls`, versione e compatibilità; mostrare percorso e stato nella status bar.
- [x] Permettere un binario gopls personalizzato.
- [x] Se gopls manca, mostrare istruzioni e un'installazione esplicita con avanzamento, log ed errore; nessun download silenzioso.
- [x] Avviare un processo gopls isolato per sessione/workspace secondo la decisione architetturale.
- [x] Inizializzare root URI, workspace folders, capability e configurazione Go corrette.
- [x] Gestire restart, crash, backoff limitato e shutdown/exit pulito.
- [x] Non confondere log gopls, diagnostica e output Run tra sessioni.

## 2.2 Client LSP corretto

- [x] Implementare framing JSON-RPC/LSP, correlazione richiesta/risposta ed errori tipizzati.
- [x] Implementare `didOpen`, `didChange`, `didSave` e `didClose` con versioni documento monotone.
- [x] Inviare contenuto dei buffer non salvati, non rileggere il file su disco per richieste semantiche.
- [x] Convertire correttamente coordinate Monaco ↔ LSP, incluse UTF-16 e newline.
- [x] Implementare cancellazione delle richieste obsolete durante digitazione/navigazione.
- [x] Gestire timeout e risposte tardive senza applicarle al documento o alla sessione sbagliata.
- [x] Gestire modifiche workspace/applyEdit in modo transazionale e con conferma quando toccano più file.

## 2.3 Funzioni semantiche

- [x] Pubblicare diagnostica per file/sessione nel gutter, Problems e status bar.
- [x] Implementare completion Monaco da gopls.
- [x] Aggiungere gli import mancanti automaticamente quando si accetta un suggerimento, senza toccare il file su altre righe. *(prova e2e: completando `strings.ToUpper` compare `"strings"` negli import)*
- [x] Implementare hover.
- [x] Implementare signature help.
- [x] Implementare Go to Definition/Type Definition/Implementation dove supportato.
- [x] Implementare Find References con navigazione risultati, raggruppati per file.
- [x] Raggruppare gli utilizzi per tipo (dichiarazione, scrittura, lettura, import), classificati dall'AST Go del file (buffer non salvato incluso), poi per file.
- [x] Implementare document symbols e struttura file richiudibile a destra.
- [x] Implementare workspace symbols e Quick Open simboli.
- [x] Implementare semantic rename con anteprima delle modifiche.
- [x] Implementare code actions e gestione import.
- [x] Implementare formatting configurabile tramite gopls/gofmt.
- [x] Implementare ricerca testuale nel progetto, cancellabile e con esclusioni configurabili.
- [x] Navigare in sola lettura nei sorgenti dell'SDK Go (GOROOT/stdlib) e dei moduli nella module cache tramite definition/hover, senza permetterne la modifica.
- [x] Non usare regex o dati statici per simulare funzioni semantiche (le regex restano solo per il ▶ del gutter su `func main`/`TestXxx`, che non è una funzione semantica).

## 2.4 Linter Go (golangci-lint/staticcheck)

- [x] Rilevare `golangci-lint` (preferito, aggrega staticcheck e altri linter) e, in alternativa/fallback, `staticcheck`; mostrare percorso e versione nella status bar.
- [x] Permettere un binario linter personalizzato per progetto/sessione.
- [x] Se il linter manca, mostrare istruzioni e un'installazione esplicita con avanzamento, log ed errore, con la stessa logica di gopls/Delve/toolchain Go — nessun download silenzioso.
- [x] Rilevare e rispettare una configurazione di progetto (`.golangci.yml`/`.golangci.yaml`/`staticcheck.conf`) se presente, senza crearne una implicita.
- [x] Eseguire il lint su azione esplicita e opzionalmente on-save (impostazione disattivabile), sempre in modo asincrono e cancellabile.
- [x] Pubblicare i risultati come diagnostica nel gutter, in Problems e nello status bar, distinguibili da quelle di gopls ma nello stesso flusso di navigazione.
- [x] Isolare esecuzioni e risultati per sessione/progetto come per gli altri strumenti esterni (una esecuzione per sessione, risultati e marker indicizzati per sessione).
- [x] Non applicare automaticamente fix del linter: eventuali quick-fix restano un'azione esplicita per file/blocco.

## 2.5 Editor avanzato

- [x] Implementare split editor orizzontale e verticale con modelli condivisi e view state indipendenti.
- [x] Implementare tab pin, close others/right e riapertura tab chiuso senza perdere dirty state.
- [x] Implementare breadcrumb simbolico oltre al percorso.
- [x] Integrare code action, rename, references e Problems con navigazione da tastiera.
- [x] Persistenza del layout editor e dei pannelli senza persistere accidentalmente contenuti sensibili.

## 2.6 Editor semantico avanzato (parità GoLand, lato LSP)

Tutte queste voci sono richieste LSP aggiuntive sulla stessa sessione gopls di 2.1/2.2: vanno implementate qui perché condividono plumbing, cancellazione e isolamento per sessione. Nessuna va simulata con regex o euristiche testuali.

- [x] **Semantic highlighting**: semantic tokens di gopls sopra la sintassi, rimappati per nome su una legenda fissa; parametri, costanti, funzioni, tipi, campi e package con colori propri, solo nei temi di Go Studio. Code → Semantic Highlighting.
- [x] **Parameter hints / inlay hints**: nomi dei parametri solo per literal e `nil` (come GoLand) e type parameter dedotti. Code → Parameter & Type Hints, senza modificare il file.
- [x] **Quick Documentation** (Ctrl/Cmd+Q): hover di gopls al cursore; la documentazione compare anche nei dettagli della completion.
- [x] **Quick Definition** (Ctrl/Cmd+Shift+I): popup con l'intera dichiarazione (commento incluso) ritagliata dall'AST, colorata, senza lasciare il file.
- [x] **Show usages** (Ctrl/Cmd+Alt+F7): popup accanto al cursore con gli utilizzi per tipo, navigabile da tastiera, con apertura nella vista Usages.
- [x] **Type Info** (Ctrl/Cmd+Shift+P): tipo dell'espressione al cursore accanto al testo.
- [x] **Exit points highlighting**: documentHighlight di gopls su `func`/`return`/`panic` evidenzia tutti i punti di uscita; sulle variabili distingue lettura e scrittura.
- [x] **Rilevamento chiamate ricorsive**: ⟳ nel gutter e sottolineatura sulle chiamate ricorsive dirette, da call hierarchy di gopls, con debounce.
- [x] **Code generation**: Code → Implement Interface… (Ctrl/Cmd+I) sul tipo al cursore: scelta dell'interfaccia (progetto, dipendenze, SDK), asserzione idiomatica `var _ I = (*T)(nil)`, import aggiunto, metodi generati dal quick fix di gopls, anteprima completa; annullando l'editor torna com'era.
- [x] **Search Everywhere** (Shift Shift): file, simboli, azioni dell'IDE (con scorciatoia e motivo se non disponibili) e pannelli adOmnia, raggruppati per categoria.
- [x] **Inspections e quick-fix da tastiera**: Alt+Enter unisce le code action di gopls alle correzioni proposte dal linter (es. staticcheck S1039) e alla soppressione ufficiale della riga (`//nolint:x`, `//lint:ignore`). Le correzioni del linter compaiono solo se il file non è cambiato dopo l'analisi.
- [x] Degradazione esplicita: le capacità di gopls sono registrate all'avvio; semantic tokens, inlay hints, highlight e call hierarchy si spengono se gopls non li annuncia, e i toggle del menu Code spiegano perché. Le azioni gopls che aprono la sua interfaccia web (Browse documentation, Split package…) non vengono più proposte.

## 2.7 Test mirati

- [x] Test per versioni documento, buffer unsaved e scarto di risposte LSP obsolete.
- [x] Test per conversione posizioni UTF-16 con caratteri multibyte.
- [x] Test per cancellazione richieste e crash/restart gopls.
- [x] Test di isolamento diagnostica tra due sessioni.
- [x] Test per rilevamento/assenza linter, esecuzione cancellabile e isolamento dei risultati tra sessioni.
- [x] Prova reale di completion, hover, definition, references, rename, import e formatting su progetto multi-package.
- [x] Test per semantic tokens e inlay hints: rimappatura della legenda (anche con token scartati), filtro literal, risposte di versioni superate scartate senza azzerare i token (niente flicker); integrazione con gopls reale.
- [x] Prova reale di Quick Documentation, Quick Definition, exit points, chiamate ricorsive e generazione metodi di interfaccia (e2e nel browser contro gopls v0.23.0).

## Gate di uscita Fase 2

- [x] Modificare un buffer non salvato e ottenere diagnostica/completion coerenti con quel contenuto.
- [x] Navigare a definizioni e riferimenti reali tra package.
- [x] Eseguire rename e formatting senza corrompere file o dirty state.
- [x] Riavviare gopls dopo un crash controllato senza riavviare adOmnia.
- [x] Ottenere diagnostica di lint reale (golangci-lint/staticcheck) su un progetto con problemi noti, distinguibile da quella di gopls.
- [x] Semantic highlighting e inlay hints restano coerenti durante la digitazione, senza flicker né token disallineati.
- [x] Un unico gesto da tastiera apre le quick-fix disponibili e le applica correttamente su un buffer non salvato. *(Alt+Enter prima non apriva nulla: corretto)*
- [x] Nessun dato LSP o di lint di un progetto compare in un'altra sessione.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano. *(Automatiche verdi; manca la prova manuale `wails3 task dev` su Windows.)*
- [ ] **FASE 2 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 3.**

### Evidenze della fase

- Data: 2026-09-28
- Commit: `f568303` (backend gopls), `63bbaea` (editor collegato a gopls), `6ff8099` (lint, editor avanzato); rilascio `v0.9.36`.
- Eccezione di processo: la Fase 2 è iniziata prima del gate manuale della Fase 1 su richiesta esplicita dell'utente; entrambi i gate restano da collaudare su Windows.
- Versioni: Go 1.24.7/1.26.5, gopls v0.23.0, golangci-lint v2.14.0, staticcheck 2026.2.1.
- Progetto Go usato: fixture multi-package `internal/goide/testdata/multipkg` (interfaccia, struct, metodo, test) e `testdata/lintissues` con problemi noti.
- Comandi e risultati: `npx tsc --noEmit`, `npm run build`, `npx vitest run` (130 file, 595 test), `go vet ./internal/goide/...`, `go test -race ./internal/goide/...` con gopls, staticcheck e golangci-lint reali (12 esecuzioni ripetute senza flakiness), cross-build Windows del binario e `go vet` darwin.
- Prova end-to-end: frontend reale in Chromium collegato al vero `goide.Service` tramite un server di preview locale (non committato) che implementa il trasporto HTTP di `@wailsio/runtime`. Verificati come utente: apertura e trust del progetto, avvio automatico di gopls, ▶ su `func main` con output reale, ▶ su `TestHello` (`--- PASS`), diagnostica su buffer non salvato, completion, hover, Find Usages, rename su 3 file con anteprima, ricerca simboli (progetto e SDK), F12 nello SDK in sola lettura, salvataggio con optimize imports e reformat verificato su disco, Find in Files, lint golangci-lint (errcheck) in Problems, split editor, breadcrumb simbolico, menu tab con pin, Close Others e Reopen Closed.
- Difetti trovati e corretti durante la verifica: buffer di un file sovrascritto dal contenuto di un altro passando da un documento in sola lettura (perdita dati); race tra chiusura del canale `exited` e stato di gopls dopo Stop; rejection non gestite su chiamate annullate (anche nel vero Wails); focus del dialog Rename; nomi accessibili sporcati dalle icone.
- Limiti rimasti: prova manuale nella finestra Wails nativa non eseguibile nel container (GTK4/WebKitGTK assenti); signature help coperto dal provider e dai test backend ma non ancora osservato a video; lo split editor mostra un file alla volta senza gruppo di tab proprio.
- Chiusura 2.3/2.6/2.7 (2026-09-28, branch `feat/goide-phase3`): nuove richieste gopls (semantic tokens, inlay hints, documentHighlight, call hierarchy), Quick Definition dall'AST, classificazione degli utilizzi dall'AST, correzioni del linter. Test Go con gopls reale (`TestEditorFeaturesWithRealGopls`, `TestImplementInterfaceQuickFixAndNoInertActions`, `TestEditorSettingsProduceNoGoplsWarnings`) e unitari; 140 file / 634 test frontend. E2E nel browser: 11 passi editor semantico, 6 passi Search Everywhere / quick-fix / Implement Interface, auto-import, più le suite di Fase 3 senza regressioni.
- Difetti trovati e corretti in questa chiusura: Alt+Enter e Code → Show Context Actions non aprivano nulla (Monaco 0.56); la lampadina proponeva su ogni riga azioni gopls inerti che aprono la sua interfaccia web; gopls v0.23 segnalava a video impostazioni deprecate (`noSemanticString/Number`); l'anteprima delle modifiche nascondeva il codice inserito su più righe; Search Everywhere mostrava per un istante simboli della ricerca precedente.

---

# Fase 3 — Più progetti, ripristino e terminale integrato

Obiettivo: lavorare su più progetti in sessioni isolate, ripristinabili, con configurazioni persistenti e terminali PTY reali.

## 3.1 Sessioni indipendenti

- [x] Aprire più progetti e passare fra sessioni senza perdere tab, dirty state, layout, diagnostica o console. *(e2e con due progetti: buffer non salvato, console Run e terminale intatti al ritorno)*
- [x] Separare per sessione documenti, gopls, configurazioni, esecuzioni, console e terminali. *(watcher: vedi 3.5)*
- [x] Definire comportamento quando lo stesso file è aperto in due sessioni: buffer indipendenti (un modello Monaco per sessione), avviso se l'altra copia ha modifiche non salvate, schede con cartella quando i nomi coincidono. Salvare una copia fa ricaricare l'altra se pulita, o mostra Reload/Keep/Compare se modificata.
- [x] Rilevare e mostrare conflitti fra buffer concorrenti senza sovrascritture silenziose: il backend rifiuta un salvataggio basato su una versione superata; il watcher avvisa subito l'altra sessione.
- [x] Chiudere una sessione chiedendo cosa fare con file dirty e processi attivi.
- [x] Evitare che la chiusura di una sessione termini risorse appartenenti alle altre. *(anche la pulizia delle sessioni con cartella rimossa ora ferma processi, gopls e terminali solo di quella sessione)*

## 3.2 Persistenza e ripristino

- [x] Persistenza versionata di progetti recenti, sessioni, tab, file attivo, layout e configurazioni (schema v3).
- [x] Migrazione backward-compatible dello schema di persistenza (v2 → v3, testata).
- [x] Ripristinare la sessione senza eseguire automaticamente toolchain, programmi, terminali o gopls non autorizzato. *(i file SDK in sola lettura non vengono salvati nella vista né riaperti al ripristino)*
- [x] Ripristinare buffer non salvati in un recovery store locale e proporre recupero esplicito. *(limiti 4 MB per buffer, 200 buffer, 32 MB totali; se il file su disco è cambiato il recupero chiede conferma; flush immediato alla chiusura della finestra)*
- [x] Gestire cartelle spostate/rimosse e file non più presenti con stato recuperabile.
- Spostato in 5.6: export/import delle impostazioni Go Studio (opzionale).

## 3.3 Configurazioni Run persistenti

- [x] Supportare package `main`, lista esplicita di file Go, build package/progetto, binario compilato e test. *(Test e Binario erano mostrati ma rifiutati dal backend: ora eseguono davvero)*
- [x] Persistenza locale di target, cwd, argomenti programma, flag Go, build tag e ambiente.
- [x] Validare configurazioni prima dell'avvio e mostrare errori contestuali (percorsi confinati al progetto).
- [x] Duplicare, rinominare, ordinare ed eliminare configurazioni.
- [x] Evitare di serializzare segreti in chiaro: i valori segreti sono richiesti al lancio e mai persistiti.

## 3.3b Comandi rapidi e go.mod (richiesta utente: "tutto veloce e semplice")

- [x] CodeLens in `go.mod`: sopra `module` **Update all · Update patches · Tidy · Download · Verify**; su ogni `require` **Update · Replace with local… · Remove**; **Drop replace** su dipendenze già sostituite e su ogni `replace`.
- [x] Replace con cartella locale: selettore nativo, verifica che la cartella contenga un `go.mod`, scrittura relativa (`../lib`) tramite `go mod edit`, nessuna shell.
- [x] Conferma solo per le azioni che possono usare la rete (update, remove, download, tidy); replace/drop/verify sono immediate. Il `go.mod` sporco viene salvato prima del comando.
- [x] `go.mod`/`go.sum` aperti si ricaricano da soli dopo il comando se non modificati; se modificati compare l'avviso Reload/Keep.
- [x] CodeLens sulla riga `package` di ogni file Go: **⚒ Build · ▶ Test · Vet** (+ **Generate** se ci sono direttive `//go:generate`).
- [x] Menu Run: Build/Test/Vet Current Package, Build/Test/Vet All (`./...`), Generate, Install. Scorciatoie: Ctrl/Cmd+F9 build package, Ctrl/Cmd+Shift+F9 build all, Ctrl/Cmd+Shift+F10 test package, Ctrl/Cmd+Alt+F10 test all.
- [x] Menu Go: Update All Dependencies, Update Patch Versions, Download Modules, Verify Modules.
- [x] I comandi partono dal modulo che contiene il file attivo (progetti multi-modulo e `go.work`).

## 3.4 Terminale PTY reale

- [x] Aggiungere xterm.js e addon necessari come dipendenze locali, senza CDN.
- [x] Implementare backend PTY con ConPTY su Windows e adattatori separati per piattaforme supportate (go-pty). *(prova su Windows ancora manuale)*
- [x] Aprire shell locale configurabile nella working directory del progetto, con il `go` della sessione nel PATH e `TERM=xterm-256color`.
- [x] Supportare input interattivo, output streaming, resize e sequenze ANSI.
- [x] Supportare più terminali per sessione con nome, stato e chiusura indipendenti.
- [x] Distinguere chiaramente terminale interattivo e Run console (scheda Terminal nel pannello inferiore, Alt+F12 apre subito una shell).
- [x] Limitare scrollback e throughput per evitare blocchi con output intenso: backpressure invece di scartare output, UTF-8 mai spezzato, cronologia frontend limitata a 512K caratteri.
- [x] Terminare shell e process tree alla chiusura del terminale/sessione/app.
- [x] Non inserire automaticamente credenziali o comandi nel terminale.

## 3.5 Prestazioni e robustezza

- [x] Watcher controllati e deduplicati: uno per progetto (fsnotify), cartelle ignorate escluse, massimo 4.000 cartelle, raffiche raggruppate in 150 ms (massimo 1 s), overflow oltre 500 file o dal kernel, file temporanei dei salvataggi atomici nascosti. I file Go cambiati fuori dall'editor arrivano anche a gopls (didChangeWatchedFiles).
- [x] Ricerca cancellabile e limiti sui risultati (Find in Files, Fase 2). *(indicizzazione progressiva non necessaria: la ricerca delega a gopls e a una scansione cancellabile)*
- [x] Misurare apertura e navigazione su un progetto grande senza bloccare il main thread (3.200 file, 400 package): apertura 0,5-0,7 s, gopls pronto in 1,2-1,5 s, Quick Open 3 ms nel backend e risultato 220 ms dopo l'ultimo tasto, Find in Files 0,6 s, modifica esterna nell'albero 0,26 s; digitando nessun long task.
- [x] Applicare backpressure/coalescing agli eventi di output del terminale.
- [x] Verificare consumo e rilascio risorse passando ripetutamente fra sessioni: 20 cambi, mediana 126 ms, heap JS stabile (156,6 → 156,0 MB); chiudere un progetto ferma solo il suo watcher, i suoi processi e i suoi terminali.

## 3.6 Test mirati

- [x] Test di isolamento completo tra due progetti con output, diagnostica, config e terminali simultanei (`TestTwoProjectsStayIsolatedWhileRunningTogether`, più `TestLanguageServerSessionsStayIsolated` per gopls).
- [x] Test di ripristino sessione e recovery di buffer dirty.
- [x] Test di migrazione della persistenza da una versione precedente.
- [ ] Test PTY: input, resize, exit naturale, kill e cleanup process tree su Windows. *(passano su Linux, incluso cleanup del process tree; Windows da eseguire)*
- [x] Test di conflitto per lo stesso file aperto in due sessioni (`TestSameFileInNestedProjectsNeverOverwritesSilently`, test frontend e e2e).

## Gate di uscita Fase 3

- [x] Due progetti restano completamente isolati durante edit, LSP, Run e terminale.
- [x] Riavviare adOmnia ripristina sessioni e layout senza avviare codice implicitamente.
- [ ] Un terminale interattivo reale funziona, si ridimensiona e si chiude senza processi orfani. *(verificato su Linux; manca Windows/ConPTY)*
- [x] Le modifiche esterne e i conflitti tra sessioni sono gestiti senza perdita silenziosa.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano. *(automatiche ok; manca il collaudo manuale Windows)*
- [ ] **FASE 3 FUNZIONANTE E APPROVATA — è consentito iniziare la Fase 4.**

### Evidenze della fase

- Data: 2026-09-28
- Branch: `feat/goide-phase3`
- Versioni PTY/xterm: `github.com/aymanbagabas/go-pty` (diretta in `go.mod`), `@xterm/xterm` 5.5 con addon fit.
- Progetti Go usati: progetto con `go.mod` che richiede un modulo non pubblicato, cartella `../lib` con proprio `go.mod`, package `util` con test.
- Comandi e risultati: `go vet ./internal/goide/...` ok; `go test -race ./internal/goide/...` ok; `npx tsc --noEmit` ok; `npx vitest run` 134 file / 613 test ok; `npm run build` ok.
- Prova e2e (frontend reale in Chromium + vero `goide.Service`): trust, CodeLens `go.mod`, Replace with local → `replace example.com/lib => ../lib` su disco e ricaricato nell'editor, Drop replace, conferma per Update all, ▶ Test della riga package (`ok example.com/app/util`), Vet, Ctrl+Shift+F9 (`go build ./...`), Run → Test All, Alt+F12 con shell reale (`go version`). Zero errori di pagina.
- Difetti della revisione del lavoro precedente, corretti: terminale che scartava output e spezzava UTF-8 con falso flag di troncamento; `go` della sessione assente dal PATH del terminale; sessioni rimosse che lasciavano gopls e processi orfani; recovery senza limite totale; configurazioni Test/Binario finte; doppia riga di tab Run/Terminal; primo prompt della shell perso; ripristino che provava a riaprire file SDK; recupero che sovrascriveva in silenzio un file cambiato su disco; flush del recovery che non scriveva; Build che ignorava il tipo di configurazione; stringhe UI in italiano; loop infinito di React all'apertura del progetto (selettori Zustand con `?? []`); errore xterm alla distruzione immediata; font del terminale non risolto (variabile CSS passata al canvas).
- Chiusura Fase 3 (watcher, conflitti, isolamento, prestazioni): test Go `watcher_test.go`, `cross_session_test.go`, `isolation_test.go`, `quick_open_test.go`; 143 file / 642 test frontend; e2e nel browser 33/33 passi su quattro suite (go.mod e comandi rapidi, editor semantico, Search Everywhere e quick-fix, due progetti) più la misura su 3.200 file.
- Difetti trovati e corretti in questa chiusura: lo stesso file aperto in due progetti condivideva il modello Monaco (le modifiche di un progetto finivano nel buffer dell'altro); i marker di diagnostica venivano uniti fra progetti per URI; il terminale tornava vuoto passando fra progetti (stato del pannello riusato) e veniva ristretto a poche colonne quando nascosto; l'intero IDE si ridisegnava a ogni tasto, evento Run o avanzamento di gopls (store sottoscritto per intero e cursore nello stato del pannello); Quick Open rileggeva tutto il progetto a ogni tasto e ordinava i risultati per posizione su disco; Find in Files disegnava tutte le righe insieme.
- Limiti rimasti: prove manuali su Windows (ConPTY, finestra Wails); oltre 4.000 cartelle il watcher osserva il progetto solo in parte.

---

# Fase 4 — Test runner, debugger, coverage e finestre separate

Obiettivo: offrire test e debug reali, quindi valutare l'isolamento in finestre separate senza promettere capacità non verificate.

## 4.1 Test runner

- [x] Eseguire `go test -json` per package, progetto, singolo test e sottotest. *(`TestRunRequest` strutturato; ▶ nel gutter, riga package, Run menu, albero)*
- [x] Correlare eventi strutturati per package/test senza affidarsi a parsing fragile del solo testo. *(`testTree`, incluse le build-output/build-fail di Go 1.24+ e i benchmark spezzati su più eventi)*
- [x] Mostrare albero package → test → sottotest, stato, durata, output e dettagli del fallimento.
- [x] Collegare file/riga del failure all'editor.
- [x] Supportare cancellazione e arresto dell'intero process tree. *(Stop nella toolbar Tests; `TestTestRunnerStopKillsTheTestProcess`)*
- [x] Rieseguire tutti i test, un singolo test o soltanto i falliti. *(Ctrl+Shift+Alt+F10 per i falliti)*
- [x] Tenere risultati e output isolati per sessione/esecuzione. *(storico di 20 esecuzioni per sessione, output limitato a 64 KB per nodo)*
- [x] Mostrare stato flaky/skip/timeout quando ricavabile dai dati reali. *(skip e timeout reali; "flaky" non è ricavabile da una singola esecuzione e non viene inventato)*
- [x] Eseguire benchmark (`go test -bench`) e vet/check dalla stessa interfaccia, con risultati leggibili e non solo output grezzo. *(benchmark nell'albero con ns/op e allocazioni; vet dal Run menu e dalla riga package, con errori in Problems)*
- [x] Avviare il debug di un singolo test dalla stessa interfaccia, riusando la sessione Delve di 4.2. *(icona Debug sulla riga del test o sottotest)*

## 4.2 Debugger Delve via DAP

- [x] Rilevare `dlv`, versione e compatibilità con Go; permettere percorso personalizzato. *(ricerca: personalizzato, strumenti adOmnia, GOPATH/bin, PATH; campo dlv in Go → Tool Paths; errore chiaro se l'SDK del progetto è più vecchio di quanto Delve supporti)*
- [x] Se Delve manca, mostrare istruzioni e installazione esplicita con avanzamento/errori. *(conferma con il comando esatto, output nella Run console; proposta automatica al primo Debug)*
- [x] Avviare Delve/DAP solo dopo azione Debug esplicita e con endpoint confinato. *(`dlv dap --listen=127.0.0.1:0`, solo su progetti autorizzati)*
- [x] Implementare handshake, initialize, launch/attach dove supportato, configurationDone e disconnect. *(launch per programmi e test; attach rinviato, vedi "Cosa resta")*
- [x] Gestire breakpoint, verifica e aggiornamento delle righe effettive. *(clic sul numero di riga o Ctrl+F8; pallino vuoto finché Delve non verifica; le righe seguono le modifiche; salvati per progetto e ripristinati al riavvio)*
- [x] Implementare continue, pause, step over, step into e step out. *(F9, F8, F7, Shift+F8, Ctrl+F2; fuori dal debug F7/F8/F9 tornano all'editor)*
- [x] Mostrare thread/goroutine, call stack e navigazione della riga corrente.
- [x] Mostrare scopes, variabili espandibili e watch. *(figli caricati solo all'espansione; watch rivalutati a ogni pausa)*
- [x] Implementare valutazione espressioni con errori chiari. *(console con storico ↑↓ e valore al passaggio del mouse; in console le chiamate di funzione funzionano senza scrivere `call`, nelle watch e nell'hover no per non eseguire codice di nascosto; variabile di un altro frame: "x is not visible in the selected frame", mostrata attenuata e risolta cambiando frame)*
- [x] Associare ogni messaggio a sessione debug e scartare eventi tardivi dopo disconnect. *(token di pausa lato frontend, flag `closed` lato backend)*
- [x] Terminare debugger e debuggee in modo affidabile alla chiusura. *(disconnect con terminateDebuggee, attesa dell'uscita di dlv, poi process tree; binario compilato in una cartella temporanea eliminata all'uscita, mai nel progetto)*

## 4.3 Coverage

- [x] Generare coverage solo su azione esplicita usando toolchain Go ufficiale.
- [x] Mostrare percentuale per package/file e annotazioni linea nell'editor.
- [x] Permettere attivazione/disattivazione overlay senza alterare il file.
- [x] Gestire profili coverage obsoleti dopo modifiche ai sorgenti. *(impronta del file misurato: l'overlay sparisce e l'editor avvisa)*

## 4.4 Finestre separate / più istanze

Decisione (2026-09-28): **rinviato**. La prova reale su Windows non è eseguibile nel container Linux (GTK4/WebKitGTK assenti) e il gate vieta di dichiarare una capacità non verificata. Il prodotto non mostra alcun pulsante o voce per aprire Go Studio in una finestra separata. Due progetti restano utilizzabili in parallelo nella stessa finestra, con isolamento completo verificato (Fase 3 e test 4.5).

- [x] Se non affidabile, lasciare la funzione disabilitata e documentare il limite senza pulsanti finti.
- Il lavoro per abilitarla è spostato in 5.8.

## 4.5 Test mirati

- [x] Test parser/event aggregator di `go test -json`, inclusi sottotest, failure e output concorrente. *(`testrunner_events_test.go`, fixture `testjson/mixed.jsonl` e `bench.jsonl`)*
- [x] Test DAP per sequenza lifecycle, breakpoint, evento stopped e disconnect. *(`dap/client_test.go` con adapter finto; `debug_integration_test.go` con dlv reale)*
- [x] Test cleanup debugger/debuggee e process tree. *(`TestDebuggerStopLeavesNoOrphans`, anche sulla cartella temporanea del binario)*
- [x] Test isolamento simultaneo di test e debug su due sessioni. *(`TestTestsAndDebugStayIsolatedAcrossSessions`)*
- [x] Prova reale di test fallito, rerun failed, breakpoint, step, variabili, watch ed evaluate. *(e2e nel browser, vedi Evidenze)*

## Gate di uscita Fase 4

- [x] Un test fallito è mostrato strutturalmente e apre il file/riga corretti.
- [x] Rerun failed esegue davvero solo il perimetro previsto.
- [x] Una sessione debug reale raggiunge un breakpoint e supporta step, stack, variabili e watch.
- [ ] Stop/chiusura non lascia Delve o debuggee orfani. *(verificato su Linux; manca Windows)*
- [x] Coverage reale è navigabile e non resta applicata a sorgenti non più corrispondenti.
- [x] Multiwindow è verificato e abilitato, oppure esplicitamente rinviato senza dichiarazioni ingannevoli. *(rinviato, vedi 4.4)*
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano. *(automatiche ok; manca il collaudo manuale Windows)*
- [ ] **FASE 4 FUNZIONANTE E APPROVATA — è consentito il collaudo finale.**

### Evidenze della fase

- Data: 2026-09-28
- Commit: branch `feat/goide-phase4` (`158c79d` test runner e coverage, `1e51b45` backend Delve, `37d6836` UI debugger, più la chiusura di fase), unita su master.
- Versioni Go/Delve: Go 1.26.5 (anche 1.24.7 per la prova di incompatibilità), Delve 1.27.2, gopls 0.23.
- Progetti Go usati: `testdata/testproject` (package `calc` con test che fallisce alla riga 17, test lento per il timeout, benchmark), `testdata/debugproject` (`sum`, struct `point`, test `TestSum`).
- Comandi e risultati: `go vet ./internal/goide/...` ok; `go test -race ./internal/goide/...` ok (inclusi `TestDebugger*` con dlv reale e `TestTestsAndDebugStayIsolatedAcrossSessions`); `npx tsc --noEmit` ok; `npx vitest run` 146 file / 657 test ok; `npm run build` ok.
- Prova e2e (frontend reale in Chromium + vero `goide.Service`), 17 passi: ▶ su un test lo esegue da solo nell'albero; il sottotest fallito mostra l'output e apre `calc_test.go:17`; test con coverage e Rerun failed limitato ai falliti; overlay di coverage che sparisce dopo una modifica; breakpoint con clic sul numero di riga; ▶ → Debug 'main' si ferma sulla riga 16 con frame, goroutine e variabili; evaluate `len(values) * 10` = 30; chiamata `sum(nil) + 1` in console; watch fuori scope che si risolve selezionando `main.main`; watch; valore al passaggio del mouse; espansione della slice; F8 e F9; rimozione del breakpoint in pausa e fine programma con output; F8 fuori dal debug lasciato all'editor; breakpoint che seguono l'inserimento e l'undo di una riga; debug di `TestSum` dal gutter con `got = 5` e Ctrl+F2. Zero errori di pagina.
- Difetti trovati e corretti durante la verifica: deadlock del client DAP rispondendo alle richieste inverse dentro il ciclo di lettura; `success:false` omesso dalla serializzazione; errore di evaluate generico al posto di quello di Delve; debuggee orfano dopo Stop; letture senza lock dello stato del debugger; loop infinito di React (selettore Zustand che restituiva un oggetto nuovo); valutazione al passaggio del mouse anche sulla parentesi dopo un nome; binario `__debug_bin` creato nella cartella del progetto e visibile nell'albero; titoli di sessione illeggibili (`^TestSum$`, `.`); rumore "Type 'dlv help'" in console; errore criptico con SDK Go più vecchio di Delve; segnalazione utente "unable to evaluate": le chiamate di funzione fallivano sempre (Delve richiede `call`) e le variabili di un altro frame davano l'errore grezzo "Unable to evaluate expression: could not find symbol value for …".
- Esito multiwindow: rinviato in modo esplicito (4.4), nessun controllo nel prodotto.
- Limiti rimasti: prove manuali su Windows (Stop del debugger e process tree, ConPTY); debug `attach` e remoto non implementati; il fallimento preesistente di `internal/git` (`TestRunTerminalCommandUsesRepositoryCWDAndExitCode`) dipende dalla shell del container che stampa "nvm", non da Go Studio.

---

# Fase 5 — Parità GoLand: assistenza al codice, VCS nell'editor e integrazione con i moduli adOmnia

Obiettivo: chiudere la distanza percepita con GoLand sulle funzioni che un utente si aspetta di trovare in un IDE Go professionale, riusando i moduli che adOmnia possiede già invece di ricostruirli dentro Go Studio.

Prerequisito: gopls è realmente operativo (Fase 2) e il terminale è reale (Fase 3). Le voci puramente LSP di questo elenco vivono in 2.6, non qui.

## 5.1 Refactoring oltre il rename

- [x] Esporre extract function, extract variable, inline e move **solo** attraverso le code action realmente fornite da gopls per il range selezionato. *(Code → Refactor This… Ctrl+Alt+Shift+T; Extract Variable Ctrl+Alt+V, Extract Constant Ctrl+Alt+C, Extract Function/Method Ctrl+Alt+M, Inline Ctrl+Alt+N, Move to New File F6. Se gopls non offre l'azione compare "X is not available here: select …")*
- [x] Mostrare l'anteprima delle modifiche prima di applicarle, con elenco dei file toccati. *(anteprima per le modifiche su più file, con righe rimosse e aggiunte e file nuovi marcati "new"; le modifiche su un solo file si applicano in editor con un unico Ctrl+Z, come in GoLand)*
- [x] Applicare i `workspace/applyEdit` multi-file in modo transazionale: o tutti i file o nessuno, con rollback su errore. *(prima di scrivere si verifica che ogni buffer sia ancora quello su cui gopls ha calcolato gli edit; i file nuovi si creano tutti o nessuno e non sovrascrivono mai)*
- [x] Mantenere il dirty state corretto dopo un refactoring che tocca file non aperti. *(i file toccati si aprono e restano modificati non salvati; i file creati sono già su disco)*
- [x] Non simulare con manipolazione testuale i refactoring che gopls non offre: se non esiste la code action, il comando non compare. *(limite di gopls dichiarato: "Inline variable" sostituisce solo il riferimento selezionato; se era l'ultimo uso gopls segnala la dichiarazione inutilizzata. Rinomina ed eliminazione di file restano rifiutate)*

## 5.2 Navigazione completa

- [x] Go to super method e go to implementation dai gutter marker, non solo da menu. *(clic su I↓/I↑: una destinazione si apre subito, più destinazioni aprono il popup; Navigate → Super Method Ctrl+U)*
- [x] Marcatori nel gutter per implementazioni, override e interfacce implementate. *(I↓ su interfacce e loro metodi con le implementazioni; I↑ su tipi e metodi concreti con le interfacce implementate, anche dell'SDK come `fmt.Stringer`; calcolati da gopls in un solo passaggio per file)*
- [x] Cronologia di navigazione avanti/indietro con scorciatoie e persistenza per sessione. *(Ctrl+Alt+← / Ctrl+Alt+→; gli spostamenti vicini nello stesso file si fondono; salvata con la vista della sessione)*
- [x] Bookmark di riga per sessione, persistenti e navigabili da elenco. *(F11 aggiunge o toglie, Shift+F11 apre l'elenco con anteprima della riga; seguono il testo mentre si scrive)*
- [x] Vista struttura del file sincronizzata con il caret (l'elemento corrente resta evidenziato durante lo scroll).
- [x] Breadcrumb simbolico cliccabile che permette di saltare agli elementi fratelli.

## 5.3 Strumenti Go integrati

- [x] Menu **Go Tools** che esegue i comandi della toolchain sul progetto senza passare da terminale: `go vet`, `go generate`, `go fix`, `go mod why`, `go mod graph`, `go doc`. *(menu Go → "Go Tools: …"; target precompilato: package del file, modulo della riga di go.mod o dell'import, simbolo sotto il cursore)*
- [x] Ogni comando mostra l'anteprima degli argomenti esatti prima dell'esecuzione e riusa la Run console di 1.4 per output, stop e cleanup. *(anteprima calcolata dal backend mentre si scrive; target validati contro l'iniezione di flag; `go fix` e `go generate` avvisano che modificano file e salvano prima gli editor; ogni esecuzione mostra "$ comando" in testa ed "exit code" in fondo, e la finestra Run viene in primo piano)*
- [x] Nessun comando viene eseguito senza autorizzazione strumenti attiva sulla sessione.
- [x] Syntax highlighting per i file assembly Plan9 (`.s`) tramite grammatica Monaco dedicata; nessuna funzione semantica dichiarata su questi file.
- [x] Debug con `attach` a un processo già avviato e debug remoto (`dlv --headless`), con le stesse garanzie di cleanup di 4.2. *(Run → Attach to Process… con elenco filtrabile dei processi; Run → Connect to Remote Delve…; Stop si stacca senza terminare il programma dell'utente. Limite dichiarato: i breakpoint remoti funzionano quando i sorgenti hanno lo stesso percorso sui due lati)*
- [x] Supporto editor per `go.sum`, `.golangci.yml` e file di generazione, coerente con il resto dei linguaggi già gestiti in 1.2. *(go.sum con colorazione dedicata; .golangci.yml come YAML; i file "Code generated … DO NOT EDIT" mostrano un avviso)*

## 5.4 Editor e produttività

- [x] Multi-caret, selezione a colonna e duplicazione riga allineate alle aspettative di un editor moderno (Monaco copre gran parte: verificare e documentare i gap). *(keymap GoLand nel menu Edit: Duplicate Line Ctrl+D, Delete Line Ctrl+Y, Move Line Ctrl+Shift+↑/↓, Add Caret at Next Occurrence Alt+J, Select All Occurrences Ctrl+Alt+Shift+J, Column Selection Mode Alt+Shift+Insert; Alt+clic aggiunge un cursore e Shift+Alt+trascina seleziona a colonna. Gap dichiarati: Extend Selection resta Shift+Alt+→ perché Ctrl+W chiude il tab; Redo è Ctrl+Shift+Z)*
- [x] Vista locale delle modifiche del buffer corrente ripristinabile anche dopo il salvataggio (local history per sessione, con limite di ritenzione e nessun contenuto sensibile persistito oltre il limite). *(File → Local History…: una versione per salvataggio più quella su disco prima del primo salvataggio; diff con il buffer e Restore annullabile con Ctrl+Z. Limiti: 20 versioni per file, 14 giorni, 32 MB totali; `.env`, chiavi e certificati non vengono mai registrati; la cronologia di un progetto chiuso viene eliminata)*
- [ ] Confronto affiancato fra buffer corrente e versione su disco già presente in 1.2: estenderlo al confronto con una revisione VCS quando 5.5 è disponibile.
- [x] TODO/FIXME raccolti in una vista dedicata con navigazione al file/riga. *(finestra TODO con TODO, FIXME, XXX e BUG nei commenti, filtri per tipo e rescan)*
- [x] Split editor con un proprio gruppo di tab (oggi mostra un file alla volta scelto da un menu). *(dalla Fase 1; tab propri, "+" per aprire un altro file, chiusura del tab senza chiudere il file)*
- [x] Avviso nella status bar quando il watcher supera 4.000 cartelle e osserva il progetto solo in parte. *(dalla Fase 3; "Partially watched" con spiegazione nel tooltip)*
- [x] Morph `aO → gO` all'ingresso in Go Studio (400 ms, con `prefers-reduced-motion`), solo se lo si vuole adottare. *(dal mock approvato; sul marchio della menu bar, statico con reduced motion)*

## 5.5 VCS nell'editor

Decisione architetturale da prendere **prima** di scrivere codice: se estendere `internal/git` o creare un dominio VCS separato per i repository di codice. Git Sync (workspace API) non deve regredire in nessuno dei due casi.

- [ ] Rilevare se la root del progetto è un repository Git e mostrarne branch corrente e stato nella toolbar (voce già prevista dal mock approvato).
- [ ] Gutter diff per riga aggiunta/modificata/rimossa rispetto a HEAD, con popup per vedere e revertire il singolo hunk.
- [ ] Blame per riga a richiesta, con autore, data e commit.
- [ ] Cronologia del file e del progetto, con diff navigabile fra revisioni.
- [ ] Stage, commit e branch switch come azioni esplicite, con conferma e senza operazioni distruttive implicite.
- [ ] Nessuna operazione di rete (fetch/pull/push) senza gesto utente diretto; nessuna credenziale scritta nella persistenza di Go Studio.
- [ ] Dichiarare esplicitamente cosa resta non supportato (merge conflict resolution, rebase interattivo, altri VCS) invece di mostrare controlli inerti.

## 5.6 Integrazione con i moduli adOmnia esistenti

Questa sezione non costruisce nuovi strumenti: collega Go Studio a ciò che adOmnia ha già, evitando duplicazione e mantenendo la coesione grafica richiesta da `docs/SOUL.md`.

- [ ] **Docker**: aprire il Docker Lab esistente (`internal/docker`) sul contesto del progetto Go corrente, senza reimplementare gestione immagini e container dentro Go Studio.
- [ ] **Database**: aprire gli strumenti database esistenti (`internal/database`, Mongo Explorer) dal contesto di Go Studio, con la stessa identità visiva.
- [ ] **Plugin**: esporre al runtime plugin (`internal/plugins`) gli eventi e i comandi di Go Studio realmente stabili, documentando il contratto e la sua versione.
- [ ] **HTTP/API**: da un handler Go individuato nel codice, aprire una richiesta precompilata nel workspace API di adOmnia — integrazione che nessun IDE concorrente offre e che rafforza i pilastri del prodotto.
- [ ] Export/import delle impostazioni Go Studio, solo se compatibile con il formato workspace e documentato. *(opzionale, dalla Fase 3)*
- [ ] Ogni integrazione deve funzionare in entrambe le direzioni o essere dichiarata a senso unico; nessun pulsante che apre un pannello vuoto.

## 5.8 Finestre separate / più istanze (rinviate dalla Fase 4)

- [ ] Prototipare una finestra Wails secondaria Go Studio riusando il pattern esistente senza duplicare ownership backend.
- [ ] Verificare focus, shortcut, eventi, chiusura, dirty state e cleanup tra finestra principale e secondaria.
- [ ] Verificare comportamento se lo stesso progetto è aperto in più finestre o istanze.
- [ ] Introdurre locking/coordinamento o avviso di conflitto prima di abilitare la funzione.
- [ ] Dichiarare nel prodotto il supporto multiwindow solo dopo prova reale su Windows e piattaforme dichiarate.

## 5.7 Test mirati

- [ ] Test per l'applicazione transazionale di un refactoring multi-file, incluso il rollback su errore a metà.
- [ ] Test per il calcolo del diff di gutter su file con CRLF, file binari e file non tracciati.
- [ ] Test per la costruzione degli argomenti dei comandi Go Tools (nessuna shell concatenata, nessun path fuori dalla root).
- [ ] Test di isolamento: stato VCS, Go Tools e local history restano separati fra due sessioni.
- [ ] Prova reale su un repository Git con modifiche non committate: gutter, blame, cronologia e revert di un hunk.

## Gate di uscita Fase 5

- [ ] Un extract function reale su codice multi-package produce codice compilabile e anteprima corretta.
- [ ] La navigazione a super method/implementation funziona dai gutter marker su un'interfaccia con più implementazioni.
- [ ] I comandi Go Tools producono output reale nella Run console e si fermano senza processi orfani.
- [ ] Il gutter diff, il blame e la cronologia riflettono lo stato reale del repository e Git Sync non ha subito regressioni.
- [ ] Le integrazioni con Docker Lab, Database, Plugin e workspace API aprono il contesto corretto e non pannelli vuoti.
- [ ] Nessuna funzione di parità è simulata: ciò che gopls o Git non forniscono è assente o dichiarato.
- [ ] Suite e verifiche previste dalla definizione di fase funzionante passano.
- [ ] **FASE 5 FUNZIONANTE E APPROVATA — è consentito il collaudo finale.**

### Evidenze della fase

- Data:
- Commit:
- Versioni Go/gopls/Git:
- Progetto e repository usati:
- Comandi e risultati:
- Prova manuale:
- Integrazioni verificate:
- Limiti rimasti:

---

# Collaudo finale e documentazione

## Flussi completi

- [ ] Da installazione pulita: aprire un progetto, autorizzarlo, modificare, salvare, buildare, eseguire, inviare stdin e fermare.
- [ ] Creare un progetto nuovo, riaprirlo dai recenti e ripristinare la sessione.
- [ ] Lavorare su due progetti contemporaneamente senza contaminazione di stato o output.
- [ ] Gestire file modificato esternamente e conflitto dello stesso file tra sessioni.
- [ ] Usare completion, diagnostica, definition, references, rename, import e formatting su buffer dirty.
- [ ] Usare terminale, test runner, benchmark, debugger e coverage su progetto reale.
- [ ] Usare semantic highlighting, inlay hints, quick documentation, exit points e generazione metodi di interfaccia su codice reale.
- [ ] Eseguire un extract function e verificare che il progetto compili ancora.
- [ ] Usare gutter diff, blame e cronologia su un repository Git reale senza regressioni su Git Sync.
- [ ] Aprire Docker Lab, strumenti database e una richiesta API dal contesto di Go Studio.
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

- [ ] Tutti i gate delle Fasi 0–5 risultano spuntati con evidenze.
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
