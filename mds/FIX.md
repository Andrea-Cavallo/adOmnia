# FIX — documento unico (IDE, Go Studio / Hub, Database)

Unisce `fix-ide-2026-10.md`, `fix2.md` e `db-fix.md` (i tre originali restano invariati).
Tutti i riferimenti `file:riga` sono stati letti sul codice, **non eseguiti**: ricontrollarli prima di modificare.
Percorsi frontend relativi a `frontend/src/`, salvo diversa indicazione.
**Le verifiche manuali sono in `mds/MANUAL-CHECK.md`** (voci `…M*`, riproduzioni nell'app, verifiche delle voci `IMPLEMENTATO`, gate manuali): da ora in poi si scrivono lì (regola 0.8), non qui.

---

## Stato a colpo d'occhio

**71 chiuse · 119 implementate da verificare · 56 da fare - su 246 voci.**

| Sezione | ✅ chiuse | 🟡 implementate, da verificare | ⬜ da fare | totale |
|---------|----------:|-------------------------------:|-----------:|-------:|
| IDE-1 | 3 | 13 | 3 | 19 |
| IDE-2 | 4 | 4 | 3 | 11 |
| IDE-3 | 2 | 4 | 2 | 8 |
| IDE-4 | 10 | 3 | 1 | 14 |
| IDE-5 | 5 | 6 | 1 | 12 |
| IDE-6 | 0 | 5 | 0 | 5 |
| GS-1 | 4 | 4 | 3 | 11 |
| GS-2 | 6 | 0 | 5 | 11 |
| GS-3 | 9 | 0 | 3 | 12 |
| GS-4 | 2 | 6 | 3 | 11 |
| GS-5 | 3 | 4 | 1 | 8 |
| GS-6 | 0 | 9 | 5 | 14 |
| GS-7 | 1 | 2 | 2 | 5 |
| GS-8 | 1 | 2 | 1 | 4 |
| GS-9 | 2 | 3 | 2 | 7 |
| GS-10 | 3 | 9 | 0 | 12 |
| GS-11 | 1 | 3 | 2 | 6 |
| GS-12 | 0 | 3 | 0 | 3 |
| GS-13 | 1 | 3 | 0 | 4 |
| GS-14 | 1 | 2 | 0 | 3 |
| GS-15 | 1 | 2 | 0 | 3 |
| DB-1 | 3 | 7 | 7 | 17 |
| DB-2 | 0 | 14 | 7 | 21 |
| DB-3 | 9 | 11 | 5 | 25 |
| **TOTALE** | **71** | **119** | **56** | **246** |

- **✅ chiuse** = casella `[x]`: codice, test e verifica fatti davvero (regola 0.1).
- **🟡 implementate, da verificare** = casella ancora `[ ]` con nota `IMPLEMENTATO`: codice e test ci sono, manca solo la verifica manuale nell'app (o quella di un'altra persona). Sono chiudibili senza scrivere codice: serve `wails3 task dev` o la release. **La verifica da eseguire è elencata in `mds/MANUAL-CHECK.md`, con gli stessi ID.**
- **⬜ da fare** = nessun codice scritto. Le voci di verifica manuale (`…M*`, gate manuali, riproduzioni nell'app) stanno in `mds/MANUAL-CHECK.md` e non sono più conteggiate qui.
- Il conteggio riguarda le voci `- [ ]` / `- [x]` delle sezioni IDE-1…DB-3: le righe dei **Gate** e le voci spostate in `mds/MANUAL-CHECK.md` non sono contate. **Aggiornare questa tabella ogni volta che si spunta una casella.**

---

## 0. REGOLE — leggere prima di spuntare QUALSIASI casella

### 0.1 Quando una cosa è "FATTA"
Una voce si spunta `[x]` solo se **tutte** queste condizioni sono vere:

1. **Codice** scritto e nel repo (non "pronto", non "quasi").
2. **Test automatico** che fallisce senza il fix e passa con il fix (prima rosso, poi verde). Dove il punto dice "test", esiste ed è eseguito.
3. **Comandi di verifica eseguiti per davvero** e verdi (vedi 0.4). Il type-check o la build da soli NON provano che una funzione lavori.
4. **Verifica manuale nell'app** per ogni voce con UI o con comportamento su Windows: l'app è stata avviata e la funzione usata (percorso felice + almeno un caso limite). Se non si può testare, la voce NON è fatta: si scrive `NON VERIFICATO` accanto. Le verifiche manuali si scrivono e si eseguono in `mds/MANUAL-CHECK.md` (regola 0.8).
5. **Documenti aggiornati** se cambia comportamento, storage o scorciatoie (vedi 0.5).
6. **Evidenza scritta** nel Registro (sezione 5): comando + esito, oppure screenshot, oppure hash del commit.

### 0.2 Frasi vietate (non valgono come prova)
- "Dovrebbe funzionare", "in teoria", "il codice è corretto", "compila".
- "Test verdi" senza aver indicato quali e senza averli lanciati.
- "Fatto" per una voce che ha ancora un passo manuale non eseguito.
- "Fatto" quando il test è stato modificato o disattivato per farlo passare (ammesso solo se il test era sbagliato, e va scritto perché).

### 0.3 Stati e responsabilità
- `[ ]` da fare / in corso. `[x]` fatto **e verificato** secondo 0.1.
- Se una voce è bloccata, NON spuntarla: aggiungere sotto `BLOCCATO: motivo, chi sblocca`.
- Se una voce si scopre non necessaria o già a posto: `[x]` solo con la nota `GIÀ OK: evidenza`.
- Chi implementa compila le caselle **Impl / Test / Manuale / Doc** del Gate della sezione. La casella **Verificato da altra persona/agente** la spunta qualcun altro (o un agente di review) rileggendo evidenza e diff.
- Le cause segnate "probabile / da confermare" vanno **riprodotte prima** di scrivere il fix. Se la riproduzione smentisce la causa, aggiornare questo documento prima di procedere.

### 0.4 Comandi di verifica proporzionati
```bash
go test ./internal/<dominio-modificato>/...
cd frontend && npx vitest run <test-mirati> && npx tsc --noEmit
npm run build && npm run check:startup   # checkpoint di integrazione UI
wails3 task build                        # checkpoint desktop/release
```
- Durante le singole feature eseguire i test mirati al comportamento modificato; non rilanciare ogni volta l'intera suite frontend da oltre 1.300 test.
- Eseguire le suite complete frontend e Go al rilascio/checkpoint finale, dopo modifiche trasversali oppure quando i test mirati indicano una regressione più ampia.
- Se si toccano i binding Go: `wails3 generate bindings -clean=true -ts ./...` con il `wails3` pinnato in `go.mod`, e `frontend/bindings/adomnia/*` aggiornati.
- `internal/ide/architecture_test.go` deve restare verde.
- Test manuale: `wails3 task dev` con un progetto reale (`root/go.mod` + `root/cmd/main.go` + sotto-package con test), skin scuro **e** chiaro.

### 0.5 Documenti da aggiornare quando serve
`docs/GO-STUDIO.md`, `mds/todo-ide.md`, `docs/ISSUES.md`, `README.md` (rimozione Document Studio/Git dal Hub), `docs/adomnia-feature-catalog.en.md`, sezione sicurezza di `CLAUDE.md`, eventuale `docs/RELEASE.md`. Documentare ogni modifica allo storage (es. `adomnia.database.connections`).

### 0.6 Regole di repo (`CLAUDE.md`)
- Il root Go è solo binding layer; la logica sta in `internal/<dominio>`.
- Generico in `internal/ide/*`, specifico Go in `internal/languages/golang`; `internal/goide` solo cabla. Il core non importa mai gli adapter. Nessun `switch language` nel core.
- Riusare ciò che esiste (`internal/ide/sdk.ToolSearch`, `netpolicy`, `JsonTree`, …); non duplicare lookup su PATH né componenti.
- CSS solo con token di `styles/globals.css`; niente colori Tailwind hardcoded nella UI primaria; nessuna nuova libreria UI se evitabile.
- Go Studio resta lazy: mai importarlo da `App.tsx` (`npm run check:startup`).
- Segreti mai nei log, mai restituiti al frontend, mai in chiaro su disco.
- Il pannello Database non usa binding Wails: parla col sidecar via HTTP (`internal/database/database.go`, `internal/sidecar/server.go:92`).

### 0.7 Disciplina di lavoro
- Un punto = una modifica rivedibile. Non mescolare fix indipendenti.
- Prima di modificare un file, rileggere le righe citate: il codice può essere cambiato.
- Ogni fix a codice nuovo passa da code review (e security review se tocca auth, input, file system, segreti, rete).
- A fine lavoro: riepilogo con file modificati e comandi di verifica eseguiti.

### 0.8 Verifiche manuali → `mds/MANUAL-CHECK.md`
- **Da ora in poi** tutto ciò che richiede l'app in esecuzione si scrive in `mds/MANUAL-CHECK.md`, non qui: voci `…M*`, riproduzioni da fare nell'app o sulla release, verifiche delle voci `IMPLEMENTATO`, gate manuali e ispezioni visive.
- Qui restano codice, test automatici, note di implementazione ed evidenze di build (Registro, sezione 5).
- `MANUAL-CHECK.md` usa gli **stessi ID** di questo documento: quando una verifica manuale è eseguita, si spunta la voce lì, poi la casella qui, e si aggiornano entrambe le tabelle "Stato a colpo d'occhio".
- Restano qui (non sono verifiche manuali) le riproduzioni che chiedono solo un run rosso di test automatici, es. GS-1.0 e GS-2.0.

---

## 1. Indice e priorità

Priorità: **P0** blocca l'uso, **P1** difetto visibile, **P2** miglioramento. Sforzo: S/M/L.

| ID | Titolo | Prio | Sforzo |
|----|--------|------|--------|
| IDE-1 | Update: dopo il riavvio resta 1.0.0 e l'app non si apre | P0 | M |
| IDE-2 | Nessun terminale visibile, mai (+ barra task nello status bar) | P0 | M |
| IDE-3 | Import graph illeggibile | P1 | M-L |
| IDE-4 | Nuova vista Goroutines | P1 | L |
| IDE-5 | Altri difetti IDE (12 voci) | P1-P2 | vari |
| IDE-6 | CPU alta ad app ferma (~20%) | P0 | M |
| GS-1 | Play/Run non funziona con `main.go` in `cmd/` | P0 | L |
| GS-2 | "Run with Coverage" su cartella: niente / 0.0% | P1 | M-L |
| GS-3 | Claude Code / milk: `EMAXREDIRECT`, "process is not available" | P0 | L |
| GS-4 | Barra AI: un'unica icona con Copilot / milk / Claude | P1 | M |
| GS-5 | Splitter invisibili nello skin scuro | P1 | M |
| GS-6 | Hub: via Document Studio e Git; logo più grande | P2 | M |
| GS-7 | Markdown nell'IDE: anteprima di default | P1 | S-M |
| GS-8 | Mermaid nell'IDE (`.mmd`/`.mermaid`) | P2 | M |
| GS-9 | Git dentro l'IDE (tool window) | P1 | L |
| GS-10 | Altri problemi frontend (audit) | P1-P2 | vari |
| GS-11 | Revisione delle modifiche degli agenti AI + MCP a Claude Code | P1 | M |
| GS-12 | File Go senza colori semantici (funzioni bianche) | P1 | S |
| GS-13 | Inline Assistant (Ctrl+Enter sulla selezione) | P1 | M |
| GS-14 | Messaggio di commit generato dall'AI (voce Z2.4 del piano) | P2 | S |
| GS-15 | Stage/unstage di singoli hunk e righe (voce Z2.5 del piano) | P2 | S-M |
| DB-1 | Valori annidati illeggibili + schermo intero | P1 | L |
| DB-2 | Password che sparisce + Connect persistente | P0 | L |
| DB-3 | Console query per categoria con interprete | P2 | L |

### Ordine di lavoro consigliato
1. **IDE-1** (piccolo, sblocca gli utenti), poi **IDE-2** (1-2, migrazione duplicati, test di guardia). IDE-1 va prima, così il rilancio GUI non viene nascosto per errore.
2. **Task bar nello status bar** (store `goideTasks`, in IDE-2), usata da IDE-3 e IDE-4.
3. **GS-1 → GS-2 → GS-3** (Run, Coverage, avvio agenti).
4. **DB-2** (password): perdita di dati utente.
5. **GS-5, GS-4**, poi **IDE-3**, **IDE-4**.
6. **GS-7, GS-8, GS-9** e SOLO DOPO **GS-6** (altrimenti l'utente perde Markdown/Mermaid/Git).
7. **DB-1**, poi **DB-3** (fasi 1, 2, 3 rilasciabili da sole).
8. **IDE-5** (5.1-5.4, 5.6, 5.7 subito; 5.5 e 5.8 quando c'è tempo) e **GS-10**.

---

## PARTE A — IDE e piattaforma

### IDE-1. Update: rimane la 1.0.0 e poi l'app non si apre

**Sintomo.** Dopo "Salva e riavvia" l'exe sul Desktop è ancora 1.0.0 e il processo risulta vivo ma senza finestra.

**Ancora presente il 2026-10-16** (segnalazione utente, dopo i fix 1.1–1.9): l'update sembra scaricarsi e applicarsi, ma l'exe resta alla stessa versione e a volte **sparisce**, così l'app non si apre più.

**Cause trovate leggendo il codice (2026-10-16).**
- Lo swap spostava l'exe fuori dalla cartella prima di installare il nuovo, e il rollback **cancellava** l'exe prima di ripristinare il backup (`apply.go`, `movePath`/`removeWithRetry`): se il ripristino falliva (antivirus, OneDrive sul Desktop, immagine del processo appena chiuso) la cartella restava senza app. Il blocco `defer` ritentava lo stesso spostamento.
- La conferma d'avvio arrivava solo dal frontend dopo l'idratazione del workspace, il doppio `requestAnimationFrame` e un import lazy (`App.tsx`, `stores/updater.ts`): qualsiasi ritardo oltre 90 s faceva scattare il rollback alla versione vecchia.
- Una build con versione diversa dal manifest rifiutava la conferma senza dirlo all'helper: rollback solo dopo il timeout, con un messaggio fuorviante.
- `apply.log` conteneva solo l'errore finale; la CI Windows non eseguiva i test dell'updater.

**Causa radice (probabile, da confermare).** L'helper rilancia l'app GUI con lo stesso helper dei processi in background, che la nasconde.
- `internal/update/apply.go:269` rilancia con `process.Configure(cmd, false)`; stessa chiamata a `:250` (rollback) e `:114` (helper).
- `internal/ide/process/adapter_windows.go:23`: `interactive=false` → `HideWindow: true` + `CREATE_NO_WINDOW`; `SW_HIDE` si applica alla prima `ShowWindow` del figlio → finestra principale nascosta.
- Finestra nascosta → niente `requestAnimationFrame` → `adomnia:first-stable-frame` (`frontend/src/App.tsx:103-114`) non scatta → `startUpdater()` (`App.tsx:63`) non parte → `ConfirmUpdateStartup()` (`updater.ts:38`) non scrive `.started`.
- Dopo 90 s l'helper uccide il figlio e fa `rollback()` (`apply.go:278-303`), che ripristina la 1.0.0 con gli stessi flag nascosti: spiega entrambi i sintomi.
- Concorrenti: lock della user-data di WebView2 (`main.go:132`, `WebviewUserDataPath: dataDir()`; l'helper rilancia appena il PID genitore termina, `wait_windows.go`); errori invisibili (solo `apply.log` e `failed-update.json`, `apply.go:115,168-176`; `manager.go:157`).

**Fix**
- [ ] IDE-1.0 Riprodotto il bug (exe 1.0.0 sul Desktop, release 1.0.1, "Salva e riavvia") e confermata la causa. — **NON VERIFICATO:** manca una coppia di release firmate 1.0.0 → 1.0.1; la causa dei flag Windows è coperta dal test nativo.
- [ ] IDE-1.1 `process.ConfigureDetachedGUI(cmd)`: solo `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, senza `HideWindow` né `CREATE_NO_WINDOW`; usato a `apply.go:250` e `:269`. L'helper (`:114`) resta nascosto. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** con installer firmato.
- [ ] IDE-1.2 Dopo `waitForParent`, attendere il rilascio della cartella user-data (retry su file di lock o enumerazione figli; minimo sleep 1,5-2 s). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** con WebView2 reale.
- [ ] IDE-1.3 Dopo un rollback: notifica "Aggiornamento fallito, ripristinata la vX" (da `failedVersion`) con pulsante che apre `apply.log`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** nell'app.
- [ ] IDE-1.4 Log di avvio degli errori di creazione della webview. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** forzando un errore WebView2.

**Altri difetti nel flusso di update**
- [ ] IDE-1.5 `OnShutdown` gira due volte (`app.go:133` e `:128`): `storage.Close()` e shutdown plugin doppi. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** shutdown protetto da `sync.Once`.
- [ ] IDE-1.6 `StartScheduled` parte in `OnShutdown` dopo `storage.Close()`; se `copyRegular` fallisce (`apply.go:110`, es. `.helper.exe` residuo con `O_EXCL`) l'utente chiude senza installare né errore. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** helper e piano sono preparati quando l'utente pianifica l'update.
- [x] IDE-1.7 `waitForParent` accetta 24 h; helper e staged restano in `%APPDATA%\adomnia\updates` fino a 7 giorni (`cleanupCache`): ridurre/ripulire. — timeout 2 minuti; cache updater ripulita dopo 24 ore.
- [ ] IDE-1.8 `.adomnia-update-*` e `.adomnia-previous` creati accanto all'exe (es. Desktop): serve permesso di scrittura, residui dopo crash; un backup residuo blocca gli update successivi (`apply.go:70`, `:236`) con messaggio vago. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** stage e backup sono nella cache privata, con recupero del backup residuo.
- [ ] IDE-1.9 Se l'helper fallisce prima dello swap (checksum, `waitForParent`, backup esistente) l'app vecchia non viene rilanciata: rilanciarla sempre. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** con pacchetto firmato corrotto.
- [x] IDE-1.10 Asset scelto non verificato (`apply.go:199-204`): un asset vuoto cade in un errore di checksum; validarlo. — test per asset mancante e non valido.
- [ ] IDE-1.11 L'exe non viene mai rimosso: backup = copia privata, il nuovo exe viene copiato accanto (`.adomnia.exe.update`) e rinominato sopra il vecchio (`MoveFileEx` con replace), con retry 10 s; se fallisce resta il vecchio. Rollback con lo stesso meccanismo. Il bundle macOS resta con lo spostamento. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `internal/update/swap.go` (`fileSwap`, `bundleSwap`). Test: `swap_test.go` (rename bloccato in install e in rollback: l'app resta sempre presente), `TestNativeHelperApplyAndRollback` ora controlla che l'exe installato sia davvero il nuovo e che il rollback rimetta il vecchio.
- [ ] IDE-1.12 Conferma d'avvio dal backend appena il runtime della finestra principale è pronto (`events.Common.WindowRuntimeReady`, `update.go` `confirmUpdateWhenWindowReady`), indipendente dal caricamento del workspace; la conferma del frontend resta (idempotente, `confirmMu`). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] IDE-1.13 Versione della build diversa dal manifest: la nuova app scrive il motivo in `<marker>.rejected` e l'helper ripristina subito. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** test `TestNativeHelperApplyAndRollback/version-mismatch`, rosso sul codice precedente (32,6 s, rollback solo all'uscita del figlio), verde ora (4,3 s).
- [ ] IDE-1.14 `apply.log` con ogni passo e orario (versioni, attesa chiusura, cartella dati libera, backup, installazione, pid, conferma/uscita/timeout, rollback e suo esito). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] IDE-1.15 CI Windows: step "Updater on Windows" in `.github/workflows/build.yml` (`go test ./internal/update/`). — **IMPLEMENTATO; da verificare al primo run della CI su Windows.**

**Test e verifica**
- [x] IDE-1.T1 `apply_test.go` con finto figlio GUI: `STARTF_USESHOWWINDOW` assente.
- Verifiche manuali **IDE-1.0, IDE-1.M1, IDE-1.M2** → `mds/MANUAL-CHECK.md` (sezione **IDE-1**).

**Gate IDE-1:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-1)  [x] Doc  [ ] Verificato da altra persona/agente

---

### IDE-2. Nessun terminale visibile, mai

**Requisito.** Ogni processo lanciato da adOmnia è nascosto; il progresso compare in una barra sotto l'IDE.

**Causa radice.** La release usa `-H windowsgui` (`build/windows/Taskfile.yml:20`): nessuna console. `hide_windows.go` chiama `GetConsoleWindow()` → 0 → codice morto. Gli analizzatori (`AnalyzeArchitecture`, `AnalyzeErrorHandling`, move-symbol) usano `packages.Load` (`internal/goide/errorcheck.go:174`, `move_symbol.go:134`, `architecture.go:26`, `architecture_diff.go:34`), che lancia `go list` senza `SysProcAttr`: ogni chiamata apre una console. Nascondere i singoli `exec.Cmd` non basta.

**Fix**
- [ ] IDE-2.0 Riprodotto (release `-H windowsgui`, Interface Analyzer → si vede la console). — **NON VERIFICATO:** manca osservazione manuale della release Windows prima del fix.
- [ ] IDE-2.1 `ensureHiddenConsole()` al posto di `hideConsoleWindow`: se `GetConsoleWindow()==0` → `AllocConsole()` + `ShowWindow(hwnd, SW_HIDE)`, eseguita il prima possibile (`init`/inizio `main`). Verificare: flash di pochi ms, Windows Terminal come predefinito (conhost/wt). Alternativa se lampeggia: wrapper `go` con `CREATE_NO_WINDOW` o `GOPACKAGESDRIVER`. Compatibile con IDE-1 (il rilancio GUI usa `DETACHED_PROCESS`, non eredita la console). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** con conhost/wt.
- [ ] IDE-2.2 `internal/procutil` (build-tag): `Hide(cmd)` (`CREATE_NO_WINDOW` + `HideWindow` su Windows, no-op altrove), `Command`, `CommandContext`; `process.Configure` mantiene i process group e chiama `procutil.Hide`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su Windows.
- [ ] IDE-2.3 Eliminati i sei helper duplicati: `git`, `docker`, `nettools` (`configureHiddenCommand`), `kube`, `logstream`, `sourcemap` (`hideConsole`); `copilot` e `milk` (`process_windows.go` con `0x08000000`). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su Windows.
- [ ] IDE-2.4 Chiamate non nascoste corrette: — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su Windows.
  - [ ] `go list` via `packages.Load` (risolto da 2.1) — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su release Windows.
  - [ ] `internal/goide/private_modules.go:76` `git config --get-all` — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su release Windows.
  - [ ] `internal/goide/fileops.go:313` `explorer /select,` (passare dall'helper) — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** resta un lanciatore GUI esplicito nella allowlist.
  - [ ] `internal/mcp/stdio.go:25` server MCP utente — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** con un server MCP reale.
  - [ ] `internal/nettools/cert.go:337,342,346` keytool/openssl — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su release Windows.
  - [ ] `internal/docker/control.go:100` `LabShell` (tab terminale nell'IDE o processo nascosto) — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** sostituito da `LabExec`, console incorporata con timeout e output limitato.
  - [ ] `internal/ide/process/interrupt_windows.go:21` (`CREATE_NEW_CONSOLE` + `SW_HIDE`: verificare che non lampeggi) — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** su release Windows.
  - GUI già senza console (browser, `explorer` in `devlog`) innocue, ma nella allowlist dei lanciatori.
- [x] IDE-2.5 Test di guardia accanto a `internal/ide/architecture_test.go`: fallisce se un file non di test fuori da `procutil` chiama `exec.Command`/`exec.CommandContext`, con allowlist per i lanciatori GUI.

**Barra di avanzamento sotto l'IDE**
- [x] IDE-2.6 `stores/goideTasks.ts` (`{id, label, status}` per `sessionId`); analizzatori e chiamate lente pubblicano inizio/fine. — test di isolamento per sessione, completamento ed errore.
- [x] IDE-2.7 `components/goide/GoStudioStatusBar.tsx` mostra i task con spinner (già importa `Loader2`/`Activity`). — **Bug introdotto e corretto (2026-10-14):** la status bar usava `useGoIDETasksStore((state) => runningGoIDETasks(state, session.id))`; `runningGoIDETasks` restituisce un nuovo array a ogni chiamata, quindi Zustand 5 / `useSyncExternalStore` vedeva uno snapshot diverso a ogni render → loop di render → React error #185 all'apertura di Go Studio (registrato in `%APPDATA%\adomnia\logs\debug-*.jsonl`). Fix: selezionare l'array stabile `state.tasks[sessionId]` e filtrare con `useMemo`; test di invariata referenza in `goideTasks.test.ts`. Verificato: nuova build, l'app apre Go Studio senza `#185`.

**Verifica**
- [x] IDE-2.T1 Test di guardia verde.
- Verifiche manuali **IDE-2.0, IDE-2.M1, IDE-2.M2** → `mds/MANUAL-CHECK.md` (sezione **IDE-2**).

**Gate IDE-2:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-2)  [x] Doc  [ ] Verificato da altra persona/agente

---

### IDE-3. Import graph illeggibile

Tab `GoStudioArchitecturePanel.tsx` → `PackagesView` → `Graph`. Dati: `packageGraph()` in `goStudioArchitecture.ts:32-60`; layout: `layoutLayered()` in `lib/layeredGraph.ts:50-84`; disegno: `GoStudioGraphView.tsx`, **condiviso** con call graph, Context e Interface Explorer (controllare visivamente tutte e quattro).

**Cause radice**
1. Frecce giganti (verificato): `GoStudioGraphView.tsx:38` `<marker>` senza `markerUnits` → usa `strokeWidth`; spessore `1 + (value/max)*5` (riga 49) → marker fino a ~36 px.
2. Archi intrecciati: ordine nel livello solo per peso/nome, nessuna riduzione incroci (`layeredGraph.ts:75`); layering longest-path senza nodi fittizi (58-67); tutti gli archi convergono nello stesso punto del nodo; archi all'indietro con `bend = 60` (riga 47).
3. `limit = 40` (`goStudioArchitecture.ts:32`) taglia per grado → quasi-clique tra gli hub; solo la nota "N altri non mostrati" (`GoStudioArchitecturePanel.tsx:44`).
4. Nessuna navigazione: niente pan/zoom, filtro stdlib/esterni, raggruppamento, evidenza cicli, riduzione transitiva; alla selezione non si attenuano gli archi (`GoStudioGraphView.tsx:60`).

**Fix** (in `layeredGraph.ts` e `GoStudioGraphView.tsx`; nessuna nuova dipendenza, tutto lazy in `components/goide`)
- [ ] IDE-3.1 Marker `markerUnits="userSpaceOnUse"` ~7 px fisso; `vector-effect="non-scaling-stroke"`; spessore 1-3 px, il peso diventa opacità o etichetta numerica. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `GoStudioGraphView.tsx`: freccia 7 unità (anche una rossa per i cicli), tratto 1-3 px senza scalare con lo zoom, il peso modula anche l'opacità.
- [ ] IDE-3.2 Sugiyama completo: nodi fittizi per archi multi-livello, 4-6 sweep barycenter su/giù, porte distribuite lungo il bordo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `lib/layeredGraph.ts` (condiviso con Service Map e Impact Map, firma invariata): slot fittizi per gli archi lunghi, 6 sweep (1 oltre 400 archi), porte ordinate per posizione del vicino, ogni arco ha un `path` che attraversa i livelli intermedi in corsia libera. Test automatici verdi, resta il controllo visivo.
- [ ] IDE-3.3 Riduzione transitiva (default attiva); raggruppamento per cartella con espansione al click; archi di ciclo tratteggiati `--color-danger` + filtro "Cicli"; toggle stdlib/esterni/test (stdlib ed esterni nascosti di default). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `packageView()` in `goStudioArchitecture.ts` + barra di toggle in `PackagesView`: Reduce (on), Group (click sul gruppo lo apre), Cycles (Tarjan; archi di ciclo tratteggiati in rosso nel grafo), Std, External. **Toggle "test" non fatto:** il report non contiene mai i package di test (`isTestVariant`), non c'è nulla da mostrare.
- [ ] IDE-3.4 Pan/zoom (`viewBox`, rotellina, trascinamento, "adatta"); hover/selezione evidenziano archi incidenti e portano il resto a ~10%; "focus + profondità N" al posto del taglio a 40, con contatore "X di Y". — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** pan/zoom + pulsanti +/−/adatta (doppio clic sullo sfondo = adatta) in `GoStudioGraphView`; hover e selezione attenuano gli archi non incidenti al 10%; focus con profondità 1-4 e contatore "X of Y packages"; tetto di sicurezza 150 nodi senza focus.
- [ ] IDE-3.5 Minimappa (opzionale). — **NON FATTO:** pan/zoom e "adatta" coprono il caso; riprendere se i grafi grandi restano difficili da orientare.
- [x] IDE-3.6 Verificato se gli archi `Imports` di `internal/languages/golang/architecture.go` (campo `Imports`, riga 99) sono solo import diretti. — **Sì:** `collectPackages` itera `pkg.Imports` (import diretti di go/packages) e tiene solo project→project; la riduzione transitiva è quindi significativa e std/esterni non sono nodi (vengono aggiunti da `packageView` quando richiesti).

**Test**
- [x] IDE-3.T1 `goStudioArchitecture.test.ts` + nuovo test su `layeredGraph`: nessun nodo sovrapposto a un percorso di arco; incroci non peggiori di prima. — `lib/layeredGraph.test.ts` (9 test: percorsi fuori dai nodi, corsie per archi lunghi, incroci a 0 su un caso costruito per incrociarsi, arco di ciclo, porte distinte, grafo vuoto, 120 nodi densi) e `packageView` in `goStudioArchitecture.test.ts`. Suite goide + observe + lib verde.
- Verifica manuale **IDE-3.M1** → `mds/MANUAL-CHECK.md` (sezione **IDE-3**).

**Gate IDE-3:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-3)  [x] Doc  [ ] Verificato da altra persona/agente

---

### IDE-4. Vista Goroutines (accanto a Entry points e Services)

**Come funziona oggi.** `golang.AnalyzeArchitecture` (`internal/languages/golang/architecture.go:217`, `go/packages`+`go/ast`+`go/types`, non esegue codice); `collectEntries` (`architecture_entries.go:75`); `collectSync` (`architecture_sync.go:34`) registra già ogni `*ast.GoStmt` come `ArchSync{Kind:"go",…}`; servizio `internal/goide/architecture.go:19` (timeout 3 min, `errorcheck.go:20`, richiede `AuthorizationPermitted`); binding `goide_bindings.go:1397`, wrapper `lib/goide-api.ts:462-470`. Runtime già presente: `DebugExtensions.Goroutines`, `GoroutineCreation`, UI `GoStudioConcurrencyView`, `GoStudioGoroutineTree`, `goStudioConcurrency.ts`.

**Lacune:** solo `FuncDecl` di primo livello (sfuggono `go` in `var x = func(){…}` e method value); non catturati `errgroup.Group.Go`, `time.AfterFunc`, `context.AfterFunc`; nessun dato su loop/ctx/WaitGroup/canale/forma; limiti `maxArchSync`/`maxArchEntries` → `Truncated`.

**Backend** (`internal/languages/golang`; il core `internal/ide` non cambia)
- [x] IDE-4.1 `architecture_goroutines.go` con `collectGoroutines` accanto a `collectSync`, visitando anche gli initializer `var` a livello di package (come `collectCLI`). — fatto; gli initializer compaiono come funzione "(package var)".
- [x] IDE-4.2 DTO `ArchGoroutine`: `Kind` (`go|errgroup|waitgroup-go|afterfunc`), `Shape` (`literal|named|method|dynamic`), `Launches`/`LaunchesID`, `Package`, `Function`, `Site`, `Spawner`, `InLoop`/`LoopKind`, `Bounded`, `Ctx`, `Cancellable`, `WaitGroup`, `ErrGroup`, `Channels`, `Recover`, `Risks []string`, `Severity`. — fatto, più `Entries` (IDE-4.5). Bindings TS aggiornati a mano: il generatore non gira qui (`go.sum` senza `x/image` e `howett.net/plist`); rigenerare quando disponibile.
- [x] IDE-4.3 `Report.Goroutines []ArchGoroutine` (`json:"goroutines"`); estesi `Resolve`, `Merge`, `finish()` (ordinamento, slice vuota non nil); `maxArchGoroutines = 5000` con `Truncated`. — fatto.
- [x] IDE-4.4 Regole di rischio (come indizi, non prove): `unbounded-loop-spawn`, `no-wait`, `no-ctx-cancel`, `loop-var-capture` (solo go < 1.22 in `go.mod`), `no-recover` (solo spawn da HTTP/job), `fire-and-forget-in-handler`. — fatto. `Bounded` = condizione con costante, range su costante/array, `SetLimit` o invio su canale prima dell'avvio. `fire-and-forget-in-handler` sostituisce `no-wait` quando l'avvio è raggiungibile da un entry HTTP o la firma è un handler. Severità: high = `loop-var-capture`; medium = `unbounded-loop-spawn`, `fire-and-forget-in-handler`, `no-ctx-cancel`; low = il resto.
- [x] IDE-4.5 Collegamento agli entry: join `Spawner` ↔ `Entry.Function`/`HandlerSite` + raggiungibilità sui `Calls` con limite di profondità. — fatto (`linkGoroutines`): join per package + ultimo segmento del nome (`Function`/`Handler`; `HandlerSite` non serve), risalita sui chiamanti fino a profondità 8, max 6 entry per avvio. È un indizio: due metodi omonimi nello stesso package si confondono.
- [x] IDE-4.6 Binding solo se serve una chiamata più leggera: `Service.AnalyzeGoroutines(sessionID)` in `internal/goide/goroutines.go` + `GoIDE.AnalyzeGoroutines`, poi rigenerare i binding. — **NON NECESSARIO:** i dati viaggiano nel report di `AnalyzeArchitecture` già in cache; nessuna nuova chiamata.

**Frontend**
- [ ] IDE-4.7 Tab `'goroutines'` ("Goroutines (n)") in `ArchitectureTab` e `tabs` di `GoStudioArchitecturePanel.tsx`; nuovo `GoStudioGoroutinesView.tsx` raggruppato per package → funzione, badge tipo/forma, indicatori loop/ctx/wg, chip di rischio; filtri (solo rischi, in loop, per tipo, testo); click con `SiteLink`; link "lancia" verso il callee. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** tutto fatto tranne il link cliccabile al callee: la freccia "→ callee" mostra il nome (con l'ID nel tooltip) ma non apre il sorgente della funzione avviata (manca il suo sito nel DTO). Chip di rischio con tooltip che spiega la regola.
- [x] IDE-4.8 Helper puri di raggruppamento/filtro in `goStudioArchitecture.ts` (accanto a `groupEntries`). — `groupGoroutines`, `filterGoroutines`, `matchGoroutineSite`.
- [ ] IDE-4.9 Comando `view.goroutines` in `goStudioCommands.ts`, menu View, `requires: { language: 'go' }`, montato con `initialTab="goroutines"` come `GoStudioRunPanel.tsx:324`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** nuova tool window `goroutines` (store `goideLsp`, titolo, `GoStudioRunPanel`), comando in `goStudioLanguageCommands.ts`. Nessuna scorciatoia assegnata.
- [ ] IDE-4.10 Runtime: in `GoStudioConcurrencyView` azione "Collega allo statico" (`GoroutineCreation` ↔ `ArchGoroutine` stesso file e riga), nessun nuovo codice Delve. Snapshot pprof: riuso codice `goroutine` in `goide/pprof*.go` (da esaminare). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** nei frame "created at" delle race, un frame che coincide per file e riga con un avvio statico mostra "Static launch · N hints" e apre la vista Goroutines (usa l'analisi in cache: nulla se non è stata lanciata). **Non fatto:** la lista goroutine di Delve (`GoStudioGoroutineTree`) e gli snapshot pprof non sono collegati; `goide/pprof*.go` non esaminato.

**Test**
- [x] IDE-4.T1 Go a tabella: `go func(){}()`, `go f(x)`, `go s.m()`, `errgroup.Go`, `wg.Go`, `time.AfterFunc`, initializer package, spawn in `for`/`range`, bounded/unbounded, ctx/`Done`, ogni regola di rischio. — `architecture_goroutines_test.go` (fixture con stub di `errgroup`, anche `context.AfterFunc`, semaforo, handler con/senza `recover`, modulo go 1.21 vs 1.22 per `loop-var-capture`). Non è a tabella pura ma copre ogni forma e ogni regola.
- [x] IDE-4.T2 Copertura `Resolve`/`Merge`; `internal/ide/architecture_test.go` verde. — `TestGoroutinesResolveMergeAndOrdering`; `go test ./internal/ide/... ./internal/goide ./internal/languages/golang` verdi.
- [x] IDE-4.T3 Vitest raggruppamento e filtri (stile `goStudioArchitecture.test.ts`). — 3 test (raggruppamento, filtri, `matchGoroutineSite` con percorsi Windows). Suite `components/goide` + `lib` verde (1212 test).
- Verifica manuale **IDE-4.M1** → `mds/MANUAL-CHECK.md` (sezione **IDE-4**).

**Gate IDE-4:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-4)  [x] Doc  [ ] Verificato da altra persona/agente

---

### IDE-5. Altri difetti dell'IDE (trovati leggendo il codice, nessuno riprodotto)

Per ognuno: riprodurre, fix, test.

- [x] IDE-5.1 (S) Revocare la fiducia lascia terminali e debug vivi: `internal/goide/service.go:313-317` ferma solo `processes` e `lsp`; `CloseSession` (343-344) ferma anche `terminal` e `debug`; `docs/GO-STUDIO.md:118` promette il contrario. Fix: `terminal.CloseSession` + `debug.StopSession` alla revoca + test. — fatto in `SetToolAuthorization`; `trust_revoke_test.go` rosso senza la riga del terminale (terminale vivo dopo la revoca), verde con.
- [x] IDE-5.2 (S) Installazione tool senza timeout: `internal/goide/gopls.go:94-99` usa `context.Background()` per `sdkGoVersion` e `resolveCompatibleToolModule` (`@latest` in rete). Fix: `WithTimeout` ~60 s e messaggio "sei offline?". — **già coperto dal codice:** `sdkGoVersion` ha 10 s (`localGoVersionTimeout`) e `resolveCompatibleToolModule` 60 s (`toolResolveTimeout`, `toolversion.go`); resta solo il messaggio "sei offline?" (non fatto).
- [x] IDE-5.3 (M) Salvataggio fragile su Windows, rompe i symlink: `internal/goide/documents.go:417-444` temp + `os.Rename` senza retry (antivirus/indexer/gopls → "Access denied"). Fix: retry 3-5 con backoff, scrivere attraverso il symlink verso il target, messaggio chiaro. — fatto (`replaceFile`: 5 tentativi con backoff 25 ms raddoppiato; `EvalSymlinks` prima di scrivere; messaggio "bloccato da un altro programma"). Test sui retry e sul messaggio; il test del symlink salta su Windows senza privilegio (gira su Linux/macOS).
- [ ] IDE-5.4 (S) `CloseSession` fallisce a metà: `service.go:364-366` se `recovery.ForgetSession` fallisce esce dopo aver rimosso la sessione; saltati `views`, `saveState`, evento `session.closed`. Fix: `ForgetSession` best-effort (log) oppure ultimo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** ora best-effort come `history.ForgetSession`; **nessun test** (serve un `recovery` che fallisca).
- [ ] IDE-5.5 (M) Errori in italiano in una UI inglese (~140 su 793 `Errorf`/`errors.New` in `internal/goide`, `ide`, `languages`; es. `documents.go:412,421-441`, `service.go:75-82,327`). Fix: una lingua per gli errori utente (inglese), convertire prima quelli che arrivano ai binding. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Convertiti in inglese 499 messaggi `Errorf`/`errors.New` in `internal/goide`, `ide`, `languages` (92 file) e le asserzioni dei test che cercavano frammenti italiani; i commenti restano in italiano.
- [x] IDE-5.6 (S) Output grezzo dei tool negli errori (`CombinedOutput()` non limitato: `templates.go:218-221`, `gist.go:58-61`, `shutdown_analysis.go:53`, `gowork.go:195`, `move_symbol.go:718`, `sonar.go:193,348`, `dependencygraph.go:201-212`). Fix: `cleanToolError(output, max)` (toglie ANSI, prime e ultime righe, limite). — `internal/goide/toolerror.go` + test; usato in `templates.go`, `gist.go`, `shutdown_analysis.go`, `gowork.go`, `move_symbol.go`. Non toccati `sonar.go` (già `tailString`) e `dependencygraph.go` (già limitato in `runModuleCommand`).
- [ ] IDE-5.7 (S) Bottoni IDE con `text-white` sull'accento (~17 componenti: `GoStudioArchitecturePanel.tsx:84`, `GoStudioTestsPanel.tsx:358`, `GoStudioEmptyState.tsx:28`…); `globals.css:33` ha `--color-on-accent: #000000` nel tema scuro (`#FFFFFF` riga 119). Fix: `text-on-accent`, meglio classe condivisa `.btn-accent`; `bg-white` solo in `GoStudioHtmlView` e overlay neri. (Coincide con GS-10.7: farlo una volta sola.) — **NON FATTO, nota:** `globals.css` ha già regole `.bg-accent.text-white → color: var(--color-on-accent)` per i tema built-in e per l'accento personalizzato (`accentPalette.ts` calcola `on-accent`). Il difetto resta sugli altri skin che non definiscono `on-accent`: da verificare a occhio prima di toccare ~200 occorrenze (ispezione visiva in `mds/MANUAL-CHECK.md`, IDE-5.7). — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Tutti i `text-white` su `bg-accent` in `components/goide` (16 righe) sono ora `text-on-accent`; token Tailwind `on-accent` = `var(--color-on-accent, #fff)`, quindi anche gli skin senza token hanno un fallback.
- [ ] IDE-5.8 (M) ~40 errori ingoiati nel frontend IDE (`catch {}`, `.catch(() => {})`, `.catch(() => undefined)` in `components/goide`, `stores/goide*.ts`, `lib/goide`). Fix: silenzio solo dove best-effort voluto; il resto verso toast/console. (Si sovrappone a GS-10.12.) — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Le chiamate best-effort visibili (simboli modificati, repo privati, creazione goroutine, close guard, watcher, crash recovery, copilot, sync ambiente) passano da `logBackgroundError(scope)` (`lib/goide/backgroundError.ts`) invece di sparire; restano silenziosi solo close/resize/forget di risorse.
- [x] IDE-5.9 (S) Handler richieste LSP mai annullati: `internal/ide/lsp/jsonrpc.go:173` `go c.answer(...)`, riga 206 `context.Background()`. Fix: contesto di `Conn` annullato alla chiusura e passato a `HandleRequest`. — fatto (`Conn.ctx`/`cancel`, annullato in `shutdown`); `TestConnCancelsServerRequestHandlersOnClose`.
- [ ] IDE-5.10 (S) Lista profili terminale può bloccarsi su Docker/WSL: `terminal_profiles.go:80` (`remote.Containers`), `terminal_profiles_windows.go:31` (`remote.WSLDistributions`), 3 s ciascuno in sequenza (`remote/discover.go:17`); percorso UI sincrono non confermato. Fix: scoperta parallela, cache 30-60 s, shell locali subito. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** la scoperta remota (SSH/Docker) ora gira in parallelo con quella locale (WSL), peggior caso da ~6 s a ~3 s; la cache da 5 minuti esisteva già. "Shell locali subito" non fatto (richiede un'API a due fasi).
- [ ] IDE-5.11 (S) Watcher: oltre 4000 cartelle se ne osserva solo una parte (`internal/goide/watcher.go:22,134`; status bar `watcher.limited` `GoStudioStatusBar.tsx:109`). Fix: tooltip "Osservate N/4000…" con azione Aggiorna. — **parziale:** il tooltip con N e limite esiste già (`GoStudioStatusBar.tsx:123`); manca l'azione Aggiorna. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** La status bar mostra "Partially watched · N/limit · Refresh": il click rilegge il progetto da disco (`refreshProject`).
- IDE-5.12 (L, manuale) Gate "Real IDE" Fase 1 (`mds/todo-ide.md` M1-M34): voce puramente manuale → **`mds/MANUAL-CHECK.md`** (IDE-5.12).

Già controllato e senza problemi: nessun TODO/FIXME nel codice IDE; i 250 metodi `GoIDE` esposti hanno un wrapper frontend; finestre IDE staccate e radice con `ErrorBoundary`; `RevealPath` su Windows corretto; percorsi relativi del modello con `/` (solo il fallback in `GoStudioEditorTabs.tsx:29` può mostrare backslash).

**Gate IDE-5:** [ ] Impl — restano 5.5, 5.7, 5.8, 5.11 (azione)  [ ] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-5, incl. 5.12)  [ ] Doc  [ ] Verificato da altra persona/agente

---

### IDE-6. CPU alta ad app ferma (~20%)

**Sintomo (segnalazione 2026-10-16).** adOmnia occupa circa il 20% di CPU senza che l'utente faccia nulla. Nessun profilo dalla macchina dell'utente: cause trovate leggendo il codice; il peso relativo va misurato.

**Fix**
- [ ] IDE-6.1 Polling dei dev log (`hooks/useAppInit.ts`, ogni 1,5 s su ogni schermata; `devlog.IsDev` è `true` anche in release): rileggeva e serializzava l'intero file e deduplicava con un `some()` su tutto lo store (fino a 2000×2000 confronti). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `devlog.ReadSince` (solo righe nuove, riparte dopo un Clear) e binding `GetDevLogsSince`; deduplicazione con mappa per messaggio. Test `TestReadSinceReadsOnlyNewCompleteLines`, `devLogs.test.ts`.
- [ ] IDE-6.2 Ciclo Git: `git status` riscriveva `.git/index`, il watcher segnalava `.git` come cambiata, `goideVcs` rilanciava `VCSStatus` (6-7 processi git). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `sessionWatch.ignoredPath` (cartelle ignorate a ogni livello e `.gitignore`), `gitEnviron()` con `GIT_OPTIONAL_LOCKS=0`, timeout anche su `statusPorcelain`. Test `TestWatcherIgnoresEventsOnIgnoredAndGitignoredPaths` (rosso prima) e `TestStatusDoesNotRewriteTheIndex` (rosso sul codice precedente).
- [ ] IDE-6.3 Indicatore risorse: gopsutil `Children()` enumerava tutti i processi del sistema per ogni nodo (Windows: snapshot Toolhelp; Linux/macOS: `pgrep`). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `processTable()` una volta per campione (`table_windows.go`, `table_other.go`), polling 5 s. Test `TestSampleIncludesChildProcesses`.
- [ ] IDE-6.4 Spinner gopls bloccato: `lsp.progress` non legato al token, un `report` tardivo lo riaccendeva; timer 500 ms anche sui toast di errore. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `lib/goide/lspProgress.ts` (test), timer 1 s solo mentre conta i secondi.
- [ ] IDE-6.5 Terminale: ticker 25 ms per terminale anche senza output. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** timer armato solo con output in attesa.

**Non toccati (da valutare con una misura):** pannelli con polling `live` (Proxy 0,7-1,5 s, Debugger 0,5 s, WebSocket, Kube, Mock…) che non rallentano in Idle; `useLiveSources.ts` (1,5 s senza gate); il tick del ticker database (1 s). Il test `internal/ide/startup` fallisce in questo ambiente anche su `HEAD` (attende una porta).

**Gate IDE-6:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (IDE-6)  [x] Doc  [ ] Verificato da altra persona/agente

---

## PARTE B — Go Studio / Hub

### GS-1. Play / Run non funziona se `main.go` è in `cmd/` e `go.mod` è nella root

**Sintomo.** `go run ./cmd` da terminale funziona; dall'IDE Play, F5 e "Run Current Configuration" falliscono con `no Go files in <root>`.

**Causa.** Nessuna risoluzione del package `main`: sempre target `.` con working dir vuota.
- `components/goide/goStudioRunDraft.ts:3-10,40` (`DEFAULT_RUN_DRAFT`, `target: '.'`); `GoStudioPanel.tsx:212` `useState(DEFAULT_RUN_DRAFT)` senza setter; `run.run` (`:758`) → `startConfigured('run')` (`:362-379`) → `store.startRun`.
- `stores/goide.ts:1150-1151` riapplica `'.'`; `loadRunConfigurations` (`:531-541`) non crea un default; `GoStudioRunConfigurations.tsx:45` e `internal/goide/runconfig.go:36-39` usano `.`.
- Backend: `goide_bindings.go:850` → `internal/goide/service.go:756` (`StartRun`); `validateRunTarget` (`internal/ide/run/helpers.go:58`) controlla solo che il path sia nel progetto; `internal/languages/golang/runner.go:90-100` costruisce `go run <Target>`, `Dir = WorkingDirectory` (`:111`).
- Stesso difetto per Debug (`GoStudioPanel.tsx:689-695`, `internal/goide/service_debug.go:101-136`), `buildRunRequest` (`service_runconfig.go:183-256`) e test (`service_tests.go:25-43`).
- Unico rilevatore di main: `internal/devcontext/gofile.go:27-49` (`detectMain`), usato solo da "Start workspace".
- Bug collegato: il gutter ▶ su `func main` usa `packagePath` relativo con `workingDirectory: ''` (`GoStudioPanel.tsx:684-685`, `goStudioRunTargets.ts:32-35,77-81`) senza lo scope di modulo di `targetScope` (`goStudioQuickActions.ts:200-202`): con `svc/go.mod` + `svc/cmd/main.go` fallisce con `./svc/cmd`. Idem `goStudioWorkspaceStart.ts:158-167`.

**Fix**
- [ ] GS-1.0 Riprodotto con `root/go.mod` + `root/cmd/main.go` (test rosso). — **NON VERIFICATO pre-fix:** aggiunto test di regressione sul caso, ma non è stato conservato un run rosso precedente all'implementazione.
- [x] GS-1.1 Core generico (`internal/ide/language` + `internal/ide/run`): capability opzionale `RunTargetResolver` con `DiscoverRunTargets(ctx, unitRoot) []RunTarget{Dir, ModuleDir, Package, Label}` e `ResolveRunTarget(root, wd, target, kind)` chiamata prima di `CommandSpec`. Nessun `switch language`.
- [x] GS-1.2 Adapter Go: discovery per modulo (riuso `scanModules`; `go list -f '{{.Name}} {{.Dir}}' ./...`, fallback `go/parser` `PackageClauseOnly`). Target solo se `Name == "main"` e c'è `func main`; esclusi `_test.go` e `//go:build ignore`. — Implementato con `go list -e -json` e fallback AST equivalente.
- [ ] GS-1.3 Regola per target `.`: working dir con file main → `.`; un solo main nel modulo → `./rel`; più main → `cmd/<basename-modulo>`, poi package del file attivo, poi chiedere. Mai indovinare in silenzio. Target-file (`go run cmd/main.go`) → directory del file + modulo (`./cmd`). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** il picker nell'app.
- [ ] GS-1.4 Stessa risoluzione per `StartRun`, `buildRunRequest`, `StartDebug` e test. Nessun main → errore `No main package found under <root>; candidates: ./cmd/api, ./cmd/worker`. — **IMPLEMENTATO** in `StartRun`/Run configurata e `StartDebug`; i test conservano lo scope esplicito del package. **Verifica manuale in MANUAL-CHECK.md** (Run/Debug/Test).
- [x] GS-1.5 Binding `ListRunTargets(sessionId)` in `goide_bindings.go` + rigenerazione.
- [ ] GS-1.6 Frontend: in `startConfigured` senza configurazione salvata risolvere con `moduleScopeFor` sul file `.go` attivo o con la discovery; creare automaticamente "Run <pkg>" al primo Play (`.adomnia/run-configurations.json`, campi piatti Go invariati); picker se più main, scelta ricordata; `targetScope` usato da `runTarget` e `serviceConfigurationForDirectory` (wd = directory del modulo, package relativo al modulo). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** nell'app.
- [ ] GS-1.7 Edge case: più main in `cmd/*`; `go.work` (eseguire dalla directory del modulo proprietario); moduli annidati (package relativo al `go.mod` più interno); cartelle loose senza `go.mod`; Windows (normalizzare `\`→`/`, prefisso `./`; `moduleScopeFor` confronta con `realPath` e ritorna `null` con symlink/case diversi → normalizzare). — **IMPLEMENTATO e coperto automaticamente; verifica manuale in MANUAL-CHECK.md** con junction/symlink Windows.

**Test**
- [x] GS-1.T1 Test Go per il resolver in `internal/languages/golang`; `internal/ide/architecture_test.go` verde.
- Verifiche manuali **GS-1.M1, GS-1.M2** → `mds/MANUAL-CHECK.md` (sezione **GS-1**).

**Gate GS-1:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-1)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-2. "Run with Coverage" (e Run tests) su una cartella: non fa niente / 0.0%

**Sintomo.** Tasto destro cartella → Go Package → Run with Coverage: non parte o mostra 0.0% anche con test presenti.

**Cause (dalla più probabile)**
1. Pattern sbagliato: `./folder` invece di `./folder/...` (`goStudioTreeMenu.ts:57-60` → `GoStudioProjectTree.tsx:232-233` → `runPackageCommand` `goStudioTreeActions.ts:232-245` → `moduleScopeFor` `goStudioQuickActions.ts:54-66` → `quickRunFor` `:101-104`); la root diventa `.`.
2. stderr ed exit code scartati: solo stdout (`internal/ide/testing/manager.go:58-60`, `QuietStdout: true` in `test_runner.go:27`); `Tree.Apply` ignora eventi senza package (`tree.go:153`); `manager.go:88-91` trasforma `failed` in `finished` senza `ExitCode` (`Snapshot` `:13-25`); con zero eventi `GoStudioTestsPanel.tsx:407` mostra "No tests found."; errori di compilazione persi.
3. Manca `-coverpkg`: `TestArguments` aggiunge solo `-coverprofile` (`test_runner.go:110-112`).
4. Report vuoto se `modulePath == ""`: `buildCoverageReport` salta ogni file (`internal/goide/coverage.go:173-175`) → report non-nil con 0 file, 0.0%. `modulePath` vuoto con `moduleDir` senza `go.mod`, riga `module` con virgolette/commento (`detector.go:120-134`), `go.work` multi-modulo. Errore di `loadCoverage` ignorato (`service_tests.go:112`); file non leggibili saltati in silenzio (`coverage.go:177-180`).
5. Module dir errata su Windows: `relativeTo(session.project.realPath, module.path)` (`goStudioQuickActions.ts:55`) vs unit da `RootPath` (`workspace.go:243`, `detector.go:28`); con symlink/junction/OneDrive/case drive i moduli sono scartati e `moduleDirectory` diventa `''`.

**Fix**
- [ ] GS-2.0 Riprodotto (cartella con sotto-package e test; cartella senza test; errore di compilazione in un test). — **NON VERIFICATO pre-fix:** i tre casi sono coperti dai test di regressione, ma non è stato conservato un run rosso precedente all'implementazione.
- [x] GS-2.1 Frontend: opzione `recursive` per `quickRunFor`/`runPackageCommand` (cartella → `./<inner>/...`, root modulo → `./...`, file → `./inner`); stessa root (`rootPath`) del backend in `moduleScopeFor` e `goImportPath`, normalizzando case/separatori.
- [x] GS-2.2 Pannello Test mostra `useGoIDETestsStore.error` e i diagnostics, più avviso "Running go test ./x/...".
- [x] GS-2.3 Core (`internal/ide/testing`): `Snapshot` con `ExitCode *int` e `Diagnostics string`; `OutputTap` tiene stderr in buffer limitato (64 KB, `maxTestOutputBytes`); exit ≠ 0 senza eventi package → resta `failed` con stderr allegato (o risultato sintetico `BuildFailed`); il pannello mostra quel testo al posto di "No tests found.".
- [x] GS-2.4 Adapter Go (`test_runner.go`): con `coverageFile != ""` aggiungere `-coverpkg=<pattern>` per ogni pattern (`./x/...`, `./x`, `./...`) uniti da virgola; `ReadModulePath` robusto (virgolette, commenti) o `go list -m`/risalita al `go.mod` più vicino; decodificare `build-output`/`build-fail` e attaccare gli errori al nodo del package.
- [x] GS-2.5 Coverage (`internal/goide/coverage.go`, `service_tests.go`): import path risolto contro tutti i moduli di `Project.Units`; errore di `loadCoverage` mostrato; `nil` se il report non ha file (non 0%); aggregazione per package (`CoveragePackage`) coperta in `coverage_test.go` per cartelle annidate.

**Verifica**
- [x] GS-2.T1 `coverage_test.go` cartelle annidate; test per `ReadModulePath`; test per stderr/ExitCode.
- Verifiche manuali **GS-2.M1…M4** → `mds/MANUAL-CHECK.md` (sezione **GS-2**).

**Gate GS-2:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-2)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-3. Claude Code / milk: `npm error EMAXREDIRECT` e "milk process is not available"

**Sintomo.**
```
npm error code EMAXREDIRECT ... maximum redirect reached at: https://10.193.126.26/UserCheck/PortalMain?... (portale proxy aziendale)
start failed: Claude Code did not initialize: milk process is not available
```
Con account aziendali (AWS Bedrock) Claude Code non parte nemmeno dopo restart.

**Cause**
- Launcher condiviso `internal/milk/manager.go`: `Start()` (183-231) → `launch()` (276-342), `exec.Command` a 280, `cmd.Dir = root` a 285, `initialize` ACP timeout 2 min (23, 313-324).
- Claude Code (`internal/claudecode/agent.go:47-62`): `settings.BinaryPath` → `claude-agent-acp` su PATH → `npx --yes @agentclientprotocol/claude-agent-acp@0.89.1` (16, 61). `--yes` + versione pinnata → richiesta al registry → portale proxy. Non cerca `claude` installato né npm globali (`%APPDATA%\npm`).
- Nessun helper di lookup condiviso: da riusare `internal/ide/sdk` `ToolSearch.Candidates`/`Locate` (`tools.go` ~40-100) e `sdk.ResolveExecutable` (`executable.go:17`).
- Env non inoltrato: `agent.go:26-44` usa `os.Environ()` + solo `ANTHROPIC_MODEL`/`ANTHROPIC_CUSTOM_MODEL_OPTION` (`config.go:247-269`); `netpolicy.Environ()` (`internal/netpolicy/netpolicy.go:263`) non usato da nessun agente. Solo Copilot imposta `NODE_EXTRA_CA_CERTS` (`internal/copilot/manager.go:344-348`).
- Messaggio fuorviante: `internal/milk/conn.go:18` `ErrClosed = "milk process is not available"` generico, usato anche per Claude Code; prodotto quando `npx` esce e `shutdown()` (`conn.go` ~222-235) fallisce le chiamate; `launch()` lo avvolge (`manager.go:326`). Stderr di npm solo nel ring buffer (`collectStderr` 344-352); `abandon()` (`:414`) azzera `current`; exit code di `cmd.Wait()` non usato.
- Bedrock: i settings (`~/.claude/settings.json`, `.claude/settings*.json`, managed; `CLAUDE_CONFIG_DIR`) sono letti solo per visualizzazione (`claudecode_bindings.go:77` `Inspect`); l'impressione che "li legga" viene dal motore AI interno (`internal/ai/claudecode.go:51-52` + `engine.go:187-216`), **non** dall'agente Claude Code.
- milk: provider (`internal/milk/agents.go:26-33`) solo DeepSeek, OpenAI, Gemini, OpenRouter, Groq, Mistral; nessun Bedrock → feature mancante, non bug.

**Fix**
- [x] GS-3.0 Riprodotto (rete con portale/redirect simulato). — Coperto da test deterministico `EMAXREDIRECT`/`UserCheck`, inclusa la rimozione delle credenziali dall'URL.
- [x] GS-3.1 Risoluzione senza download silenziosi su `sdk.ToolSearch`: percorso utente → `claude-agent-acp` su PATH → npm globali → cartella gestita da adOmnia → copia in cache/vendorizzata. Rileva `claude` e lo passa via `CLAUDE_CODE_EXECUTABLE`; il supporto è confermato dal changelog upstream dell'adapter.
- [x] GS-3.2 `npx` solo con consenso: prima `npx --offline --no-install`; se manca, stato `not-installed` con pulsante "Install adapter". Niente `--yes` automatico.
- [x] GS-3.3 Env di rete per i figli: `netpolicy.Environ()` + `NPM_CONFIG_PROXY`, `NPM_CONFIG_HTTPS_PROXY`, `NPM_CONFIG_CAFILE`, `NODE_EXTRA_CA_CERTS` dalle Settings di rete (come `copilot/manager.go:344`).
- [x] GS-3.4 Blocco `env` dei settings unito nell'env del figlio (managed > local > project > user, process env più basso; stessa precedenza di `liftedEnv`/`Inspect`). Non loggare i valori di `AWS_*`, `CLAUDE_CODE_USE_*`, `ANTHROPIC_*`. `Settings.Env` e `Settings.ExtraArgs` editabili nel dialog.
- [x] GS-3.5 Classificazione errori: exit code + ultime ~20 righe di stderr (attendere il drain); `ErrClosed` → `"<agent> exited during startup: …"`; riconoscere `EMAXREDIRECT`, `UserCheck`, `ENOTFOUND`, `ECONNREFUSED`, `CERT_`, `SELF_SIGNED` con messaggio azionabile.
- [x] GS-3.6 Diagnostica: binding `ClaudeCode.Diagnose(root)` (comando risolto, PATH di `node`/`npx`/`claude`/`claude-agent-acp`, proxy/CA effettivi, raggiungibilità registry npm (HEAD), check Bedrock `aws sts get-caller-identity`, ultimo stderr). Pulsante "Test connection" con output nei log; campi percorso/env/proxy visibili nel dialog.
- [x] GS-3.7 milk: avviso "Bedrock non è supportato da milk; usa Claude Code". Errore classificato ed env di rete anche per milk e Copilot.

**Verifica**
- [x] GS-3.T1 Test Go sulla classificazione errori e sul merge dell'env; nessun segreto nei log.
- Verifiche manuali **GS-3.M1…M3** → `mds/MANUAL-CHECK.md` (sezione **GS-3**).

**Gate GS-3:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-3)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-4. Barra AI: un'unica icona "AI" con Copilot / milk / Claude

**Stato (nota).** Oggi le tre icone stanno nella stripe **destra** (`components/goide/GoStudioToolStripes.tsx`: `GoStudioLeftStripe` `:80`; `GoStudioRightStripe` `:113-135` con Copilot `:129`, milk `:130`, Claude `:131`). Icona unica nella stripe attuale; se si preferisce a sinistra, spostare solo il bottone. **Decisione (2026-10-15):** bottone unico nella stripe destra, al posto delle tre icone.

**Struttura da riusare.** `stores/goStudioAssistant.ts:3-31` (`pane`, `draft`, `open`, `openWithDraft`, `takeDraft`, `close`, `toggle`); `GoStudioSidePane.tsx:27-34,49`; `GoStudioWorkspace.tsx:52,57` (`sideKey`); `studioToolState.ts:4,7,25,30`; `DetachedStudioToolWindow.tsx:45`; `internal/panelwindow/manager.go:93,112`; chat `GoStudioCopilotChat`/`GoStudioMilkChat`/`GoStudioClaudeChat` (wrapper di `GoStudioAgentChat.tsx`); store `milk.ts`, `claudeCode.ts`, `copilot.ts`; comandi `goStudioCommands.ts:30,247-249`, handler `GoStudioPanel.tsx:801-809`, icone `goStudioCommandIcons.ts:242-244`. Chiamanti: `GoStudioConcurrencyView.tsx:244`, `GoStudioDebugPanel.tsx:118`, `GoStudioImpactPanel.tsx:163`, `GoStudioMemoryModel.tsx:32`, `GoStudioTestsPanel.tsx:271`, `goStudioAIActionsRunner.ts:34-37`. Layout persistito: `adomnia.goide.layout.v1` e `adomnia.studio.toolLayout.v1` (`tool-<session>-<copilot|milk|claude>`).

**Fix**
- [ ] GS-4.1 Mantenere `GoStudioAssistantPane`/`GoStudioChatPane` (id `copilot|milk|claude` validi per placement, finestre staccate, `?tool=`); `lastProvider` nello store, persistito in `adomnia.goide.ai.lastProvider.v1`, fallback `copilot`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** (persistenza nell'app). `stores/goStudioAssistant.ts`: `lastProvider` aggiornato da `open`/`openWithDraft`/`toggle` (solo id chat, `a0` escluso), `close` non lo azzera. Nessuna migrazione: le chiavi `tool-<session>-<copilot|milk|claude>` restano quelle di sempre (`studioToolState.ts` invariato).
- [ ] GS-4.2 Nella stripe, **un solo bottone "AI"** che apre `lastProvider` via `toggleAssistant`; badge/stato del provider attivo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** `GoStudioToolStripes.tsx`: un `StripeButton` con icona `Sparkles`, badge dal tono del provider (`aiProviderBadge`), tooltip col messaggio classificato.
- [ ] GS-4.3 Nuovo `GoStudioAiHubPanel.tsx` montato da `GoStudioSidePane` quando `isChatPane(pane)`: tab Copilot / milk / Claude con pallino di stato (verde ready; ambra starting/installing; rosso crashed; grigio not installed/signed out); chat esistenti come figli senza modifiche; click su tab → `open(id)` + aggiorna `lastProvider`. Copilot/milk/claude fuori da `TABS`; `a0` (AICompanion, `HubMascot.tsx:31`) resta fuori. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** Tab unico "AI Assistant" in `TABS`; il tono viene da `aiProviderTone` (`goStudioAiHub.ts`, sui `State` di `copilot`/`milk`/`claudeCode`), gli stati raccolti da `useAiProviders.ts` senza avviare i provider (`ensure()` = solo status + settings).
- [ ] GS-4.4 `sideKey` derivato da `lastProvider` (non più fallback fisso `'copilot'`, `GoStudioWorkspace.tsx:52`). Se in futuro chiave unica `tool-<s>-ai`: accettarla nella regex di `studioToolState.ts:30` e copiare una volta la chiave legacy. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** Chiave unica `tool-…-ai` non introdotta: le chiavi per provider restano, niente migrazione.
- [ ] GS-4.5 Comandi: i tre `tools.*Chat` restano alias; aggiungere `tools.aiHub` "Open AI Assistant" con shortcut (Alt+9 se libero). Aggiornati `GoStudioAssistantPane.test.ts:11-14` e test dei comandi. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** **Alt+9 non era libero** (`view.contextInspector`): usato **Alt+2** (l'unico digit libero insieme al 3). `goStudioCommands.ts` con binding; `GoStudioPanel.tsx` gestisce `tools.aiHub` insieme ai tre alias; icona in `goStudioCommandIcons.ts`; test comandi estesi (Alt+2 + nessun binding duplicato) e `GoStudioAssistantPane.test.ts` riscritto per la hub.
- [ ] GS-4.6 Lo stato "errore di rete/proxy" (da GS-3) ha un tooltip col messaggio classificato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** `aiProviderTooltip` mostra `Status.message` (classificato da GS-3) sul pallino dei tab e sul bottone AI.

**Verifica**
- [x] GS-4.T1 `goStudioAiHub.test.ts`: mapping tono per ogni `State` (pronto/avvio/errore/non installato), badge, tooltip col messaggio classificato, `lastProvider` persistito, non azzerrato alla chiusura, ignora `a0`, fallback su valore sconosciuto.
- [x] GS-4.T2 `GoStudioAssistantPane.test.ts` e `goStudioCommands.test.ts`: un solo bottone/tab AI, chat figlie invariate, Alt+2 senza rubare Alt+9, nessun binding duplicato.
- Verifiche manuali **GS-4.M1…M3** → `mds/MANUAL-CHECK.md` (sezione **GS-4**).

**Gate GS-4:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-4)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-5. Splitter / delimitatori invisibili nello skin scuro

**Sintomo.** Con lo skin nero non si vedono i divisori tra albero, editor e pannelli; con il bianco sì.

**Causa.** `components/ui/ResizeHandle.tsx` con `withLine={false}` (`GoStudioWorkspace.tsx:71,76,80`): striscia 8px `bg-surface-0`, accent 8% solo in hover (in dark l'accent è `#FFF`, `globals.css:27`). Il divisore reale è il `gap-1.5` (`GoStudioWorkspace.tsx:68`); `.go-studio-gap` (`goStudioChrome.css:231`) inutilizzato. Isole dark `surface-1 #080808` su `surface-0 #000` senza bordo; ombra (`goStudioChrome.css:9`) invisibile; il light ha bordo 1px + ring (`:24,30-33`). Contrasti WCAG isola/sfondo: dark 1.05, light 1.04, obsidian 1.04, solarized 1.15, gruvbox 1.27; `border-1`/sfondo: dark 1.35, light 1.43, obsidian 1.24, solarized 1.15, gruvbox 1.27. `border-2`/`border-3` in Midnight, Forest, Sunset (`themes.go:336-337,372-373,408-409`), Tokyo, Obsidian, Carbon sono **più scuri** di `border-1`: non usarli come divisore. Manca `--color-border-strong`.

**Fix**
- [ ] GS-5.1 Token di divisore + alone isola. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** (skin scuro). `--color-divider` e `--color-divider-hover` in `globals.css` (derivati da `--color-text-1`/`--color-surface-0`/`--color-accent`, quindi ogni tema e skin li ricalcola senza nuove chiavi); alone `0 0 0 1px color-mix(...)` su `.go-studio-island` in dark (`goStudioChrome.css`), nesso non raddoppiato nel light che ha già il bordo 1px. Il blocco CSS previsto era sotto `.go-studio-root` con `--gs-divider`: usato il token globale `--color-divider` (opzione prevista da GS-5.4) così anche Git/Markdown/Database lo condividono.
- [ ] GS-5.2 Hit area 10px a cavallo del bordo dell'isola (`-right-2`/`-left-2`/`-top-2`, non `right-0`/`left-0`), divisore visibile 2px dentro. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** Serviva far uscire lo splitter dall'`overflow: hidden` dell'isola: ogni cella della griglia (`GoStudioWorkspace.tsx`) è ora un wrapper `relative` con l'isola `absolute inset-0` e lo splitter come fratello, posizionato sul bordo. Nessuna dipendenza dal resto: `.go-studio-island` è ancora ritagliata sui suoi angoli.
- [ ] GS-5.3 `ResizeHandle.tsx`: `aria-orientation`, `tabIndex=0` (solo quando c'è `onArrow`), resize da tastiera con le frecce (Maiusc = passo grande), prop `onDoubleClick`; double-click → reset a `DEFAULT_PANE_SIZES` (`lib/goStudioLayout.ts`) via `beginResize`. Una sola costante per i clamp oggi duplicati (`GoStudioPanel.tsx`, `stores/goide.ts`): `clampPaneSize` + `MIN_PANE_WIDTH`/`MIN_PANE_HEIGHT`/`MIN_EDITOR_*` in `lib/goStudioLayout.ts`, usati sia dal caricamento del layout sia dal trascinamento. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md** (frecce e doppio click nell'app).
- [ ] GS-5.4 Altri pannelli (Git, Markdown, Database, LaTeX, Mermaid, API, Log Inspector): la hairline di `ResizeHandle` passa da `bg-border-1` a `bg-[var(--color-divider,var(--color-border-1))]`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [x] GS-5.5 (Opzionale) chiave `border-strong` in `internal/themes/themes.go` e nell'elenco di `extended.go:34-36`, con la coppia in `CheckContrast` (`extended.go:107`). — **NON NECESSARIO:** il divisore non usa `border-1`/`border-strong` ma `--color-divider`, derivato dai token del tema già validati; una chiave `border-strong` sarebbe configurazione inutilizzata. Se in futuro servirà un bordo statico, riprendere la voce.

**Verifica**
- [x] GS-5.T1 Guardia `components/goide/goStudioSplitter.test.ts`: fallisce se spariscono `--color-divider`, la linea dei 2px, gli stati hover/active/focus, l'hit area 10px o la tastiera/doppio click. — rossa prima del fix (5 asserzioni), verde dopo.
- [x] GS-5.T2 `lib/goStudioLayout.test.ts`: clamp min/max, riserva dell'editor, doppio pannello laterale, finestre strette, dimensioni di default. — l'unica asserzione sbagliata era nel test ("finestre strette": con 400px il massimo corretto è 240 = 400 − 160 di editor, non il minimo); corretta e documentata nel test.
- Verifica manuale **GS-5.M1** → `mds/MANUAL-CHECK.md` (sezione **GS-5**).

**Gate GS-5:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-5)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-6. Menu Hub: via Document Studio e Git; logo più grande

> **Prerequisito bloccante:** fare questa rimozione SOLO dopo che GS-7, GS-8 e GS-9 sono `[x]` nell'IDE.
- [ ] GS-6.0 Confermato: GS-7, GS-8, GS-9 chiusi. — **NON ANCORA:** GS-7.M1, GS-8.M1, GS-9.M1 (e GS-9.5) richiedono prova manuale nell'app; non rimuovere i rail finché non sono verdi.
- [ ] GS-6.pre Prerequisito già fatto (2026-10-15): export/import/drift delle collection come cartella, oggi solo in Git Sync, ora è in `components/collections/CollectionFolderDialog.tsx` (menu contestuale delle collection → "Collection folder..."), così togliere il rail `gitsync` non fa perdere la funzione. Verifica manuale ancora da fare.

**Cosa si toglie.** "Document Studio" = categoria `docs` (`markdown`, `pdfeditor`, `mermaid`, `latex`; `lib/featureRegistry.ts:117-122`); `pdfeditor`, `latex`, `kube`, `plugins` già nascosti da `V1_HIDDEN_FEATURES` (`:144`). "Git" = `gitsync` (`:130-136`). Rimuovere `markdown`, `mermaid`, `gitsync`; `Rail.tsx:390-401` elimina da sola la categoria vuota. Non cancellare gli id senza alias (stato persistito).

**Punti da modificare**
- [ ] GS-6.1 Registry: righe `featureRegistry.ts:71-72` (markdown, mermaid) e `:76` (gitsync); alimenta `lib/commandPalette.ts:11` e `GoStudioSearchEverywhere.tsx:150`. Icone in `components/layout/Rail.tsx:47-90`. — **IMPLEMENTATO; NON VERIFICATO manualmente:** Righe `markdown`, `mermaid`, `gitsync` tolte da `featureRegistry.ts` (palette, Search Everywhere e gruppo Documents le leggono da lì); icone tolte da `Rail.tsx`.
- [ ] GS-6.2 Id e persistenza: `lib/navigation.ts:18-19,35` (`RAIL_ITEMS`), `normalizeRailItem`; alias in `LEGACY_RAIL_ALIASES` (`navigation.ts:47`) che mappano `markdown`, `mermaid`, `gitsync` a `goide` (o `welcome`). Fonti di stato da coprire: `uiSessionMemento`, `settings.general.defaultStartupRail`, `adomnia.railQuick.v1`, `adomnia.hubLayout`, finestre staccate (`?window=panel&panel=…`). — **IMPLEMENTATO; NON VERIFICATO manualmente:** `RAIL_ITEMS` senza i tre id; `LEGACY_RAIL_ALIASES` li porta a `goide`, quindi `normalizeRailItem` copre session memento, startup rail, quick nav, hub layout e finestre staccate. Test: `lib/navigation.test.ts`.
- [ ] GS-6.3 Routing: `MainAreaRouter.tsx` import lazy (`:32,33,43`) e case (`:154,155,171`); duplicato morto `panelFor` in `layout/MainArea.tsx:1279,1280,1296`; `DetachedPanelWindow.tsx:17`. — **IMPLEMENTATO; NON VERIFICATO manualmente:** Case e import lazy tolti da `MainAreaRouter.tsx`, `MainArea.tsx` (anche il duplicato `panelFor`) e `lazyPanels.ts`. Cancellati `GitSyncPanel` (+ 3 test), `MarkdownPanel`, `MermaidPanel`, `MarkdownEditor/FileTree/Toolbar/TemplatePickerModal`. Restano `MarkdownOutline/BacklinksPanel/GraphView` (GS-7.4) e `GitActionsTab/GitCompareTab` + `components/workspace/git/*` (riuso IDE).
- [ ] GS-6.4 Shortcut: `stores/app.ts:22` ha `gitsync` su Ctrl/Cmd+7 (`RAIL_QUICK_NAV`): sostituire o liberare. — **IMPLEMENTATO; NON VERIFICATO manualmente:** Ctrl/Cmd+7 era già su `goide` in `RAIL_QUICK_NAV`; nessun `gitsync`.
- [ ] GS-6.5 Welcome: `hubLayout.ts:11` (tile "Version Control"), `WelcomePanel.tsx:24`, `HubStudioIcon.tsx:6,33`; `parseHubLayout` scarta gli id sconosciuti. — **IMPLEMENTATO; NON VERIFICATO manualmente:** Tile Welcome e `HubStudioIcon` ripuliti; `HUB_EXCLUDED` senza `gitsync`.
- [ ] GS-6.6 Drop e AI: `hooks/useFileDrop.ts:153-154` (`.mmd` → IDE), `lib/globalFileRouter.ts:48`, `MermaidPanel.tsx:612`, `lib/aiCapabilities.ts:44,45,51`. — **IMPLEMENTATO; NON VERIFICATO manualmente:** `.mmd/.mermaid` rilasciato → rail Go Studio con messaggio "usa File → Open"; `aiCapabilities` senza Markdown/Mermaid Studio. Il file non si apre in automatico (il drop globale ha solo il testo, non il percorso).
- [ ] GS-6.7 Link IDE → hub eliminati: `GoStudioBranchWidget.tsx:33,51` e `goStudioVcsCommands.ts:16-20` (`showModule('gitsync')`), comando `vcs.gitStudio` (`goStudioCommands.ts:259`, `MAIN_WINDOW_ONLY` `:394`), `GoStudioProjectTree.tsx:245,254`, `stores/goideVcs.ts:46-52` (`syncGitStudioToSession`/`focusRepo` in `lib/gitRepos.ts`) → tool window nell'IDE (GS-9). — **IMPLEMENTATO; NON VERIFICATO manualmente:** Già fatto in GS-9: branch widget, `vcs.gitStudio` e albero progetto aprono il tool window Git; `syncGitStudioToSession` rimosso.
- [ ] GS-6.8 i18n: `lib/uiI18n.ts:903-945`. Test aggiornati: `goideIntegration.test.ts:18`, `uiI18n.test.ts:132`, `v1ReleaseScope.test.ts:13`, probabilmente `Rail.test.ts`, `hubLayout.test.ts`, `GitSyncPanel*.test.ts`, `styles/git-sync-sketch.test.ts`. — **IMPLEMENTATO; NON VERIFICATO manualmente:** Test aggiornati (`goideIntegration`, `v1ReleaseScope`, `navigation`); `tsc`, `vite build`, `check:startup` e l'intera suite Vitest (1676) verdi. Chiavi `uiI18n` dei tre pannelli lasciate (inerti).

**Logo in alto a sinistra troppo piccolo.** Pulsante `adomnia-rail__home` 40x40 con `adomnia-rail__brand` 31x31 (`Rail.tsx:411-427`, `Rail.css:40-56`); rail 48px, padding 3px (`Rail.css:1-9`). Asset da `useAppIcon` (`lib/brandAssets.ts`): `/icon.png`, `/icon-white.png` (dark), `/icon-black.png` (light), icone dedicate Win95/sketch (1024x1024; 95: 1254; sketch: 512); anche `assets/images/adomnia-mark.svg`. Nitido fino a ~64px.
- [ ] GS-6.9 Logo ~38-40px nel pulsante da 44px e rail ~56px (aggiornare `min-width`/`width` e larghezze di `.adomnia-rail__category`), oppure 36px nel rail da 48px. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Logo del rail 31→36 px nel rail da 48 px (`Rail.css`); da guardare nei temi/skin (GS-6.M1).
- [ ] GS-6.10 Logo del menu Go Studio (`GoStudioMenuBar.tsx:91-93`, `h-7 w-7` in 36px) nelle stesse proporzioni. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Logo del menu Go Studio `h-7 w-7`→`h-8 w-8` nel bottone da 36 px (stessa proporzione ~0,9).
- Verifiche manuali **GS-6.M1, GS-6.M2** → `mds/MANUAL-CHECK.md` (sezione **GS-6**, solo dopo GS-7/8/9).

**Gate GS-6:** [ ] Impl  [ ] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-6)  [ ] Doc (README: rimozione Document Studio/Git dal Hub)  [ ] Verificato da altra persona/agente

---

### GS-7. Markdown nell'IDE: anteprima di default (icona "occhio")

**Stato.** `components/goide/GoStudioEditor.tsx:122-128` rende `GoStudioMarkdownView` per `.md`/`.markdown`; toggle Code2 / Columns2 / Eye (`GoStudioMarkdownView.tsx:34-39,92-100`); modo per documento in `markdownModes` (`useState`, `GoStudioEditor.tsx:31`, non persistito), default `?? 'split'` a `:125`. In `preview` Monaco non è montato. Renderer `lib/markdownDoc.ts:204`; immagini locali `readGoIDEAssetDataUrl` (`goStudioMarkdownAssets.ts`).

**Fix**
- [ ] GS-7.1 Default `'preview'` (`GoStudioEditor.tsx:125`) per ogni `.md` aperto dall'IDE (albero, Search Everywhere, link, "Go to file"); toggle resta in alto a destra. Scelta persistita per documento (e opzionalmente setting globale "default markdown view"). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `goStudioMarkdownMode.ts` (`useMarkdownMode`, chiave localStorage `adomnia.goStudio.markdownModes` per `sessione:percorso`, default anteprima); il default vale per qualunque apertura perché è nel renderer del documento. Setting globale non fatto.
- [x] GS-7.2 `.md` sporco: l'anteprima usa `document.buffer`; verificato che non perda modifiche cambiando modo. — letto il codice: `GoStudioMarkdownView` rende da `document.buffer` e il buffer vive nello store, non nel modo; cambiare modo smonta solo Monaco.
- [ ] GS-7.3 `GoStudioSplitPane` non conosce Markdown: farlo passare dallo stesso `GoStudioMarkdownView`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** il pannello diviso usa `GoStudioMarkdownDocument` come l'editor principale.
- [ ] GS-7.4 (Opzionale) outline (`MarkdownOutline`), backlinks, grafo (`MarkdownGraphView`) come pannelli laterali; componenti riusabili in `components/markdown/`. Stato Hub (`adomnia.markdown.uiState`, `adomnia.markdown.recentRoot`, `settings.markdown`) e backend `internal/markdown`/`markdown_bindings.go` non servono all'IDE: non farli dipendere dal rail rimosso. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (GS-7.4, GS-7.M2):** pannello laterale in `GoStudioMarkdownView` (`GoStudioMarkdownTools.tsx`): outline dal buffer con salto alla riga, backlink da ricerca progetto (`SearchProject` con `backlinkSearchPattern`), grafo locale con `buildGraphNodes` + filtri Unresolved/Orphans/cartella. Helper puri in `lib/goide/goStudioMarkdownTools.ts` con 12 test. Nessuno stato Hub e nessun backend `internal/markdown`.

**Verifica**
- Verifica manuale **GS-7.M1** → `mds/MANUAL-CHECK.md` (sezione **GS-7**).

**Gate GS-7:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-7)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-8. Mermaid nell'IDE

**Stato.** I blocchi ```` ```mermaid ```` in un `.md` sono già gestiti (`markdownDoc.ts:232`, `components/markdown/mermaidBlocks.ts` `useMermaidBlocks`, `import('mermaid')` dinamico v12.1, `securityLevel: 'strict'`). **Gap:** `.mmd`/`.mermaid` mancano in `languageByExtension` (`internal/goide/documents.go:466`) → testo semplice senza anteprima.

**Fix**
- [x] GS-8.1 Estensioni `.mmd`/`.mermaid` e language id in `documents.go`. — language id `mermaid`; `TestLanguageForPathCoversProjectFiles` esteso.
- [ ] GS-8.2 Ramo `isMermaidDocument` accanto a `GoStudioEditor.tsx:122` con lo schema del Markdown (editor / split / anteprima, default anteprima), riusando il rendering di `components/mermaid/MermaidPanel.tsx` (983 righe; zoom/export; `:312` `securityLevel: 'loose'`, `theme: 'base'`): estrarre un componente condiviso, non copiare; usare `strict` se `loose` non serve. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** scelta diversa e più piccola: un `.mmd` è mostrato come blocco ```` ```mermaid ```` nello stesso `GoStudioMarkdownView` (`mermaidAsMarkdown`), quindi stesso renderer di `useMermaidBlocks` (`strict`, tema chiaro/scuro dallo skin, errore di sintassi sotto il blocco senza rompere l'editor), stessi modi editor/split/anteprima, default anteprima. Niente zoom/export di `MermaidPanel`: se servono, estrarre un componente condiviso.
- [ ] GS-8.3 — **NON FATTO:** dipende da GS-6 (rimozione del rail). Rail `mermaid` e drop file (`useFileDrop.ts:153-154`) ridiretti all'IDE (vedi GS-6). — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Fatto con GS-6: rail `mermaid` rimosso e drop `.mmd` ridiretto a Go Studio.

**Verifica**
- Verifica manuale **GS-8.M1** → `mds/MANUAL-CHECK.md` (sezione **GS-8**).

**Gate GS-8:** [ ] Impl — manca GS-8.3 (dipende da GS-6)  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-8)  [ ] Doc  [ ] Verificato da altra persona/agente

---

### GS-9. Git dentro l'IDE (tool window), non più nel Hub

**Decisioni già prese** (leggere prima): `docs/GO-STUDIO.md:44,657`, `docs/ISSUES.md:53`, `mds/V1-RELEASE-SCOPE-TODO.md:23,40,50`, `docs/architecture/ide-multilanguage-refactor.md:161`.
- Già nell'IDE: branch + contatore modifiche, gutter diff vs HEAD, dialog Commit (Ctrl+K), history file/riga, blame (`vcs.annotate`), editor conflitti a 3 vie. Backend `internal/goide/vcs*.go` + binding `VCS*` (`goide_bindings.go:774-837`); frontend `stores/goideVcs.ts`, `lib/goide-vcs-api.ts`, `goStudioVcsEditor.ts`, `GoStudioCommitDialog`/`GoStudioCommitDiff`/`GoStudioGitHistoryDialog`.
- **Da invertire:** `GO-STUDIO.md:657` e `ISSUES.md:53` dicono "Push, pull, merge, rebase e stash vivono in Git Studio, non nell'editor".
- Scope V1: diff, stage, commit, branch, push/pull, merge, conflitti. Rebase e drag cherry-pick restano nascosti.
- Meccanismo tool window esistente: `components/goide/studioToolState.ts`, `studioToolLayout.ts` (sinistra/destra/basso, staccabili).

**Fix**
- [ ] GS-9.1 Nuovo tool window "Git" (icona nella stripe): file modificati e stage/unstage, commit, branch (crea/cambia/merge), pull/push, stash, log/grafo, conflitti. Riuso senza copia di `internal/git/*`, `git_bindings.go`, `git_bindings_ops.go` (servizio `GitSync`, `lib/gitsync-api.ts`), `lib/git/*` (`gitService`, `graphLayout`, `hunks`, `conflictBlocks`, `pushGuard`, `commitMenuModel`, `aiCommitAnalysis`), `lib/gitRepos.ts`, `components/workspace/git/*`, `GitActionsTab`/`GitCompareTab`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** il tool window `git` esisteva già (`GoStudioGitPanel`: log, stage, pull/push, worktrees); aggiunti `GoStudioGitActions.tsx` (crea/cambia/merge/elimina branch, checkout remoto, stash/pop, conflitti ours/theirs/resolved/abort, "Resolve…" → editor a 3 vie) e il tab Pull requests (riuso di `GitCollaborationSection`). Commit = dialog Ctrl+K esistente; rebase e cherry-pick restano nascosti (scope V1).
- [x] GS-9.2 `GitSyncPanel.tsx` (1418 righe) mescola export collection→cartella e sync workspace: separare quelle parti prima di riusarlo. — **FATTO (2026-10-15):** `CollectionFolderSection.tsx` (export/import/drift, indipendente da Git) e `lib/git/overview.ts` (tipi, parsing, staged/unstaged condivisi con l'IDE) estratti; il pannello scende a 1149 righe. `tsc` e 42 test verdi.
- [ ] GS-9.3 `vcs.gitStudio`, `GoStudioBranchWidget`, `goStudioVcsCommands`, `syncGitStudioToSession` collegati al tool window; niente più `showModule('gitsync')`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `vcs.gitStudio` e il widget branch aprono già il tool window (nessun `showModule('gitsync')` in produzione); rimosso `syncGitStudioToSession` (codice morto). Restano `focusRepo`/`GIT_FOCUS_REPO_EVENT` finché esiste il pannello Hub (GS-6).
- [ ] GS-9.4 Binding Git già pronti senza UI, da esporre (verificare prima, non tutti controllati): `GitHubListPRs`/`GitHubCreatePR`/`GitHubValidateToken` (`git_bindings.go:409` e vicini), `CommitPaths`/`CommitAll`, `RemoteWebURL`/`CompareWebURL`, `GetRepoState`, `GetCommitMeta`, `ApplyPatch`, `RestoreFileFromCommit`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `RemoteWebURL` (bottone "Open on remote"), PR via `HostListPRs/HostCreatePR/HostValidateToken` (`GitCollaborationSection`). `GetRepoState/GetCommitMeta/RestoreFileFromCommit` già in `gitService`. **Non esposti (nessun consumer reale):** `GitHub*` (sostituiti da `Host*`), `CommitPaths/CommitAll` (il dialog usa `VCSCommit`), `CompareWebURL`, `ApplyPatch` (hunk via `ApplyHunk`).
- GS-9.5 Gate manuale M12 (`mds/todo-ide.md:84`): gutter, hunk revert, blame, history → **`mds/MANUAL-CHECK.md`** (GS-9.5).
- [x] GS-9.6 `GO-STUDIO.md:657` e `ISSUES.md:53` riscritti. — **FATTO (2026-10-15).**

**Verifica**
- Verifica manuale **GS-9.M1** → `mds/MANUAL-CHECK.md` (sezione **GS-9**).

**Gate GS-9:** [ ] Impl  [ ] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-9)  [ ] Doc  [ ] Verificato da altra persona/agente

---

### GS-10. Altri problemi nel frontend (audit)

**P1**
- [x] GS-10.1 `--color-danger` mai definito come variabile CSS (solo alias Tailwind `tailwind.config.ts:55`; `globals.css` ha solo `--color-error`): 31 usi in `components/goide/goStudioEditor.css` (54, 65-66, 91-96, 111, 128, 192, …) cadono sul fallback `#ef4444` e non seguono il tema; `GoStudioContextPanel.tsx:170` senza fallback non risolve. Fix: `--color-danger: var(--color-error)` in entrambi i blocchi tema, poi togliere i fallback hex. — `--color-danger: var(--color-error)` in entrambi i blocchi di `globals.css`, tolti i 9 fallback `#ef4444`; `goStudioTokens.test.ts` lo protegge. Il `var(--color-danger, var(--color-error))` restante (4 usi) è equivalente.
- [ ] GS-10.2 Feedback sulle azioni asincrone: errori run/test in un solo `ErrorBanner` persistente (`stores/goide.ts:1165`, `goideTests.ts:102`, `GoStudioPanel.tsx:846,939`); nessun toast IDE (successi "Coverage saved", "AI started", "Run started" muti); `GoStudioWorkspace.tsx:67` mostra `useStudioTools.error` come `<div>` senza stile. Fix: store `studioToast` in `GoStudioPanel` alimentato da `errorMessage()`; errore del workspace con `ErrorBanner`; `goideTests.ts:101-102` scrive l'errore in due store (comparso due volte): uno solo. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** **parziale:** l'errore del workspace (`useStudioTools.error`) ora ha lo stesso stile dei banner IDE; `goideTests` scrive l'errore in un solo store. **Toast successi fatti:** store `stores/goideToast.ts` (max 3, auto-chiusura 3,5 s, test) + `GoStudioToasts` montato in `GoStudioPanel`; emessi "Started: …" e "Finished: …" (exit 0) dagli eventi `run.started/finished` in `stores/goide.ts`. Manca la prova visiva nell'app.
- [ ] GS-10.3 Tab bar editor (`GoStudioEditorTabs.tsx:85`): la tab attiva non viene portata in vista, nessun menu "tutte le tab", nessun roving tabindex/frecce; il close (`:110`) è `<span role="button" tabIndex={-1}>` dentro `<button role="tab">` (non raggiungibile da tastiera, interattivi annidati). Fix: `scrollIntoView({inline:'nearest'})` su `activeId`, menu overflow, close come bottone fratello. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** **parziale:** la tab attiva viene portata in vista, frecce/Home/End cambiano tab, tabindex a rotazione (solo l'attiva è nel Tab). Non fatti: menu "tutte le tab" e il close come bottone fratello (resta `<span role="button">` dentro il tab).
- [ ] GS-10.4 Status bar tagliata su finestre strette (`GoStudioStatusBar.tsx:99` `overflow-hidden`; destra `shrink-0` `:125-160`): Trusted/Restricted e tema escono dal bordo. Fix: Profile/Trace/Sonar/Security (`:137-148`) in un menu "Tools"; gruppo destro `overflow-x-auto`. `languageServerLabel` (`:49-56`) e titolo `:125-128` hanno "gopls" hardcoded: leggere dalla contribution del linguaggio. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `GoStudioStatusBar.tsx`: il gruppo centrale scorre in orizzontale (Trusted/Restricted e tema restano sempre visibili a destra), Trace/Sonar/Security sono nel menu **Tools** (`GoStudioStatusMenu.tsx`, posizionato `fixed` per non essere ritagliato, Esc chiude), il nome del language server viene da `IdeLanguageContribution.languageServer` e non più da "gopls" fisso; il pulsante Problems ha `aria-label` con i conteggi. Test in `GoStudioStatusBar.test.tsx`.

**P2**
- [ ] GS-10.5 Albero progetto non accessibile (`GoStudioProjectTree.tsx:128-148`): `role="tree"`/`treeitem`, `aria-expanded`, roving tabindex. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** `role="tree"` sul contenitore, `treeitem` + `aria-level/expanded/selected` sulle righe, roving tabindex (solo riga attiva e root nel Tab), frecce su/giù/Home/End e destra/sinistra per aprire/chiudere le cartelle.
- [ ] GS-10.6 Pulsanti icona senza `aria-label` (solo `title`): StatusBar `:137-148`, Toolbar, `Titlebar.tsx`; ogni `go-studio-icon-button` ha `aria-label`. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Tutti i `go-studio-icon-button` solo-icona hanno `aria-label` (9 aggiunti più i toggle con titolo dinamico).
- [ ] GS-10.7 Colori fuori token: `layout/MainArea.tsx:1178` (`hover:text-red-300` → `text-error`), `Titlebar.tsx:39` (`hover:bg-red-500/80` → `bg-error`); backdrop `bg-black/40` in `GoStudioChangeSignatureDialog.tsx:72`, `GoStudioMoveSymbolDialog.tsx:68`, `layout/DropOverlay.tsx:25` → overlay standard `goStudioModal.css`; `text-white` sui bottoni accent in ~14 pannelli (`GoStudioElsewhere:33,37`, `GoStudioEmptyState:28`, `GoStudioTestsPanel:358`, `GoStudioVulnPanel:90`, `GoStudioErrorsPanel:99`, …) → `text-on-accent` (stesso lavoro di IDE-5.7: farlo una volta). `GoStudioHtmlView.tsx:46,60` (`bg-white`) voluto per l'iframe: aggiungere un commento. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** **parziale:** `Titlebar` e `MainArea` usano `error`, i dialoghi Change Signature e Move Symbol usano `gs-modal-backdrop`. Non fatti: `DropOverlay` (overlay volutamente scuro), `text-white` sui bottoni accent (vedi IDE-5.7), commento su `GoStudioHtmlView`. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Come IDE-5.7; `bg-white` di `GoStudioHtmlView` commentato come voluto; backdrop e `red-*` risultavano già sistemati.
- [ ] GS-10.8 Split editor: `GoStudioSplitPane.tsx:49-55` `<select>` nativo `w-24` (troncato, rompe WebKitGTK); divisore `GoStudioHtmlView.tsx:43` `w-px` statico; tab bar dello split con `tabIndex=0` su ogni tab (`:35`). Fix: `ResizeHandle`, menu custom, roving tabindex. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Il `<select>` nativo dello split è un pulsante "+" con `ContextMenu`; tab con roving tabindex e frecce. Il divisore statico di `GoStudioHtmlView` resta `w-px` (nessun resize necessario).
- [ ] GS-10.9 Larghezze salvate senza limite superiore (`stores/goide.ts:157-159`): clamp rispetto al contenitore al caricamento. — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** `clampPane` in `stores/goide.ts`: larghezze ≤ 50% della finestra, altezza ≤ 70%.
- [x] GS-10.10 Binding senza UI oltre a Git: `GraphSearch` (`goide_bindings.go:1417`; `GraphSearchReady` è usato) → Search Everywhere; `Collab.PreviewShare` (`collab_bindings.go:65`); `McpClient` `GetSessionStatus`. — **DECISIONE (2026-10-15):** **Deciso di non esporre (nessun consumer reale):** `GraphSearch` ricostruisce il grafo ed è sostituito da `GraphSearchReady` (già in Search Everywhere); `Collab.PreviewShare` e `McpClient.GetSessionStatus` non hanno un punto UI naturale. Da riprendere solo con un caso d'uso. **GIÀ OK (2026-10-15): decisione applicata, voce chiusa senza codice.**
- [x] GS-10.11 Welcome: `layout/WelcomePanel.tsx:34-40` (`useNow`) re-render ogni secondo con HH:MM → tick al cambio minuto; "Open project" (`:~58`) cambia solo rail su `goide`, senza recenti né picker → riusare i recenti dell'empty state di Studio. — **tick già risolto** (`minuteAlignedTimeout` in `WelcomePanel.tsx`); "Open project" senza recenti/picker NON fatto.
- [ ] GS-10.12 `.catch(() => undefined)` silenziosi: `GoStudioCommitDialog.tsx:112`, `GoStudioPrivateModules.tsx:33`, `GoStudioDebugSession.tsx:389`, `GoStudioCloseGuard.tsx:33` → stato "non disponibile" (si sovrappone a IDE-5.8). — **IMPLEMENTATO; NON VERIFICATO manualmente (2026-10-15):** Come IDE-5.8.

**Gate manuali aperti con più impatto** (`mds/todo-ide.md`) → elenco e passi in **`mds/MANUAL-CHECK.md`** (sezione **GS-10**): M24 tastiera/focus visibile (`:101`), M25 contrasto/zoom/tema (`:102`), M2/M23 processi orfani e chiusura con file sporchi, M31 finestre separate (`:87`), runtime macOS/Linux (`:129`, `:186`). Le voci 3-9 alimentano M24/M25.

**Gate GS-10:** [ ] Impl  [ ] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-10)  [ ] Doc  [ ] Verificato da altra persona/agente

---

### GS-11. Revisione delle modifiche degli agenti AI (milk, Claude Code)

**Contesto:** con gli strumenti MCP gli agenti cambiano più file per turno; prima esisteva solo Allow/Deny prima della scrittura, nessuna vista di cosa avevano cambiato. Piano: `mds/03-GO-STUDIO-PIANO-UNIFICATO.md` (Z1.1, Z1.3).

**Fix**
- [ ] GS-11.1 Backend della review: foto in memoria dei file di testo a inizio turno, confronto a fine turno, accetta/rifiuta per blocco, file e tutto; un blocco rifiutato si scrive solo se il file è ancora quello mostrato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `internal/ide/agentreview` (Tracker, limiti 20.000 file / 64 MB, cartelle `.git`, `node_modules`, `vendor`, `dist`, `target`… escluse), hook `TurnObserver` in `internal/milk/manager.go` (stesso per milk e Claude Code), binding `AgentReview`/`Accept*`/`Reject*` in `goide_agentreview_bindings.go`. Salvataggio atomico estratto in `internal/ide/fileio` (riusato da `internal/goide`). Test: `go test ./internal/ide/agentreview ./internal/ide/fileio ./internal/milk ./internal/goide`.
- [ ] GS-11.2 UI: barra "N files changed by the agent · Review" sopra il composer della chat, dialog *Review agent changes* (file con +/−, blocchi con contesto, Accept/Reject per blocco e file, Accept all/Reject all con conferma), comando `tools.reviewAgentChanges` (*Tools → Review Agent Changes…*), anche nelle chat staccate. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `GoStudioAgentReviewBar.tsx`, `GoStudioAgentReviewDialog.tsx`, store `stores/goideAgentReview.ts`, helper `lib/goide/agentReview.ts` (riusa `goStudioLineDiff`). Test: `npx vitest run src/lib/goide/agentReview.test.ts`, `npx tsc --noEmit`, `npm run build`, `npm run check:startup`.
- [ ] GS-11.3 Claude Code riceve davvero i server MCP: `session/new` inviava sempre `mcpServers: []` (`sessionMCPServers` mai chiamata). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `internal/milk/manager.go` `sessionFor`.
- [ ] GS-11.4 milk (protocollo proprio) non riceve i server MCP: verificare se `milk serve --acp` accetta `mcpServers` in `session/new` prima di inviarli (un campo sconosciuto potrebbe far fallire la sessione).
- [ ] GS-11.5 I server MCP partono anche con la AI policy del progetto `off` o `local-only`: decidere e applicare il controllo prima di `session/new`.
- [x] GS-11.6 Documenti: `docs/GO-STUDIO.md` (Claude Code → *Review agent changes*, MCP solo per Claude Code), `CHANGELOG.md`, `docs/adomnia-feature-catalog.en.md`, piano 03. — **FATTO (2026-10-16).**

**Verifica**
- Verifiche manuali **GS-11.M1…M3** → `mds/MANUAL-CHECK.md` (sezione **GS-11**).

**Gate GS-11:** [ ] Impl  [ ] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-11)  [ ] Doc  [ ] Verificato da altra persona/agente

