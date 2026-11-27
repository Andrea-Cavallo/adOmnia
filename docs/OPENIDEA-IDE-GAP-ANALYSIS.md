# OpenIDEA → adOmnia: funzionalità da portare in Code Studio

Analisi dei sorgenti locali del 26 novembre 2026. OpenIDEA: `C:\Users\Andrea\Workspace\02_Development\openidea`, HEAD `81c2fc9ac`, package 0.1.53. adOmnia: HEAD `3bcfeedb`, con modifiche concorrenti nell'area Database escluse da questo lavoro.

Questa è un'analisi funzionale e architetturale, non una verifica dell'interfaccia in esecuzione. Non sono stati avviati gli IDE, eseguiti benchmark o rilanciati i test. La presenza di test citati è evidenza di copertura prevista, non di esito verificato in questa sessione. Le priorità e i costi relativi sono valutazioni progettuali.

## Decisione proposta

Portare prima gli strumenti che migliorano il lavoro quotidiano sui linguaggi già supportati: transazioni di modifica con Undo/Redo globale, live template/postfix, profili delle ispezioni e scope riutilizzabili. Poi completare le operazioni sui file e aggiungere changelist, ricerca strutturale e duplicati. Notebook e backend remoto completo sono progetti successivi.

OpenIDEA usa React, CodeMirror e un backend Rust/Tauri; adOmnia React, Monaco e Go/Wails. Sono trasferibili i contratti e i comportamenti, mentre editor, IPC e backend richiedono adattamento. Non propongo di sostituire Monaco o il core Go.

## Cosa adOmnia ha già

| Area | Riscontro nel checkout adOmnia | Conseguenza |
|---|---|---|
| Search Everywhere, azioni, keymap | `CodeStudioSearchEverywhere.tsx`, `codeStudioCommands.ts`, `codeStudioKeymap.ts` | Estendere il registro esistente; non crearne un secondo. |
| Rename, extract, inline, move e change signature | `codeStudioRefactorings.ts`, `CodeStudioChangeSignatureDialog.tsx`, `CodeStudioMoveSymbolDialog.tsx` | Il divario è nella copertura per linguaggio e nel ciclo preview/applica/annulla. |
| Problems e widget delle ispezioni | `CodeStudioProblems.tsx`, `CodeStudioInspectionWidget.tsx`, `stores/codeStudioLsp.ts` | Manca, nei percorsi esaminati, un sistema generale di profili per regola equivalente a OpenIDEA. |
| Agent task, review, verifiche e MCP | `CodeStudioAgentTask*.tsx`, `internal/ide/agenttask`, `agentreview`, `agentcontrol`, `docs/AGENT-IDE-CONTROL.md` | Non serve ricostruire una chat o un sistema task. |
| Git, stage selettivo, stash e worktree | `internal/git`, `internal/git/stash.go`, `CodeStudioGitPanel.tsx` | Changelist e shelf sono incrementi; lo stash selettivo esiste già. |
| Emmet e alcuni snippet locali | `components/ide/languages/web/emmet.ts`, `languages/java/javaLocalCompletion.ts` | Serve una gestione comune dei template, non un'altra implementazione Emmet. |
| Run in altri ambienti | `internal/ide/remote/remote.go`, `devcontainer.go` | WSL/SSH/container sono già target; un IDE interamente remoto è un livello ulteriore. |
| Più linguaggi e adattatori dichiarativi | `internal/languagecatalog/catalog.go`, `internal/languages/*` | Non usare il numero di linguaggi pubblicizzato da OpenIDEA come misura della qualità. |
| Profili, trace, benchmark e risorse | `CodeStudioProfilePanel.tsx`, `CodeStudioTracePanel.tsx`, `docs/PERFORMANCE.md` | Integrare misurazioni esterne comparabili, senza duplicare il monitor. |
| API, database, servizi e contesto | catalogo funzionale, `lib/entities`, `internal/devcontext` | Riutilizzare questi collegamenti: sono parte distintiva di adOmnia. |

I percorsi frontend abbreviati nella tabella sono sotto `frontend/src/components/code-studio/`, salvo indicazione diversa. Alcuni documenti di adOmnia descrivono ancora una situazione prevalentemente Go: per le conclusioni ho privilegiato i file attuali rispetto alle descrizioni storiche.

