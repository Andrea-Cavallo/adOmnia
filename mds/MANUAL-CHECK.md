# MANUAL-CHECK — verifiche manuali (app desktop)

Tutto ciò che per essere chiuso richiede **l'app in esecuzione** (`wails3 task dev` o la release) sta qui, non in `mds/FIX.md`.
Nessuna voce di questo file richiede di scrivere codice: richiede di usare il prodotto e registrare l'esito.

- Creato il 2026-10-15 spostando da `mds/FIX.md` le voci manuali (verifiche `…M*`, riproduzioni da fare nell'app, voci implementate in attesa di verifica, gate manuali).
- 2026-10-15: fuso e cancellato `mds/MANUAL-CHECKS.md` (giro rapido GS-6…GS-9); le sue voci sono qui (GS-6.M3/M4/M5, prerequisiti comuni, GS-9.M1). **Questo è l'unico file delle verifiche manuali: non crearne altri.**
- **Da ora in poi ogni nuova verifica manuale si scrive qui** (regola 0.8 di `FIX.md`). In `FIX.md` restano codice, test automatici ed evidenze di build.

## Regole

1. Una voce si spunta `[x]` solo dopo aver eseguito i passi descritti **nell'app**: percorso felice + almeno un caso limite.
2. A chiusura di una voce: scrivere l'evidenza nel **Registro** in fondo a questo file (build/versione, passi, esito) → spuntare la casella corrispondente in `FIX.md` → aggiornare la tabella "Stato a colpo d'occhio" di `FIX.md` e quella di questo file.
3. Se una voce fallisce: **non** spuntarla, scrivere sotto `FALLITO: cosa, passi, build` e aprire/aggiornare la voce in `FIX.md`.
4. Frasi vietate (regola 0.2 di `FIX.md`): "dovrebbe funzionare", "in teoria", "il codice è corretto", "compila".
5. Salvo diversa indicazione verificare **skin scuro e chiaro**. Progetto Go di riferimento: `root/go.mod` + `root/cmd/main.go` + sotto-package con test.
6. Le voci con "limite noto" hanno una parte non implementata: la verifica riguarda solo ciò che c'è, il limite resta aperto in `FIX.md`.

## Prerequisiti comuni

| Serve | Per |
|---|---|
| coppia di release firmate 1.0.0 → 1.0.1 (+ pacchetto corrotto) | IDE-1 |
| release `-H windowsgui` su Windows 11, conhost **e** Windows Terminal | IDE-2 |
| progetto con ≥80 pacchetti (va bene adOmnia stessa) | IDE-3 |
| progetto reale con goroutine | IDE-4 |
| progetto con `cmd/a` e `cmd/b`, `go.work`, junction/symlink Windows | GS-1, GS-2 |
| progetto Go **e** Git con ≥2 branch, branch `prova` con commit diverso, `README.md` con un blocco Mermaid, un file `.mmd`, una modifica non committata | GS-7, GS-8, GS-9 |
| rete con portale/redirect oppure account Bedrock, `claude-agent-acp` globale | GS-3 |
| tutti i 10 temi built-in + skin white/black mask, win95, sketch | GS-5, GS-6 |
| database reale per driver (Mongo, Postgres, MySQL, SQLite, Redis) | DB-1, DB-2, DB-3 |
| provider AI verificato in Settings → AI | DB-3.M5 |
| Claude Code e milk attivi, progetto Go con Git, un server MCP configurato | GS-11 |
| provider AI verificato in Settings → AI | GS-11, GS-12, DB-3.M5 |

## Stato a colpo d'occhio

| Sezione | voci manuali | chiuse |
|---------|-------------:|-------:|
| IDE-1 | 15 | 0 |
| IDE-2 | 7 (+6 sottovoci) | 0 |
| IDE-3 | 5 | 0 |
| IDE-4 | 4 | 0 |
| IDE-5 | 5 | 0 |
| IDE-6 | 4 | 0 |
| GS-1 | 6 | 0 |
| GS-2 | 4 | 0 |
| GS-3 | 3 | 0 |
| GS-4 | 9 | 0 |
| GS-5 | 5 | 0 |
| GS-6 | 5 | 0 |
| GS-7 | 5 | 0 |
| GS-8 | 2 | 0 |
| GS-9 | 5 | 0 |
| GS-10 | 9 | 0 |
| GS-11 | 6 | 0 |
| GS-12 | 4 | 0 |
| GS-13 | 9 | 0 |
| GS-14 | 6 | 0 |
| GS-15 | 7 | 0 |
| DB-1 | 14 | 0 |
| DB-2 | 18 | 0 |
| DB-3 | 16 | 0 |
| **TOTALE** | **173** | **0** |

---

## IDE-1 — Update: la finestra non si apre dopo il riavvio

**Prerequisito:** coppia di release firmate 1.0.0 → 1.0.1; pacchetto 1.0.1 corrotto per il rollback; WebView2 reale.

**Riproduzione**
- [ ] **IDE-1.0** Installare la 1.0.0 sul Desktop, offrire la 1.0.1, "Salva e riavvia": exe ancora 1.0.0 e processo vivo senza finestra; confermare la causa (flag `HideWindow`/`CREATE_NO_WINDOW` sul rilancio GUI).

**Implementate, da verificare**
- [ ] **IDE-1.1** Dopo "Salva e riavvia" la finestra si apre (nessuna finestra nascosta): `ConfigureDetachedGUI` senza `HideWindow`/`CREATE_NO_WINDOW`; l'helper resta nascosto.
- [ ] **IDE-1.2** Con WebView2 reale l'update riesce anche subito dopo la chiusura del genitore: la cartella user-data viene rilasciata (retry con minimo 1,5-2 s).
- [ ] **IDE-1.3** Dopo un rollback la notifica "Aggiornamento fallito, ripristinata la vX" è visibile e il pulsante apre `apply.log`.
- [ ] **IDE-1.4** Forzando un errore di creazione della webview l'errore viene loggato all'avvio.
- [ ] **IDE-1.5** All'uscita `OnShutdown` gira una sola volta (nessuno `storage.Close()` o shutdown plugin doppi).
- [ ] **IDE-1.6** Con un update pianificato, chiudendo l'app helper e piano sono già pronti: nessuna uscita silenziosa senza installare né errore.
- [ ] **IDE-1.8** Nessun `.adomnia-update-*`/`.adomnia-previous` accanto all'exe (es. Desktop): stage e backup nella cache privata; un backup residuo viene recuperato senza errore vago.
- [ ] **IDE-1.9** Con un pacchetto firmato corrotto (checksum, backup esistente) l'app vecchia viene comunque rilanciata.
- [ ] **IDE-1.11** Durante tutto l'update l'exe resta sul Desktop (mai cartella vuota), anche con Desktop su OneDrive e con l'antivirus attivo; dopo il successo l'exe è la nuova versione (Proprietà → Dettagli), dopo un rollback la vecchia. Accanto all'exe non resta `.adomnia.exe.update`.
- [ ] **IDE-1.12** Con un workspace grande (o un dialog all'avvio) l'update viene confermato appena compare la finestra, senza rollback.
- [ ] **IDE-1.13** Con una build 1.0.1 compilata senza `VERSION` (riporta `dev`): rollback entro pochi secondi e notifica col motivo "the installed build reports version…".
- [ ] **IDE-1.14** `apply.log` (pulsante della notifica o `%APPDATA%\adomnia\adomnia\updates\apply.log`) mostra ogni passo con l'orario.

**Verifiche manuali**
- [ ] **IDE-1.M1** Manuale Windows: la finestra appare, esiste `<updates>/…zip.started`, exe = 1.0.1 (proprietà del file).
- [ ] **IDE-1.M2** Forzare il fallimento (exe 1.0.1 che termina subito) → notifica di rollback visibile e app 1.0.0 con finestra.

**Gate manuale IDE-1:** [ ] — si chiude con tutte le voci sopra `[x]`; in `FIX.md` → `Gate IDE-1 … Manuale`.

---

## IDE-2 — Nessuna finestra di console

**Prerequisito:** release `-H windowsgui` su Windows 11; ripetere con conhost e con Windows Terminal come terminale predefinito.

**Riproduzione**
- [ ] **IDE-2.0** Prima del fix: con la release, Interface Analyzer fa comparire una console.

**Implementate, da verificare**
- [ ] **IDE-2.1** Nessun flash di console all'avvio (`ensureHiddenConsole`), sia con conhost sia con Windows Terminal. Se lampeggia: valutare wrapper `go` con `CREATE_NO_WINDOW` o `GOPACKAGESDRIVER`.
- [ ] **IDE-2.2** I processi lanciati da adOmnia non aprono finestre (`internal/procutil`).
- [ ] **IDE-2.3** Gli helper duplicati eliminati (`git`, `docker`, `nettools`, `kube`, `logstream`, `sourcemap`, `copilot`, `milk`) non hanno cambiato comportamento.
- [ ] **IDE-2.4** Chiamate un tempo non nascoste — sottovoci, tutte su release Windows:
  - [ ] `go list` via `packages.Load` (analizzatori: Interface Analyzer, Error Analysis, Architecture, Move Symbol)
  - [ ] `git config --get-all` (`private_modules.go`)
  - [ ] `explorer /select,` — deve aprirsi come lanciatore GUI esplicito, non come finestra spuria
  - [ ] server MCP utente (`internal/mcp/stdio.go`) con un server MCP reale
  - [ ] keytool/openssl (`internal/nettools/cert.go`)
  - [ ] `LabExec` (ex `LabShell`): console incorporata con timeout e output limitato
  - [ ] interrupt debug (`interrupt_windows.go`): nessun lampeggio

**Verifiche manuali**
- [ ] **IDE-2.M1** Release `-H windowsgui` su Windows 11: Interface Analyzer, Error Analysis, Architecture, Move Symbol, installazione tool → nessuna finestra, nemmeno per un istante.
- [ ] **IDE-2.M2** Ripetere con Windows Terminal come terminale predefinito.

**Gate manuale IDE-2:** [ ] — include il controllo visivo della status bar (barra dei task).

---

## IDE-3 — Import graph leggibile

**Prerequisito:** `wails3 task dev` con progetto ≥80 pacchetti (va bene adOmnia), tema scuro e chiaro.

**Implementate, da verificare**
- [ ] **IDE-3.1** Frecce ~7 px fisse (marker `userSpaceOnUse`), tratto 1-3 px che non scala con lo zoom, peso in opacità; freccia rossa sui cicli.
- [ ] **IDE-3.2** Layout Sugiyama: nessun arco attraversa un nodo, archi multi-livello in corsie libere, incroci ridotti, porte distribuite lungo il bordo.
- [ ] **IDE-3.3** Riduzione transitiva attiva di default; gruppi per cartella espandibili al click; filtro "Cicli" (archi tratteggiati in rosso); toggle Std/External (nascosti di default). *Limite noto:* toggle "test" non previsto.
- [ ] **IDE-3.4** Pan/zoom (rotellina, trascinamento, pulsanti +/−/adatta, doppio clic sullo sfondo); hover/selezione attenuano gli archi non incidenti al 10%; focus con profondità 1-4 e contatore "X of Y packages"; tetto 150 nodi senza focus.

**Verifiche manuali**
- [ ] **IDE-3.M1** Progetto con ≥80 pacchetti, tema scuro e chiaro; controllare anche **call graph, Context e Interface Explorer** (stesso `GoStudioGraphView`).

**Gate manuale IDE-3:** [ ]

---

## IDE-4 — Vista Goroutines

**Prerequisito:** progetto reale con goroutine (es. adOmnia stessa); analisi statica solo su progetto trusted.

**Implementate, da verificare**
- [ ] **IDE-4.7** Tab "Goroutines (n)": raggruppamento package → funzione, badge tipo/forma, indicatori loop/ctx/wg, chip di rischio con tooltip che spiega la regola, filtri (solo rischi, in loop, per tipo, testo), click con `SiteLink`. *Limite noto:* la freccia "→ callee" mostra il nome ma non apre il sorgente della funzione avviata.
- [ ] **IDE-4.9** Comando `view.goroutines` nel menu View e tool window con `initialTab="goroutines"` (nessuna scorciatoia assegnata).
- [ ] **IDE-4.10** Nei frame "created at" delle race: "Static launch · N hints" apre la vista Goroutines (nulla se l'analisi non è stata lanciata). *Limite noto:* lista goroutine di Delve e snapshot pprof non collegati.

**Verifiche manuali**
- [ ] **IDE-4.M1** Su un progetto reale con goroutine: la vista si popola; il timeout di 3 min è rispettato.

**Gate manuale IDE-4:** [ ]

---

## IDE-5 — Altri difetti IDE

**Implementate, da verificare**
- [ ] **IDE-5.4** `CloseSession` interrotto a metà: la sessione viene rimossa comunque e views/saveState/`session.closed` partono. (Nessun test automatico: serve un `recovery` che fallisca.)
- [ ] **IDE-5.10** Profili terminale con WSL/Docker/SSH: la lista non blocca la UI (scoperta parallela, peggior caso ~3 s), la cache da 5 minuti funziona. *Limite noto:* "shell locali subito" non implementato.
- [ ] **IDE-5.11** Watcher oltre 4000 cartelle: il tooltip mostra N/limite. *Limite noto:* manca l'azione "Aggiorna".

**Ispezione visiva preliminare (prima di implementare)**
- [ ] **IDE-5.7 / GS-10.7** Controllare a occhio gli skin/temi che non definiscono `on-accent`: i bottoni `text-white` sull'accento sono leggibili? Serve per decidere se toccare ~200 occorrenze (`text-on-accent` / `.btn-accent`).

**Gate manuali**
- [ ] **IDE-5.12** Gate "Real IDE" Fase 1 (`mds/todo-ide.md` M1-M34, tutti aperti): ordine **M1, M2, M3, M6**, poi **M23** (chiusura con file modificati e processi vivi) e **M22** (offline) — dove emergerebbero IDE-5.1…5.4. Mai eseguiti i controlli Linux/WebKitGTK e macOS.

**Gate manuale IDE-5:** [ ]

---

## IDE-6 — CPU ad app ferma

**Prerequisito:** release Windows, Task Manager (scheda Dettagli, colonna CPU di `adomnia.exe` e `msedgewebview2.exe`), progetto Go con Git, un terminale aperto.

**Verifiche manuali**
- [ ] **IDE-6.M1** Go Studio aperto su un progetto Git, finestra in primo piano senza toccare nulla per 2 minuti: CPU totale di adOmnia sotto il 2% (escluso gopls nei primi minuti di caricamento). Annotare il valore prima/dopo l'update.
- [ ] **IDE-6.M2** Process Explorer (o Task Manager) ad app ferma con un progetto Git aperto: nessun `git.exe` che compare a ripetizione.
- [ ] **IDE-6.M3** Indicatore risorse nella status bar: valori aggiornati ogni ~5 s, elenco processi completo (WebView2, gopls, agenti).
- [ ] **IDE-6.M4** Riavviare gopls durante il caricamento: lo spinner sparisce a lavoro finito; un toast di errore resta ma senza timer attivo.

**Gate manuale IDE-6:** [ ]

---

## GS-1 — Play / Run con `main.go` in `cmd/`

**Prerequisito:** progetto `root/go.mod` + `root/cmd/main.go`; progetto con due main (`cmd/a`, `cmd/b`); `go.work`; modulo annidato; junction/symlink Windows.

**Implementate, da verificare**
- [ ] **GS-1.3** Regola per target `.`: working dir con main → `.`; un solo main → `./rel`; più main → `cmd/<basename-modulo>`, poi package del file attivo, poi **picker** (mai indovinare in silenzio); target-file → `./<dir>`.
- [ ] **GS-1.4** Stessa risoluzione per Run, Run configurata e Debug; senza main: errore `No main package found under <root>; candidates: ./cmd/api, ./cmd/worker`.
- [ ] **GS-1.6** Primo Play senza configurazione: creazione automatica di "Run <pkg>" (`.adomnia/run-configurations.json`), picker se più main, scelta ricordata.
- [ ] **GS-1.7** Edge case Windows: più main in `cmd/*`, `go.work` (si esegue dalla directory del modulo proprietario), moduli annidati, `\`→`/`, symlink/junction (`moduleScopeFor` con `realPath`).

**Verifiche manuali**
- [ ] **GS-1.M1** Play, F5, Debug, gutter ▶ su `func main`, Run con configurazione salvata, Run test del package.
- [ ] **GS-1.M2** Due main in `cmd/a` e `cmd/b` (picker), modulo annidato, `go.work`, path Windows con symlink/junction.

**Gate manuale GS-1:** [ ]

---

## GS-2 — Run with Coverage su cartella

**Prerequisito:** cartella con sotto-package e test; cartella senza test; test con errore di compilazione; `go.mod` sopra la cartella aperta; path Windows con symlink.

**Verifiche manuali**
- [ ] **GS-2.M1** Cartella con sotto-package e test → percentuali reali per package e totale.
- [ ] **GS-2.M2** Cartella senza test → messaggio esplicito, non 0.0%.
- [ ] **GS-2.M3** Errore di compilazione in un test → testo visibile nel pannello (non "No tests found.").
- [ ] **GS-2.M4** `go.mod` sopra la cartella aperta e path Windows con symlink.

**Gate manuale GS-2:** [ ]

---

## GS-3 — Avvio agenti (Claude Code / milk)

**Prerequisito:** rete con portale/redirect (proxy aziendale) oppure account Bedrock; `claude-agent-acp` globale (o `claude` installato).

**Verifiche manuali**
- [ ] **GS-3.M1** Rete con portale (redirect): messaggio azionabile, mai "milk process is not available".
- [ ] **GS-3.M2** `claude-agent-acp` globale + profilo Bedrock in `settings.json`: l'agente parte senza download (`npx` non scarica nulla).
- [ ] **GS-3.M3** "Test connection" mostra ogni passo (comando risolto, PATH di node/npx/claude, proxy/CA, registry npm, check Bedrock, ultimo stderr).

**Gate manuale GS-3:** [ ]

---

## GS-4 — Barra AI con hub unico

**Prerequisito:** `wails3 task dev`; layout salvato con i vecchi id `tool-<session>-<copilot|milk|claude>`.

**Implementate, da verificare**
- [ ] **GS-4.1** `lastProvider` persistito in `adomnia.goide.ai.lastProvider.v1`: alla riapertura si riparte dall'ultimo provider; `close` non lo azzera.
- [ ] **GS-4.2** Un solo bottone "AI" nella stripe destra con badge dal tono del provider e tooltip col messaggio classificato.
- [ ] **GS-4.3** Hub con tab Copilot/milk/Claude e pallino di stato (verde ready, ambra starting/installing, rosso crashed, grigio not installed/signed out); il click sul tab cambia provider.
- [ ] **GS-4.4** `sideKey` derivato da `lastProvider` (nessuna migrazione: le chiavi per provider restano).
- [ ] **GS-4.5** Comando `tools.aiHub` con **Alt+2** (Alt+9 resta a `view.contextInspector`); i tre `tools.*Chat` restano alias.
- [ ] **GS-4.6** Tooltip col messaggio classificato (GS-3) sugli errori di rete/proxy.

**Verifiche manuali**
- [ ] **GS-4.M1** Un solo bottone AI; il click riapre l'ultimo provider; cambio provider dai tab.
- [ ] **GS-4.M2** Layout salvato con vecchi id si carica senza migrazione; finestra staccata della chat funziona.
- [ ] **GS-4.M3** Azioni AI contestuali (test, debug, impact…) aprono il provider giusto.

**Gate manuale GS-4:** [ ]

---

## GS-5 — Splitter visibili in ogni tema

**Prerequisito:** tutti i 10 temi built-in (dark, light, obsidian, solarized, gruvbox, midnight, forest, sunset, tokyo, carbon); finestre a 1440 e 1024 px.

**Implementate, da verificare**
- [ ] **GS-5.1** Divisore visibile a riposo in ogni tema/skin (token `--color-divider`), alone sulle isole dark senza doppio bordo nel light.
- [ ] **GS-5.2** Hit area 10px a cavallo del bordo dell'isola; linea 2px dentro il bordo; nessun ritaglio dall'`overflow: hidden` dell'isola.
- [ ] **GS-5.3** Resize da tastiera (frecce, Maiusc = passo grande), `aria-orientation`, doppio click = reset a `DEFAULT_PANE_SIZES`.
- [ ] **GS-5.4** Stessa hairline anche in Git, Markdown, Database, LaTeX, Mermaid, API, Log Inspector.

**Verifiche manuali**
- [ ] **GS-5.M1** Screenshot a 1440 e 1024 su tutti i temi built-in: divisore visibile a riposo, accent in hover, cursore corretto, double-click reset, frecce da tastiera.

**Gate manuale GS-5:** [ ]

---

## GS-6 — Hub (solo dopo GS-7, GS-8, GS-9)

> Eseguire queste verifiche solo dopo che GS-7, GS-8 e GS-9 sono chiusi e la rimozione è stata fatta.

**Verifiche manuali**
- [ ] **GS-6.M1** Logo più grande: tutti i temi e gli skin (white/black mask, win95, sketch); logo nel pulsante del rail e nel menu Go Studio nelle proporzioni giuste (GS-6.9/6.10 di `FIX.md`); rail e Welcome coerenti in ogni tema/skin.
- [ ] **GS-6.M2** Avvio con stato persistito vecchio (in `localStorage` `adomnia.railQuick.v1` o ultimo rail = `gitsync`/`markdown`/`mermaid`, finestra staccata, quick nav): nessun errore, atterra su Go Studio/IDE/welcome.
- [ ] **GS-6.M3** Rimozione dal rail: il rail non mostra più Markdown, Mermaid, Git Sync e la command palette non li trova; la Welcome non ha più la tile "Version Control".
- [ ] **GS-6.M4** Trascinamento di un `.mmd` sull'app: si apre Go Studio con il messaggio previsto.
- [ ] **GS-6.M5** Collections → menu contestuale → "Collection folder...": Export, Request, Import, Drift su una cartella reale.

**Gate manuale GS-6:** [ ]

---

## GS-7 — Markdown nell'IDE

**Implementate, da verificare**
- [ ] **GS-7.1** Ogni `.md` aperto dall'IDE parte in **anteprima** (albero, Search Everywhere, link, "Go to file"); toggle occhio/editor/split in alto a destra; scelta persistita per documento. *Limite noto:* setting globale non previsto.
- [ ] **GS-7.3** Il pannello diviso usa lo stesso renderer (`GoStudioMarkdownDocument`).
- [ ] **GS-7.4** Pannelli laterali (bottone accanto al commutatore editor/split/anteprima): Outline con salto alla riga, Backlink dalla ricerca nel progetto, "Open local graph" per il grafo locale (filtri Unresolved/Orphans e cartella). Non compare sui `.mmd` puri. *Limite noto:* il grafo è locale (nota + link in uscita + backlink, max 12 target risolti per volta).

**Verifiche manuali**
- [ ] **GS-7.M1** `README.md` dall'albero → anteprima a tutto schermo; occhio/editor/split commutano; documento sporco mantiene le modifiche cambiando modo; funziona nel pane diviso.
- [ ] **GS-7.M2** Su una nota linkata da un'altra (link Markdown **e** `[[wiki]]`): backlink elencati con anteprima e click che apre la nota; "Open local graph" mostra nota, link in uscita e backlink, con i link irrisolti evidenziati; su un progetto senza altre note: "No backlinks for this note" e grafo con la sola nota attiva.

**Gate manuale GS-7:** [ ]

---

## GS-8 — Mermaid nell'IDE

**Implementate, da verificare**
- [ ] **GS-8.2** `.mmd`/`.mermaid` mostrati come blocco mermaid nello stesso `GoStudioMarkdownView`: stessi modi editor/split/anteprima (default anteprima), tema chiaro/scuro coerente con lo skin, errore di sintassi sotto il blocco senza rompere l'editor. *Limite noto:* niente zoom/export (sono di `MermaidPanel`).

**Verifiche manuali**
- [ ] **GS-8.M1** `.mmd` e `.md` con blocco mermaid: stesso aspetto; errore di sintassi mostrato senza rompere l'editor.

**Gate manuale GS-8:** [ ]

---

## GS-9 — Git nell'IDE (tool window)

**Prerequisito:** un progetto con repository Git (meglio con branch, remoto e conflitti da risolvere).

**Implementate, da verificare**
- [ ] **GS-9.1** Tool window "Git": file modificati e stage/unstage, commit, branch (crea/cambia/merge/elimina), pull/push, stash, log/grafo, conflitti (ours/theirs/resolved/abort, "Resolve…" → editor a 3 vie), tab Pull requests. Rebase e cherry-pick restano nascosti (scope V1).
- [ ] **GS-9.3** `vcs.gitStudio` e il widget branch aprono il tool window (nessun `showModule('gitsync')`).
- [ ] **GS-9.4** "Open on remote" (`RemoteWebURL`), PR via `Host*`; *limite noto:* `GitHub*`, `CommitPaths/CommitAll`, `CompareWebURL`, `ApplyPatch` non esposti.

**Verifiche manuali**
- [ ] **GS-9.5** Gate manuale M12 (`mds/todo-ide.md:84`): gutter diff, hunk revert, blame, history.
- [ ] **GS-9.M1** Flusso completo senza uscire dall'IDE: modifica → stage → commit (Ctrl+K) → branch → push/pull → conflitto → risoluzione. Creazione branch con nome non valido → errore, nome valido → si passa al branch; stash e pop con modifiche locali; tab Pull requests carica profilo ed elenco PR; "Open on remote" apre il browser. Il Hub non mostra più Git.

**Gate manuale GS-9:** [ ]

---

## GS-10 — Frontend (audit)

**Implementate, da verificare**
- [ ] **GS-10.3** Tab bar editor: tab attiva portata in vista, frecce/Home/End cambiano tab, tabindex a rotazione. *Limite noto:* mancano il menu "tutte le tab" e il close come bottone fratello.
- [ ] **GS-10.4** Finestra stretta: la status bar non viene tagliata (gruppo centrale scorrevole, Trusted/Restricted e tema sempre visibili), menu **Tools** per Trace/Sonar/Security (Esc chiude), nome del language server dalla contribution.
- [ ] **GS-10.6** `aria-label` (oltre `title`) sui pulsanti icona di StatusBar, Toolbar e Titlebar.
- [ ] **GS-10.11** Welcome: orologio che scatta al cambio minuto (nessun re-render al secondo). *Limite noto:* "Open project" senza recenti/picker.

**Gate manuali trasversali** (`mds/todo-ide.md`) — i più impattanti
- [ ] **M24** Tastiera e focus visibile (`todo-ide.md:101`) — alimentato dalle voci GS-10.3…10.9.
- [ ] **M25** Contrasto / zoom / tema (`todo-ide.md:102`) — alimentato dalle voci GS-10.3…10.9.
- [ ] **M2 / M23** Processi orfani e chiusura con file sporchi.
- [ ] **M31** Finestre separate (`todo-ide.md:87`).
- [ ] **Runtime macOS e Linux** (`todo-ide.md:129,186`) — WebKitGTK incluso.

**Gate manuale GS-10:** [ ]

---

## GS-11 — Revisione delle modifiche degli agenti

**Prerequisito:** Claude Code (e milk) attivi in un progetto Go con Git; per GS-11.3 un server MCP in *Context servers (MCP)*.

**Implementate, da verificare**
- [ ] **GS-11.1** A fine turno compaiono i file creati, modificati ed eliminati dall'agente; un file riscritto identico non compare; i turni successivi si sommano mantenendo la versione di partenza.
- [ ] **GS-11.2** Barra sopra la chat con *Review*; dialog con elenco file, blocchi, Accept/Reject per blocco e file, Accept all/Reject all (con conferma); *Tools → Review Agent Changes…*; funziona anche nella chat staccata.
- [ ] **GS-11.3** Claude Code vede i server MCP configurati e `adomnia` (es. chiede `collection_list_requests`).

**Verifiche manuali**
- [ ] **GS-11.M1** Chiedere a Claude Code di modificare 3 file e crearne uno; rifiutarne uno intero, accettare un solo blocco di un altro, rifiutare il file creato: su disco resta esattamente quanto accettato (confermare con il diff Git), l'editor aperto si aggiorna.
- [ ] **GS-11.M2** Caso limite: con il dialog aperto modificare e salvare a mano lo stesso file, poi *Reject* su un blocco: niente sovrascrittura, messaggio e review aggiornata. Un file con modifiche non salvate nell'editor conserva il buffer.
- [ ] **GS-11.M3** Skin scuro e chiaro: righe aggiunte/tolte leggibili, pulsanti coerenti con gli altri dialog; progetto oltre i limiti (es. cartella con >20.000 file) mostra l'avviso nella chat invece della review.

---

## GS-12 — Colori semantici nei file Go

**Prerequisito:** progetto Go grande (va bene adOmnia stessa), gopls installato, skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-12.1** Aprire 5-6 file subito dopo l'apertura del progetto, mentre la status bar mostra il caricamento di gopls: a caricamento finito tutti i file hanno funzioni, tipi, parametri e package colorati, senza modificarli.
- [ ] **GS-12.2** Riavviare gopls con file aperti: i colori tornano da soli.
- [ ] **GS-12.3** Con Go Studio aperto, aprire una request con lo Scripts editor o una spec OpenAPI nell'API Studio e tornare a Go Studio: le funzioni restano colorate; gli editor YAML/JS hanno gli stessi colori di prima.

**Verifiche manuali**
- [ ] **GS-12.M1** Caso limite: gopls spento a metà caricamento (kill del processo): nessun errore a schermo, i colori sintattici restano, quelli semantici tornano al riavvio.

**Gate manuale GS-12:** [ ]

---

## GS-13 — Inline Assistant (Ctrl+Enter sulla selezione)

**Prerequisito:** `wails3 task dev` con il progetto Go di riferimento; provider AI verificato in Settings → AI; per GS-13.M4 anche `.adomnia/aiignore` e `.adomnia/ai-policy.json` nel progetto. Skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-13.1** Ctrl+Enter su una selezione apre il popup ancorato sotto il codice con l'input di istruzione (Enter genera, Esc annulla, clic fuori chiude); senza selezione si usa la dichiarazione sotto il cursore; nel menu contestuale c'è "AI: Inline Assistant…".
- [ ] **GS-13.2** La proposta compare come diff inline: righe nuove verdi in un blocco con ✓/✗, righe tolte barrate rosse, toolbar con +N −M e Accept all / Reject all (Ctrl+Enter / Esc).
- [ ] **GS-13.3** Accettare un blocco lo applica subito ed è annullabile con un solo Ctrl+Z; rifiutarlo lascia il codice; Accept all è un solo passo di undo; accettare i blocchi in ordine sparso li applica alle posizioni giuste.

**Verifiche manuali**
- [ ] **GS-13.M1** Percorso felice: selezionare una funzione, istruzione "aggiungi gestione errori", generare, Accept all: il codice cambia solo nella selezione, il buffer resta non salvato e un solo Ctrl+Z ripristina l'originale.
- [ ] **GS-13.M2** Per hunk: proposta con più blocchi, ✓ su uno e ✗ su un altro; sul buffer resta esattamente quello scelto (confronto col gutter diff vs HEAD o con Undo).
- [ ] **GS-13.M3** Casi limite: Esc durante la generazione; Esc in revisione (tutto scartato); modifica a mano del file durante la revisione (proposta scartata con messaggio); selezione oltre i 24k caratteri (rifiuto con limite); file in sola lettura; Ctrl+Enter senza selezione valida.
- [ ] **GS-13.M4** Sicurezza: file escluso in `.adomnia/aiignore` rifiutato; policy `off` e `local-only` con provider remoto rifiutate; un segreto nel codice non compare nella proposta (redazione e ripristino); risposta "chiacchierona" del modello non sostituisce mai codice (resta il messaggio "did not change the fragment").
- [ ] **GS-13.M5** Skin scuro e chiaro: popup, righe verdi, righe barrate e pulsanti ✓/✗ leggibili in entrambi.
- [ ] **GS-13.M6** Senza provider AI attivo/verificato il messaggio rimanda a Settings → AI e non parte nessuna chiamata; con provider locale (Ollama) il progetto `local-only` è accettato.

**Gate manuale GS-13:** [ ]

---

## GS-14 — Messaggio di commit generato dall'AI

**Prerequisito:** `wails3 task dev`; progetto Git con modifiche non committate; provider AI verificato in Settings → AI. Per GS-14.M2 anche `.adomnia/aiignore` e `.adomnia/ai-policy.json` nel progetto.

**Implementate, da verificare**
- [ ] **GS-14.1** Nel Commit Dialog (Ctrl+K) il bottone *Draft message with AI* riempie la textarea con un messaggio Conventional Commits coerente col diff dei file spuntati (e i simboli cambiati); disattivato senza file spuntati, assente senza provider AI; il messaggio resta modificabile e il commit non parte mai da solo.
- [ ] **GS-14.2** Gate: policy `off` e `local-only` (provider remoto) rifiutate con messaggio leggibile prima di ogni chiamata; file escluso in `.adomnia/aiignore` elencato ma non inviato; segreti nel diff non compaiono nel messaggio (redazione senza ripristino); file binario e file troppo grande annotati senza bloccare la bozza.

**Verifiche manuali**
- [ ] **GS-14.M1** Percorso felice: progetto con 2-3 file modificati, spuntarli, *Draft message with AI*: il messaggio descrive davvero le modifiche (tipo, soggetto < 72 caratteri), si modifica e si committa.
- [ ] **GS-14.M2** Policy e aiignore: con `.adomnia/ai-policy.json` `off` e `local-only`+provider remoto l'errore è chiaro e non parte nessuna chiamata; con un file escluso da `.adomnia/aiignore` la bozza lo cita senza contenerne il testo.
- [ ] **GS-14.M3** Segreti: una API key nel diff non compare nella bozza (solo segnaposto o formulazione generica); con un solo file binario o enorme la bozza funziona lo stesso.
- [ ] **GS-14.M4** Skin scuro e chiaro: bottone, spinner e errori leggibili in entrambi; bottone disattivato con zero file spuntati.

**Gate manuale GS-14:** [ ]

---

## GS-15 — Stage e unstage di singoli hunk e righe

**Prerequisito:** `wails3 task dev`; progetto Git con più blocchi di modifica nello stesso file (almeno uno salvato e uno non salvato), skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-15.1** Dall'hunk popup (clic sulla barra diff del gutter) *Stage* e *Unstage* portano dall'index (o riportano indietro) solo il blocco mostrato; il buffer non salvato viene salvato prima; il resto del file non cambia e la lista modifiche si aggiorna.
- [ ] **GS-15.2** *Stage single lines…* / *Unstage single lines…* nel popup e l'icona forbici sulle righe del Git workbench aprono la dialog con checkbox per blocco e per riga +/-; applicando una riga sola solo quella passa nell'index.

**Verifiche manuali**
- [ ] **GS-15.M1** Percorso felice: file con due blocchi modificati, clic sul gutter del primo → Stage; `git diff --cached` (o il Git workbench) mostra solo quel blocco, il secondo resta unstaged.
- [ ] **GS-15.M2** Unstage: dall'hunk popup di un blocco già staged, Unstage lo riporta fuori dall'index senza toccare il worktree.
- [ ] **GS-15.M3** Buffer non salvato: modificare l'editor senza salvare, Stage dal popup salva e poi porta il blocco nell'index (nessun errore di patch, nessuna modifica persa).
- [ ] **GS-15.M4** Righe singole: *Stage single lines…* con una sola riga + spuntata → solo quella nell'index; *Unstage single lines…* fa il contrario; stessa dialog dall'icona forbici del Git workbench.
- [ ] **GS-15.M5** Casi limite: blocco già tutto staged (messaggio "nothing to stage/unstage"), file non versionato o binario (nessun crash), skin scuro e chiaro leggibili.

**Gate manuale GS-15:** [ ]

---

## DB-1 — Valori annidati leggibili + schermo intero

**Prerequisito:** Mongo con collezione che ha sotto-oggetti/array (es. `M0001…M0005`); Postgres con colonna `jsonb`; MySQL e SQLite per il controllo tipi.

**Riproduzione**
- [ ] **DB-1.0** Riprodurre: celle annidate che mostrano solo `Object (2 fields)` / `Array (3)` (Mongo Table) e `[object Object]` (SQL) — prima del fix.

**Implementate, da verificare**
- [ ] **DB-1.2** `ValueCell`: contenitori con chevron + preview leggibile (`{ street: "Via Roma", city: "Milano" }`, `[ "a", "b", +1 ]`), click apre l'Inspector; scalari invariati.
- [ ] **DB-1.3** Cell Inspector: `JsonTree` sul valore **grezzo** (Copy JSON conserva `$oid`/`$date`), espansione iniziale, header con colonna/tipo/dimensione, Copy JSON e Copy path per nodo.
- [ ] **DB-1.4** Document view: click sul numero di riga → riga intera (Mongo `DocumentCard` read-only, SQL albero), "Copy row JSON".
- [ ] **DB-1.5** Schermo intero vero (`fixed inset-0`), Esc esce, Ctrl+Shift+F solo col pannello Database a fuoco; riga "N rows (limit L, auto-limited)", "Page X of Y", "only the current page is loaded: N of total".
- [ ] **DB-1.6** Virtualizzazione scorrevole (altezza riga fissa, header sticky, chiavi stabili, nessuno sfarfallio).
- [ ] **DB-1.7** Colonne ridimensionabili (trascina la maniglia sul bordo dell'header, doppio click resetta).
- [ ] **DB-1.8** Toggle Table / Tree / JSON; Mongo List rinominata **Tree**; vista JSON con `JsonTree` comprimibile.
- [ ] **DB-1.9** "Expand nested": colonne puntate (`address.city`), array `[i]`/`[…]`.
- [ ] **DB-1.10** Export CSV con oggetti in `JSON.stringify` (mai `[object Object]`), JSON con valori Mongo intatti (`toEditable`).
- [ ] **DB-1.11** Postgres/MySQL/SQLite: `ValueCell` su json/jsonb/array.

**Verifiche manuali**
- [ ] **DB-1.M1** Vista Tabella con preview leggibili → click → contenuto ad albero → "Document view" con riga intera → Ctrl+Shift+F tutto schermo con tutti i dati, Esc esce → "Expand nested" con colonne puntate → export CSV/JSON con dati reali.
- [ ] **DB-1.M2** Query Postgres su colonna `jsonb`: stesso comportamento. Skin scuro e chiaro.
- [ ] **DB-1.M3** Nessuna regressione su Mongo Explorer (List/JSON/Table), editing documenti, export.

**Gate manuale DB-1:** [ ]

---

## DB-2 — Password persistente + Connect

**Prerequisito:** Mongo e almeno un SQL (Postgres/MySQL/SQLite) reali; possibilità di riavviare l'app; un secondo processo nativo per il controllo keychain.

**Già verificato (parziale, 2026-10-15):** Connect SQLite su Windows; PostgreSQL reale con riuso client, lock Vault e credenziali cifrate usabili da secondo processo nativo. **Restano:** reload/riavvio UI, modifica/rimozione, tutti i driver, guasto/ripristino server.

**Implementate, da verificare (UI completa)**
- [ ] **DB-2.0** Riproduzione: salvare la password, ricaricare la webview/riavviare → form vuoto e query fallite (difetto pre-fix).
- [ ] **DB-2.1** Le password si persistono **sempre cifrate** (mai in chiaro su disco — incrociare con DB-2.S1).
- [ ] **DB-2.2** Chiave master nel keychain di sistema (Windows Credential Manager/DPAPI, macOS Keychain, Secret Service); fallback su file con avviso una tantum; passphrase opzionale.
- [ ] **DB-2.3** Cifratura automatica al salvataggio; il lock a inattività non tocca la chiave nel keychain.
- [ ] **DB-2.4** Migrazione: chiaro residuo → riferimento sigillato; valori già vuoti → avviso "reinserisci una volta"; DSN nel sigillo.
- [ ] **DB-2.5** Form: mai chiaro/riferimento nell'input, segnaposto "•••••••• salvata" con "Cambia"; `password` inviata solo se modificata.
- [ ] **DB-2.6** `ConnectionManager`: Connect persistente, ping ~30 s, riconnessione con backoff (1 s → 30 s), timeout inattività (default 15 min).
- [ ] **DB-2.7** Le password restano in Go: query e test passano `connectionId` (il chiaro non transita dal renderer).
- [ ] **DB-2.8** Rotte sidecar `/database/connect`, `/database/disconnect`, `/database/status`; `/database/test` resta senza stato.
- [ ] **DB-2.9** UI: pallino di stato con latenza, Connect/Disconnect accanto a Test, connessione lazy.
- [ ] **DB-2.10** Nessun segreto nei log né nelle risposte (incrociare con DB-2.S1).

**Verifiche manuali**
- [ ] **DB-2.M1** Crea connessione Mongo/Postgres, inserisci password, salva, ricarica webview **e riavvia l'app**: form "salvata", query funzionanti senza reinserire.
- [ ] **DB-2.M2** Modifica un altro campo e salva: la password resta. "Rimuovi" la cancella davvero.
- [ ] **DB-2.M3** Vault con auto-lock scaduto: le query continuano a funzionare.
- [ ] **DB-2.M4** Connect → verde con latenza → query più veloci (nessun reconnect per richiesta) → spegni il DB: errore e riconnessione automatica al ritorno → Disconnect chiude. Il Test non lascia connessioni aperte.
- [ ] **DB-2.M5** Password in chiaro preesistente: migrata a riferimento; password già vuota: avviso "reinserisci".
- [ ] **DB-2.M6** Chiave di fallback senza keychain (es. Linux headless o keyring bloccato): l'avviso "System keychain unavailable…" compare nel form; il file `database-master.key` **non** contiene la chiave in chiaro (prefisso `ADK1`) ed è `0600`; copiando la sola cartella di configurazione su un'altra macchina le credenziali salvate **non** si aprono.
- [ ] **DB-2.S1** Controllo sicurezza: nessuna password in chiaro in `adomnia.database.connections`, nel bucket bbolt, nei log né nelle risposte HTTP del sidecar; `/vault/decrypt` **rifiuta (403)** i riferimenti usati dalle credenziali database (provarne uno dal pannello Vault).

**Gate manuale DB-2:** [ ] — la **security review indipendente** (casi `DB-2.T1` di `FIX.md`) è stata fatta il 2026-10-15: resta il manuale.

---

## DB-3 — Console query per categoria con interprete

**Prerequisito:** Mongo, Postgres e Redis reali; provider AI verificato in Settings → AI per M5; skin scuro e chiaro.

**Implementate, da verificare**

*Fase 1 — console e completamento*
- [ ] **DB-3.1.1** Console a scomparsa (pulsante **Console**): categorie con contatore e badge rischio (Read/Write/Destructive), target che precompila i template, ricerca testuale, tab **Saved** con Recenti/Salvate, **New tab**, **Run** solo sui template di sola lettura con target scelto; categorie Redis (Read keys, Write, Delete…).
- [ ] **DB-3.1.3** Snippet: Tab avanza tra gli stop, Maiusc+Tab indietro, Esc esce; stop a scelta aprono il popup; senza snippet Tab inserisce due spazi. *Limite noto:* stop con lo stesso numero non specchiati.
- [ ] **DB-3.1.5** `useDbSchema`: completamento SQL con tipi, contesto per l'interprete, campionamento Mongo lazy solo su azione/con query viva, indici `listIndexes` → avviso "campo non indicizzato". *Limite noto:* le tab Mongo dell'Explorer fanno campionamento proprio per l'anteprima documenti.
- [ ] **DB-3.1.7** Chip contestuali sotto l'editor (Add WHERE, Add LIMIT 100, Count rows, Add filter, Count first): un clic modifica solo il testo.

*Fase 2 — interprete e rischio*
- [ ] **DB-3.2.2** Riepilogo in linguaggio semplice + badge Read/Write/Destructive + fino a 3 avvisi (nessun filtro, più statement, sostituzione completa, colonna/tabella inesistente, campo non indicizzato).
- [ ] **DB-3.2.3** Stima d'impatto dentro la conferma: "It will affect N rows/documents" (timeout 8 s); se non riscrivibile in sicurezza nessun numero e avviso esplicito.
- [ ] **DB-3.2.4** Ctrl+Invio = selezione/altrimenti statement sotto il cursore; Ctrl+Maiusc+Invio = tutti in sequenza, stop al primo errore, un'unica conferma se distruttivi, esito per statement nei log.

*Fase 3 — AI*
- [ ] **DB-3.3.1** Pulsante **Ask AI** (solo con provider) → `AiQueryAssistant`: intento in linguaggio naturale → query proposta.
- [ ] **DB-3.3.3** Proposta in stile diff con badge di rischio e riepilogo; **Insert in editor** / **Discard**; mai esecuzione automatica (le scritture passano da conferma + stima).

*Cronologia e salvate*
- [ ] **DB-3.4.1** Preferiti e cronologia come record (`savedQueries.v2`, `HistoryItem`); export senza id di connessione e con `password = '…'` oscurata.
- [ ] **DB-3.4.3** Filtri per categoria/testo, rinomina inline, "Use as template" (badge **Mine**), import con id nuovi.

**Verifiche manuali**
- [ ] **DB-3.M1** Mongo: categoria Aggiorna → `updateMany` con collezione precompilata; Tab scorre i segnaposto; completamento con campi reali; riepilogo; stima mostra N; la conferma include N. Senza filtro: badge distruttivo e chip "Aggiungi filtro".
- [ ] **DB-3.M2** Postgres: `UPDATE utenti SET` propone solo colonne di `utenti` con tipi; `UPDATE` senza WHERE (anche `WHERE` a capo) classificato correttamente; due statement con `;` riconosciuti, esecuzione della sola selezione.
- [ ] **DB-3.M3** Redis: categorie Chiavi/Lettura/Scrittura; la scrittura chiede conferma.
- [ ] **DB-3.M4** Cronologia/preferiti: voci vecchie migrate e filtrabili.
- [ ] **DB-3.M5** AI: "Chiedi all'AI" propone senza eseguire; richiesta ispezionata senza righe di dati né segreti; senza AI il pulsante non appare. Skin scuro e chiaro.

**Gate manuale DB-3 (per fase):** Fase 1 [ ] — Fase 2 [ ] — Fase 3 [ ] — Cronologia 3.4 [ ]

---

## REF-2 — sincronizzazione LSP incrementale e supersede

- [ ] **REF-2.M2** Diagnostiche: pubblicazioni identiche non causano lampeggiamenti; correzione dell'errore rimuove i marker, riapertura e restart li ripristinano se ancora presenti. Riduzione di eventi/timer coperta dal test backend prima rosso → verde; verifica desktop ancora aperta.

- [ ] **REF-2.M1** Wails, progetto Go reale: digitazione rapida e completamento/hover su file grande con emoji e CRLF; nessun errore visibile per cancellazioni attese, suggerimenti coerenti con l'ultimo buffer. Aprire lo stesso workspace in due sessioni/finestre con modifiche non salvate diverse allo stesso file; verificare isolamento, chiudere una sessione e continuare nell'altra. Riavviare gopls e verificare il buffer non salvato ripristinato. Rename/formatting espliciti restano eseguibili. Ripetere con tema chiaro e scuro. Test backend con gopls v0.23.0 già verdi; questa verifica desktop resta aperta.

## REF-11 — modalità idle centralizzata

- [ ] **REF-11.M1** Release Windows inattiva a 5/15/30 min: report locale CPU/RAM dell'intero albero e stato osservato. **Hub vuota misurata**, restano workspace API popolato e progetto IDE; niente inferenze dai clock simulati. Evidenze locali in `.artifacts/idle-native/`: `report.json`, JSONL, ambiente, SHA256 binario e `completion.json`.
- [ ] **REF-11.M2** Dopo Idle/Background: primo input riattiva clock, risorse, Runtime Lens e analisi secondarie; navigazione e ripristino dello stato funzionanti. Split e finestra staccata visibile proteggono anche il workspace senza focus tastiera.
- [ ] **REF-11.M3** Terminale con comando lungo, debug, richiesta/stream e registrazione intenzionale continuano durante Idle e finestra nascosta; LSP avviato esplicitamente resta protetto, quello automatico senza editor si sospende e riparte alla successiva richiesta.

## Z1.4 — regole automatiche del progetto

- [ ] **Z1.4.M1** Copilot, milk e Claude: progetto con i quattro file root, inviare un messaggio e controllare i nomi nei chip del contesto; disattivare Project rules e verificare che il turno successivo le escluda. Modificare un file e inviare di nuovo; verificare aggiornamento, marker per file oltre 8 KiB e rispetto di `.adomnia/aiignore`. Slash command milk invariati. Provare finestra staccata, tema chiaro e scuro. I test automatici non chiudono questa verifica.

## Verifica globale di rilascio

- [ ] `wails3 task dev` con progetto reale, skin scuro e chiaro: **GS-1, GS-2, GS-4, GS-5, GS-7**.
- [ ] Release `-H windowsgui` su Windows 11: **IDE-1, IDE-2**.
- [ ] Nessun segreto in chiaro su disco, nei log o nelle risposte HTTP (**DB-2.S1**).
- [ ] Tutti i temi built-in e gli skin (white/black mask, win95, sketch) senza elementi illeggibili.

---

## Registro evidenze manuali

| Voce | Data | Chi | Build / versione, passi, evidenza | Esito |
|------|------|-----|-----------------------------------|-------|
| REF-11.M1 (Hub vuota) | 2026-10-15 | Codex | Build Windows production Wails beta.28, Windows 11 Pro build 26300, profilo APPDATA isolato, working tree sporco; SHA256 `FED200A3A856603F9E646A03DF6BBBC6AB2C76066C3A8EB343AD3CF073825BDC`. Registrazione reale 1.840 s, 369 campioni ogni 5 s. Primo campione Idle a 305 s: CPU totale 0,0335%. Checkpoint sull'ultimo minuto: 5 min Active 0,06% medio / 0,10% max (prima della soglia del renderer); 15 min Idle 0,04% / 0,09%; 30 min Idle 0,04% / 0,07%. RAM totale a 15/30 min: 464,1/468,2 MiB; goroutine finali 20. Chiusura normale, nessun PID registrato ancora presente. Dati in `.artifacts/idle-native/`; nessuna prova di riduzione rispetto a una versione precedente. | Parziale: Hub vuota misurata; API/IDE e REF-11.M2/M3 aperte |
|      |      |     |                                   |       |