---

### GS-12. File Go senza colori semantici (funzioni, tipi, parametri bianchi)

**Sintomo (segnalazione 2026-10-16).** In un progetto Go alcuni file si colorano, altri restano con funzioni e tipi bianchi; gopls ci mette molto anche per gli usages.

**Cause trovate leggendo il codice.**
- `goStudioSemanticFeatures.ts`: ogni errore di `requestSemanticTokens` diventava "Canceled"; Monaco conserva i token precedenti (nessuno) e non richiede più finché il file non cambia. Con gopls ancora in caricamento la prima richiesta va in timeout (`defaultRequestTimeout` 15 s, `internal/goide/lsp.go`): i file aperti in quel momento restavano senza colori semantici.
- `monacoSetup.ts`: le regole dei semantic tokens erano solo nei temi `adomnia-go-*`. Monaco ha un tema per pagina: se un editor dell'API Studio (script, spec OpenAPI) impostava `adomnia-dark/light`, `function`, `method`, `parameter`, `namespace` e `property` cadevano sul colore di default (bianco).

**Fix**
- [ ] GS-12.1 Nuovo tentativo con backoff (2, 4, 8, 16, 30, 30 s) dopo un errore che non è un annullamento di Monaco; contatore per documento azzerato al successo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `semanticRetryDelay` in `goStudioSemanticTokens.ts` (test), `scheduleSemanticRetry` in `goStudioSemanticFeatures.ts`.
- [ ] GS-12.2 A fine lavoro di gopls (`lsp.progress` con `end`, es. caricamento pacchetti) si richiedono di nuovo semantic tokens e inlay hint per tutti i file aperti. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] GS-12.3 Regole dei semantic tokens anche nei temi `adomnia-dark/light`, tranne `type` (già token sintattico di YAML/JS). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** `npx tsc --noEmit`, `npm run build`, `npm run check:startup` verdi.

