# TODO — Go Studio integrato in adOmnia

Questo file contiene **solo il lavoro ancora aperto**. Le 347 voci completate delle Fasi 0–5 sono state rimosse il 2026-09-29: la loro storia è in git, nel `CHANGELOG.md`, nelle note di rilascio `docs/releases/v0.9.35.md`–`v0.9.38.md` e nella guida [`docs/GO-STUDIO.md`](docs/GO-STUDIO.md), che documenta il prodotto com'è oggi.

## Stato

- **Implementato e coperto da test automatici**: Fasi 0–5, comprese le finestre separate (5.8), Fix with AI e le icone dei file. Le suite Go (`-race`, gopls e Delve reali) e frontend passano su Windows; su Linux passano in CI.
- **Documentazione**: completata il 2026-09-29 (README, catalogo funzioni, ISSUES, ARCHITECTURE, CLAUDE.md e `docs/GO-STUDIO.md` con persistenza, dipendenze, versioni, scorciatoie e modello di sicurezza).
- **Manca**: le prove manuali nell'app avviata (sotto) e, dopo di queste, la chiusura dei gate e la dichiarazione delle finestre separate nelle note di rilascio.

---

# ▶ PROVE MANUALI DA FARE

Quando una prova passa: spuntala qui, registra l'esito nelle **Evidenze** in fondo e spunta i gate che sblocca.

**Setup**: Windows, `wails3 task dev` (CLI `wails3` alla versione di `go.mod`), un progetto Go reale (più package, test, `go.mod` con dipendenze, repository Git con modifiche non committate), Task Manager aperto.

**Già verificato in automatico su Windows** (2026-09-29, Go 1.26.5, gopls v0.23.0, Delve 1.27.2), quindi non va rifatto a mano: stop dell'albero di processi, terminale ConPTY, debugger (breakpoint, step, variabili, evaluate, singolo test, attach, remoto, nessun `dlv`/`__debug_bin` orfano), navigazione gopls verso altri package, isolamento fra sessioni. Restano manuali solo le parti che richiedono la finestra reale o il Task Manager.

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

Architettura: Copilot Language Server ufficiale (completamento, login, enterprise) + in seguito il modo ACP/SDK per chat e agent. UI sempre adOmnia, nessuna estensione VS Code. Regola: nessun componente assume `github.com`; tutto passa da `GitHubProfile`.

**Fatto (MVP parte 1)** — `internal/copilot`, `copilot_bindings.go`, `frontend/src/components/goide/*Copilot*`
- [x] `GitHubProfile` + resolver host: github.com, `*.ghe.com`, GHES; profili multipli; profilo per progetto
- [x] Impostazioni `copilot.json` senza token; proxy, strict SSL, CA aziendale (`NODE_EXTRA_CA_CERTS`)
- [x] Installazione del Language Server nativo dal registry npm con verifica SHA-512, solo su azione dell'utente
- [x] Ciclo di vita: initialize/initialized, configurazione enterprise, workspace folders, crash recovery 1s/2s/5s/10s, stop senza orfani
- [x] Login device flow sull'host del profilo, sign out, stato con utente e host
- [x] Sincronizzazione documenti dallo stesso punto di gopls (open/change/save/close/focus)
- [x] Ghost text Monaco: debounce, cancellazione, scarto dei risultati obsoleti, Tab/Esc, accettazione parziale, telemetria show/accept
- [x] Filtro segreti + `.adomnia/aiignore`: i file esclusi non arrivano mai al server
- [x] Status bar, menu rapido, dialog impostazioni, comandi nel menu Tools

**Prove manuali**
- [ ] **C1** — Install, enable, sign in su github.com, ghost text in un file Go, Tab/Esc
- [ ] **C2** — Profilo `company.ghe.com`, sign in enterprise, progetto legato al profilo Work
- [ ] **C3** — Proxy aziendale + CA bundle; kill del processo `copilot-language-server` e riavvio automatico

**Prossime fasi**
- [ ] Chat laterale (Ask) con contesto file/selezione/workspace, streaming e Stop
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

Da compilare man mano che passano le prove (una riga per sessione di collaudo).

| Data | Commit / release | Piattaforma | Versioni Go / gopls / Delve | Progetto usato | Prove passate | Note e differenze dai mock |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
