# Piano operativo: IDE JavaScript/TypeScript e framework web

Data: 11 ottobre 2026. Stato: proposta; nessuna fase implementata da questo piano.

## Punto di partenza verificato

Il refactor della piattaforma è già presente: internal/ide contiene language, project, lsp, dap, run, testing, sdk e process. internal/goide è la facciata Wails/composition root; internal/languages/golang è l'unico adapter registrato. Anche IDE_LANGUAGES nel frontend contiene soltanto GO_LANGUAGE.
Il lifecycle LSP multi-server risiede ancora nella facciata internal/goide/lsp.go: riutilizzarlo; estrarre solo i punti che impediscono concretamente il secondo adapter. Non ripetere il precedente refactor né rinominare in massa file, binding o chiavi goide.
La checklist smoke desktop del precedente refactor rimane aperta. Presenza del codice e vecchi risultati automatici non attestano un nuovo collaudo.

## Decisioni

- Un adapter backend JavaScript/TypeScript condiviso, con selettori JS, JSX, TS, TSX; React, Vite e Next.js sono profili di progetto, non linguaggi separati.
- Riutilizzare registry, ServerSpec, client LSP/Monaco, DAP, process supervisor, terminale, Git e trust esistenti. Non introdurre monaco-languageclient senza dimostrare una lacuna concreta.
- Il secondo consumer rende giustificata una capability per costruire la ServerSpec: introdurla se necessaria, mantenendo compatibili i metodi Go pubblici.
- Tooling locale: TypeScript del progetto quando disponibile, versione gestita come fallback esplicito. Versioni server/runtime fissate e compatibili; niente aggiornamenti silenziosi.
- Apertura e detection non eseguono script. Installazioni, package scripts e server partono da azioni esplicite rispettando il trust esistente; downloads solo richiesti dall'utente.
- Persistenza additiva e migrazioni in lettura; nessuna dipendenza obbligatoria da Node per gli utenti Go.
- Pilastri: Local-First e User-Extensible; preview/network aggiungono Browser Debugging Integrated.

## Fasi e criteri di uscita

### 0 — Baseline e lacune reali
- [ ] Verificare workspace Go legacy, completion, rename, run/test/debug, terminale e Git sulla build desktop.
- [ ] Tracciare routing documenti, startup LSP, capability UI, unità e selezione runtime; elencare le assunzioni Go residue che bloccano JS/TS.
- [ ] Preparare fixture: TS puro, JS con jsconfig, React/Vite, Next.js e workspace Go + frontend; includere percorsi con spazi.
Uscita: baseline riproducibile e elenco circoscritto delle modifiche, senza riscrittura generale.

### 1 — Primo adapter JS/TS e runtime
- [ ] Aggiungere internal/languages/typescript e registrarlo in internal/goide/languages.go.
- [ ] Riconoscere package.json, tsconfig/jsconfig e lockfile senza processi; esclusione node_modules, dist, .next e directory generate; limiti di scansione.
- [ ] Gestire unità annidate/monorepo e assegnare ogni documento alla radice corretta.
- [ ] Rilevare Node, TypeScript e language server; mostrare versione, percorso, assenze e incompatibilità nella UI esistente del tooling.
- [ ] Risolvere eseguibili Windows .cmd/.exe senza concatenare comandi shell arbitrari.
Uscita: progetto JS/TS riconosciuto anche senza Go installato; runtime assente spiegato e nessuna esecuzione all'apertura.

### 2 — Intelligence editor completa
- [ ] Avviare typescript-language-server --stdio tramite ServerSpec e instradare i documenti con languageId corretti.
- [ ] Aggiungere frontend/src/components/ide/languages/typescript e registrazione in IDE_LANGUAGES.
- [ ] Verificare completion, hover, signature help, definition, references, diagnostica, rename multi-file e organize imports.
- [ ] Disabilitare o coordinare i provider Monaco TS incorporati per evitare completion e diagnostica duplicate.
- [ ] Verificare UTF-16, annullamento richieste, buffer non salvati, edits atomici e risposte obsolete.
- [ ] Verificare gopls e TS LSP contemporanei, riavvio limitato dopo crash e shutdown senza processi orfani.
Uscita: modifica e rename reali di componenti TSX/JSX in workspace misto, con Problems corretti e regressioni Go assenti.