**Limite noto.** La lentezza del primo caricamento è di gopls (default già leggeri: staticcheck e vulncheck spenti); i colori arrivano quando ha finito.

**Gate GS-12:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-12)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-13. Inline Assistant (Ctrl+Enter sulla selezione)

**P1** — voce Z2.3 di `mds/03-GO-STUDIO-PIANO-UNIFICATO.md`. Le 18 AI actions restano invariate (preparano il prompt in chat): questo è un comando nuovo che toglie il salto di contesto.
- [ ] GS-13.1 Comando `goStudio.ai.inlineAssistant` con **Ctrl+Enter** sulla selezione (o sulla dichiarazione sotto il cursore) e voce "AI: Inline Assistant…" nel menu contestuale: popup `gs-popover` ancorato sotto il codice con l'input dell'istruzione (Enter genera, Esc annulla, clic fuori chiude), senza selezione valida rifiuto esplicito. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `goStudioInlineAssistantSession.ts` (`openInlineAssistant`, `rangeFor`, `targetFor`), `GoStudioInlineAssistantPopup.tsx` montato in `GoStudioPanel`, azione registrata in `goStudioAIActionsRunner.ts` (`installGoStudioAIActions`).
- [ ] GS-13.2 Diff inline di revisione dentro l'editor: righe proposte in zone verdi con ✓/✗ per blocco, righe tolte barrate in rosso, toolbar con contatore +N −M, Accept all / Reject all (Ctrl+Enter / Esc). Ogni accettazione è una modifica non salvata e annullabile (un solo Ctrl+Z per blocco; Accept all = un solo passo di undo); le coordinate dei blocchi restano valide dopo ogni accettazione (shift per delta di righe). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `renderReview`/`acceptInlineHunk`/`acceptAllInlineAssistant` in `goStudioInlineAssistantSession.ts`, `shiftInlineHunks`/`inlineEditHunks` in `goStudioInlineAssistant.ts` (test).
- [ ] GS-13.3 Gate di sicurezza: serve un provider AI verificato (altrimenti rimando a Settings → AI); `.adomnia/aiignore` e policy `off`/`local-only` rifiutano; segreti redatti con `createAIRedactor` e ripristinati nella proposta; una risposta in prosa viene rifiutata invece di sostituire codice; modifica del file durante la revisione scarta la proposta con messaggio; frammento oltre 24k caratteri rifiutato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `blockedByPolicy`, `parseInlineEditResponse` (test), guardia `onDidChangeModelContent` in `goStudioInlineAssistantSession.ts`.
- [x] GS-13.4 Test automatici e documentazione: `goStudioInlineAssistant.test.ts` (15 test: prompt senza fence di linguaggio, estrazione blocco recintato, rifiuto risposte chiacchierone, forma del frammento, coordinate hunk, shift dopo accettazione) verdi con `goStudioAIFix.test.ts`; `docs/GO-STUDIO.md` (bullet di sicurezza + scorciatoia), `docs/adomnia-feature-catalog.en.md` J3.6. — **FATTO (2026-10-16):** vedi Registro.

