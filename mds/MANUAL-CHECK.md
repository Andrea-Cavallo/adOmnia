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

Conteggio rigenerato il 2026-10-21. **La tabella è un aggregato**: include le voci di verifica manuale di questo file (IDE/GS/DB, REF, SEC, RES, INST, PY, RC-UI, EDIT-MODE, AG, più le sottosezioni dentro il Registro) e quelle tracciate negli altri piani di `mds/` (`ML-*` in `MULTILANGUAGE-IDE.md`, `JS-*` in `06-JAVA-SPRING-STUDIO.md`). Non è quindi ricalcolabile da questo solo file: quando si spunta una voce, aggiornare la riga della sua sezione e il totale.

| Sezione | voci manuali | chiuse |
|---------|-------------:|-------:|
| IDE-1 | 15 | 0 |
| IDE-2 | 14 | 0 |
| IDE-3 | 5 | 0 |
| IDE-4 | 4 | 0 |
| IDE-5 | 5 | 0 |
| IDE-6 | 4 | 0 |
| IDE-7 | 2 | 0 |
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
| GS-11 | 7 | 0 |
| GS-12 | 4 | 0 |
| GS-13 | 9 | 0 |
| GS-14 | 6 | 0 |
| GS-15 | 7 | 0 |
| GS-16 | 9 | 0 |
| GS-17 | 5 | 0 |
| GS-18 | 9 | 0 |
| DB-1 | 14 | 0 |
| DB-2 | 18 | 0 |
| DB-3 | 16 | 0 |
| REF-2 | 2 | 0 |
| REF-11 | 4 | 0 |
| SEC-1 | 9 | 0 |
| ML-1 | 3 | 1 |
| ML-2 | 4 | 0 |
| ML-4 | 2 | 0 |
| ML-5 | 2 | 1 |
| ML-6 | 2 | 0 |
| ML-7 | 3 | 0 |
| ML-8 | 3 | 2 |
| ML-9 | 6 | 13 |
| JS-1 | 4 | 0 |
| JS-2 | 7 | 0 |
| JS-3 | 3 | 0 |
| JS-4 | 3 | 0 |
| JS-5 | 4 | 0 |
| JS-6 | 2 | 1 |
| JS-7 | 2 | 0 |
| JS-8 | 3 | 0 |
| JS-9 | 2 | 0 |
| JS-10 | 1 | 0 |
| JS-11 | 7 | 0 |
| JS-16 | 3 | 0 |
| JS-17 | 4 | 4 |
| SEC-2 | 10 | 0 |
| RES-1 | 3 | 0 |
| INST-1 | 2 | 0 |
| PY | 13 | 0 |
| RS | 10 | 0 |
| RC-UI | 1 | 0 |
| EDIT-MODE | 1 | 0 |
| AG | 7 | 0 |
| Varie (Z1.4, nuove verifiche 2026-10-18, verifica globale) | 15 | 0 |
| **TOTALE** | **353** | **22** |

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
- [ ] **IDE-4.10** Nei frame "created at" delle race: "Static launch · N hints" apre la vista Goroutines (nulla se l'analisi non è stata lanciata). Nella lista goroutine di Delve e nella funzione selezionata del pannello profili compare lo stesso chip per le funzioni avviate da `go` (match per nome, quindi indizio).

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

## IDE-7 — Finestre dentro l'area di lavoro dello schermo

**Prerequisito:** area di lavoro più piccola delle finestre predefinite (1400×900): display 1280×720/1366×768, scala Windows > 100%, o barra delle applicazioni alta. Poi un monitor ≥ 1920×1080 per il confronto.

**Verifiche manuali**
- [ ] **IDE-7.M1** Con l'area di lavoro ridotta: avviare adOmnia e aprire la finestra staccata di Code Studio, una Live Preview, Swagger Editor, un pannello staccato e una richiesta API staccata — ognuna si apre interamente visibile (barra del titolo e controlli raggiungibili), mai più grande dell'area di lavoro; se il minimo della finestra è più grande dello schermo, la finestra resta comunque dentro.
- [ ] **IDE-7.M2** Su monitor ≥ 1920×1080: le stesse finestre si aprono alle dimensioni abituali (1400×900 e affini), senza cambi di misura.

**Gate manuale IDE-7:** [ ]

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
- [ ] **GS-11.5** Con `.adomnia/ai-policy.json` `off`, avviare una chat con Claude Code **e con milk** e chiedere un tool MCP: nessun server è disponibile. Con `local-only` i server HTTP spariscono e restano solo gli stdio (compreso `adomnia`). Con `allowed` torna l'elenco completo.

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

## GS-16 — Settings e keymap in JSON con schema a livelli

**Prerequisito:** `wails3 task dev`; progetto Go con Git (per il file committabile); per GS-16.M3 modalità Vim attiva. Skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-16.1** Creare `.adomnia/settings.json` in un progetto e aprirlo nell'editor: autocompletamento per chiavi, id dei comandi reali in `keymap.bindings`, valori enum e termini `when`; una chiave sconosciuta o un valore sbagliato viene sottolineato con messaggio e il resto del file si applica lo stesso.
- [ ] **GS-16.2** Effetti a livelli: `editor.fontSize`, `wordWrap`, `lineNumbers`, `editorMode`, `stickyScroll`, `fontLigatures` valgono negli editor di Go Studio; `tabSize`/`softTabs` vincono su `.editorconfig` e sulle Settings utente; salvando il file l'effetto arriva senza riavvio.
- [ ] **GS-16.3** Keymap a livelli: un binding di progetto vince su quello dell'utente, `null` toglie il tasto, `preset` di progetto cambia la base; un binding con `when` non valido per il contesto salta al livello successivo.
- [ ] **GS-16.4** Migrazione: con la vecchia chiave `adomnia.goide.keymap` valorizzata (personalizzazioni o preset vscode), al primo avvio con impostazioni v14 le scorciatoie sono nella sezione `keymap` e funzionano; la vecchia chiave resta aggiornata alle modifiche successive (rollback).

**Verifiche manuali**
- [ ] **GS-16.M1** Percorso felice: file di progetto con `editor.tabSize: 4` e un binding `file.save` → Ctrl+S e tabulazione cambiano davvero; confronto con e senza file.
- [ ] **GS-16.M2** Contesti: `when: 'editor && vim.normal'` scatta solo in vim normal (in insert/visual no, con sub-modalità tracciate dalla barra di stato vim); `when: '!input'` non scatta scrivendo in un campo di testo; la stessa combinazione assegnata in due contesti diversi non si sovrappone (nessun conflitto nel dialog Scorciatoie).
- [ ] **GS-16.M3** File non valido: JSON rotto (marker in cima al file), `format` mancante, chiave sconosciuta e valore fuori enum → segnalati, resto del file attivo; niente crash a modificarlo mentre si scrive.
- [ ] **GS-16.M4** Rollback: con la doppia scrittura, tornando a una build precedente le scorciatoie personalizzate risultano ancora dalla vecchia chiave; esportando/importando le impostazioni la sezione `keymap` resta coerente.
- [ ] **GS-16.M5** Nessuna regressione sugli altri editor JSON: in API Studio lo SpecEditor mantiene i propri completamenti; skin scuro e chiaro leggibili per marker e suggerimenti.

**Gate manuale GS-16:** [ ]

---

## GS-17 — Command palette fuzzy e ranking per uso recente

**Prerequisito:** `wails3 task dev`; progetto Go aperto. Skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-17.1** Ricerca fuzzy graduata in Search Everywhere (Shift Shift): prefisso > inizio parola > sottostringa > sottosequenza; `bld` trova *Build*, `bui` mette *Build* prima di *Rebuild*; query senza corrispondenza non mostra nulla di forzato.
- [ ] **GS-17.2** Uso recente nel ranking: eseguire un comando da tasto o menu, poi cercarlo → è più in alto dei pari merito; a query vuota "Recent actions" riflette l'uso reale (anche da tastiera, non solo dalla palette).

**Verifiche manuali**
- [ ] **GS-17.M1** Percorso felice: `bui` → *Build* in cima, scorciatoia ancora cercabile ("ctrl shift f" → *Find in Files*), frecce/Enter invariati.
- [ ] **GS-17.M2** Recente: eseguire *Run* dal menu, poi *Debug* da F5; cercare "run": *Run* (appena usato) prima dei comandi mai usati; riavviare l'app e verificare che la lista sopravviva (chiave `adomnia.goide.recentCommands`).
- [ ] **GS-17.M3** Nessuna regressione nella palette: file, simboli, test, run configurations, settings, pannelli e comandi estensioni rispondono come prima; skin scuro e chiaro leggibili.

**Gate manuale GS-17:** [ ]

---

## GS-18 — Cache risposte per peso e doppioni body

**Prerequisito:** `wails3 task dev`; un endpoint che restituisce body grandi (es. mock o file statico da 5-10 MB) e uno che restituisce un'immagine; Settings → Requests visibili. Skin scuro e chiaro.

**Implementate, da verificare**
- [ ] **GS-18.1** Budget per peso: con più risposte grandi (~5 MB l'una) la history esce di voce vecchia appena superato il budget (impostazione *History memory budget (MB)*, default 16), anche sotto il limite di numero; la risposta più recente resta sempre; il campo si salva e si ripristina.
- [ ] **GS-18.2** Doppione base64: una risposta testuale (JSON/testo) non conserva la copia base64 (sessione salvata più leggera); una risposta immagine/pdf mostra ancora il preview corretto.
- [ ] **GS-18.3** Ricerca nella history su estratto: con body da 5 MB la digitazione resta reattiva; le corrispondenze oltre i 32k del body si trovano aprendo la risposta (limite dichiarato).
- [ ] **GS-18.6** Risposta oltre 1 MB, poi riavvio: riaprendo la voce compare subito l'anteprima e il corpo completo arriva dal disco (il file di sessione non contiene il body intero). Con una risposta piccola nulla cambia.
- [ ] **GS-18.9** HAR con una risposta > 512 KB: il dettaglio dice che il body pesante non è in memoria e "Load body" lo mostra; l'export riscrive il file originale. Flow recording con una risposta > 2 MB: il passo resta nella registrazione ma da quel body non si propongono variabili.

**Verifiche manuali**
- [ ] **GS-18.M1** Percorso felice: inviare 8-10 risposte da 5 MB; la history conserva ~budget impostato, le voci vecchie escono, aprire/riaprire una voce funziona; ripristino sessione coerente.
- [ ] **GS-18.M2** Body testuali con UTF-8 (accenti, emoji): copia negli appunti e "salva su file" producono byte corretti (ricodifica UTF-8, non la mappa a 8 bit).
- [ ] **GS-18.M3** Binari: immagine e pdf hanno ancora il preview e il salvataggio corretto (base64 tenuto).
- [ ] **GS-18.M4** Ricerca: query su body grandi reattiva; match dentro i primi 32k trovato; nessuna regressione su filtri stato, apertura, rimozione e pulizia della history.

**Gate manuale GS-18:** [ ]

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
- [ ] **REF-11.M3** Terminale con comando lungo, debug, richiesta/stream e registrazione intenzionale continuano durante Idle e finestra nascosta; LSP avviato esplicitamente resta protetto; dal 2026-10-19 anche quello automatico resta acceso in Idle e si sospende solo sotto pressione di memoria (obiettivo globale).
- [ ] **REF-11.M4** Progetto Go aperto, attendere la fine di *Setting up workspace*, lasciare l'app inattiva oltre 5 minuti e tornare: niente nuovo *Setting up workspace*, stesso PID di gopls nel popover risorse. *Language Server Log* mostra motivo dell'avvio, ambiente (`GOPROXY` senza credenziali), PID, tempo di `initialize` e `✔ Setting up workspace done in …`; su un caricamento oltre un minuto compare la riga `slow` con le cause da controllare. Annotare i tempi reali del progetto lento (10 minuti segnalati) dal log.

## Z1.4 — regole automatiche del progetto

- [ ] **Z1.4.M1** Copilot, milk e Claude: progetto con i quattro file root, inviare un messaggio e controllare i nomi nei chip del contesto; disattivare Project rules e verificare che il turno successivo le escluda. Modificare un file e inviare di nuovo; verificare aggiornamento, marker per file oltre 8 KiB e rispetto di `.adomnia/aiignore`. Slash command milk invariati. Provare finestra staccata, tema chiaro e scuro. I test automatici non chiudono questa verifica.

## SEC-1 — Security Center: impatto e remediation guidata

**Prerequisito:** `wails3 task dev`; progetto con `go.mod` e/o `pom.xml` che ha almeno una dipendenza con advisory noto (oppure database locale degli advisory presente). Deep analysis serve solo per SEC-1.M1. Skin scuro e chiaro.

> **Evidenza di logica (2026-10-18):** il flusso completo `SEC-1.1`→`SEC-1.5` è provato end-to-end su
> manifest **reali** dal test `internal/securityintel/e2e` —
> `SECURITY_SAMPLE_DIR=<progetto> go test ./internal/securityintel/e2e/ -run TestSafeRemediationOnARealManifest -v`.
> Eseguito su `go.mod` reale (`filippo.io/age v1.3.2`, `resolve` → **skipped** "external tools are not
> authorized") e su `pom.xml` reale (`io.micrometer:micrometer-registry-prometheus 1.10.0`, `resolve`
> → **ok** con risoluzione statica). Entrambi: preview "major upgrade — closes 1 advisory", piano con
> diff e nessuna scrittura, write provvisorio con backup `*.adomnia-restore`, discard che ripristina
> e rimuove il backup, apply che rende la modifica definitiva (stato `committed`).
> **Resta da verificare qui solo che la UI mostri queste cose come un utente le vede.**

**Implementate, da verificare**
- [ ] **SEC-1.1** *Security Impact Before Update*: dal finding, "Preview impact" mostra per la versione target (modificabile) gli advisory chiusi, quelli ancora aperti e quelli introdotti, con classe di compatibilità e consiglio. Il CVE compare anche quando la fonte usa il proprio ID.
- [ ] **SEC-1.2** *Safe Remediation*: "Prepare the change" mostra il diff del manifest e l'elenco dei passi di verifica. A questo punto **nessun file è stato scritto**.
- [ ] **SEC-1.3** "Run checks" esegue i passi uno alla volta, ognuno con stato (idle / running / ok / failed / skipped) e output leggibile. Il primo passo scrive la modifica in via provvisoria e crea il backup `*.adomnia-restore`.
- [ ] **SEC-1.4** Con **Deep analysis disattivo**, i passi che avviano processi risultano `skipped — external tools are not authorized` e nessun processo parte (verificabile dal Task Manager); con Deep analysis attivo compilazione e test girano e il loro output è leggibile nel passo.
- [ ] **SEC-1.5** "Apply change" è attivo solo con tutti i passi ok/skipped: rende definitiva la modifica e il backup resta accanto al manifest. "Discard change" ripristina il manifest com'era e rimuove il backup. Con un passo fallito Apply resta disattivato.

**Verifiche manuali**
- [ ] **SEC-1.M1** Percorso felice: dipendenza Go con correzione patch → Preview impact → Prepare → Run checks con Deep analysis attivo → Apply. `go.mod` cambia solo sulla riga della versione; una nuova scansione non riporta più il finding chiuso e gli advisory risultati "introdotti" dal preview compaiono davvero.
- [ ] **SEC-1.M2** Casi limite: versione target uguale all'attuale (rifiuto con messaggio); dipendenza transitive Maven non dichiarata nel `pom.xml` (finding bloccato col motivo, nessun comando proposto); versione gestita da parent/BOM/`dependencyManagement` (bloccata col motivo); modulo Go con `replace` (bloccato); passo di test fallito (Apply disattivato, il diff resta disponibile per correggere a mano); Discard dopo i controlli (manifest ripristinato).
- [ ] **SEC-1.M3** Privacy: con modalità Offline attiva i passi non scaricano nulla (`GOPROXY=off` per Go, `mvn -o` per Maven) e non compaiono richieste verso l'esterno; nessun sorgente o nome di file lascia la macchina in nessun passo.
- [ ] **SEC-1.M4** Skin scuro e chiaro: diff (righe `+`/`-`/`@@`), stati dei passi e badge d'impatto leggibili in entrambi.

**Gate manuale SEC-1:** [ ]

---

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

### Git — cronologia visiva (2026-10-16)

- [ ] Aprire Log in un repository con merge reali: verificare corsie colorate continue, colonne Branch/tag, Graph, Commit, autore/data; selezionare commit e parent caricati, controllare i dettagli.
- [ ] Provare temi chiaro/scuro e pannelli sotto 740 px: dettagli sotto la cronologia, scroll indipendente, nomi/ref lunghi troncati con tooltip e nessuna sovrapposizione. Riprovare checkout, creazione branch, merge e cancellazione con le conferme esistenti.

Anteprima browser della sola cronologia verificata con 45 commit reali; non sostituisce la prova nativa del pannello completo. Test Git mirati: 14 verdi; TypeScript e build verdi. Guardia startup sul checkout concorrente: 607489 B / 650000, fallisce per `lib/goide/legacyKeymap.ts` importato dalle impostazioni globali (modifiche parallele).

### ML-1 — Code Studio: nome visibile (2026-10-17)

- [x] ML-1.M1 *(2026-10-17, app e2e isolata, tema scuro EN: Hub con card Code Studio + "Build. Run. Debug.", rail con glifo `</>`, nessun "Go Studio" nel testo; light e IT non provati — resta aperto M4)* Avviare l'app (`wails3 task dev`): nell'Hub la card dice **Code Studio** / "Build. Run. Debug." con glifo `</>`; rail, tooltip e palette comandi dicono Code Studio; icona rail `</>`.
- [ ] ML-1.M2 Aprire un progetto: titolo finestra, menu, impostazioni, scorciatoie, stato vuoto e dialog di fiducia non citano più "Go Studio".
- [ ] ML-1.M3 Finestra staccata e Split Debug View: titolo "… · Code Studio · adOmnia".
- [ ] ML-1.M4 Tema chiaro e scuro, lingua IT ed EN (stringhe "Apri in Code Studio", "Compila. Esegui. Debug.").

### ML-2 — Code Studio: rename interno e migrazioni (2026-10-17)

- [ ] ML-2.M1 Con un profilo che ha già usato la versione precedente (chiavi `adomnia.goide.*` in localStorage, rail `goide` nel layout Hub): avviare l'app nuova — layout editor, terminali, cronologia run, keymap e Hub sono quelli di prima; l'Hub apre Code Studio.
- [ ] ML-2.M2 Aprire un progetto Go fidato: indicizzazione gopls, Run, Debug con breakpoint, test, terminale — tutto come prima del rename.
- [ ] ML-2.M3 Finestra staccata dell'IDE, finestra tool staccata e Split Debug View: si aprono, ricevono gli eventi (`code-studio:event`) e si chiudono senza chiedere conferme spurie.
- [ ] ML-2.M4 Riavvio con progetti aperti: ripristino sessioni e recovery dopo chiusura forzata (bucket `goide` invariato).

### ML-4 — Run: campi generati dallo schema (2026-10-17)

- [ ] ML-4.M1 Aprire Run configurations di un progetto Go: sotto "Execution options" compare **Advanced** (collassata) con Race, Coverage, GOOS, GOARCH, Build tags, Go tool flags e, per package/build, Debug build flags; per un test anche Profile. Per un comando generico, Make o Docker la sezione Advanced non compare. Verificare tema scuro e controlli `select`/`input` su Windows (e WebKitGTK se disponibile).
- [ ] ML-4.M2 Salvare una configurazione con GOOS/race/tags, riaprirla e controllare che i valori restino; il file `.adomnia/run-configurations.json` condiviso mantiene i campi piatti.

### ML-5 — Run: proposte rilevate (2026-10-17)

- [ ] ML-5.M1 Aprire un progetto con `go.mod` e senza configurazioni: in "Run configurations", sopra "New configuration", compare **Detected** con Run/Test/Build del modulo; un click crea e seleziona la configurazione e la proposta sparisce. Avviarla con ▶.
- [x] ML-5.M2 *(2026-10-17, parziale: progetto Node con `package.json` senza lockfile → Detected propone `Node · npm run dev` e `npm run test`; non provati pnpm/yarn né workspace Go+Node)* Aprire una cartella con `package.json` (script dev/build) e un lockfile pnpm/yarn/npm: le proposte usano il package manager del lockfile (es. `Vite · pnpm run dev`) e si avviano come comando; in un workspace con Go + Node compaiono entrambe, ciascuna con la propria working directory.
- [ ] ML-5.M3 Barra Run vuota: in un progetto senza configurazioni, aprire il menu della configurazione attiva → compaiono voci "Add …" (fino a 4); un click salva la configurazione, la rende attiva e Run la avvia. Provare con Maven (wrapper `mvnw` e senza) e con Spring Boot (`spring-boot:run` per primo).

### ML-6 — Run: configurazioni raggruppate per unità (2026-10-17)

- [ ] ML-6.M1 In un workspace con almeno due unità di linguaggi diversi (es. cartella Go + cartella Node) e configurazioni salvate in ciascuna, la lista di "Run configurations" mostra intestazioni `nome-cartella · Linguaggio`; con una sola unità non compaiono intestazioni. Le frecce su/giù, duplica ed elimina funzionano come prima.
- [ ] ML-6.M2 Monorepo senza `go.work` (`orders/go.mod`, `payments/go.mod`, `billing/pom.xml`, `web/package.json`): aprire un `.go` di `orders` — gopls parte e non segnala "no go.mod file found"; aprire un `.java` di `billing` e un `.ts` di `web` — ogni server parte solo alla prima apertura di un file del suo linguaggio. Il menu delle configurazioni (barra Run) elenca le voci per unità con `orders · Go` a destra.

### ML-7 — File base (2026-10-17)

- [ ] ML-7.M1 Cartella "polyglot" con un file per formato (`.html`, `.css`, `.scss`, `.sql`, `.json`, `.yaml`, `.toml`, `.xml`, `.sh`, `.ps1`, `Dockerfile`, `.md`): ognuno si apre, è evidenziato, "Format document" funziona dove Monaco lo offre e la console non mostra errori. Annotare qui i buchi (es. TOML usa la sintassi `ini`).
- [ ] ML-7.M2 In un file `.sql` Ctrl/Cmd+Invio (e il menu contestuale "Run SQL in Database") apre il modulo Database con una nuova scheda "Code Studio" che contiene la selezione, o l'istruzione sotto il cursore se non c'è selezione; il lavoro già aperto nelle altre schede resta intatto. L'esecuzione la fa l'utente con la connessione scelta.
- [ ] ML-7.M3 In un progetto con `scripts/up.sh` (e `build.ps1` su Windows): il menu delle configurazioni e il wizard propongono "Script · scripts/up.sh" (solo se `bash`/`powershell` esistono), un click lo salva, ▶ lo esegue senza aprire una console visibile su Windows.

### ML-8 — Auto restart in workspace misto (2026-10-17)

- [ ] ML-8.M1 Con una configurazione Go (cartella `orders`) e una Node (cartella `web`, comando `pnpm run dev`), entrambe con "Restart on save" e in esecuzione: salvare un `.go` in `orders` riavvia solo la Go; salvare un `.ts` in `web` riavvia solo la Node; salvare un `.md` o un file in un’altra cartella non riavvia nulla.

- [x] ML-8.M2 *(2026-10-17, app e2e isolata)* Progetto Node con script `dev`: aggiunta la proposta `npm run dev` e premuto ▶ — si apre la Live Preview (pagina "Hello from dev server" servita sul proxy :5675, server vero :5199), la console Run mostra `npm run dev` e `Local: http://localhost:5199/`. **Difetto trovato:** dopo ■ Stop la preview mostra "The preview could not start — The dev server stopped (exit code 1)" invece di uno stato fermo.
- [x] ML-8.M3 *(2026-10-17, app e2e: ▶ poi ■ — la preview mostra "Stopped", nessun "could not start"; test automatico `TestStoppingFromTheRunConsoleIsNotAnError`)* Dopo ■ Stop di un dev server avviato da ▶, la Live Preview mostra "Stopped" senza messaggio d'errore (oggi: "could not start", exit code 1).
- [ ] ML-8.M4 Compound `backend` (comando con `Port` 8080, elencato per primo) + `frontend`: la console mostra "<compound>: backend ready." solo quando la 8080 risponde e il frontend parte dopo; se il backend muore prima di aprire la porta, il compound avvisa "not ready" e non avvia il frontend. Un membro senza `Port` parte subito, come prima.
- [ ] ML-8.M5 Una configurazione `pnpm run dev` (o `vite`/`air`) con Restart on save, in esecuzione: salvare un sorgente NON riavvia il processo (ricarica da sé); salvare un file in `node_modules/` o `target/` non riavvia nessuna esecuzione.

### ML-9 — New Project e language server (2026-10-17)

- [ ] ML-9.M1 File > New Project…: il dialog elenca i template Go più **Static website** e **Node.js script**. Scegliendo uno dei due scompare "Module path", il pulsante si abilita con cartella + nome, e il progetto si apre con i suoi file (nessun go.mod). Per un template Go nulla cambia (module path richiesto, `go mod init`).
- [ ] ML-9.M2 Progetto creato da "Node.js script": in Run configurations la sezione **Detected** propone `npm run start` e `npm run test` (package manager reale); da "Static website" il Run apre la Live Preview.
- [ ] ML-9.M3 Tools > **Install All Language Servers…** (progetto fidato): un solo dialog elenca `go install …gopls` e `npm install --prefix …`; confermando partono entrambe le installazioni e l'output compare nella console Run; senza fiducia la voce è disabilitata con il motivo.
- [x] ML-9.M4 *(2026-10-17, app e2e dal branch `feat/multilang-run-test-routing`, progetto Vitest)* "Run all tests" esegue `npm exec -- vitest run --reporter=json --outputFile=…`: albero `sum.test.js › sum › adds ✓ / fails on purpose ✗`, 1 passato 1 fallito, messaggio dell'asserzione con `sum.test.js:4`, doppio clic apre il file. Prima del fix (stesso giorno) il pannello lanciava `go test` e dava "build failed". **Resta Go-centrico:** barra Run ("go run ."), status bar ("Go folder · go1.26.3", gopls) e il pulsante Debug per test (ML-9.M5).
- [x] ML-9.M5 *(2026-10-17, app e2e dal branch `feat/multilang-run-test-routing`)* Progetto Node: barra Run "Add configuration" (con config salvata: il suo nome), status bar "TypeScript / JavaScript" e "typescript-language-server" invece di gopls, niente "Go folder", go1.x, golangci-lint né toolchain Go; footer dell'albero "1 TypeScript / JavaScript app"; ▶ resta abilitato senza Go installato; sulle righe dei test niente Debug né ripeti ×20 (solo Go). Un progetto Go (`ado-kafkasvc`) resta invariato: "1 module · go.mod", `go run .`, gopls, golangci-lint, go1.26.3.
- [x] ML-9.M6 *(2026-10-17)* Riesecuzione di un singolo test JS dalla riga (▶): esegue `npm exec -- vitest run … -t sum[ >]+fails on purpose$ sum.test.js` — solo quel test (gli altri saltati), anche con spazi e simboli nel nome; su Windows il filtro passa da `npm.cmd` senza essere reinterpretato da cmd.exe. Run → Test All usa il runner JS/TS se il progetto non ha moduli Go.
- [x] ML-9.M7 *(2026-10-17)* ▶ senza configurazione: in una cartella con un semplice script Node (`node index.js`, nessun dev tool) apre il gestore Run con la proposta `Node · npm run start` invece di fallire nella Live Preview; con un'app Vite/React o un sito statico apre la preview come prima.
- [x] ML-9.M8 *(2026-10-17, app e2e, tools web rimossi prima della prova, pannello Tests aperto)* Dal banner "typescript-language-server is not installed" → Install… → conferma: la console Run si apre da sola con `npm install --prefix …`, il banner passa a "Installing… Show output" e la status bar mostra `install · running` + "Installing language servers…"; a fine installazione il banner sparisce e la voce passa a `typescript-language-server`. Un fallimento riporta in primo piano la console Run.
- [x] ML-9.M10 *(2026-10-17, app e2e dal branch, copia di `pluginsystem`, JDK 21)* JDT LS: apri `C:\Users\Andrea\Documents\Workspaces\pluginsystem` (Maven multi-modulo) e un `.java`: tazza Java accanto al file, banner "Eclipse JDT LS is not installed" → Install… mostra il comando `curl … && tar …` → conferma → console Run aperta + task "Installing JDT LS…" nella status bar → a fine installazione il banner sparisce e il server parte da solo (Eclipse JDT LS ready; simboli/hover/completamento/errori nel file). Senza JDK 21+ il banner spiega il motivo e non offre Install. Provato: banner + `Install…` con il comando esatto nel dialogo; console Run con `curl … && tar …` (exit 0, 4.5 s) e task nella status bar; a fine installazione il banner sparisce e la status bar mostra `Eclipse JDT LS` verde con diagnostica nel `.java`. **Non ancora:** Lombok (`@Slf4j` ecc. danno errori finché JDT LS non carica l'agent), completamento/hover provati solo a livello di provider generici.
- [x] ML-9.M11 *(2026-10-17, app e2e)* Test JUnit: in un progetto Maven con un test JUnit (uno che passa, uno che fallisce) apri il pannello Tests → target `<cartella> · Maven` → Run: la console Run mostra `mvn -B test`, l'albero ha il file `…Test.java` con i metodi verdi/rosso, il rosso apre la riga dell'asserzione. Con Gradle lo stesso (`cleanTest test`). Provato in app: Run all tests su un mini progetto Maven con JUnit 5 → console `Ran mvn -B test`, albero `src/test/java/it/acme/MathTest.java` con `breaks` rosso e `adds` verde, contatori 1 passed / 1 failed.
- [ ] ML-9.M19 Debug build Java: nell’app eseguire Maven `spring-boot:run` con VM options già impostate e una variabile ambiente; breakpoint, evaluate, step e Stop. Ripetere Gradle multi-modulo con `:modulo:run`, `:modulo:test` e `:modulo:bootRun` del plugin Spring reale; verificare classpath JDT/Buildship della classe scelta, errori navigabili e porta 5005 occupata. Tema chiaro/scuro. Le fixture automatiche offline del 2026-10-18 non sostituiscono questo collaudo.
- [ ] ML-9.M12 Main Class: in un progetto Maven con una classe `main` (anche in un modulo) il gestore Run, sezione Detected, propone `Maven main <Classe>` (`-f <modulo>/pom.xml -B compile …exec-maven-plugin…:java -Dexec.mainClass=…`); ▶ stampa l'output del programma in console. Con un'app Spring Boot in un modulo: `Maven Spring Boot <Classe>`. In Gradle con il plugin `application`: `Gradle application` (`gradlew run`). *(exec:java provato con Maven reale su un mini progetto)*
- [x] ML-9.M14 *(2026-10-17, app e2e)* ▶ nel gutter dei `.java`: sul `main` il menu propone `Run 'Hello'` / `Debug 'Hello'`, Run stampa `hello from main 0` con il comando `exec-maven-plugin` nella console; su ogni `@Test` il ▶ lancia solo quel metodo (`mvn -B test -Dtest=it.acme.MathTest#adds …`) e l'albero Tests mostra solo `adds` verde. Lombok: `pluginsystem` passa da 60 errori a 0 dopo la reinstallazione di JDT LS con l'agent.
- [x] ML-9.M13 *(2026-10-17, app e2e)* Debug Java: con un'installazione di JDT LS precedente il banner chiede di reinstallare (aggiunge il Java Debug Server); poi in un progetto con `Maven main <Classe>` attiva la configurazione, metti un breakpoint nel `.java`, premi Debug (Shift+F9): il pannello Debug si apre, il programma si ferma sul breakpoint, lo stack mostra il sorgente, Step/Resume funzionano, Stop termina. Provato: banner "needs to be updated" → reinstall (JDT LS + Java Debug Server nello stesso comando) → `Maven main Hello` nel gestore Run → breakpoint alla riga 4 → Debug: sessione "Paused" su `Hello.java:4` con call stack e `args` nelle variabili. **Da rifinire:** il pannello usa ancora termini Go ("Goroutines", "function breakpoint" come motivo della pausa).
- [x] ML-9.M15 *(2026-10-17, app e2e, `pluginsystem` + mini progetto Maven/JUnit)* Navigazione e colori Java: Ctrl+click / F12 su `Field` apre `Field.java` del JDK in sola lettura (sorgente reale di `java.base`, salvato sotto la cache utente); da lì F12 su `AccessibleObject` apre la classe successiva (catena di jdt://). I colori semantici (funzioni, tipi, parametri) ci sono anche alla prima apertura del file: un `.java` aperto mentre JDT LS importa il progetto riprova invece di restare bianco. **Ctrl+Shift+O** = Optimize Imports (come Ctrl+Alt+O).
- [x] ML-9.M16 *(2026-10-17, app e2e)* Gestore Run → Detected: **Java · main <Classe>** crea una configurazione "Java main class" con il form *Main class* + *VM options* (Kind "Java main class", working directory = modulo); ▶ stampa l'output del programma. Kind **Java remote JVM** (host/porta): il pulsante Debug si collega a una JVM già in ascolto; ▶ spiega che serve Debug.
- [x] ML-9.M17 *(2026-10-17, app e2e)* Debug di un test JUnit dal ▶ del gutter: menu `Debug 'adds'` → la console Run mostra `mvn -B test -Dtest=… -Dmaven.surefire.debug=-agentlib:jdwp=…address=127.0.0.1:<porta>`, la sessione si collega a quella porta e si ferma sul breakpoint nel metodo (thread, call stack e variabili). Lo stesso meccanismo (`DebugArguments`) vale per `spring-boot:run` di una configurazione Maven e per `test`/`bootRun`/`run` Gradle (porta fissa 5005): provato solo il caso Maven + JUnit.
- [ ] ML-9.M18 pom.xml intelligente: apri `C:\Users\Andrea\Desktop\spring-openai-master\pom.xml` in Code Studio: in cima i lens **Check for updates** e **Scan vulnerabilities**. Check → sulle dipendenze compaiono `↑ x.y.z (same major)` / `(latest)` e un'info sulla versione; cliccando un lens la `<version>` (o la property `${…}`, es. `spring.boot.version`, che aggiorna tutte le dipendenze che la usano) cambia come edit annullabile con Ctrl+Z. Scan → warning/errore sulla riga con CVE, gravità e `fixed in …`; il lens o il quick fix (Ctrl+.) aggiorna alla versione che chiude i CVE. Le versioni gestite dal parent (`starter-validation`, `lombok`) non hanno lens. Nessuna richiesta di rete finché non si preme uno dei due lens. *(backend provato su questo pom e su Maven Central; UI non ancora provata in app)*
- [x] ML-9.M9 *(2026-10-17, app e2e dal branch `feat/multilang-run-test-routing`, JDK 21 + Maven 3.9.6)* Progetto Maven (`pom.xml`, `App.java`): barra Run "Add configuration"; ▶ apre il gestore con **Detected** `Maven · mvn test` e `Maven · mvn package`; aggiunta `Maven test` e ▶: la console Run mostra `$ mvn test` e il build termina con exit 0; status bar "Java" senza gopls/golangci-lint/go1.x. **Non ancora (→ ML-9.M10):** language server (completamento/errori nei `.java`), test strutturati JUnit, debug, Spring Boot `run` (serve un progetto Spring), wrapper `mvnw` e Gradle provati solo a livello di test automatici.

### JS-1 — Spring Index (2026-10-18)

Piano: [06-JAVA-SPRING-STUDIO.md](06-JAVA-SPRING-STUDIO.md) JS-1. **Prerequisito:** progetto Spring Boot reale con `application.properties` e un `application-prod.properties` (o `.yml` con profilo), una classe `@ConfigurationProperties`, un `@Value` e un `@RestController`; JDK 21, JDT LS installato, repository Maven locale con qualche starter già scaricato.

- [ ] JS-1.M1 Apri `application.properties`: il completamento sulle chiavi Spring propone le proprietà note con **tipo, descrizione e default** (dal `spring-configuration-metadata.json` degli JAR e dalle `@ConfigurationProperties` del progetto); la proprietà definita nel progetto compare con la posizione della dichiarazione Java e Ctrl+click ci porta.
- [ ] JS-1.M2 Profili: in `application-prod.properties` il completamento è lo stesso e il valore del profilo è segnato come **override** del valore base; il `server.port` effettivo (base o profilo) è quello mostrato.
- [ ] JS-1.M3 Navigazione bean: su un `@Autowired` (campo o costruttore) Ctrl+click apre il bean che lo soddisfa; con due bean e un `@Qualifier` porta a quello giusto; su `@Value("${…}")` apre la property.
- [ ] JS-1.M4 Pannello endpoint: elenco degli endpoint MVC (metodo, route, controller → metodo), filtro per testo; un click apre il metodo. Una property obbligatoria mancante dà un warning con gravità e posizione.

### JS-2 — Editor e comandi Java (2026-10-18)

Piano: 06 JS-2. **Prerequisito:** come JS-1, più un progetto Go di controllo per verificare che nulla cambi lì.

- [ ] JS-2.M1 Menu/palette: su un `.java` compaiono i comandi Java (Run/Debug Main Class, Run/Debug Test, Spring Boot Run, Maven goals, Optimize Imports, Go to Test, Check for updates, Scan vulnerabilities); su un `.go` nessuno di questi compare. Ogni comando ha la sua icona e il suo shortcut mostrato.
- [ ] JS-2.M2 Code Vision: sopra una dichiarazione Java (classe, metodo, costante) compare il **conteggio usi** e l'autore git, cliccabile; resta nascosto con modifiche non salvate. **Inlay hints Java non sono abilitati**: con JDT LS attivo non devono comparire, e il motivo è dichiarato in `docs/CODE-STUDIO.md` (JDT LS 1.60 non applica la preferenza nel nostro client). Registrare qui se in questa build compaiono comunque.
- [ ] JS-2.M3 Marker gutter override/implements: la freccia **I↓** compare sulla riga della classe o del metodo che ha implementazioni/override nel progetto, il tooltip dice quante sono e il click apre la lista (o l'unica destinazione). Non compare su un metodo che non sovrascrive nulla. JDT LS restituisce solo la direzione "in basso": il click porta agli override, non al padre.
- [ ] JS-2.M4 New Java Class / New Package dal menu della cartella: template compilato, nomi non validi rifiutati con il motivo, il file si apre già compilato.
- [ ] JS-2.M5 Menu **Java** accanto a "Go" (☰): contiene Run/Debug Main e Test, Spring Boot Run, Build (compile), test/package/clean install, Optimize Imports, Generate, Go to Test, Check Updates, Scan Vulnerabilities. In un progetto Maven il martello Build / Ctrl+Shift+B lancia `mvnw compile` (mai `go build .`) e in Run le voci "Build Current Package / Build All / Test All / Vet…" sono disattivate con il motivo.
- [ ] JS-3.M4 Pannello Tests su un progetto Maven con un test rosso: il bottone Bug sulla riga del test e il Debug della suite aprono una sessione Java ferma sul breakpoint nel test; un test `@Disabled("motivo")` mostra "Skipped: motivo" nell'output.
- [ ] JS-4.M4 Errore di compilazione in un `.java` (`mvnw compile`): nella console Run e nel terminale la riga `[ERROR] …Foo.java:[12,34]` è cliccabile e apre il file a riga e colonna.

### JS-3 — Test JUnit completi (2026-10-18)

Piano: 06 JS-3. **Prerequisito:** progetto con una classe di test JUnit che passa, una che fallisce e una ignorata (`@Disabled`), anche in un modulo.

- [ ] JS-3.M1 Albero test: ogni metodo ha la sua icona passato/fallito/ignorato con il motivo e la durata; la classe mostra il **roll-up** dei metodi e i contatori; il fallimento apre la riga dell'asserzione.
- [ ] JS-3.M2 Dal pannello Tests il ▶ e il **Debug** funzionano anche sui nodi Java (classe e metodo), non solo dal ▶ del gutter: la console mostra il comando Maven/Gradle e il debug si ferma sul breakpoint.
- [ ] JS-3.M3 Rerun failed: riesegue solo i metodi falliti (più di uno, stessa classe e classi diverse), gli altri risultano saltati.

### JS-4 — Build: error navigation e JDK di progetto (2026-10-18)

Piano: 06 JS-4. **Prerequisito:** progetto che non compila (un errore di sintassi e un simbolo mancante) e più JDK installati.

- [ ] JS-4.M1 Build con errori: nella console Run gli `[ERROR] …/Foo.java:[12,34]` sono cliccabili e aprono la riga; gli stessi errori compaiono nel pannello problemi con gravità. Multi-modulo: l'errore è attribuito al modulo giusto.
- [ ] JS-4.M2 JDK di progetto: nelle run configuration la toolchain è selezionabile (JDK home + versione), resta salvata, e lo **stesso JDK** serve a Run e Debug (verificare dal comando mostrato in console che il percorso del `java` sia quello scelto).
- [ ] JS-4.M3 Preparazione progetto: aprendo un `.java` in un progetto non ancora importato compare lo stato `starting → importing → building → ready` (o l'equivalente mostrato), senza che la finestra sembri bloccata; a `ready` arrivano diagnostica e completamento.

### JS-5 — Debug profondo (2026-10-18)

Piano: 06 JS-5. **Prerequisito:** app Spring Boot con DevTools tra le dipendenze, un controller che chiama un servizio via proxy/CGLIB (o Mockito in un test), breakpoint sul metodo del servizio.

- [ ] JS-5.M1 Stepping filters: con i filtri di default attivi, lo Step Into dal controller non entra in CGLIB/ByteBuddy/proxy JDK/JUnit; il call stack non mostra i frame filtrati. Disattivandoli dai settings si vede tutto. Verificare anche in un test Mockito.
- [ ] JS-5.M2 Breakpoint relocation: metti un breakpoint con **condizione** e uno **logpoint**, poi modifica il file sopra la riga in modo che il breakpoint si sposti: condizione e logpoint restano associati al breakpoint spostato.
- [ ] JS-5.M3 Hot update in Run: con il servizio in esecuzione modifica una classe e usa "Compile changes": l'esito è esplicito e distinto (*compilato* / *classi sostituite* / *contesto riavviato*) e corrisponde a ciò che accade davvero; il servizio risponde senza restart completo.
- [ ] JS-5.M4 Hot swap in Debug: in sessione di debug modifica il corpo di un metodo: le classi vengono sostituite senza perdere la sessione (DevTools restart disattivato in debug, come da comando mostrato); se il cambio non è sostituibile, il messaggio lo dice senza crash.

### JS-6 — Semantica Java owned by JDT (2026-10-18)

Piano: 06 JS-6. **Prerequisito:** progetto con una `static void main()` senza `public` (Java 25), una classe di test con annotation custom e JDT LS attivo.

- [ ] JS-6.M1 Con JDT LS `ready` le proposte di Run/Test sono quelle di JDT: compaiono la main non-public e i test con annotation custom; spegnendo il server (o prima dell'installazione) le stesse proposte arrivano dal fallback regex e sono marcate come tali, senza inventare risultati.
- [x] JS-6.M2 Contratto di possesso: il test che vieta nuove regole locali di semantica Java è presente e fa rumore se si prova ad aggiungerne una non marcata come fallback. *(2026-10-20, non serve l'app: `semantics_contract_test.go`, dimostrato rosso→verde — `go test ./internal/languages/java/ -run TestLocalJavaSemanticsAreMarkedFallback`.)*

### JS-7 — Launch diretto e command-line lunghe (2026-10-18)

Piano: 06 JS-7. **Prerequisito:** progetto con molti jar (o uno di test con classpath lungo), JDK 21 e un JDK 8 se disponibile.

- [ ] JS-7.M1 Con JDT LS `ready` la Run di una main lancia `java` **diretto** (comando visibile in console con `mainClass`, classpath, `-m` per i moduli), dopo il pre-step `resources:resources`; senza JDT LS resta il comando `exec:java`. Le VM options finiscono sul processo Java, non in `MAVEN_OPTS`.
- [ ] JS-7.M2 Classpath lunghissimo: il comando usato è un argfile `java @file` (o il JAR-manifest per JDK 8), l'app parte comunque e il file temporaneo non resta in giro.

### JS-8 — Dipendenze JVM: tree, classpath browser, Gradle (2026-10-18)

Piano: 06 JS-8. **Prerequisito:** progetto Maven multi-modulo con una dipendenza in conflitto di versione, e un progetto Gradle Spring Boot.

- [ ] JS-8.M1 Dependency tree Maven: albero delle dipendenze risolte con evidenza di **duplicati e conflitti** (versione omessa vs risolta), click sulla dipendenza → apertura; multi-modulo con un albero per modulo.
- [ ] JS-8.M2 Classpath browser: elenco dei jar e delle cartelle del classpath di ogni modulo, con apertura del sorgente/virtuale `jdt://`; corrisponde al classpath reale usato dalla Run.
- [ ] JS-8.M3 Gradle: `build.gradle` ha le stesse lenti del pom (Check for updates, Scan vulnerabilities, aggiorna versione/property) e il parent/BOM non dà lens dove la versione non è definita; il progetto Gradle viene riconosciuto come Spring Boot e propone `bootRun` senza eseguire Gradle.

### JS-9 — Performance JVM (2026-10-18)

Piano: 06 JS-9 (P2). **Prerequisito:** app Spring Boot in Run/Debug e una suite di test.

- [ ] JS-9.M1 Durante Run/Debug/Test il pannello performance mostra heap reale (young/old, senza metaspace) e CPU della **JVM giusta** (non del wrapper Maven/Gradle); i numeri sono credibili confrontati con VisualVM o `jstat` a mano.
- [ ] JS-9.M2 Registrazione JFR: si avvia e si ferma esplicitamente, il file si apre con gli strumenti JDK, e la registrazione non parte mai da sola.

### JS-10 — MyBatis: mapper ↔ XML (2026-10-18)

Piano: 06 JS-10 (P2). **Prerequisito:** progetto con MyBatis (interfaccia mapper + XML).

- [ ] JS-10.M1 Dal metodo del mapper si va allo statement XML e viceversa, con la riga giusta su entrambi i lati; uno statement senza metodo (o il contrario) è segnalato, non taciuto.

### JS-11 — Run config a livelli e altri framework (2026-10-18)

Piano: 06 JS-11 (P2). **Prerequisito:** progetto Spring Boot + uno Quarkus o Micronaut; `.adomnia/run-configurations.json` già condiviso via Git.

- [ ] JS-11.M1 Run config generate e override: le configurazioni generate si rigenerano senza perdere gli override locali, e il file condiviso non cambia formato per chi usa la versione precedente.
- [ ] JS-11.M2 Framework: progetti Quarkus/Micronaut riconosciuti con il task giusto (`quarkusDev`, ecc.); con un `settings.xml` Maven privato (mirror/localRepository) le dipendenze risolvono e il cambio di `settings.xml` viene preso **senza** riavviare JDT LS.
- [ ] JS-13.M1 Parità API (Spring): in un `@RestController` ogni metodo con `@GetMapping`/`@PostMapping`… mostra sopra la riga `⇄ METHOD /path`, Run, Last response, History, Mock, Copy cURL, OpenAPI; `⇄` apre la richiesta nell'API Workspace (collegata al servizio in esecuzione con `{{service:NAME}}`, altrimenti `{{baseUrl}}`), Run la invia. Mock aggiunge la route al Mock Server; cURL usa `server.port` (o `{{baseUrl}}`); OpenAPI apre la route in API Docs.
- [ ] JS-13.M2 Con l'app Spring avviata dal Run, "Open API" (Tools → endpoint Spring) crea la collezione `<servizio> API` con una richiesta per endpoint e le risposte live compaiono in Last response; Debug request non è offerto per Java.
- [ ] JS-3.M4 Rerun failed con due metodi falliti della stessa classe riesegue solo quei due (comando `-Dtest=Classe#a+b` / due `--tests` visibili in console); con un nome display (`test[0]`) riesegue la classe.
- [ ] JS-6.M3 Un file con `void main()` senza `public static` (Java 25) mostra il ▶ solo quando JDT LS è `ready`; con JDT LS fermo resta la regola della regex e una classe non lanciabile non ha il ▶.
- [ ] JS-8.M4 Dipendenza senza `<version>` in un pom con parent Spring Boot: il marker/CVE mostra la versione ereditata e non propone modifiche in quel file; "Scan vulnerabilities" su un `build.gradle` segnala i CVE delle dipendenze con versione scritta (e avvisa che le transitive non sono lette).

### JS-16 — Quarkus e MicroProfile (2026-10-19)

Piano: 06 JS-16 (P0). **Prerequisito:** un progetto Quarkus reale (`mvn quarkus:dev` parte) oppure il template **Quarkus (Maven)** da File → New Project. Skin scuro e chiaro.

- [ ] **JS-16.M1** Endpoint JAX-RS: in una classe `@Path` con metodi `@GET`/`@POST` gli endpoint compaiono nel pannello Spring endpoints con metodo, route completa (classe + metodo) e `@Produces`/`@Consumes`; lo stesso elenco è nelle route del Developer Context (lens sul sorgente, "Open API"). Con un progetto Spring accanto nessuna differenza.
- [ ] **JS-16.M2** Debug del dev mode: `quarkus:dev` (o `quarkusDev`) avviato e premuto Debug — il processo **non** riceve un agent JDWP iniettato (lo si vede dalla console: nessun `-agentlib:jdwp`), la sessione si collega alla porta 5005 e si ferma sui breakpoint; con l'app già in esecuzione il collegamento parte senza riavviare nulla.
- [ ] **JS-16.M3** Configurazione: in `application.properties` le chiavi `quarkus.*` hanno completamento con tipo e descrizione; su `@ConfigProperty(name = "…")` Ctrl+click porta alla proprietà; `quarkus.http.port` è la porta mostrata come `server.port` per le chiamate API.

### JS-17 — Affidabilità su progetti JVM grandi (2026-10-20)

Piano: 06 JS-17 (P0). **Prerequisito:** `quarkus-super-heroes-main` (o un altro progetto Maven multi-modulo grande) aperto in adOmnia; JDK adatto al progetto installato (Java 25 per super-heroes) e Docker avviato per i test Quarkus con Dev Services. Skin scuro e chiaro.

**Evidenze della verifica del 2026-10-20** (screenshot e catture citati sotto): `C:\Users\Andrea\Desktop\adomnia-js17-evidence-2026-10-20\`.

- [x] **JS-17.M1** Console Run allineata: `mvnw -pl rest-villains test` (o un build verboso) nella console Run mostra righe lunghe e ridisegnate di avanzamento (`\r`) allineate come in un terminale; una riga scritta a metà fra due chunk di output NON compare spezzata su due righe a margine sinistro; i colori ANSI restano, i caratteri di escape no. Stessa prova incollando l'output con Copy. *(2026-10-20, eseguita nell'app su `quarkus-super-heroes-main`: `./mvnw.cmd test` del reactor, output di 2.222 righe con colonne allineate (`[jar]`, `[1/10]`, filetti), nessun frammento a margine sinistro; "Copy console" restituisce l'output intero leggibile. Evidenze: screenshot `shot-m1-run2.png`, cattura `run-full3.txt`. I `\r` e le escape sono coperti dai 12 test di `codeStudioConsoleLines.test.ts` rosso→verde.)*
- [x] **JS-17.M2** UI reattiva durante i test: lanciato `mvn test` sul reactor, durante l'esecuzione si apre `rest-narration` nell'albero progetto, si cambia tab e si scrive in un file; Stop ferma il processo entro pochi secondi e la console non perde le ultime righe. Con il terminale integrato lo stesso comando non incolonna male (PTY alla larghezza reale del pannello). *(2026-10-20, eseguita nell'app: durante il run da 2m38s `rest-narration` si è espansa nell'albero con tutti i figli visibili e l'UI è rimasta reattiva; Stop ha fermato il processo alla pressione e la console ha conservato la coda ("711 earlier lines not shown" + ultima riga di log intatta). Sottopasso "cambia tab e scrivi in un file" non eseguito durante il run (il workspace ripristinato aveva solo tab immagini); il PTY alla larghezza reale è coperto dal cambio apertura terminale. Screenshot `shot-m2-running.png`, `shot-m2-stopped.png`.)*
- [x] **JS-17.M3** JDT LS automatico: aprendo il Code Studio sul progetto Java **senza aprire alcun `.java`** Eclipse JDT LS parte da solo e la status bar mostra la preparazione (`importing`/`building` fino a `ready`); a `ready` completamento e Structure arrivano da JDT (la status bar non mostra più "Local Java analysis"); fermando il server la fonte torna esplicitamente locale. *(2026-10-20, eseguita nell'app: chiusi tutti i tab e riavviata l'app — nessun `.java` aperto — e JDT LS è partito **1 secondo dopo l'avvio** (equinox figlio dell'app: pid 102220/128200/159904 alle 14:46:54 contro le 14:46:53 dell'app). Semantica JDT attiva: Problems mostra i deprecation warning reali dei moduli e il log JDT non ha più gli errori "release 25". Il passaggio di fonte locale↔JDT (etichetta "Local Java analysis") è coperto dal test `localAnalysisLabel`; la finestra visiva con il server in avvio resta da controllare a mano. Screenshot `shot-m3-starting.png`, `shot-notabs.png`.)*
- [x] **JS-17.M4** Toolchain multi-modulo: il selettore JDK del progetto mostra **Java 25** come versione richiesta (letta dai moduli, non dall'aggregatore) e suggerisce il JDK 25 installato; Run, Debug e Test usano lo stesso JDK (percorso visibile in console). Con un JDK che non soddisfa la versione richiesta il motivo è dichiarato. *(2026-10-20, eseguita nell'app: il dialogo **"Project JDK"** dice **"The build declares Java 25"** e propone **JDK 25 · 25.0.4.1 · `~/.jdks/temurin-25.0.4.1`** con badge "suggested", tutti gli altri JDK "too old"; selezionandolo la scelta è scritta in `.adomnia/java.local.json` e le esecuzioni la usano davvero — il log di `./mvnw test` mostra il Kotlin daemon avviato con `…\temurin-25.0.4.1\bin\java` e `testCompile` passa con `release 25`. Screenshot `shot-jdk-dialog.png`.)*

### SEC-2 — CVE nell'editor di go.mod e pom.xml (2026-10-18)

- [ ] SEC-2.M1 Apri un `go.mod` con una dipendenza nota vulnerabile (es. `golang.org/x/net v0.10.0`): la lens "⛨ Scan vulnerabilities" in testa al file avvia la scansione; sulla riga del `require` compaiono il marker (rosso per critical/high), la lens "⚠ GO-… · HIGH · fixed in vX" e "↑ vX (security fix)". Il click (o Ctrl+.) cambia solo la versione, con Ctrl+Z si annulla, `// indirect` resta.
- [ ] SEC-2.M2 Senza `govulncheck` installato, dopo la scansione compare "ℹ Reachability off · Install govulncheck…": mostra la conferma con il comando `go install …`, poi l'output nella console Run.
- [ ] SEC-2.M3 Scansiona un `pom.xml` con Maven non autorizzato ma con la repository `~/.m2` popolata: i finding includono le transitive; la dipendenza diretta che le porta ha un marker "brings in <lib> <versione>: CVE-…". Con un POM mai scaricato l'avviso dice quanti ne mancano.
- [ ] SEC-3.M1 Security Center → Pentest (Strix) senza Strix installato: appare "Install Strix…", il consenso mostra il comando esatto (`uv tool install strix-agent` o `pipx install strix-agent`), l'output scorre nella pagina e a fine installazione il pulsante Run pentest si abilita (con Docker acceso).
- [ ] SEC-3.M2 Il selettore progetto propone gli ultimi progetti aperti in Code Studio e funziona anche per la scansione dipendenze; Browse apre il selettore nativo.
- [ ] SEC-3.M3 Run pentest su un progetto piccolo in modalità Quick con budget basso: la conferma dice che il codice va al provider scelto; durante la scansione l'output si aggiorna; Stop la ferma; a fine scansione i problemi compaiono con gravità e file:riga e "Export as MD" scarica report e dettagli. I file del progetto non cambiano e nel progetto non nasce `strix_runs/`.
- [ ] SEC-3.M4 Con un id modello personalizzato (es. `github_copilot/gpt-4o`) la scansione usa quel modello; senza chiave AI configurata l'errore è chiaro.
- [ ] SEC-3.M6 Nel tab Strix il menu Agent elenca Settings → AI più una voce per ogni provider con chiave negli Environments (es. `ANTHROPIC_API_KEY · Prod`); scegliendola compare il campo Model (precompilato se noto) e la scansione usa quella chiave, non quella delle impostazioni.
- [ ] SEC-3.M5 Export → "Markdown report" del Security Center produce un .md con riepilogo e un blocco per ogni finding.
- [ ] SEC-2.M4 Esporta "CycloneDX VEX" dal Security Center: i finding soppressi risultano `not_affected` con il motivo, gli altri `in_triage` o `exploitable`.



## Nuove verifiche dal confronto IDE — 2026-10-18 (non eseguite)

- [ ] JS-14.M1 Java senza JDT/JDK disponibile: aprire e modificare un file non salvato, usare completamento e Structure con tipi annidati, costanti, overload e variabili omonime in scope diversi. Clic outline alla dichiarazione giusta; nessun processo/server avviato. Chiaro/scuro.
- [ ] JS-14.M2 JDT spento → avvio/import → pronto → stop: outline e suggerimenti passano alla fonte corretta senza duplicati o risposte obsolete; mantenere il risultato locale durante l'import, riprendere hover e navigazione semantica con il server.
- [ ] JS-14.M3 Due progetti e split, file Java incompleto/grande/Unicode, cambi rapidi di tab e modifiche non salvate: niente simboli tra file/sessioni, tastiera e focus utilizzabili, limiti visibili senza blocchi.
- [ ] JS-15.M1 Spring con datasource e profili: aprire la connessione proposta in Database Studio, completare placeholder mancanti e testare solo su azione. Nessun segreto in log/export/storage renderer, nessuna connessione automatica; riusare storico SQL e browser tabelle.
- [ ] ML-7.M4 Corpus Markdown/Yuque concordato: confrontare rendering delle sintassi richieste, sanitizzazione e link; registrare differenze residue, chiaro/scuro.
- [ ] ML-10.M1 Commit AI da diff Java e misto: Conventional, libero e template personale; anteprima modificabile e redatta, nessun commit automatico, preferenza ripristinata dopo riavvio.
- [ ] ML-10.M2 Tab una riga/più righe con molti file e split: tastiera, pin, preview, riordino, chiusura e cambio documento; limite di altezza e ripristino preferenza, chiaro/scuro.
- [ ] ML-10.M3 macOS, tap Homebrew pubblicato: installazione e upgrade da release precedente, checksum/asset corretti e avvio. La presenza dei template nel repo non chiude il collaudo.


## RES-1 — CPU/RAM e GOMEMLIMIT (2026-10-19)

- [ ] **RES-1.M1** Nella nuova build desktop: aprire monitor, cambiare limite backend, verificare valore effettivo senza perdere tab; chiudere/riaprire app e verificare persistenza. Provare limite invalido e errore di scrittura: pannello aperto con errore e possibilità di riprovare.
- [ ] **RES-1.M2** Due progetti Go con buffer sporchi: cambiare limite e riavviare quello selezionato, verificare nuovo PID e vecchio processo assente, hover e navigazione sui buffer conservati; altro progetto invariato. Java e WebView non si riavviano.
- [ ] **RES-1.M3** Registrare idle, editing e build/test separatamente; verificare grafici aggregati/per-processo, tema chiaro/scuro, processi entrati/usciti e salti temporali quando la finestra è nascosta. Esportare JSON/CSV/MD/HTML e confrontare PID, intervalli, limiti, errori, contatori GC e CPU mancante con il monitor. Verificare annullamento/salvataggio non riuscito e apertura HTML offline. I test backend e le prove browser non chiudono questo gate nativo.

## INST-1 — Installer e Low-Resource per servizio (2026-10-20)

- [ ] **INST-1.M1** Tools → Installer…: con Go SDK e npm presenti, "Select all missing" + "Install selected" mostra i comandi esatti nella conferma, installa nella cartella strumenti di adOmnia, console Run e task nella status bar visibili; al termine le righe passano a installato senza riaprire. Progetto non fidato: pulsante disattivato con avviso. Senza Go SDK: errore chiaro per riga, nessun blocco. Strix: installazione tracciata fino alla fine. Chiaro/scuro.
- [ ] **INST-1.M2** Pannello Risorse → Low resources: sospendere solo Completion (poi solo Navigation, solo Hover) e verificare che solo quel servizio taccia mentre il resto lavora; cambiare la scelta a modalità attiva la riapplica; riavviare adOmnia con la modalità attiva mantiene i servizi sospesi; "Restore services" li riattiva tutti.

## PY — Supporto Python in Code Studio (piano 2026-10-21)

Riferimento: `MULTILANGUAGE-IDE.md` §9.5, PY-0–PY-9. Stato: **supporto implementato** (run script/modulo, pytest strutturato con coverage opzionale, debug debugpy con exception breakpoint e attach locale, basedpyright con un server per unità, interpreti per unità, Ruff, template; verifiche automatiche reali con Python 3.11/pytest 9.1.1/debugpy 1.8.22), **nessuna prova nell'app eseguita**: tutte le voci qui sotto restano aperte. Registrare build/commit, OS, versioni degli strumenti, fixture, esito ed eventuali limiti per ogni prova.

Quando una voce non torna, tenere presenti i limiti **realmente** aperti (gli altri sono chiusi: formattazione Ruff PY-4.5, coverage PY-5.5, exception breakpoint e attach PY-6.1/6.2, `--reload` rimosso nel debug PY-6.4, server LSP per unità PY-4.2, artefatti verificati PY-8.3): matrice macOS/Linux non verificata (PY-0.2), verifica manuale dell'editor con buffer non salvati/UTF-16/stub `.pyi` (PY-4.3), misure di startup/idle/RAM su workspace misto (PY-8.4). **Nota sulla reinstallazione:** un basedpyright gestito installato prima del 2026-10-21 non ha il report di pip e viene rifiutato con il messaggio di reinstallare; è il comportamento previsto (PY-8.3), non un guasto da segnalare.

- [ ] **PY-M1** Aprire script sciolto e progetto pyproject con layout src: Explorer, unità, icona e Run coerenti; senza interprete mostrare azione utile, senza eseguire/download all'apertura. Progetto non fidato leggibile, processi bloccati.
- [ ] **PY-M2** Due unità Python con venv diversi: selezione interprete, versione, import disponibili in una sola unità, cambio ambiente, ambiente eliminato, riavvio app e restore. Ogni unità ha il proprio server basedpyright (due processi, due log con prefisso dell'unità): gli import di un'unità non devono risolversi con il venv dell'altra, e Restart/Stop devono valere per entrambe. Nessuna contaminazione, buffer non salvati conservati.
- [ ] **PY-M3** Script e modulo: args con spazi/Unicode, cwd, env-file con segreti redatti, streaming stdout/stderr, stop/rerun, configurazione salvata e riaperta. Ripetere con uv/Poetry presenti e ambiente mancante, senza sync/installazione implicita.
- [ ] **PY-M4** basedpyright assente → installazione esplicita con comando/console/task → completion/hover/definition/rename/Problems/Structure; offline e errore installazione con retry. La cartella strumenti contiene `install-report.json` e `adomnia-tool.json`; cancellando o modificando il report la notice rifiuta il server e chiede di reinstallare (poi la reinstallazione lo riabilita). Buffer non salvati e file .pyi; light/dark, tastiera e focus.
- [ ] **PY-M5** pytest: discovery esplicita, test singolo/parametrizzato, suite, fail/skip/xfail, errore collection e rerun failed; traceback apre file/riga corretti. Cancel e tool assente visibili. Coverage: con pytest-cov presente *Run with coverage* mostra percentuale, file e overlay; senza pytest-cov il comando fallisce con il messaggio del tool e nessun pacchetto viene installato; modificare un file rende le annotazioni non più correnti (token).
- [ ] **PY-M6** debugpy: script, modulo e test selezionato con breakpoint confermato, step, stack/thread, variabili/watch/evaluate; stop, secondo avvio e crash; attach a un `debugpy --listen` già avviato con host:porta espliciti (nessun processo avviato da adOmnia). Verificare assenza processi orfani e isolamento di due sessioni.
- [ ] **PY-M7** FastAPI/Uvicorn, Django e Flask: proposta modificabile, porta/URL pronti, preview su azione, porta occupata, avvio fallito e stop; reload Run e debug senza reloader. Eventuale import OpenAPI usa il flusso esistente.
- [ ] **PY-M8** Workspace Go/web/Java/Python: routing LSP, Run/Test/Debug, compound e chiusura unità; Low resources libera strumenti Python senza perdere buffer. Registrare startup/idle/RAM misurati e regressioni degli altri linguaggi.
- [ ] **PY-M9** Windows nativo, macOS nativo e Linux/WebKitGTK: ripetere percorso minimo open → edit → run → test → breakpoint → stop, percorsi con spazi/Unicode, form light/dark e tastiera. Una piattaforma non provata resta esplicitamente aperta.
- [ ] **PY-M10** ▶ del gutter su uno script Python: glifo sulla riga di `if __name__ == "__main__":` e, senza guard, sulla prima riga; menu Run e Debug, run nella console con lo script scelto e debug con breakpoint sullo script. Progetto non fidato: Run/Debug bloccati con il messaggio di fiducia. Con lo script in una sottocartella il percorso relativo deve risolversi correttamente.
- [ ] **PY-M12** Integrazioni con il resto di adOmnia: (a) un progetto FastAPI o Flask con `@app.get("/items")` e un `urls.py` Django con `path("items/<int:pk>/", view)` → la vista Architecture mostra le route e "API Client" apre la richiesta precompilata (metodo e percorso, `{pk}` compreso); (b) `Project Services` legge `pyproject.toml`/`requirements*.txt` e propone PostgreSQL/Redis/Kafka ecc. aprendo Database Studio, Broker Studio e Docker Lab senza avviare nulla da soli; le dipendenze di sviluppo non compaiono; (c) Security Center su un progetto Python con `requirements.txt` fissato e un `poetry.lock`: card "Python / PyPI" con i finding, versioni da lockfile, warning esplicito per le dipendenze non fissate e nessun finding inventato su `>=`. Ripetere con tema chiaro e scuro.
- [ ] **PY-M13** Sicurezza e dipendenze Python nell'editor: aprire `requirements.txt` e `pyproject.toml`, click su *Scan vulnerabilities* → marker sulle dipendenze fissate con `==`, lens con la versione corretta, quick fix che modifica solo la versione e resta annullabile; una dipendenza con `>=` non produce marker. Nel dialog Module dependencies la scheda **Python** mostra vincolo, versione risolta dal lockfile, `dev`, file:riga e l'advisory peggiore (in sola lettura, nessuna installazione). Dalla console Run, con un server avviato, **API docs** porta all'API Docs con l'URL precompilato e il fetch resta un click. Tema chiaro e scuro.
- [ ] **PY-M11** Ruff formatter: senza Ruff, Reformat Code e format-on-save mostrano l'errore con l'azione di installazione e non modificano il buffer; dopo **Python → Install Ruff…** (comando visibile, conferma) il file si formatta, `pyproject.toml`/`ruff.toml` del progetto vengono rispettati, e un salvataggio applica la formattazione una sola volta (nessun doppio edit). Buffer con modifiche non salvate e file con spazi/Unicode nei percorsi.

## RS — Supporto Rust in Code Studio (piano 2026-10-21)

Riferimento: `MULTILANGUAGE-IDE.md` §9.6, RS-0–RS-10. Stato: **codice RS-0→RS-8 implementato** (visto al 2026-10-22; le note inline del piano dicono cosa è rinviato), **collaudi qui sotto non ancora eseguiti**: le voci si spuntano solo dopo prova nell'app. RS-M7 è il gate di integrazione con il resto del prodotto: senza di esso Rust non è "supportato".

- [ ] **RS-M1** Aprire un crate singolo e un workspace Cargo (lib + bin + examples): Explorer, unità (`target/` escluso), icona e Run coerenti; `rust-toolchain.toml` con canale non installato → stato "mancante" con azione esplicita, nessun download/esecuzione all'apertura. Progetto non fidato leggibile, processi bloccati.
  - *Preparato il 2026-10-23*: fixture Rust reali in `internal/languages/rust/testdata/rs-m1/` (`single-crate`, `workspace` con lib+bin+examples+decoy in `target/package/`, `toolchain-missing` con `rust-toolchain.toml` → canale 1.75.0 non installato). Compilano con `cargo check --offline`. Pre-check automatico verde `TestRSM1Fixture*` (`go test ./internal/languages/rust/ -run TestRSM1`): 1 unità cargo-package sul crate singolo, workspace = 1 `cargo-workspace` + 2 `cargo-package` con **il decoy di `target/` escluso**, canale 1.75.0 risolto con azione esplicita `rustup toolchain install 1.75.0`. Baseline processi prima dell'apertura: **0** tra cargo/rustc/rustup/rust-analyzer.
  - *BLOCCATO (2026-10-23, 08:30)*: il collaudo visivo richiede l'app in esecuzione e l'unica istanza disponibile (single-instance, `adomnia.exe` 23/10 07:54) è **in uso dall'agente che esegue RS-M7** sullo stesso desktop (l'app passa da un progetto all'altro durante la verifica; finestre e z-order cambiano sotto le mani). Chi sblocca: fine del giro RS-M7 o l'utente che concede l'app in esclusiva. **Runbook pronto** (vedi sotto): apertura `single-crate` → Explorer 1 unità + icona + Run coerente; `workspace` → 3 unità, `target/` assente; `toolchain-missing` NON fidato → leggibile e fermo (0 processi), poi fidato → dialogo toolchain con stato "mancante" e comando `rustup toolchain install 1.75.0` visibile prima di ogni download; errore di Run su progetto non fidato = blocco con messaggio.
- [ ] **RS-M2** Run di `bin` ed `example`: features, profilo, args con spazi/Unicode, env-file con segreti redatti, stop (muoiono cargo **e** il binario), rerun, configurazione salvata e riaperta. Errore di compilazione: Problems e console con `file:riga:colonna` e codice (`E0308`) cliccabili.
- [ ] **RS-M3** rust-analyzer: assente → installazione esplicita (comando visibile, console Run, task in status bar) → completion/hover/definition/rename/Problems/Structure; navigazione su `std` e su un crate esterno (con `rust-src`); progetto non fidato → nessun server e notice che spiega build script/proc-macro; stato "Indexing" mostrato come progresso, non errore. Run in corso e analyzer insieme: nessun `Blocking waiting for file lock`.
- [ ] **RS-M4** Test: albero crate → modulo → test, `tests/` d'integrazione, doctest, `#[ignore]`, `should_panic`, panic con apertura alla riga giusta, errore di compilazione dei test distinto da un test fallito, rerun failed, cancel; ▶ nel gutter su `#[test]`.
- [ ] **RS-M5** Coverage (solo se `cargo-llvm-cov`/strumento scelto è presente): percentuale, file e overlay; senza strumento messaggio del tool e nessuna installazione implicita.
- [ ] **RS-M6** Debug CodeLLDB: breakpoint confermato su bin e su test, step, stack/thread, `Vec`/`String`/`Option` leggibili, evaluate, stop e secondo avvio, adapter assente con azione Install. Registrare per piattaforma (Windows MSVC/GNU, macOS, Linux) cosa non è leggibile.
- [ ] **RS-M7** **Gate integrazione** con un servizio axum + sqlx reale (es. esempio ufficiale `todos`/`realworld`): le route compaiono in API Workspace e nella collezione "Open API" → invio richiesta al binario in esecuzione → "Mock this tab" → la stessa richiesta risponde dal mock; `DATABASE_URL` proposto come connessione nel pannello Database con DSN sigillato (mai in chiaro in bbolt/localStorage/run config); l'URL locale compare nella barra Run e la Live Session mostra il traffico; un handler gRPC `tonic` e un endpoint WebSocket compaiono nei rispettivi pannelli. Ripetere con axum 0.7 e 0.8 (sintassi dei path) e con actix e rocket. Go/Java/Python nello stesso workspace producono le stesse entità di prima.
- [ ] **RS-M8** `Cargo.toml`: `Check for updates` solo su azione (rete assente → messaggio utile), `↑ versione` con dipendenza ereditata da `[workspace.dependencies]`, marker CVE dal Security Center su una versione vulnerabile nota, albero da `Cargo.lock` con duplicati.
- [ ] **RS-M9** Risorse a 3 server e "Low resources" (RS-9.5, **misurare prima di promettere numeri**): workspace misto con la **stessa fixture di PY-M8/PY-8.4 e JDT LS** (unità Go + web + Java + Python + Rust, almeno un workspace Cargo con più crate e dipendenze reali: rust-analyzer pesa come il grafo delle dipendenze). Con **JDT LS + basedpyright + rust-analyzer attivi insieme**: registrare tempo di startup (prima diagnostica), RAM a idle fermo e RAM in editing, per processo e totale app; niente percentuali non misurate, i numeri vanno nell'evidenza di RES-1. Poi: **Stop/Low resources** libera LSP, DAP e figli (`cargo`, `rustc`, binario) tramite lo sweep comune senza perdere buffer sporchi né modifiche; l'opzione **"Low resources" di rust-analyzer** (proc-macro e build script spenti, `SetRustLowResources` in `rust.local.json` + `workspace/didChangeConfiguration` senza riavvio) abbassa la RAM di rust-analyzer mentre il server resta attivo; il ripristino riaccesa analisi pesanti senza riavvio. "Clean analyzer cache" libera la cartella `cargo.targetDir` dedicata (RS-9.2) senza toccare la `target/` dell'utente.
- [ ] **RS-M10** Windows nativo (MSVC senza Build Tools → messaggio utile al posto dell'errore grezzo di `link.exe`; GNU), macOS nativo e Linux/WebKitGTK: percorso minimo open → edit → run → test → breakpoint → stop, percorsi con spazi/Unicode, dialogo toolchain light/dark e tastiera. Una piattaforma non provata resta esplicitamente aperta.

## RC-UI — Run configurations (2026-10-21)

- [ ] **RC-UI.M1** Nuova build Wails, progetto misto Go/Java/web/Python: ricerca salvate/tipi, priorità linguaggi presenti, cwd univoca e nessuna scelta implicita con due unità dello stesso linguaggio; Detected → revisione → salvataggio; schema provider, validazione campi nelle sezioni nascoste, errori/retry; modifica → cambio/chiusura/duplicazione → Cancel conserva il draft, Discard scarta solo dopo conferma. Pin/share, ordine, shell preset, compound, environment/tasks/restart/target conservati. Tastiera/focus, finestra stretta, chiaro/scuro e WebKitGTK. Browser fixture già osservata per layout/ricerca/discard, non prova binding o salvataggio desktop.

## EDIT-MODE — Tastiera editor (2026-10-21)

- [ ] **EDIT-MODE.M1** Nella build Wails: abilitare Vim, cliccare nel codice, verificare Navigation visibile, Invio/Space muovono senza modificare; `i` mostra Insert e abilita testo/spazi/newline, Esc riporta Navigation. “Use standard editing” ripristina la scrittura senza `i`, preserva buffer/cursore/undo; riprovare con editorMode imposto nel progetto, split, cambio tab, Emacs e chiaro/scuro. Le prove browser con Monaco e adapter reali non chiudono il gate nativo.

## AG — Workflow agenti e Teams (pianificato 2026-10-21)

Tutte le voci sono pianificate: nessuna verifica eseguita. Riferimento `MULTILANGUAGE-IDE.md` AG-1–AG-8.

- [ ] **AG-M1** Task singolo: scelta agente/obiettivo/criteri, streaming, intervento, stop/ripresa e failure; nessuna modifica persa o task completato senza evidenze.
- [ ] **AG-M2** Due agenti in worktree distinti: coda, dipendenze, ownership, porte/risorse e stop selettivo; checkout sporco iniziale intatto, cleanup recuperabile.
- [ ] **AG-M3** Diff reale con commenti ancorati alla revisione, richiesta correzioni, delta e test invalidati da modifiche successive; conflitto visibile, integrazione soltanto dopo azione umana.
- [ ] **AG-M4** Contesto da file/simboli/documentazione e buffer non salvati: anteprima destinazione, limiti/redazione, isolamento per task e nessun invio inatteso.
- [ ] **AG-M5** Due agenti ACP compatibili: capability diverse, permission request, cancel, crash e protocollo incompatibile; diagnostico/retry senza perdita della review.
- [ ] **AG-M6** Docker: permessi filesystem/rete/credenziali, limiti, path mapping, daemon assente, offline, cancel e crash; nessun fallback host silenzioso o container/volume orfano.
- [ ] **AG-M7** Teams: creare/eseguire/sospendere una ricorrenza, riavvio/app chiusa/fuso orario, deduplicazione, errori e inbox review; nessun merge/push/invio esterno automatico. Tastiera, chiaro/scuro e desktop Windows/macOS/Linux secondo piattaforme dichiarate.

## AI-CHAT — Claude/milk: contesto, modelli e allegati (2026-10-21)

- [ ] **AI-CHAT.M1** Nella build Wails su due progetti/language unit: Claude e milk ricevono file attivo, modifiche non salvate, selezione indipendente, regole e indice filtrato. Verificare disattivazione toggle, esclusioni/segretazione e policy off/local-only; nessuna contaminazione tra progetti.
- [ ] **AI-CHAT.M2** Claude adapter reale: selezionare un modello annunciato (Opus/Sonnet se disponibili sull'account), inviare testo esterno e immagine supportata; verificare comprensione visiva reale, nessuna falsa accettazione, cambio modello bloccato durante turno, errore modello/connessione con Retry e bozza/allegati conservati. Controllare binari, file troppo grandi, paste/IME/Invio, chiaro/scuro.
- [ ] **AI-CHAT.M3** Dopo aggiornamento esplicito a milk 0.7+: agenti configurati e modelli nel selettore, scope globale dichiarato e backup/campi config preservati; cambio crea nuova chat per il progetto; think/routing restano coerenti dopo slash command, piani task visibili, New chat non riprende contenuti precedenti. Errori e Stop non perdono il lavoro.
- [ ] **AI-CHAT.M4** Milk ACP 0.7 rifiuta PNG/JPEG prima dell'invio con spiegazione, senza scartarli silenziosamente; file UTF-8 esterni accettati. Quando upstream annuncerà immagini ACP, riaprire il gate con test visivo reale del modello, non soltanto verifica del payload. Colore Send leggibile nei due temi e tastiera/picker utilizzabili.
- [ ] ML-9.M20 `node --test` e suggerimenti: in un progetto con `"test": "node --test"` (nessun Vitest/Jest) il pannello Tests propone l'unità, Run stampa i risultati nell'albero (pass, fail annidato con `/` nel nome, skip) e un file con import mancante appare fallito con il messaggio; il fallimento apre file e riga corretti; senza `node_modules` il run parte comunque e con Node assente l'errore è chiaro. In un progetto Nest (`start:dev`) e in uno Next, la barra Run propone dev, build, test e l'avvio in produzione senza duplicati; il reporter non compare nella cartella del progetto (sta sotto la cache utente).