## 1. Transazioni di refactoring con Undo/Redo su tutti i file

**Priorità P1, costo relativo medio-alto. È la base degli interventi successivi.**

OpenIDEA mantiene una storia di workspace: un refactoring su più file può essere annullato come una sola operazione, inclusi i movimenti supportati. Riferimenti: `src/editor/core/model/workspaceHistory.ts`, `src/features/code-insight/workspaceUndo.ts`, `src/features/project-tree/fileRefactor.ts` e relativi test.

adOmnia ha già preview e controlli contro buffer obsoleti in `codeStudioWorkspaceEdits.ts`, con test in `codeStudioWorkspaceEdits.transaction.test.ts`. Nel percorso esaminato, però, applica gli edit all'editor attivo con Undo locale, aggiorna gli altri documenti nello store e crea i file nuovi attraverso il backend. Non offre qui una storia unica che annulli l'intera operazione.

Da portare:

- Un identificatore di transazione per modifiche, creazioni e, quando supportati, spostamenti/eliminazioni.
- Baseline/versione dei documenti, controllo prima dell'applicazione e prima di Undo/Redo.
- Una sola azione Undo/Redo per il refactoring, senza cancellare edit successivi dell'utente.
- Politica esplicita per operazioni su disco e fallimenti parziali; il solo precontrollo dei buffer non garantisce rollback I/O.

Integrare il modello nei helper di workspace esistenti; la parte filesystem va nel core Go, non nel binding Wails. Riutilizzarlo successivamente per refactoring, sostituzioni strutturali e cleanup. La review degli agenti conserva i propri controlli di baseline, senza forzare un'unificazione prematura.

**Accettazione:** refactoring di tre file, uno nuovo; Undo/Redo completo; conflitto con una modifica successiva; errore di scrittura; chiusura/cambio progetto; preservazione dei buffer non salvati.

## 2. Live template, Surround With e postfix condivisi

**Priorità P1, costo medio. Miglioramento immediato durante la scrittura.**

Riferimenti OpenIDEA: `src/features/templates/live/model.ts`, `postfix/model.ts`, `settings/LiveTemplatesPage.tsx`, `settings/PostfixPage.tsx`, test in `src/features/templates/__tests__/`.

Il modello offre abbreviazioni, variabili collegate, contesti per linguaggio, `$SELECTION$`, posizione finale, template utente e postfix come `expr.if`, `items.for`, `value.nn`. Le espressioni sono riconosciute con l'albero sintattico dell'editor: non basta copiare le stringhe dei template.

In adOmnia partire dai contribution dei linguaggi e dallo snippet engine Monaco:

- Catalogo comune con contributi per linguaggio, template utente e import/export locale.
- Tabstop, segnaposto collegati e Surround With sulla selezione.
- Primo insieme circoscritto per Go, Java, Python, Rust e web.
- Postfix solo dove si può identificare in modo affidabile l'espressione. Quando manca informazione sintattica o di tipo, limitare l'offerta invece di indovinare.
- Variabili con funzioni consentite, senza `eval`, shell o esecuzione di contenuti del progetto.

**Accettazione:** espansione e annullamento, campi ripetuti, CRLF/Unicode, commenti/stringhe, precedenza di Tab rispetto a completamento/indentazione/Vim, nessun conflitto con Emmet e suggerimenti LSP.

## 3. Profili delle ispezioni e Inspect Code per scope

**Priorità P1, costo medio-alto. Più controllo sui problemi e sui progetti grandi.**

Riferimenti OpenIDEA: `src/platform/inspections.ts`, `inspectionControls.ts`, `src/features/analysis/inspect.ts`, `cleanup.ts`, `scope.ts`, `src/features/settings/pages/editor/inspectionsModel.ts`.

Da portare sopra Problems e diagnostiche esistenti:

- Identità stabile della regola: produttore, linguaggio e codice diagnostico; fallback esplicito per diagnostiche senza codice.
- Profili utente e progetto: attiva/disattiva e override della severità.
- Menu contestuale del problema per modificare la regola e aprire le sue impostazioni.
- Inspect Code su file, directory/unità, progetto o file modificati, con progressi, Stop e riepilogo della copertura.
- Risultati per severità → regola → file, distinguendo risultati freschi da diagnostiche già memorizzate.