**Verifica**
- Verifica manuale **GS-13.M1…M6** → `mds/MANUAL-CHECK.md` (sezione **GS-13**).

**Gate GS-13:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-13)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-14. Messaggio di commit generato dall'AI (Z2.4 del piano)

**P2** — voce Z2.4 di `mds/03-GO-STUDIO-PIANO-UNIFICATO.md`. Prima non esisteva nessun generatore di messaggi per il commit pendente (solo `ai.betterMessage` su commit già fatti, in Git Studio).
- [ ] GS-14.1 Bottone *Draft message with AI* nel Commit Dialog (Ctrl+K), accanto alla textarea del messaggio: riassume il diff HEAD → working copy dei file spuntati (e i simboli Go cambiati) in un messaggio Conventional Commits che resta modificabile prima del commit; disattivato senza file spuntati, assente senza provider AI verificato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `goStudioCommitMessageAI.ts` (`buildCommitMessagePrompt`, `parseCommitMessage`, `draftGoStudioCommitMessage`) e bottone in `GoStudioCommitDialog.tsx`.
- [ ] GS-14.2 Gate di sicurezza: policy `off`/`local-only` rifiutano prima di ogni chiamata; `.adomnia/aiignore` elenca il file senza inviarne il contenuto; segreti redatti con `createAIRedactor` e **mai ripristinati** nella risposta (un messaggio di commit non deve rimetterli nello storico Git); file binari/troppo grandi annotati senza bloccare la bozza. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** test `goStudioCommitMessageAI.test.ts`.
- [x] GS-14.3 Test automatici e documentazione: `goStudioCommitMessageAI.test.ts` (8 test: prompt, parsing, rifiuto risposta vuota, policy, esclusione contenuti, diff vuoto); `docs/GO-STUDIO.md` (bullet di sicurezza + "Commit and integrate"), `docs/adomnia-feature-catalog.en.md` J6.10. — **FATTO (2026-10-16):** vedi Registro.