### 3 — React/Vite e workflow di sviluppo
- [ ] Detection framework da dipendenze e configurazioni; scelta package manager da packageManager/lockfile, conflitti mostrati chiaramente.
- [ ] Elencare script reali da package.json e integrarli in run configuration e workflow esistenti.
- [ ] Install dependencies, Run/Stop/Rerun con comando, cwd e log visibili; nessuna modifica implicita ai lockfile.
- [ ] Live Preview dal dev server locale con HMR: riutilizzare browser esistente, verificare embedding, porte occupate e fallback quando il sito non è incorporabile.
- [ ] Integrare Start/Stop Workspace Go + frontend e proprietà dei processi: fermare solo quelli avviati da adOmnia.
Uscita: aprire React/Vite, avviare dev, vedere HMR e arrestare l'intero workflow senza processi residui.

### 4 — Next.js e strumenti di qualità
- [ ] Supportare script dev/build/start e plugin TypeScript Next del progetto; verificare caricamento reale e tipi generati .next.
- [ ] Integrare Prettier ed ESLint dalle dipendenze/configurazioni locali, senza applicare regole globali né doppie diagnostiche.
- [ ] Primo test runner Vitest tramite capability testing esistente: discovery, risultati strutturati, rerun failed e cancellazione. Jest successivamente.
- [ ] Aggiungere HTML/CSS/JSON e Tailwind come server complementari solo dopo routing e deduplica corretti.
Uscita: fixture Next con diagnostica specifica verificata, format/lint/test utilizzabili e fallimenti mostrati chiaramente.

### 5 — Debug JavaScript progressivo
- [ ] Adapter vscode-js-debug tramite DAP esistente; prima Node launch/attach con source map TS.
- [ ] Breakpoint, pause, stepping, variables, watch, call stack e stop verificati con runtime reale.
- [ ] Poi browser React/Vite e infine Next server + client: sessioni distinte e selezione target chiara.
- [ ] Verificare che il DebugManager corrente possa ospitare Go e JS simultanei; estenderlo solo se il collaudo rivela il limite.
Uscita: breakpoint nel sorgente TS e TSX corretto; debug Go conservato; chiusura/riavvio puliti.

### 6 — Flusso integrato adOmnia
- [ ] Collegare preview e browser/network esistenti al workspace; verificare che la preview sia effettivamente osservabile dal backend CDP.
- [ ] Navigazione verso API Client, sorgente e Database attraverso lib/entities e devcontext esistenti.
- [ ] Demo Go API + React: modifica con HMR, richiesta, ispezione rete, breakpoint backend e frontend.
Uscita: workflow reale completo; non promettere intercettazione automatica se trasporto browser/WebView non la permette.

### 7 — Estensioni framework
- [ ] Vue/Volar per primo, poi Svelte, Astro e Angular, ciascuno con fixture e release separata.
- [ ] Per ogni server definire ownership dei file, runtime, configurazione, capability e interazione con TS LSP.
- [ ] Confermare che un nuovo adapter non richieda switch per linguaggio nel core.
Uscita: completion/diagnostica/rename e dev preview reali per ogni framework dichiarato supportato.

## Verifica e rilascio

Ogni fase chiude un workflow verticale: test mirati a routing, processi, trust e compatibilità; test architetturali; TypeScript; build frontend; check:startup (650 kB); build/test Go appropriati. Per modifiche UI: test localizzazione, dark/light, tastiera e smoke Wails della nuova build. Gate finale completo Go/frontend e build/smoke nativi sulle piattaforme dichiarate supportate. Segnare le checkbox solo con evidenza; distinguere automatico, manuale e non verificato.

Primo rilascio: fasi 0-3, JS/TS + React/Vite con editor e dev preview. Next/quality nel secondo incremento, debug nel terzo. Nessuna stima temporale affidabile prima della fase 0. Nome visibile IDE Studio valutabile dopo il primo rilascio; identità persistite e binding Go restano compatibili.

## Fonti tooling

- TypeScript Language Server: https://github.com/typescript-language-server/typescript-language-server/releases (v6 richiede Node >=22.22.2; verificare versione fissata durante implementazione).
- Next TypeScript plugin: https://nextjs.org/docs/app/api-reference/config/typescript
- JS DAP adapter: https://github.com/microsoft/vscode-js-debug