Non chiamare una raccolta dei soli file aperti «analisi completa del progetto». LSP e strumenti diversi hanno capacità diverse: file saltati, server non pronti e analisi parziale devono essere espliciti. Un override della presentazione non modifica automaticamente configurazione e comportamento del linter.

La configurazione deve estendere in modo additivo gli settings esistenti. Non sovrascrivere `.adomnia/settings.json` o i file dei tool. I controlli Security Center e le policy AI mantengono significato e autorità separati.

**Accettazione:** due produttori con lo stesso codice, regole senza codice, isolamento tra progetti, file chiusi, annullamento, report parziale, import di vecchie impostazioni.

## 4. Scope salvati e riutilizzati tra ricerca e analisi

**Priorità P1 come fondazione di 3 e 7, costo medio.**

OpenIDEA risolve scope comuni in `src/features/analysis/scope.ts`, con definizioni e ricerca in `src/platform/scopes.ts` e `src/features/search/find/ScopesDialog.tsx`.

adOmnia ha già include/exclude in `CodeStudioFindInFiles.tsx`. Aggiungere scope nominati, ad esempio «sorgenti senza generati», «unità corrente», «file modificati», riusabili da Find, Inspect Code e ricerca strutturale. Tenere la prima versione limitata a file/unità/glob: non serve importare subito una sintassi complessa.

**Accettazione:** progetti con unità annidate, percorsi Windows, esclusioni, file eliminati e untracked, scope vuoto e aggiornamento dello stato Git. Le esclusioni per ricerca non sostituiscono i filtri di privacy del contesto AI.

## 5. Rename/Move dei file con aggiornamento dei riferimenti e Safe Delete

**Priorità P1, costo alto e dipendente dal linguaggio.**

Riferimenti OpenIDEA: `src/features/project-tree/fileRefactor.ts`, `operations.ts`, `src/editor/refactor/fileReferences.ts`, `safeDelete.ts`, `safeDelete.test.ts`, `src/features/project-tree/safeDelete.test.ts`.

Nel menu adOmnia `codeStudioTreeMenu.ts` Safe Delete è esplicitamente disabilitato. Il percorso `codeStudioTreeActions.ts` usa le operazioni sui file esistenti; nei percorsi cercati non ho trovato il flusso generale `workspace/willRenameFiles` equivalente.

Da portare: richiesta degli edit dei riferimenti ai server che la supportano, preview, aggiornamento dei tab aperti, spostamento e Undo come unica operazione. Per Safe Delete: ricerca degli usi, elenco navigabile e dichiarazione del grado di completezza dell'analisi.

Non confondere «nessun uso trovato» con «sicuro da eliminare»: reflection, registrazioni e caricamenti dinamici restano limiti. Anche OpenIDEA ha fallback e limiti: `safeToDelete` può ritornare senza ricerca oltre la soglia prevista. Non trasferire quel comportamento come garanzia di sicurezza. Una ricerca saltata/incompleta deve essere visibile.

**Accettazione:** import aggiornati, server privo della capability, server non pronto, rinomina del solo maiuscolo su Windows, cartelle, buffer dirty, conflitto e Undo.

## 6. Changelist locali; shelf come incremento successivo

**Priorità P2, costo medio per changelist; maggiore per shelf completo.**

OpenIDEA: `src/features/vcs/changelists.ts`, `changelistsUi.tsx`, `shelf.tsx`, `crates/ide-vcs/src/changelists.rs`, `shelf.rs` e test dedicati.

Portare prima gruppi locali nominati di file modificati, lista attiva e messaggio di commit per gruppo. Esempio: separare «fix IDE», «database» e «documentazione» nello stesso checkout. La prima versione può assegnare file interi: la selezione di hunk del Git esistente resta indipendente.

adOmnia ha già `StashPaths`, `StashApply` e preview dello stash in `internal/git/stash.go`: non ricostruirli sotto il nome shelf. Una shelf vera aggiunge patch persistenti nominate, anteprima, ripristino con conflitti e ciclo di vita indipendente dallo stash. Valutarla dopo le changelist.

Usare metadati locali per il checkout: l'organizzazione personale non deve alterare automaticamente l'index Git o diventare un file condiviso del team. Gestire repository annidati e worktree separati.