**Verifica**
- Verifica manuale **GS-14.M1…M4** → `mds/MANUAL-CHECK.md` (sezione **GS-14**).

**Gate GS-14:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-14)  [x] Doc  [ ] Verificato da altra persona/agente

---

### GS-15. Stage e unstage di singoli hunk e righe (Z2.5 del piano)

**P2** — voce Z2.5 di `mds/03-GO-STUDIO-PIANO-UNIFICATO.md`. Il backend era già pronto e testato (`internal/git/staging.go` `FileDiff`/`ApplyHunkToIndex`, binding `GitSync.*`, matematica dei patch in `lib/git/hunks.ts`, dialog `HunkStageDialog.tsx` completa ma **orfana**: nessuno la montava).
- [ ] GS-15.1 Stage / Unstage del singolo blocco dall'hunk popup (clic sul gutter): prima il buffer su disco se dirty, poi `git apply --cached` (avanti per stage, al contrario per unstage) solo sui blocchi che toccano le righe del popup; messaggio di esito e refresh dello stato; il resto del file non viene toccato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `goStudioVcsHunkStage.ts` (`applyGoStudioHunkToIndex`), `hunksOverlapping`/`hunkRange` in `lib/git/hunks.ts`, pulsanti in `GoStudioHunkPopup.tsx`.
- [ ] GS-15.2 Singole righe: `HunkStageDialog` montata dal popup (*Stage/Unstage single lines…*) e dal Git workbench (icona forbici sulla riga di ogni modifica), con checkbox per blocco e per riga +/-. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** mount in `GoStudioHunkPopup.tsx` e `GoStudioGitPanel.tsx`.
- [x] GS-15.3 Test automatici e documentazione: `hunks.test.ts` esteso (11 test totali fra `hunkRange`, `hunksOverlapping`, `selectHunkLines`) e `goStudioVcsHunkStage.test.ts` (stage/unstage/nessuna corrispondenza/fuori repository); `docs/GO-STUDIO.md` ("Commit and integrate"), `docs/adomnia-feature-catalog.en.md` J6.11. Nessuna modifica Go: il backend esistente resta come è. — **FATTO (2026-10-16):** vedi Registro.

**Verifica**
- Verifica manuale **GS-15.M1…M5** → `mds/MANUAL-CHECK.md` (sezione **GS-15**).

**Gate GS-15:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (GS-15)  [x] Doc  [ ] Verificato da altra persona/agente

---

## PARTE C — Pannello Database

DB-1 e DB-2 sono indipendenti; DB-3 usa lo schema condiviso e il `ConnectionManager` di DB-2 ma può partire in parallelo.

### DB-1. Valori annidati (oggetti/array) illeggibili nelle griglie + schermo intero

**Sintomo.** Le celle annidate mostrano solo `Object (2 fields)`, `Array (3)`. Si vuole leggere il contenuto e vedere i risultati a schermo intero con tutti i dati.

**Causa**
- Griglia Mongo (vista Table): `components/database/mongo/MongoWorkspace.tsx:333-358` (`DocumentTable`), celle `max-w-[320px] truncate` con `<BsonInline>` (`:351`; `mongo/DocumentCard.tsx:22`); testo da `bsonDisplay()` in `mongo/bson.ts:58` (`Array` `:87`, `Object` `:88`); colonne da `documentColumns()` (`bson.ts:248`); `VIEW_MODES` `:33` (List, JSON, Table); JSON è un `<pre>` con `highlightedJson` (`:276`), non comprimibile.
- Griglia SQL/runner JSON: `database/ResultsView.tsx:202-239` (`DataTable`), `<CellValue>` (`:230`, `database/dbShared.tsx:367`) fa `String(value)` → `[object Object]`; troncato a 360px.
- Dati: l'Explorer Mongo chiede `canonical:true` (`database.go:863`, ExtJSON canonico); il runner Mongo è non-canonico (`mongoDocToMap`, `database.go:889`, wrapper `$oid`/`$date`). Driver SQL (`runRows`, `database.go:996-1030`): json/jsonb/array Postgres, JSON MySQL, SQLite arrivano come **testo**, senza rilevazione JSON.
- Mancano: dettaglio cella/riga, albero nelle tabelle, appiattimento colonne annidate, schermo intero vero. `expanded` in `ResultsView` (`:30`, Maximize2 `:150`, `fixed inset-3 z-[240]` `:61`) non copre la finestra, senza Esc né scorciatoia; Mongo Explorer senza maximize. Export `exportJson`/`exportCsv` in `DatabasePanel.tsx:518-527`: CSV `csvEscape(row[col])` → `[object Object]`.
- Limiti: SQL `limit` default 200, clamp 1..5000 (`DatabasePanel.tsx:48`, `database.go:153-157`; `applyLimit` `:945` → `Limited`); `ResultsView` pagina client 25/50/100/200 (`:20`). Mongo Explorer: paginazione server 1..1000 (`mongo/useMongoBrowser.ts:31,103`), in memoria solo la pagina (`m.docs`); export max 100k (`EXPORT_CAP` `:12`); runner Mongo max 5000 (`database.go:526-535`).
- Riusabili: `components/loginspector/JsonTree.tsx` (ricerca, expand/collapse all, wrap, raw, Copy JSON, copia valore e JSONPath; props `{value, title?, className?, actions?}`; token `--color-json-*`; non virtualizzato, ignora i wrapper BSON); `components/jsonviewer/JsonViewerPanel.tsx` (fullscreen ed Esc `:204`, `:391`); `BsonField` di `DocumentCard.tsx`. Nessuna libreria di virtualizzazione.

**Fix** (in ordine)
- [ ] DB-1.0 Riprodotto su collezione Mongo con sotto-oggetti/array (es. `M0001…M0005`) e su colonna `jsonb` Postgres. — **NON RIPRODOTTO manualmente nell'app** (riproduzione in `mds/MANUAL-CHECK.md`, DB-1.0): la causa (`bsonDisplay` → `Object (2 fields)`, `String(value)` → `[object Object]`) è verificata sul codice e i casi sono coperti da `dbValue.test.ts`.
- [x] DB-1.1 Funzioni pure `normalizeCell`, `previewValue`, `flattenRow` con test accanto. — Implementato in `components/database/dbValue.ts` (non `lib/`: deve usare i wrapper BSON di `mongo/bson.ts`, e i test stanno accanto alle altre funzioni del pannello). `normalizeCell(value, driver)`: stringhe JSON sotto 1 MB parsate, wrapper BSON `$oid`/`$date`/`$number*` letti come `ObjectId('…')`/ISO/numeri **solo per Mongo** (su SQL `{"$oid":…}` resta un oggetto); `previewValue(v, maxLen=60)` → `{ street: "Via Roma", city: "Milano" }`, `[ "a", "b", +1 ]`, `{…}` oltre la profondità; `flattenRow(row, depth=2)` → `address.city`, `tag[0]`…`tag[N]`, `tag[…]` per il resto. Mai più `Object (N fields)` come unico testo.
- [ ] DB-1.2 `ValueCell.tsx` condiviso: sostituisce `BsonInline` in `DocumentTable` e `CellValue` in `DataTable` per i contenitori; chevron + `previewValue`; click apre l'Inspector. Scalari invariati (`BsonInline`/`CellValue`). In `bson.ts:87-88` solo fallback legacy. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.3 Cell Inspector (`ValueInspector.tsx`, drawer di destra, token del tema) con `JsonTree` come corpo, alimentato dal valore **grezzo** (i tipi BSON sopravvivono a "Copy JSON"); `JsonTree` esteso con `startExpanded` (profondità) e hook `renderScalar` (`ObjectId('…')`, date ISO). Header: colonna, tipo, dimensione; Copy JSON + "Copy path" per nodo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.4 "Document view": click sul numero di riga apre l'Inspector con l'intera riga; per Mongo `DocumentCard` in sola lettura (`onSave` omesso), per SQL la riga come albero; "Copy row JSON". — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.5 Schermo intero vero: hook condiviso `useResultsFullscreen.ts` con `fixed inset-0 z-[240]` (sotto i modali `z-[260]`), Esc per uscire (modello `JsonViewerPanel.tsx:204`), **Ctrl+Shift+F** solo con il pannello Database a fuoco. Applicato a `ResultsView` (al posto di `inset-3`) e a `MongoWorkspace` (Maximize2 accanto al toggle). Mostrare quanto è caricato: "N righe (limit L, auto-limited)" / "pagina X di totale" / Mongo "solo pagina corrente: N di totale". — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** Riga limite in `ResultsView` (`(limit L, auto-limited)`), `Page X of Y` nel pager, `only the current page is loaded: N of total` nell'Explorer Mongo.
- [ ] DB-1.6 Virtualizzazione: `database/useWindowedRows.ts` (matematica pura in `windowedRange`, testata), altezza riga fissa (40px in `DataTable`, 32px in `DocumentTable`), slice da `scrollTop`, spaziatori sopra/sotto, header `sticky`, overscan 12. Nessuna libreria. Schermo intero: tutte le righe caricate; fuori, paginazione client. Chiavi stabili al posto di `key={idx}`. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.7 Ridimensionamento colonne: `database/useColumnWidths.ts` con maniglia sul bordo destro dell'`th` (trascina, doppio click resetta), larghezze in stato locale per nome di colonna, applicate con `colgroup` + `width` su `th`/`maxWidth` sulle celle; il `max-w-[360px]`/`[320px]` resta solo come fallback. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.8 Toggle Tabella / Albero / JSON: in `ResultsView` un controllo a tre vie (Table = griglia, Tree = `JsonTree` comprimibile e ricercabile, JSON = JSON normalizzato con `normalizeCell`) al posto dei tab Results/JSON; in Mongo la vista List è rinominata **Tree** e la vista JSON usa `JsonTree` comprimibile. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.9 Appiattimento colonne annidate: toggle "Expand nested" nelle due griglie; `flattenRow(row, depth=2)` → colonne puntate (`address.city`), array come preview o `[i]` fino a N. Aggancio in `documentColumns` (`bson.ts:248`) e `columns`/`visibleColumns` di `ResultsView` (`:36-37`); "Choose columns" (`:115`) invariato. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.** In modalità piatta le celle mostrano i valori già normalizzati (quindi l'Inspector copia la forma piatta).
- [ ] DB-1.10 Export corretto (`DatabasePanel.tsx:570-579`): CSV con `JSON.stringify` degli oggetti (`csvEscape` in `dbShared.tsx`); JSON via `toEditable` perché i valori canonici Mongo sopravvivano. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**
- [ ] DB-1.11 Postgres/MySQL/SQLite: `ValueCell` su json/jsonb/array via `normalizeCell` (parsing frontend con guardia di dimensione da 1 MB). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md.**

**Rischi da verificare.** `JsonTree` non conserva lo stato di collasso tra aperture; valori enormi → guardia prima di `JSON.parse`; ObjectId/Date non devono perdere il tipo nel "Copy as JSON editabile". — **Aggiornato:** la guardia c'è (`MAX_JSON_PARSE_BYTES`, 1 MB) e l'Inspector riceve il valore **grezzo** (i `renderScalar` servono solo al display), quindi "Copy JSON" conserva `{"$oid":…}`/`{"$date":…}`. Restano aperti lo stato di collasso tra aperture e il comportamento con valori enormi già parsati.

**Verifica**
- [x] DB-1.T1 `dbValue.test.ts`: `normalizeCell` (JSON, testo, guardia dimensione, wrapper Mongo solo su Mongo), `previewValue` (le tre forme della specifica, mai `Object (N fields)`), `flattenRow` (colonne puntate, array `[i]`/`[…]`, profondità), `isContainerValue`.
- [x] DB-1.T2 `dbGridInspection.test.ts` (contratti sul codice: preview+Inspector, vista riga/documento, schermo intero Esc/Ctrl+Shift+F, export, "Expand nested", virtualizzazione con chiavi stabili, maniglia colonne, toggle Table/Tree/JSON, righe "quanto è caricato") + `csvEscape` in `dbShared.test.ts` + `useWindowedRows.test.ts` (matematica della finestra).
- Verifiche manuali **DB-1.0, DB-1.M1…M3** → `mds/MANUAL-CHECK.md` (sezione **DB-1**).

**Gate DB-1:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (DB-1)  [x] Doc  [ ] Verificato da altra persona/agente

---

### DB-2. Password della connessione che sparisce + "Connect" persistente

**Sintomo.** (a) Dopo un po' la password non c'è più nel form e le query smettono di funzionare: deve restare per sempre (salvata in modo sicuro) e il form deve mostrare che è salvata. (b) Oggi c'è solo "Test connection": serve un vero **Connect** persistente (con Disconnect), con stato visibile; Test resta solo verifica.

**Causa (a): la password non viene mai scritta su disco, per scelta di progetto.**
- Modello TS `DbConnection` in `components/database/dbShared.tsx:12-29`; Go `dbConnectionRequest` (`internal/database/database.go:27-41`) è solo DTO, il backend non persiste.
- Persistenza: JSON nel bucket bbolt `database`, chiave `connections` (`dbShared.tsx:77-81`, `internal/storage/storage.go:34`, `safeStoragePut` in `lib/wailsStorage.ts:30`, mirror localStorage `adomnia.database.connections`); load/save `DatabasePanel.tsx:96-167`, `180-183`.
- `serializeDatabaseConnections` (`dbSecrets.ts:50-59`) → `persistManagedSecret` restituisce `''` per ogni valore non `vault:` (`lib/managedSecrets.ts:11-20`); il chiaro vive in una `Map` di modulo (`sessionSecrets`, `managedSecrets.ts:5`); a ogni reload/HMR/riavvio è vuota e `hydrateManagedSecret` (`:23`) restituisce `''`. È voluto: test `dbSecrets.test.ts:21-30` e riga `docs/adomnia-feature-catalog.en.md:651`. Unico modo di conservarla: "Protect" + passphrase (`ConnectionsSidebar.tsx:258-278`).
- Un DSN con credenziali incorporate segue lo stesso percorso session-only (`dbSecrets.ts:14-21`, `hasEmbeddedCredentials` `:30-37`).
- Vault: auto-lock 30 min (`internal/vault/vault.go:27`, `resetVaultTimer` `:41-49`, `lockVault` `:51-59`); dopo il lock `resolveSecret` riceve 423 (`vaultRefs.ts:39`) e `resolveDatabaseConnection` lancia "Unlock Vault…": ogni query fallisce. Dopo un riavvio è di nuovo bloccato. `vaultTimeout` senza mutex (`vault.go:27,38`) in race con il timer (`SetVaultTimeout`, `app.go:319-326`, clamp 1-120). `Unlock` non verifica la passphrase (`vault.go:132-168`); cifratura per chiamata con passphrase digitata (`/vault/encrypt`, `:178-209`). Nessun keychain/DPAPI nel repo.
- Altro: `updateActive` (`DatabasePanel.tsx:185`) spread `{...c, ...patch}`; un riferimento `vault:` compare nel form come stringa cifrata (`ConnectionsSidebar.tsx:224`, `value={active.password}`), nessun segnaposto "salvata"; connessioni da handoff con `password: ''` (`upsertConnectionFromRef`, `dbShared.tsx:427`); redazione export in `internal/storage/redaction.go` (tiene `vault:`); altri consumatori `goStudioAILiveContext.ts:6-7,85` (`hydrateDatabaseConnections`/`resolveDatabaseConnection`).

**Causa (b): nessuna sessione.** `testConnection` (`DatabasePanel.tsx:358-373`) invia la connessione risolta (password in chiaro) a `/database/test`; `databaseTestHandler` (`database.go:78-136`) apre/ping 5 s/chiude. Ogni query apre e chiude un client: SQL `openDatabase` (`:293-348`, `defer db.Close()` `:195`), Mongo `openMongoDatabase` (`:399`, `defer client.Disconnect` `:507`, retry SCRAM/authSource e ping `:463-473`), Redis `openRedisDatabase` (`redis.go:16`) → Mongo explorer (`runMongo` `:414-424`) e `refreshSchema` (`:375-412`, fino a 30 count) pagano connect+auth a ogni richiesta, con la password in chiaro nel body. Non esistono stato, manager, keepalive, Disconnect, riconnessione.

**Fix**
- [ ] DB-2.0 Riprodotto (salva password, ricarica webview/riavvia → form vuoto e query fallite). — **RIPRODOTTO automaticamente (2026-10-14):** `dbSecrets.test.ts` serializza password/DSN, azzera la memoria del renderer e ricarica: entrambi vuoti. **Verifica manuale in MANUAL-CHECK.md** (DB-2.0/DB-2.M1); il test documenta il difetto attuale e andrà aggiornato quando sarà implementato il salvataggio cifrato. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.1 Decisione confermata dall'utente: **le password si persistono SEMPRE, cifrate** (mai in chiaro su disco). Aggiornati `docs/adomnia-feature-catalog.en.md:651`, test `dbSecrets.test.ts:21-30` (asserisce che la password sopravvive al reload) e la sezione sicurezza di `CLAUDE.md`. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.2 `internal/vault`: API `Seal(plaintext) -> "vault:…"` e `Open(ref)` con chiave master generata a installazione nel keychain di sistema (Windows Credential Manager/DPAPI, macOS Keychain, Secret Service) con `zalando/go-keyring` (dipendenza approvata); fallback su file con permessi utente-only + avviso di sicurezza una volta. Passphrase utente opzionale ("extra protezione"). — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.3 Password cifrate automaticamente al salvataggio (stop a scartare il chiaro in `persistManagedSecret` per lo scope database). Il lock a inattività non riguarda la chiave nel keychain. Mutex su `vaultTimeout`. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.4 Migrazione in `hydrateDatabaseConnections` (`dbSecrets.ts:39-47`): ogni chiaro residuo sigillato in riferimento e store riscritto (esiste già a `DatabasePanel.tsx:110`); valori già `''` → avviso "reinserisci una volta"; anche il `dsn` sempre nel sigillo (non solo con ref/segreto di sessione, `dbSecrets.ts:14`), credenziali separate dal DSN. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.5 Form (`ConnectionsSidebar.tsx`): `password` vuoto + `hasSavedPassword` (via `databaseCredentialState`); mai riferimento o chiaro nell'input (`:224`); segnaposto "•••••••• salvata" con "Cambia"; `password` inviata solo se modificata; mai sovrascrivere un riferimento con `''`; cancellazione solo con "Rimuovi". "Protect" solo come modalità opzionale. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.6 `ConnectionManager` (`internal/database/manager.go`): indicizzato per id; tiene `*sql.DB` (`SetMaxOpenConns`/`SetConnMaxIdleTime`), `*mongo.Client`, `*redis.Client`; API `Connect(id,cfg)`, `Disconnect(id)`, `Status(id){state, latencyMs, err, since}`, `Query` sull'handle in cache; i tre `open*` rifattorizzati in `acquire(id)`; ping ~30 s; riconnessione con backoff esponenziale con jitter (1 s → 30 s); timeout inattività configurabile (default 15 min). — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.7 Le password restano in Go: il manager risolve il riferimento; query e test prendono `connectionId` invece della password (il chiaro non passa più dal renderer a ogni richiesta). — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.8 Rotte sidecar `/database/connect`, `/database/disconnect`, `/database/status`; `/database/test` resta senza stato (apri → ping → chiudi). — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.9 Frontend: pallino di stato (connesso / disconnesso / errore / in corso) con latenza nella lista (`ConnectionsSidebar.tsx:96-104`) e nell'intestazione del form; **Connect** e **Disconnect** accanto a **Test** (griglia `:250`); stato via polling o sottoscrizione; connessione lazy alla prima query o selezione; flag `autoConnect` per i preferiti. — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.
- [ ] DB-2.10 Sicurezza: password mai nei log (mantenere metadati-only); mai restituire il testo al frontend dopo il salvataggio, solo `hasPassword`; `/vault/decrypt` fuori dal renderer per il database; credenziali del DSN oscurate nelle stringhe di errore (pgx/mongo possono riportare l'URI). — **IMPLEMENTATO (1.0.2); UI da verificare in MANUAL-CHECK.md.** Vedi `docs/DATABASE-CONNECTIONS.md` e Registro.

**Verifica**
- Verifiche manuali **DB-2.0, DB-2.M1…M5, DB-2.S1** → `mds/MANUAL-CHECK.md` (sezione **DB-2**; già verificato in parte: vedi nota lì).
- [ ] DB-2.11 (M) `/vault/decrypt` resta invocabile dal renderer col token sidecar: i riferimenti legacy `vault:<age>` e quelli "extra protection" delle credenziali database risultano decifrati in renderer (review sicurezza 2026-10-15). Il formato predefinito `vault:local:v1:` non è apribile da quell'endpoint. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (DB-2.S1):** `/vault/decrypt` rifiuta con **403** i riferimenti usati da una credenziale database salvata (password o dsn): `vault.SetCredentialRefGuard(database.IsCredentialRef)` è cablato nel sidecar (`internal/sidecar/server.go`), il controllo è in `internal/database/credential_refs.go`. Le env-var e il pannello Vault non sono toccati. Test: `TestIsCredentialRefOnlyMatchesSavedSecrets` (solo i ref salvati, con trim), `TestDecryptRefusesDatabaseCredentialRefs` e `TestDecryptWithoutGuardKeepsWorking`. *Limite noto:* i ref "extra protection" restano decifrabiliti con la passphrase tramite `/vault/encrypt`-side flows dedicati al Vault; il ref legacy `vault:<age>` di una credenziale DB è ora bloccato su questo canale.
- [ ] DB-2.12 (S) Fallback della chiave di cifratura in chiaro su disco fuori Windows (`seal_key_other.go`: `protectKeyFile` era no-op): chi legge la config-dir utente otteneva chiave + bbolt e decriptava tutto. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (DB-2.12):** la chiave di fallback ora è legata a macchina e utente (`machine-id` + uid, `seal_key_other.go`) come DPAPI su Windows: `seal_key_wrap.go` (`wrapKeyFile`/`unwrapKeyFile`, marker `ADK1`) con 5 test (round trip, file legacy da 32 byte invariati, identità sbagliata, manomissione, truncation); cross-compilazione linux/darwin verdi. Su macOS senza `machine-id` resta 0600 in chiaro con l'avviso `credentialWarning` già reso in `ConnectionsSidebar.tsx:330`. Residuo accettabile: chi esegue codice come lo stesso utente sulla stessa macchina legge comunque tutto (come con DPAPI).
- [ ] DB-2.13 (S) Chiari derivati da env-var `{{VAR}}` risolti nel renderer nel path AI live-context (`dbSecrets.ts:76-90`, usato da `goStudioAILiveContext.ts:85`). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (DB-3.M5):** `liveDatabaseSchema` ora invia solo `{connectionId, variables}` esattamente come il pannello Database (`liveSchemaQuery` in `goStudioAILiveContext.ts`), senza `connection` risolta: credenziali e riferimenti vault restano in Go. Test `goStudioAILiveContext.test.ts` (corpo senza `connection`, senza "password"); il riuso di `resolveDatabaseConnection` resta solo nei test `dbSecrets.test.ts` (candidato a rimozione in un cleanup).
- [ ] DB-2.T1 Test Go per il manager (connect/ping/backoff/idle) e per `Seal`/`Open`; security review. — **Test: già presenti e verdi** (`internal/database/manager_test.go`: riuso/disconnect, backoff, idle/reconnect, credenziali; `internal/vault/seal_test.go`: Seal/Open, manomissione, chiave fallback). **Security review indipendente fatta (2026-10-15, agente esterno):** nessun rischio critico/alto sulla riservatezza delle credenziali; trovato e **fissato** un bypass del gate operazioni distruttive via Mongo `runcommand` (ora strict sempre: `mongoDestructiveOperation`, test `TestMongoRunCommandAlwaysNeedsConfirmation`) e allineate al gate le keyword SQL con effetti collaterali `CALL/DO/COPY/MERGE/REPLACE/LOAD/GRANT/REVOKE` (test `TestDestructiveQueryCoversSideEffectStatements`, classificatore frontend `queryInterpreter` allineato). I rischi MEDIO/BASSO residui sono diventati DB-2.11, DB-2.12, DB-2.13.

**Gate DB-2:** [x] Impl  [x] Test  [ ] Manuale → `mds/MANUAL-CHECK.md` (DB-2)  [x] Doc  [x] Security review indipendente  [ ] Verificato da altra persona/agente

---

### DB-3. Console query per categoria con interprete che suggerisce le query

**Obiettivo.** Console divisa per tipo (ricerca, inserimento, update/set, cancellazione, aggregazione, schema/admin/indici) che propone query pronte, completa con lo schema reale, spiega in linguaggio semplice cosa farà la query e avverte dei rischi prima dell'esecuzione. Valida per Mongo, SQL (Postgres/MySQL/SQLite) e Redis. Tre fasi, ciascuna rilasciabile da sola.

**Stato attuale** (sotto `components/database/`)
- Editor: `<textarea>` sopra `<pre>` evidenziato (`QueryEditor.tsx:243-301`), condiviso da SQL/Mongo/Redis (`isJson`, `:75`); highlight `highlightedSql`/`highlightedJson` (`dbShared.tsx:395,408`).
- Completamento solo SQL (`sqlComplete.ts:62`); Mongo/Redis null (`QueryEditor.tsx:95`); popup custom (`:266-287`); nessuno snippet/tab stop (Tab = due spazi, `:288`).
- Esecuzione: Ctrl/Cmd+Invio esegue l'intero buffer (`:296`); nessun "esegui selezione" né divisione in statement; il backend manda tutto come un solo statement (`database.go:138-237`).
- Schema: `schemaItems`/`schemaColumns` nello stato locale di `DatabasePanel.tsx:62-66`, caricati da `refreshSchema` (`:375-412`); all'editor arriva solo `completionSchema` senza tipi (`:79`); Mongo/Redis schema vuoto (`columnsQuery` → `''`). Campionamento già in `mongo/schema.ts:52` (`analyzeSchema`) ma usato solo da `MongoWorkspace`/`SchemaTab`. Nessuna info PK/FK.
- Mongo: `mongo/AggregationsTab.tsx:10-35` (`STAGE_OPERATORS`, `STAGE_TEMPLATES`), `IndexesTab.tsx`, `codegen.ts`, `mongo/bson.ts:211` `parseShellDoc`. Il runner JSON accetta solo JSON stretto.
- Formato query Mongo (`database.go:372` `mongoQueryCommand`): `operation`, `database`, `collection`, `filter`, `projection`, `sort`, `pipeline[]`, `document`, `documents[]`, `update`, `command`, `limit`, `skip`, `upsert`, `canonical`. Operazioni (case-insensitive, `:488`; implementate `:537-784`): `find`, `aggregate`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `count`/`countDocuments`, `estimatedCount`, `listCollections`, `listDatabases`, `createCollection`, `dropCollection`, `dropDatabase`, `runCommand` (indici: `createIndexes`, `listIndexes`, `dropIndexes`).
- Redis (`redis.go:54-249`): `{command,args[]}`, `{operation:'scan',pattern}`, `{operation:'inspect',key}`; allowlist `redisReadCommands`/`redisWriteCommands` (`:63-64`); scritture richiedono `confirm`; Explain rifiutato.
- SQL: `isResultQuery` (`database.go:940`), `applyLimit` (`:945`), `destructiveQuery` (`:989`, 409 in strict senza `confirm`).
- Sicurezza UI: `isDangerous` (`dbShared.tsx:214`: match di stringa ` WHERE ` → `WHERE` a fine riga/dopo newline sfugge), `isDangerousMongo` (`:219`, più prudente del backend: il backend impone `confirm` solo per `updateMany`, `deleteMany`, drop; `mongoDestructiveOperation` `:789`), `isDangerousRedis` (`:229`); dialogo conferma `DatabasePanel.tsx:326-337`. **Nessun dry-run né stima righe interessate.**
- Cronologia/preferiti (`RightRail.tsx`): ultime 50 query (`DatabasePanel.tsx:343`) e 30 preferiti come stringhe (`:487-499`), per bucket non per connessione. Tab: `QueryTab {id,name,query}` (`dbShared.tsx:47`), persistite in `WORKSPACE_KEY` (`DatabasePanel.tsx:169-175`).
- AI: nessun pulsante AI nel pannello Database. Percorso esistente: `ensureAIConfigured()` + `AIEngine.Complete(system,user,maxTokens)` (`ai_bindings.go:41`, `lib/aiEngine.ts:55`; esempi `goStudioAIFixRunner.ts:79`, `lib/aiScripts.ts:89`); `isAICompanionAvailable` (`lib/aiAvailability.ts`); `settings.ai.credentialMode` (`stores/settings.ts:123`); `createAIRedactor()` (`lib/aiRedaction.ts:35`); policy locale `goStudioAIFixRunner.ts:62-70`; `goStudioAILiveContext.ts:48,74,85` costruisce già una stringa tabelle/colonne.
- Parsing SQL: nessun tokenizer/AST nel frontend (solo `sqlAliases` `sqlComplete.ts:30`); il "Format" toglie solo gli spazi finali (`DatabasePanel.tsx:479`).

#### Fase 1 — Console per categoria + completamento contestuale
- [ ] DB-3.1.1 `QueryConsole.tsx` a scomparsa nel pannello editor (`DatabasePanel.tsx:576-603`): rail categorie (Cerca, Inserisci, Aggiorna/Set, Elimina, Aggrega, Schema/Admin/Indici; Redis: Chiavi, Lettura, Scrittura, dipendenti dal driver) con contatore template e badge rischio (lettura/scrittura/distruttiva); elenco template per categoria e driver (clic = inserisce nell'editor o in nuova tab; secondo pulsante esegue solo se sola lettura); ricerca testuale e "Recenti / Salvate"; strip suggerimenti sotto la textarea. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `QueryConsole.tsx`, pannello a scomparsa a sinistra dell'editor (pulsante **Console** nella barra secondaria): categorie con contatore e badge rischio (Read/Write/Destructive), target (tabella/collezione) che precompila i template, ricerca testuale, tab **Saved** con Recenti/Salvate. Clic = inserisce nell'editor (nuova tab se l'editor ha già testo), **New tab** sempre disponibile, **Run** solo sui template di sola lettura con target scelto. Redis: categorie rinominate (Read keys, Write, Delete…). La strip dei suggerimenti sotto la textarea è la riga dell'interprete (vedi 3.1.7).
- [x] DB-3.1.2 `database/consoleTemplates.ts`, `{id, driver, category, title, description, body, risk}` con `body` in sintassi snippet `${1:segnaposto}`, `${2|a,b|}`, `$0`; nessuna logica nel componente. Copertura minima:
 — `consoleTemplates.ts` (registro dati, bodies in sintassi snippet) + `specializeTemplate()`; `consoleTemplates.test.ts` (25 test: id unici, categorie/rischi validi, ogni body parsabile e, riempito, JSON/SQL ben formato, `STAGE_OPERATORS` importato e non copiato).
  - [x] Mongo: `find` (semplice/filtro/sort+limit), `count`, `insertOne`, `insertMany`, `updateOne` `$set`, `updateMany` `$set`/`$inc`/`$unset`/`$push`, `replaceOne`, `deleteOne`, `deleteMany`, `aggregate` (`STAGE_TEMPLATES`/`STAGE_OPERATORS` spostati in un modulo condiviso, non copiati), `createCollection`, `dropCollection`, `runCommand` `createIndexes`/`listIndexes`/`dropIndexes`.
 — coperto da `consoleTemplates.test.ts`.
  - [x] SQL: `SELECT` (semplice, JOIN, GROUP BY), `WITH`, `INSERT`, `UPDATE … SET … WHERE`, `DELETE … WHERE`, `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX`/`DROP`; varianti per dialetto (`LIMIT`, `RETURNING`, `ON CONFLICT` vs `ON DUPLICATE KEY`).
 — coperto da `consoleTemplates.test.ts` (varianti per dialetto).
  - [x] Redis: `GET`/`SET`/`DEL`/`EXPIRE`/`TTL`, `HGETALL`/`HSET`, `LPUSH`/`LRANGE`, `SADD`/`SMEMBERS`, `scan` con pattern, `inspect`.
 — coperto da `consoleTemplates.test.ts`.
  - [x] I template si specializzano con lo schema (tabella/collezione selezionata precompilata, colonne comuni come scelte).
 — `specializeTemplate()`: tabella/collezione e database precompilati (restano tab stop), primo campo/colonna diventa lista di scelte con colonne reali (max 20, nomi con `,|$\}` scartati). Test dedicati.
- [ ] DB-3.1.3 Snippet expander (`QueryEditor.tsx:288`): Tab → tab stop successivo, Maiusc+Tab precedente, Esc esce; senza snippet attivo Tab inserisce due spazi. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `snippet.ts` (parser, testato) + sessione in `QueryEditor.tsx`: all'inserimento il buffer riceve i testi di default e si seleziona il primo stop; **Tab** avanza, **Maiusc+Tab** torna indietro, **Esc** esce; gli stop a scelta aprono il popup delle opzioni; le posizioni seguono la digitazione nello stop attivo e la sessione finisce se si scrive altrove o si clicca. Senza snippet attivo Tab inserisce due spazi. **Limite:** gli stop con lo stesso numero non sono specchiati.
- [x] DB-3.1.4 `jsonCompletions(text, caret, ctx)` accanto a `sqlComplete.ts` (Mongo e `command` Redis): valori di `operation` dalla lista del backend; `collection` da `schemaItems`; campi dentro `filter`/`projection`/`sort`/`update`/`document`; operatori dopo `$` (da `STAGE_OPERATORS`). JSON non valido → degrada senza errori.
 — `jsonComplete.ts` + `jsonComplete.test.ts` (10 test): nomi di `operation`, `collection` dallo schema, chiavi top-level, campi di `filter`/`projection`/`sort`/`update`/`$set`/`document`, operatori dopo `$` (filtro, update, stage da `STAGE_OPERATORS`), comandi Redis; fuori da una stringa completa chiavi con virgolette; JSON rotto → nessun suggerimento. Collegato al popup di `QueryEditor` (Mongo/Redis).
- [ ] DB-3.1.5 Schema condiviso: hook `useDbSchema(conn)` (o prop `schemaContext`) al posto dello stato locale `DatabasePanel.tsx:62-66`; console, `RightRail` e tab Mongo leggono la stessa fonte. Mongo: campionamento **lazy** per collezione (`find limit 50` + `analyzeSchema`), cache in mappa, invalidazione su Refresh; indici via `listIndexes`. Tipi di colonna passati al completamento SQL. Mai campionare senza connessione attiva né fuori da un'azione utente. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** hook `useDbSchema.ts` = unica vista derivata (completamento SQL con tipi, `QuerySchema` per l'interprete, contesto JSON, schema per la console e per Ask AI). Mongo: campionamento **lazy** per collezione (`find limit 50` + `analyzeSchema`) solo con connessione viva e solo quando una query o la console nomina la collezione; cache in mappa, azzerata a ogni Refresh o cambio connessione, errori ignorati. **Indici (aggiunto 2026-10-15):** `listIndexes` accanto al campione, nomi dei campi indicizzati in `QuerySchemaTable.indexes` → l'avviso `unindexed field on a large collection` scatta davvero (`useDbSchema.test.ts`). `RightRail` legge la vista derivata dell'hook (i campi Mongo campionati arrivano da `dbSchema.jsonContext`); le tab Mongo dell'Explorer fanno il loro campionamento per l'anteprima documenti, che è un'altra cosa.
- [x] DB-3.1.6 Completamento SQL contestuale: dopo `UPDATE x SET` solo colonne di `x`; dopo `INSERT INTO t (` colonne di `t`; dopo `JOIN … ON` colonne con stesso nome/tipo; dopo `WHERE` colonne e operatori coerenti col tipo.
 — `sqlComplete.ts` (`contextualColumns`) + 4 test nuovi: dopo `UPDATE x SET` solo le colonne di x, in `INSERT INTO t (` solo le colonne non ancora elencate di t, dopo `WHERE`/`ON`/`HAVING`/`AND`/`OR`/`GROUP BY`/`ORDER BY` solo colonne in scope più operatori; il tipo della colonna compare nel dettaglio (`utenti · text`).