**Accettazione:** assegnazione dei nuovi cambiamenti, rename/delete, commit parziale, index già modificato, refresh, worktree e ripristino con conflitti.

## 7. Ricerca/sostituzione strutturale e rilevamento duplicati

**Priorità P2, costo alto. Valore concreto per manutenzione e migrazioni.**

OpenIDEA: `crates/ide-analysis/src/structural.rs` usa ast-grep su grammatiche tree-sitter; `duplicates.rs` usa token, rolling hash e verifica dei candidati. Frontend: `src/features/analysis/structural.ts`, `duplicates.ts`, `DuplicatesView.tsx`.

La ricerca strutturale riconosce forma del codice e placeholder, ad esempio `$E.unwrap()`, anche con spaziatura diversa. Il rilevamento duplicati può ignorare nomi e letterali e mostrare frammenti ripetuti senza suggerire automaticamente che siano equivalenti semanticamente.

Per adOmnia valutare prima una integrazione opzionale e versionata di ast-grep, con linguaggi realmente disponibili dichiarati. Confrontare costo di distribuzione e manutenzione con un'integrazione nativa; non introdurre un servizio Rust permanente solo per riusare il crate. Questa scelta richiede uno spike, non è risolta dall'analisi.

Riutilizzare Find/References, scope e transazioni di modifica. Prima ricerca read-only, poi preview selettiva e sostituzione. Buffer non salvati, coordinate UTF-16, limiti di risultati e cancellazione fanno parte del contratto.

**Accettazione:** nessuna corrispondenza testuale falsa in commenti/stringhe, placeholder ripetuti, codice incompleto, Unicode/CRLF, buffer cambiato dopo la preview, repository grande e Stop. Per i duplicati, limiti sui casi altamente ripetitivi e segnalazione di report troncato.

## 8. Notebook Python

**Priorità P3, costo alto. Funzionalità nuova, da scegliere in base all'uso reale.**

OpenIDEA: `src/features/notebook/NotebookEditor.tsx`, `session.ts`, `security.ts`, `outputs.ts`, `crates/ide-notebook`, `docs/en/guide/notebook.mdx`.

Porta file `.ipynb` con celle codice/Markdown, kernel Python locale, scelta ambiente, output, interrupt/restart, save e history. OpenIDEA dichiara limiti precisi: kernel Python locali, niente server Jupyter remoti, niente widget interattivi o JavaScript eseguito.

In adOmnia partire dal selettore interprete Python e dal registro degli editor specializzati; processo del kernel nel core, dietro trust e azione esplicita. Separare modello notebook e lifetime del kernel dal montaggio React. Output HTML/SVG richiedono rendering sicuro, senza rete o script involontari. Non è un'estensione del vecchio runtime plugin Python.

**Accettazione:** round-trip senza perdere metadata/output sconosciuti, nessuna esecuzione all'apertura, ambiente mancante, interrupt/restart, output voluminoso e chiusura con modifiche.

## 9. IDE remoto completo

**Priorità P3, costo molto alto. Non è un piccolo porting.**

OpenIDEA: `src/features/remote-dev`, `crates/ide-remote`, `docs/en/guide/remote/server.mdx`, `ssh.mdx`, `containers.mdx`. Il server remoto espone il backend IDE, non soltanto l'esecuzione dei comandi.

adOmnia già costruisce comandi per WSL, SSH e container e traduce i percorsi. Il salto successivo sarebbe spostare anche filesystem, LSP, watcher, terminale e debug nell'ambiente remoto, con riconnessione e inoltro delle porte. Richiede un contratto di trasporto e versionamento; non basta aggiungere un pulsante «SSH».

Prima consolidare i target attuali; iniziare un backend remoto solo con una necessità concreta. Accesso a un host scelto dall'utente può rispettare il controllo dei dati, ma non deve diventare un servizio cloud obbligatorio.

## Miglioramenti trasversali da riprendere