- [ ] DB-3.1.7 Strip di 2-4 chip contestuali (es. `SELECT * FROM utenti` senza `WHERE`: "Aggiungi WHERE", "Aggiungi LIMIT", "Conta le righe"; `updateMany` senza filtro: "Aggiungi filtro", "Prima conta"); un clic applica la modifica. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `queryChips.ts` (logica pura, 10 test) + riga sotto l'editor: SELECT senza WHERE/LIMIT → Add WHERE, Add LIMIT 100, Count rows; UPDATE/DELETE senza filtro → Add WHERE, Count first; Mongo many senza filtro → Add filter, Count first. Un clic modifica solo il testo.

#### Fase 2 — Interprete e controllo del rischio
- [x] DB-3.2.1 `queryInterpreter.ts` (funzioni pure, test accanto a `sqlComplete.test.ts`): `interpret(driver, text, schema)` → `{kind, targets[], filterPresent, writes, risk, summary, issues[]}`.
 — `queryInterpreter.ts` + `queryInterpreter.test.ts` (24 test): tokenizer minimo (stringhe, commenti, `$$`), `WHERE` vero anche a capo, più statement, CTE, schema (tabella/colonna sconosciuta), Mongo (operazioni, sostituzione completa, upsert, indici), Redis (stesse allowlist del backend). `DatabasePanel` ora decide con l'interprete; i vecchi `isDangerous*` restano come pavimento (nulla che prima chiedeva conferma smette di chiederla).
  - SQL: via commenti/stringhe, keyword iniziale, tabelle bersaglio (estendendo `sqlAliases`), `WHERE` con **regex vera** (non ` WHERE `), più statement, `LIMIT`, `SELECT *`; sostituisce `isDangerous` e il `dangerous` di `DatabasePanel.tsx:78`.
  - Mongo: `JSON.parse` (o `parseShellDoc`) → operazione, collezione, chiavi del filtro, `update` con operatori (`$set`…) o documento di sostituzione (rischio alto), `upsert`.
  - Redis: comando, chiave/pattern, lettura/scrittura (da allowlist).
- [ ] DB-3.2.2 Riepilogo in linguaggio semplice sotto l'editor e badge Lettura / Scrittura / Distruttiva con `issues` ("nessun filtro", "più statement", "sostituzione completa del documento", "colonna inesistente `statoo`", "campo non indicizzato su collezione grande"). — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** riga sopra la status bar con badge Read/Write/Destructive, frase in linguaggio semplice e fino a 3 avvisi (nessun filtro, più statement, sostituzione completa, colonna/tabella inesistente, campo non indicizzato).
- [ ] DB-3.2.3 Dry-run via conteggio: UPDATE/DELETE SQL → `SELECT COUNT(*) FROM t WHERE …` (test sulla riscrittura; se non riscrivibile in sicurezza, nessun conteggio e avviso); Mongo `updateMany`/`deleteMany` → `{operation:'count', filter}`. "interesserà N righe/documenti" nel dialogo di conferma (`DatabasePanel.tsx:326-337`). Azione esplicita "Stima impatto", con timeout. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `countRewrite()` (testato: UPDATE/DELETE con o senza WHERE, rifiuto di JOIN/LIMIT/CTE/più statement, Mongo many → `count` con database) usato da `estimateImpact()`: la stima gira **dentro la conferma** (l'utente ha già premuto Run), timeout 8 s, e il dialogo dice "It will affect N rows/documents". Se non è riscrivibile in sicurezza non c'è numero e il dialogo lo dice. Non c'è un pulsante "Stima impatto" separato.
- [ ] DB-3.2.4 "Esegui selezione" e divisione in statement lato frontend (rispetta stringhe, commenti, `$$`): Ctrl+Invio = statement sotto il cursore, Ctrl+Maiusc+Invio = tutti, esito per statement. Backend resta a statement singolo. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** `splitStatements`/`statementAt` (testati). **Ctrl+Invio** = selezione, altrimenti lo statement sotto il cursore (se lo script ne ha più di uno); **Ctrl+Maiusc+Invio** = tutti in sequenza, si ferma al primo errore, un'unica conferma se qualcuno è distruttivo, esito per statement nei log. Il backend resta a statement singolo.
- [x] DB-3.2.5 Coerenza con il backend: dialogo UI allineato ai requisiti reali di `confirm` (`mongoDestructiveOperation`, `destructiveQuery`, `redisWriteCommands`), spiegando *perché* chiede conferma; fragilità del match ` WHERE ` corretta anche in Go (`destructiveQuery`, `database.go:989`).
 — Go: `destructiveQuery` riscritta (`internal/database/database.go`): maschera stringhe/commenti/`$$`, `WHERE` vero anche a capo, ogni statement dello script, CTE con DELETE/UPDATE; un commento iniziale non nasconde più un `DELETE`/`DROP`. `destructive_test.go` (15 casi). UI: il dialogo di conferma spiega *perché* chiede (riepilogo, avvisi, stima).

#### Fase 3 — Suggerimenti AI (opzionali, disattivati di default)
- [ ] DB-3.3.1 Pulsante "Chiedi all'AI" accanto a Explain in `QueryEditor.tsx`, visibile solo con `isAICompanionAvailable`; intento in linguaggio naturale → query proposta nella categoria giusta. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** pulsante **Ask AI** nella barra secondaria (solo con provider verificato in Settings → AI, via `isAICompanionAvailable`) che apre `AiQueryAssistant.tsx`: intento in linguaggio naturale → query proposta.
- [x] DB-3.3.2 Prompt con **soli nomi di schema** (tabelle, colonne, tipi, indici) + query corrente + intento; **mai righe di dati**. Tutto da `createAIRedactor()` (`redact` prima, `restore` dopo), `ensureAIConfigured()`, `AIEngine.Complete(system,user,~1200)`, rispetto di `credentialMode` e policy locale come `goStudioAIFixRunner.ts:62-70`; contesto schema riusando `goStudioAILiveContext.ts`, non duplicato.
 — `aiQuerySuggest.ts` + test (10): il prompt contiene solo nomi di tabelle/colonne/tipi (limiti 40×40), l'intento e la query corrente, mai righe; `createAIRedactor()` nasconde i segreti in uscita e li ripristina nella risposta; `ensureAIConfigured()` + `AIEngine.Complete(…, 1200)` rispettano `credentialMode`. Lo schema è quello già caricato dal pannello (nessuna seconda lettura, quindi `goStudioAILiveContext` non serve); la policy di progetto `.adomnia/ai-policy.json` non si applica: il pannello Database non è legato a un progetto.
- [ ] DB-3.3.3 Risultato come suggerimento in stile diff con riepilogo dell'interprete e badge di rischio; "Inserisci" o "Scarta"; **mai esecuzione automatica**; le scritture generate passano da conferma e stima d'impatto. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** la proposta appare in stile diff (`lineDiff`, righe aggiunte/rimosse) con badge di rischio e riepilogo dell'interprete; **Insert in editor** o **Discard**. Mai esecuzione automatica: la scrittura passa dalla conferma con stima d'impatto.
- [x] DB-3.3.4 Nessuna chiamata esterna senza azione esplicita (local-first): niente suggerimenti AI in background mentre si digita.
 — l'unica chiamata parte dal clic su Suggest (o Invio nel campo); nessun suggerimento mentre si digita nell'editor. Il pannello dichiara cosa invia e a quale provider.

#### Cronologia e query salvate (trasversale)
- [ ] DB-3.4.1 `favorites: string[]` e cronologia a stringhe (`DatabasePanel.tsx:343,487-499`) sostituiti da record `{id, name, category, driver, connectionId, query, ts}` sotto nuove chiavi in `dbShared.tsx:77-81`; redazione degli export prima di qualsiasi condivisione; limiti di dimensione. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO (completato 2026-10-15); verifica manuale in MANUAL-CHECK.md:** la cronologia è di record `HistoryItem {id, name, category, driver, connectionId, query, ts}` (non più `{query, ts, label}`): `createHistoryRecord`/`migrateHistory` in `savedQueries.ts`, categoria dedotta dall'interprete, `connectionId` nullo per i dati migrati (validi per ogni connessione dello stesso driver) e compilato per le query nuove. I preferiti sono record `SavedQuery` sotto `savedQueries.v2` (200 record / 20.000 caratteri); `RightRail` mostra la cronologia per nome (`item.name`).
- [x] DB-3.4.2 Migrazione nei loader (c'è già una migrazione cronologia a `DatabasePanel.tsx:139`): vecchie stringhe → record con `category` dedotta dall'interprete e `connectionId` nullo (valide per tutte le connessioni dello stesso driver).
 — `migrateFavorites()` (test): le vecchie stringhe diventano record con famiglia (sql/mongodb/redis) e categoria dedotte dall'interprete, `connectionId` nullo, ordine conservato; la lista vecchia (`favorites`) resta intatta per un rollback. La cronologia non cambia formato, quindi non serve migrarla.
- [ ] DB-3.4.3 Filtri per categoria/connessione, rinomina, "Salva come template personale" (badge "Mio"), export/import come file. — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md (stesso ID più DB-3.M*).**
 — **IMPLEMENTATO; verifica manuale in MANUAL-CHECK.md:** nel tab Saved della console: filtro per categoria (la connessione è quella attiva) e testo, rinomina inline, elimina, "Use as template" (badge **Mine**, compare nella sua categoria), salva query corrente / come template, **export** su file senza id di connessione e con valori tipo `password = '…'` oscurati, **import** con id nuovi. Logica pura in `savedQueries.ts` (11 test).

**Rischi.** Parser SQL a regex sbaglia sui casi limite (CTE annidate, `;` in stringhe, dollar quoting): meglio un tokenizer minimo con test mirati; il rischio calcolato dalla UI non è mai l'unica difesa (resta il backend). Riscrittura a `COUNT` non sempre equivalente (JOIN in UPDATE, `LIMIT` in DELETE): in dubbio non stimare e dirlo. Campionamento Mongo su collezioni enormi: limite, timeout, cache. Se gli snippet col textarea overlay diventano fragili, valutare Monaco (già in `package.json`) **solo** se serve, rispettando "Go Studio resta lazy" e il budget di bundle.

**Verifica**
- [x] DB-3.T1 Test unitari: `interpret`, parser degli snippet, `jsonCompletions`, divisione in statement, riscrittura a `COUNT`.
 — `queryInterpreter.test.ts` (interpret, divisione in statement, `statementAt`, riscrittura a COUNT), `snippet.test.ts`, `jsonComplete.test.ts`, `sqlComplete.test.ts`, `queryChips.test.ts`, `savedQueries.test.ts`, `aiQuerySuggest.test.ts`, `QueryConsole.test.tsx` (markup di console e riga dell'interprete), più `destructive_test.go`.
- Verifiche manuali **DB-3.M1…M5** → `mds/MANUAL-CHECK.md` (sezione **DB-3**).

**Gate DB-3 (per fase):** Fase 1 [x] Impl [x] Test [ ] Manuale — Fase 2 [x] Impl [x] Test [ ] Manuale — Fase 3 [x] Impl [x] Test [ ] Manuale — Cronologia 3.4: [x] Impl [x] Test [ ] Manuale — [x] Doc  [ ] Verificato da altra persona/agente — verifiche manuali in `mds/MANUAL-CHECK.md` (DB-3.M1…M5: serve `wails3 task dev`, un database reale per driver e un provider AI verificato).

---

## 2. Checklist finale globale (prima di dichiarare il lavoro concluso)

- [ ] Tutti i Gate delle sezioni IDE-1…IDE-5, GS-1…GS-10, DB-1…DB-3 completi (nessuna casella aperta senza nota `BLOCCATO` o `NON VERIFICATO`).
- [ ] `go test ./...`, `npm run build`, `npm run check:startup` verdi (output incollato nel Registro).
- [ ] `internal/ide/architecture_test.go` e test di guardia di IDE-2.5 verdi.
- [ ] Binding rigenerati con il `wails3` pinnato; `frontend/bindings/adomnia/*` aggiornati.
- [ ] Layout/storage esistenti si caricano senza migrazione manuale (`LEGACY_RAIL_ALIASES`, id pane invariati); migrazioni di `adomnia.database.connections` e cronologia documentate.
- [ ] Verifica manuale completata: elenco, passi ed esiti in `mds/MANUAL-CHECK.md` (sezione "Verifica globale di rilascio").
- [ ] Nessun segreto in chiaro su disco, nei log o nelle risposte HTTP (DB-2.S1); security review fatta dove richiesta.
- [ ] Code review (`code-reviewer`) fatta su tutto il codice modificato; CRITICAL/HIGH risolti. — **NON FATTA** (nessun agente lanciato). Hardening fatto a mano: `refArg` in `internal/git/git.go` rifiuta nomi vuoti o che iniziano con `-` in checkout/create/merge/delete/rebase branch (test `internal/git/branches_test.go`; `go vet ./...` e `tsc --noEmit` puliti, `go test ./internal/git/` verde).
- [ ] Documenti aggiornati (0.5).
- [ ] Riepilogo finale con file modificati e comandi di verifica eseguiti.

---

## 3. Dipendenze tra sezioni (da non violare)
- IDE-1 **prima** di IDE-2 (il rilancio GUI non deve essere nascosto).
- IDE-2 (store `goideTasks`) **prima** di IDE-3 e IDE-4.
- GS-3 alimenta lo stato mostrato in GS-4.
- GS-7, GS-8, GS-9 **prima** di GS-6.
- DB-2 (`ConnectionManager`, `connectionId`) usato da DB-3; schema condiviso di DB-3.1.5 usato da `RightRail` e tab Mongo.
- IDE-5.7 = GS-10.7 e IDE-5.8 ≈ GS-10.12: una sola implementazione, spuntare entrambe con la stessa evidenza.

---

## 4. Note aperte da chiarire (non assumere)
- Cause marcate "probabile / da confermare" (IDE-1, IDE-2.1): riprodurre prima.
- IDE-3.6: gli archi `Imports` sono solo diretti? — **RISOLTO (2026-10-15):** sì, sono gli import diretti project→project.
- IDE-4.10: codice pprof `goide/pprof*.go` — **ESAMINATO (2026-10-15):** `pprof.go` è il Performance Studio (solo lettura: `ListProfileFiles` cammina `Project.RealPath` saltando `.git`/`node_modules`, `LoadProfile` ha `ensureWithinRoot` + limite 512 MB + `profile.ParseData`, i salti al sorgente restano dentro il Go root); `pprof_capture.go` cattura da servizi live (`/debug/pprof/…`) solo su host **locali** (`netpolicy.IsLocalHost`), solo con progetto autorizzato, valida il payload prima di scrivere e scrive solo dentro il progetto con nome generato. Resta valido il limite di scope: il collegamento runtime copre solo i frame "created at" delle race.
- IDE-5.10: percorso UI dei profili terminale — **CONFERMATO (2026-10-15) asincrono:** `GoStudioTerminalPanel.tsx:105` carica i profili in `useEffect` (`listGoIDETerminalProfiles().then…finally(setProfilesLoaded)`) e i controlli restano disabilitati finché non arrivano; nessun percorso UI sincrono. Profilo scelto dal menu "New terminal" (`:405,:424`), persistito in `localStorage` (`adomnia.goide.terminalProfile`) e ripristinato per i terminali ricreati (`goStudioTerminalRestore.ts`).
- GS-3.1: `CLAUDE_CODE_EXECUTABLE` è supportato dalla versione pinnata; confermato dal changelog upstream dell'adapter.
- GS-4: icona AI nella stripe destra (stato attuale) o sinistra? — **RISOLTO (2026-10-15):** stripe destra. Scorciatoia: **Alt+2**, non Alt+9 (`view.contextInspector` occupa Alt+9; liberi restavano solo 2 e 3).
- GS-9.4: binding Git senza UI — **VERIFICATI (2026-10-15):** tutti i binding `VCS*` della tool window Git hanno UI (`lib/goide-vcs-api.ts` consumato dai componenti: status, repository selector, file/line history, file at revision, blame, changed symbols, stage, commit, checkout, revert, patch lines, pull, push, working diff). Restano **volontariamente non esposti** (limite V1, rail `gitsync` rimosso) i binding del vecchio `GitSync`: `CommitPaths`, `CommitAll`, `CompareWebURL`, `ApplyPatch` (solo `bindings/adomnia/gitsync.ts` e `wails-window.d.ts`, nessun consumer). `RemoteWebURL` è usato da "Open on remote"; le PR passano dai binding `Host*` (tab Pull requests).

---

## 5. Registro evidenze (compilare quando si spunta)

| ID voce / Gate | Data | Chi | Evidenza (comando + esito / screenshot / commit) | Verificato da |
|----------------|------|-----|--------------------------------------------------|---------------|
| IDE-1 Impl/Test/Doc | 2026-10-13 | Codex | `go test -timeout 10m ./...` verde; `npx vitest run` completo: 1373 test verdi; `npx tsc --noEmit`; `npm run build`; `npm run check:startup` (600158 B < 650 kB); `wails3 task build`; binding rigenerati con Wails beta.28. Manuale update/rollback reale ancora NON VERIFICATO. |               |
| IDE-2 Impl/Test/Doc | 2026-10-14 | Codex | `go test -timeout 10m ./...` verde; guardia AST verde; `npx vitest run`: 315 file/1375 test verdi; `npx tsc --noEmit`; `npm run build`; `npm run check:startup` (600158 B < 650 kB); `wails3 task build` con Wails beta.28. Controllo visivo release Windows ancora NON VERIFICATO. |               |
| GS-1 Impl/Test/Doc | 2026-10-14 | Codex | `go build ./...` e `go test -timeout 10m ./...` verdi; `internal/ide/architecture_test.go` verde; `npx tsc --noEmit`; `npm run build`; `npm run check:startup` (600158 B < 650 kB); `npx vitest run`: 316 file/1379 test verdi; `wails3 task build` (Wails beta.28) exit 0; binding `ListRunTargets` presenti e rigenerati. Manuale Play/F5/Debug/gutter/picker NON VERIFICATO (richiede app desktop interattiva). |               |
| GS-2 Impl/Test/Doc | 2026-10-14 | Codex | `go test -timeout 10m ./...` verde; test mirati per scope ricorsivo, stderr/exit code, `go.mod` quotato, coverage vuota e moduli annidati; `npx vitest run`: 316 file/1380 test verdi; `npx tsc --noEmit`; `npm run build`; `npm run check:startup` (600158 B < 650 kB); `wails3 task build` (Wails beta.28) exit 0. Verifica manuale nel Test Explorer ancora NON VERIFICATA. |               |
| IDE-2.7 hotfix React #185 | 2026-10-14 | OpenCode | Riprodotto dall'app reale: `%APPDATA%\adomnia\logs\debug-2026-10-14.jsonl` con `Error: Minified React error #185` e componente in `GoStudioPanel-*.js`; assente nei log del 13/10. Causa: selettore Zustand instabile `runningGoIDETasks(state, session.id)`. Fix in `GoStudioStatusBar.tsx` (array stabile + `useMemo`) + test di referenza in `goideTasks.test.ts`. Verifica: `npx tsc --noEmit` pulito; `npx vitest run`: 316 file/1380 test verdi; `.\build.ps1` exit 0; nuova build avviata → nessun `#185` nel log. |               |
| GS-3 Impl/Test/Doc | 2026-10-14 | Codex | Commit `fad8907`; test mirati `./internal/claudecode ./internal/milk ./internal/copilot ./internal/ide/sdk`, `go build ./...`, `npx tsc --noEmit`, `npm run build`, `npm run check:startup` (600158 B < 650 kB), binding Wails beta.28. Suite frontend completa non ripetuta secondo la verifica proporzionata. Portale aziendale, Bedrock reale e UI desktop ancora NON VERIFICATI. |               |
| DB-2.0 / DB-2.3 preparazione | 2026-10-14 | Codex | `npx vitest run src/components/database/dbSecrets.test.ts`: 5 test verdi, incluso riproduzione della perdita al reset della memoria renderer. `go test -race ./internal/vault`: prima FAIL con DATA RACE su timeout/timer, dopo verde; test callback obsoleta dopo riapertura e limiti timeout 1–120. Nessuna verifica manuale o chiusura Gate DB-2. |               |
| DB-2 / release 1.0.2 | 2026-10-15 | Codex | `go test -count=1 -timeout 10m ./...` verde; 316 file / 1383 test frontend verdi; `go test -race ./internal/database ./internal/vault` verde; `go test -count=1 -run TestPostgresCredential ./internal/database` con PostgreSQL 16.15 temporaneo: stesso backend PID, lock Vault, Disconnect/riapertura, credenziali cifrate utilizzabili da secondo processo Windows. `wails3 task build` beta.28, VERSION=1.0.2 verde; startup 600541 B < 650 kB. Revisione autore: rifiuto del chiaro, niente segreti nelle risposte driver, chiave DPAPI nel fallback Windows, preservazione dati su errore. Revisione indipendente e matrice UI completa aperte. |               |
| GS-5 Impl/Test/Doc | 2026-10-15 | OpenCode | Prima rosso: `goStudioSplitter.test.ts` + `goStudioLayout.test.ts` fallivano (5 test). Dopo: 10/10 verdi; `npx vitest run src/components/goide src/components/ui src/lib/loginspector/platformJourneyContract.test.ts src/styles src/stores/goidePreviewTab.test.ts` = 108 file / 476 test verdi; `npx vitest run` sui pannelli che usano `ResizeHandle` (database, markdown, mermaid, latex, loginspector, workspace, layout, apidocs) = 16 file / 60 test verdi; `npx tsc --noEmit` pulito; `npm run build` exit 0; `npm run check:startup` 601081 B < 650 kB. Corretto un asserzione errata del test sulle finestre strette (v. GS-5.T2). Controllo visivo dei temi NON VERIFICATO. |               |
| GS-4 Impl/Test/Doc | 2026-10-15 | OpenCode | `goStudioAiHub.test.ts` (12 test: toni, badge, tooltip, `lastProvider` su localStorage), `GoStudioAssistantPane.test.ts` riscritto per la hub, `goStudioCommands.test.ts` esteso (Alt+2, Alt+9 invariato); suite completa frontend: 323 file / 1417 test verdi; `npx tsc --noEmit` pulito; `npm run build` exit 0; `npm run check:startup` 601122 B < 650 kB e `deferredModulesStillOnStartup: []` (Go Studio resta lazy). Aggiornati `CHANGELOG.md` e `docs/GO-STUDIO.md`. I test nuovi falliscono sul codice pre-GS-4 (modulo `goStudioAiHub` assente, tre bottoni nella stripe). Verifica manuale del bottone/hub/finestra staccata NON VERIFICATA. |               |
| DB-1 (parziale) | 2026-10-15 | OpenCode | `dbValue.test.ts` (13 test) + `dbGridInspection.test.ts` (5 contratti) + `csvEscape` in `dbShared.test.ts`; suite completa frontend: 330 file / 1462 test verdi; `npx tsc --noEmit` pulito; `npm run build` exit 0. Implementate: DB-1.1, 1.2, 1.3, 1.4, 1.5, 1.9, 1.10, 1.11 (`dbValue.ts`, `ValueCell.tsx`, `ValueInspector.tsx`, `useResultsFullscreen.ts`, estensione `JsonTree` con `startExpanded`/`renderScalar`, export CSV/JSON). Mancano: DB-1.6 virtualizzazione, 1.7 colonne ridimensionabili, 1.8 toggle Tabella/Albero/JSON, riga "pagina X di totale" di 1.5. Verifica manuale su database reale NON VERIFICATA. |               |
| DB-1.6 / 1.7 / 1.8 + righe "quanto è caricato" | 2026-10-15 | OpenCode | `useWindowedRows.ts` (matematica pura `windowedRange`, 5 test) e `useColumnWidths.ts`; virtualizzazione in `DataTable` (40px) e `DocumentTable` (32px) con spaziatori e chiavi stabili; maniglia colonne con `colgroup` e reset al doppio click; toggle Table/Tree/JSON in `ResultsView` e Mongo (List → Tree, JSON con `JsonTree`); righe `N rows (limit L, auto-limited)`, `Page X of Y`, `only the current page is loaded: N of total`. `dbGridInspection.test.ts` portato a 14 contratti; suite completa: 346 file / 1665 test verdi. Verifica manuale NON VERIFICATA. |               |
| DB-3 (parziale → completo) | 2026-10-15 | OpenCode + sessione parallela | DB-3 implementato in due sessioni parallele sugli stessi file: questa sessione ha scritto `consoleTemplates.ts` (76 template + `specializeTemplate`), `snippet.ts` (parser/espansione) e `queryInterpreter.ts` (`interpret`, `splitStatements`, `statementAt`, `countRewrite`, 68 test) con i rispettivi test; la sessione parallela ha scritto `QueryConsole.tsx`, `QueryEditor.tsx` (snippet + strip interprete), `jsonComplete.ts`, `useDbSchema.ts`, `queryChips.ts`, `aiQuerySuggest.ts`/`AiQueryAssistant.tsx`, `savedQueries.ts` e il fix Go di `destructiveQuery`. **Completato qui (2026-10-15):** 3.1.5 indici (`listIndexes` in `useDbSchema` → avviso `unindexed field`, `useDbSchema.test.ts`) e 3.4.1 cronologia a record (`createHistoryRecord`/`migrateHistory`, 6 test). Verifica finale: 348 file / 1676 test frontend verdi, `npx tsc --noEmit` pulito, `go test ./internal/database/... ./internal/sidecar/...` verdi su SQLite reale. Verifica manuale DB-3.M1…M5 NON VERIFICATA. |               |
| GS-9 / repository nelle sottocartelle | 2026-10-15 | Codex | Riprodotto prima del fix con due repository Git locali in una cartella non versionata: `TestVCSStatusFindsNestedRepositories` rosso (`Available:false`). Dopo: test VCS e discovery verdi (`go test -count=1 -timeout 10m -run 'TestVCS|TestRepositoryFolders' ./internal/goide ./internal/git`), 19 test frontend mirati verdi; TypeScript, `go build ./...`, guardie architettura e build UI verdi. Selettore repository, cronologia per repository proprietario, isolamento stage e protezione da risposte obsolete. Binding beta.28 rigenerati. Verifica manuale desktop NON VERIFICATA; il Gate GS-9 complessivo resta aperto. |               |
| GS-9 / grafo Git nel pannello inferiore | 2026-10-15 | Codex | Ripristinato renderer `GitCommitGraph` con `buildGitGraphLayout` nella vista Log, ora predefinita: corsie, connessioni ai parent, merge e ref branch/tag. Riuso dei parent già forniti da `Overview --all --topo-order`; righe IDE da 36 px, renderer standalone invariato a 58 px. `GoStudioGitLog.test.tsx` + `graphLayout.test.ts`: 5 test verdi; TypeScript verde. Verifica visiva desktop NON VERIFICATA. |               |
|                |      |     |                                                  |               |
| GS-7.4 Impl/Test | 2026-10-15 | OpenCode | Pannelli laterali Markdown nell'IDE: `lib/goide/goStudioMarkdownTools.ts` (pattern backlink, dedupe, archi, grafo locale, filtri orfani/irrisolti, risoluzione target) + `GoStudioMarkdownTools.tsx` cablato in `GoStudioMarkdownView` (bottone accanto al commutatore dei modi). Backlink via `SearchProject` (`include: ['*.md']`), grafo via `buildGraphNodes` + `MarkdownGraphView` riusato; nessuno stato Hub né `internal/markdown`. `npx vitest run src/lib/goide/goStudioMarkdownTools.test.ts` = 12 test nuovi; `npx vitest run src/components/goide src/lib` = 283 file / 1267 test verdi; `npx tsc --noEmit` pulito. Verifica manuale GS-7.4/GS-7.M2 NON VERIFICATA. |               |
| DB-2 security review + gate distruttive | 2026-10-15 | OpenCode + review agente indipendente | Review di sicurezza indipendente su `internal/vault`, `internal/database`, `internal/sidecar`, `dbSecrets.ts`/`ConnectionsSidebar.tsx`: nessun rischio critico/alto sulla riservatezza delle credenziali; **1 ALTO** sul gate delle operazioni distruttive (Mongo `runcommand` girava senza conferma) e 3 MEDIO/BASSO (aperti come DB-2.11-2.13). Fix con prima rosso: `TestMongoRunCommandAlwaysNeedsConfirmation` e `TestDestructiveQueryCoversSideEffectStatements` fallivano; dopo: `mongoDestructiveOperation("runcommand") = (true,true)` e keyword `CALL/DO/COPY/MERGE/REPLACE/LOAD/GRANT/REVOKE` strict in `destructiveQuery`, classificatore `queryInterpreter` allineato (2 casi nuovi). Verdi: `go test ./internal/database/... ./internal/sidecar/...`, `npx vitest run src/components/database` = 21 file / 247 test. |               |
| DB-2.12 / DB-2.13 | 2026-10-15 | OpenCode | **DB-2.12:** chiave di fallback legata a macchina+utente fuori Windows (`seal_key_wrap.go` con marker `ADK1`, `machineSecret()` da `machine-id`+uid), 5 test (`seal_key_wrap_test.go`) + `seal_test.go` verdi, cross-compilazione linux/darwin e `go vet` puliti; file legacy da 32 byte restano validi. **DB-2.13:** `liveDatabaseSchema` passa alla forma opaca `{connectionId, variables}` (`liveSchemaQuery`), niente `resolveDatabaseConnection` nel renderer per il contesto AI; test 11 verdi (`goStudioAILiveContext.test.ts`, `dbSecrets.test.ts`), `npx tsc --noEmit` pulito. Verifiche manuali: DB-2.12 (ambiente senza keyring) e DB-3.M5 (schema AI con DB reale) ancora aperte. |               |
| DB-2.11 | 2026-10-15 | OpenCode | `/vault/decrypt` rifiuta con 403 i riferimenti delle credenziali database salvate: `vault.SetCredentialRefGuard(database.IsCredentialRef)` cablato in `internal/sidecar/server.go`, controllo in `internal/database/credential_refs.go` (solo i ref di `password`/`dsn` in `database/connections`). Test nuovi verdi: `TestIsCredentialRefOnlyMatchesSavedSecrets`, `TestDecryptRefusesDatabaseCredentialRefs`, `TestDecryptWithoutGuardKeepsWorking`. `go build ./...` e `go test ./...` verdi (unico FAIL `internal/otlp/TestAnnotateConnectionsWithRealSockets` flaky: passa da solo, socket reali). Verifica manuale nel pannello Vault ancora aperta (DB-2.S1). |               |
| GS / icone barra IDE | 2026-10-15 | Codex | Icone distinte per Project, log, utilizzi, ricerca, TODO e problemi; eliminato il doppione log/utilizzi. Simboli da 19 px e tooltip visibili con mouse e focus tastiera. TypeScript e build frontend verdi. Verifica visiva desktop NON VERIFICATA. |               |
| GS / navigazione IDE | 2026-10-15 | Codex | Ripristinato Git nella barra sinistra; selezione esclusiva tra Project, log e tool inferiori, azzeramento massimizzazione al cambio. Aperture da tastiera chiudono i log della sessione. Structure mostra solo Structure/Context/Project, AI solo il proprio hub. Ricerca in finestra Ctrl+F, senza icona laterale, filtri e sostituzione espandibili. 31 test mirati, TypeScript e build verdi; verifica desktop NON VERIFICATA. |               |
| DB-3 Impl/Test/Doc | 2026-10-15 | Claude | Frontend: `npx vitest run src/components/database` = 19 file / 219 test verdi (nuovi: `queryInterpreter` 24, `jsonComplete` 10, `queryChips` 10, `savedQueries` 11, `aiQuerySuggest` 10, `QueryConsole.test.tsx` 6, `sqlComplete` +4, `consoleTemplates` +4); `npx tsc --noEmit` pulito; `npm run build` ok; `npm run check:startup` `deferredModulesStillOnStartup: []`. Go: `go test -count=1 ./internal/database` verde, `destructive_test.go` 15 casi (la vecchia `destructiveQuery` non vedeva un commento iniziale né un `WHERE` a capo). Code review (agente `code-reviewer`), corretti: (1) "Run all" mandava `confirm:true` senza conferma (db2, CTE con DELETE) → ora `confirm` parte solo se l'utente ha confermato e il pavimento legacy copre db2; l'interprete vede anche il DELETE/UPDATE dentro una CTE; (2) Ask AI non nascondeva `{"password":"…"}` né valori brevi → `redactQueryText` prima del redattore condiviso (test); (3) uno snippet già espanso veniva riapplicato al rimontare l'editor (ritorno da Mongo Explorer) → `onSnippetApplied`; (4) un campione Mongo in volo finiva nella connessione sbagliata → contatore di generazione; (5) Go `maskSQLNonCode` trattava `\'` come escape su ogni driver → solo MySQL (test per driver); (6) il tetto di 200 preferiti espelleva i template personali e l'import invertiva l'ordine. Verifica manuale (console, Tab sugli stop, conferma con stima, Ctrl+Invio per statement, Ask AI con provider reale) NON VERIFICATA. |               |
| IDE-3 Impl/Test/Doc | 2026-10-15 | Claude | `lib/layeredGraph.test.ts` (9) + `packageView` in `goStudioArchitecture.test.ts`; suite `components/goide` + `observe` + `lib` verde; `npx tsc --noEmit` pulito (esclusi errori Database di altri lavori); `npm run build` ok; `npm run check:startup` `deferredModulesStillOnStartup: []`. Controllo visivo con ≥80 package NON VERIFICATO. |               |
| IDE-4 Impl/Test/Doc | 2026-10-15 | Claude | `go vet` e `go test ./internal/languages/golang ./internal/ide/... ./internal/goide` verdi (5 test goroutine nuovi, incluso `loop-var-capture` solo su go < 1.22); Vitest goide + lib: 270 file / 1212 test verdi. Bindings TS di `ArchGoroutine` scritti a mano (generatore bloccato da `go.sum`). Verifica manuale della vista NON VERIFICATA. |               |
| Riorganizzazione verifiche manuali | 2026-10-15 | OpenCode | Creato `mds/MANUAL-CHECK.md` con tutte le voci che richiedono l'app: 40 voci spostate da qui (voci `…M*`, gate manuali M12/M24/M25/M2/M23/M31, IDE-5.12, riproduzioni IDE-1.0/IDE-2.0/DB-1.0) più la verifica delle 76 voci `IMPLEMENTATO` → 127 controlli manuali con prerequisiti e passi. Aggiunta la regola 0.8 ("da ora in poi le verifiche manuali si scrivono in MANUAL-CHECK.md"); marker `IMPLEMENTATO; NON VERIFICATO manualmente` rinominati in `verifica manuale in MANUAL-CHECK.md`; tabella di stato ricalcolata (213 → 173 voci: ✅ 66 e 🟡 76 invariati, ⬜ 71 → 31). Nessuna modifica al codice. |               |

| Checkpoint integrazione develop | 2026-10-16 | Codex | Build Windows production `wails3 task build` beta.28 verde, binding rigenerati; frontend completo 353 file / 1717 test verdi; `check:startup` 605567 B / 650000, zero moduli differiti nello startup; `go test -p 4 ./... -count=1 -timeout 10m` verde (Go Studio 166,112 s). Prima esecuzione parallela: soglia cache AI instabile sotto carico, poi invariata verde 3 volte e nella suite finale. Corretti due difetti nei test: socket accettati OTLP trattenuti fino alla verifica e cache invalidata per le porte effimere (20 run con race detector verdi); isolamento progetti Windows con profilo cmd per escludere suggerimenti PSReadLine da cronologia condivisa (5 run verdi). Build/runtime dell'app non modificati da queste correzioni ai test. Ulteriori test CLI/milk/OTLP verdi sullo stato aggiornato, 9 test dei report Node verdi. Log locali `.artifacts/publish-*`; prove manuali e review indipendenti ancora aperte, nessuna casella UI chiusa da questo checkpoint. | |
| GS-13.4 Impl/Test/Doc | 2026-10-16 | MiMo (OpenCode) | Inline Assistant (voce Z2.3 del piano): `goStudioInlineAssistant.ts` (prompt, parsing risposte, hunk in coordinate di file, shift dopo accettazione), `goStudioInlineAssistantSession.ts` (sessione Monaco, view zone + decorazioni, gate di sicurezza), `GoStudioInlineAssistantPopup.tsx` + CSS con token; comando `goStudio.ai.inlineAssistant` (Ctrl+Enter) in `installGoStudioAIActions`, popup montato in `GoStudioPanel`. Rosso→verde: il round-trip degli hunk falliva con le coordinate di test sbagliate (startLine 10 su testo di 3 righe), corretto il test; codice invariato. `npx vitest run src/components/goide/goStudioInlineAssistant.test.ts src/components/goide/goStudioAIFix.test.ts` = 29 test verdi; `goStudioAIFixRunner.test.ts` 8 verdi; `goStudioSplitter.test.ts` 5 verdi; `npx tsc --noEmit` pulito; `npm run build` exit 0. Docs: `GO-STUDIO.md` (sicurezza + scorciatoia), `adomnia-feature-catalog.en.md` J3.6. Verifica manuale GS-13.M1…M6 NON VERIFICATA (richiede app desktop e provider AI reale). | |
| GS-14.3 + GS-15.3 Impl/Test/Doc | 2026-10-16 | MiMo (OpenCode) | Z2.4 (messaggio di commit AI) + Z2.5 (stage/unstage hunk e righe). Z2.4: `goStudioCommitMessageAI.ts` (prompt Conventional Commits da `VCSWorkingDiff` + `unifiedDiff`, parsing, gate provider/policy/aiignore/redazione senza ripristino) e bottone *Draft message with AI* in `GoStudioCommitDialog.tsx`. Z2.5: `lib/git/hunks.ts` esteso (`hunkRange`, `hunksOverlapping`, refactor di `selectHunkLines` sullo stesso parser di header), `goStudioVcsHunkStage.ts` (`git apply --cached` avanti/al contrario sui blocchi scelti), pulsanti Stage/Unstage + *single lines…* in `GoStudioHunkPopup.tsx`, mount di `HunkStageDialog` (prima orfana) dal popup e da `GoStudioGitPanel.tsx`, `gitPathFromAbsolute` in `goStudioGitPaths.ts`. Rosso→verde: 2 test inizialmente rossi per difetti dei test stessi (mock con lo stesso contenuto per entrambi i file, asserzione sul messaggio d'errore) e 5 errori TS sui tuple type dei mock; corretti i test, codice invariato. Verdi: `goStudioCommitMessageAI.test.ts` 8, `hunks.test.ts` + `goStudioVcsHunkStage.test.ts` 11, suite `src/components/goide` + `src/lib/git` = 123 file / 563 test; `npx tsc --noEmit` pulito; `npm run build` exit 0. Docs: `GO-STUDIO.md` (sicurezza + "Commit and integrate"), `adomnia-feature-catalog.en.md` J6.10/J6.11. Verifiche manuali GS-14.M1…M4 e GS-15.M1…M5 NON VERIFICATE (richiedono app desktop e repository Git reale). | |
| Checkpoint finale develop e regole progetto | 2026-10-16 | Codex | Build Windows production `wails3 task build` beta.28 verde; frontend completo 358 file / 1760 test verdi; 9 test report Node verdi; `check:startup` 606600 B / 650000 e nessun modulo differito nello startup. Suite Go completa `go test -p 4 ./... -count=1 -timeout 10m` verde (Go Studio 119,397 s). Trovato e corretto un difetto reale nella review agente: scritture con dimensione e timestamp uguali potevano perdere la baseline originale; confronto anche del contenuto testuale limitato e regressione deterministica, 10 ripetizioni con race detector verdi. Regole progetto: test caricamento, aggiornamento, policy, limiti, redazione e invio Copilot/milk verdi; test symlink saltato su Windows per privilegi insufficienti. Log locali `.artifacts/final16-*`. Verifiche desktop Z1.4.M1 e degli altri flussi ancora aperte in MANUAL-CHECK.md; nessuna accettazione manuale dedotta dalla build. | |