- **Azioni come contratto comune.** `src/platform/actions.ts` di OpenIDEA centralizza disponibilità, toggle e operazioni in corso. adOmnia ha già il registro: estenderlo gradualmente affinché menu, shortcut e toolbar condividano comportamento e stato, evitando un refactor generale preventivo.
- **Benchmark esterni riproducibili.** `perf/compare/README.md` misura l'intero albero dei processi, alterna i run e conserva i fallimenti. Integrare questa metodologia con le misure adOmnia esistenti su avvio, editing, idle e chiusura. Non riusare i numeri pubblicati da OpenIDEA come previsione dei risultati di adOmnia.
- **Contributi IDE estendibili.** `plugins/README.md` e `wit/` mostrano contratti per comandi, linguaggi, pannelli ed editor. adOmnia possiede già contribution reali in `codeStudioExtensions.ts`: la nota storica «plugin read-only» in `docs/ISSUES.md` non descrive interamente il codice corrente. Prima di ampliare l'API, inventariare quella esistente; non importare un secondo runtime WASM o marketplace per imitazione.

## Ordine di implementazione

1. Transazioni workspace e Undo/Redo globale.
2. Live template e Surround With; postfix per linguaggio dove affidabile.
3. Scope comuni, profili e Inspect Code cancellabile.
4. Rename/Move con riferimenti e Safe Delete capability-gated.
5. Changelist sopra il Git attuale.
6. Ricerca strutturale read-only, poi replace; duplicati in un blocco separato.
7. Notebook solo dopo scelta del perimetro Python; backend remoto come iniziativa autonoma.

I blocchi 1–5 migliorano profondità e affidabilità senza aggiungere un altro grande pannello di prodotto. Riusano dati locali/versionabili, contribution e adattatori; Inspect/scope e le operazioni sui file rafforzano anche i workflow enterprise e i progetti multi-unità. Per ogni piano esecutivo verificare esplicitamente i due pilastri pertinenti senza trasformare la mappa in una giustificazione automatica.

## Regole per il porting

- Logica generica in `internal/ide`, specifica nei language adapter, composizione nel catalogo esistente; binding Wails sottili.
- UI con componenti Code Studio esistenti; navigazione tra moduli attraverso entity router.
- Settings e workspace solo con estensioni compatibili e migrazione documentata se necessaria.
- Ogni blocco: test mirati dei comportamenti, TypeScript/build pertinenti, poi uso nel desktop reale. Build e fixture non attestano accettazione Wails.
- Per eventuale riuso letterale di sorgenti, esaminare `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES.md` e le intestazioni dei file scelti prima del porting; in questa analisi non è stato copiato codice OpenIDEA.

La valutazione confronta percorsi di codice selezionati, non certifica l'assenza assoluta di ogni alternativa nei due repository.

## Primo blocco implementato (26 novembre 2026)

- [x] Live template comuni, con 20 contributi per Go, Java, Python, Rust e TypeScript/JavaScript, campi collegati e Surround With.
- [x] Inserimento da Code/menu contestuale e completamento; palette esistente riutilizzata con ricerca, tastiera ed empty state per template.
- [x] Template personalizzati locali con import/export JSON; import validato e unione per id, senza eseguire il contenuto.
- [x] Undo/Redo di workspace per refactoring testuali su più documenti esistenti, isolato per sessione e con rifiuto integrale se un buffer è cambiato/chiuso.
- [x] Precontrollo aggiornato dopo il caricamento asincrono dei documenti: cambio progetto o nuovo testo non vengono sovrascritti.
- [ ] Transazioni filesystem e Undo per creazioni/eliminazioni/spostamenti. I refactoring con creazioni restano disponibili ma dichiarano che Workspace Undo non è supportato.
- [ ] Postfix, editor grafico dei template, profili/scope, Safe Delete, changelist, ricerca strutturale e duplicati.
- [ ] Collaudo nel desktop Wails reale.

Le prove browser usano Monaco reale e i componenti di produzione in una fixture locale, non la finestra desktop. Verificati: selezione/indentazione Python, modifica del primo campo, Tab tra campi, campi ripetuti Java, ricerca senza risultati, Escape, palette nei due temi, Undo/Redo su due modelli e rifiuto dopo una modifica successiva. Script e immagini locali: `frontend/.artifacts/test-openidea-templates.cjs`, `openidea-templates-dark.png`, `openidea-templates-light.png`.

Verifica automatica del blocco: 97 test mirati in 13 file, TypeScript, build frontend, Oxlint mirato e controllo startup superati. Nessun codice backend modificato da questo blocco. I sorgenti sono implementati sui contratti di adOmnia; non è stato copiato codice OpenIDEA.
