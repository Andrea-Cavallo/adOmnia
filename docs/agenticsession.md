# AgenticSession — specifica di prodotto e architettura per adOmnia

**Stato:** bozza di lavoro (base per implementazione)
**Ambito:** adOmnia desktop (Wails 3, Go + React/TS), Code Studio, terminale integrato
**Riferimento studiato:** plugin JetBrains **Air** `com.intellij.air` 262.8665.521 (IntelliJ IDEA Ultimate 2026.2, installazione locale)
**Data analisi:** 31 ottobre 2026

---

## 0. TL;DR

Air è un plugin IDE che fa tre cose, e le fa bene:

1. **Setup agenti**: catalogo ACP, rilevamento degli agenti già installati sulla macchina, installazione/aggiornamento automatico, login (browser o terminale), ToS.
2. **Session ledger**: ogni sessione agente diventa un oggetto persistente con un log append-only (`events.jsonl`), una proiezione leggera (`summary.json`) e metadati locali (letto/non letto, titolo, colore, cartelle).
3. **Adozione delle sessioni nate fuori**: legge i transcript che l'agente scrive per conto suo (Claude Code in `~/.claude/projects`), li indicizza, li mette nella stessa lista delle sessioni lanciate dall'IDE, e li tiene vivi con hook HTTP + watcher del filesystem. Per questo "si ricorda le sessioni fatte da terminale".

La feature **AgenticSession** di adOmnia deve fare lo stesso, ma nel nostro contesto: un workspace desktop con terminale proprio, backend Go, più agenti ACP contemporaneamente. La differenza chiave è che qui il terminale è **nostro**, quindi possiamo fare meglio di Air: possiamo legare il PTY alla sessione invece di dipendere solo dai file dell'agente.

**Decisione architetturale proposta:** ledger JSONL per sessione + indice SQLite (metadati, FTS5) + adapter `Source` per agente + hook server locale + identificatore locale indipendente da quello del provider.

---

## 1. Obiettivo

Rendere le sessioni agente di adOmnia **persistenti, riprendibili, osservabili e cross-agente**, indipendentemente da dove sono nate:

- sessione lanciata da adOmnia (Code Studio, pannello agenti, task automatico);
- sessione lanciata a mano nel terminale integrato;
- sessione lanciata in un terminale esterno (Windows Terminal, VS Code, JetBrains) e poi ritrovata;
- sessione creata da un'automazione/agent task.

Risultato per l'utente: una sola lista di sessioni, con stato, unread, costo, file toccati, e la possibilità di riaprire/riprendere qualsiasi sessione anche dopo un riavvio dell'app.

---

## 2. Cosa ho studiato in Air (evidenze)

> Le informazioni sotto vengono dall'ispezione statica dell'installazione locale: descrittore `plugin.xml`, 208 jar di modulo, file di configurazione e dati sul disco. Non è documentazione JetBrains: è ciò che il codice distribuito fa.

### 2.1 Superficie del plugin

- Plugin ID `com.intellij.air`, nome **Air**, categoria *AI-Powered*. Si dichiara come "agentic development" per IDE JetBrains: niente agenti inclusi, si collega a quelli dell'utente.
- **210 content module** dichiarati in `META-INF/plugin.xml` (~361 KB), 208 jar in `lib/modules`.
- Separazione molto netta tra:
  - `intellij.air.backend.*` — processi, ACP, store, indici, hook;
  - `intellij.air.frontend.*` — UI (toolwindow, chat GUI in JCEF, terminale TUI);
  - `intellij.air.shared.*` — modelli e contratti condivisi (session core, eventi, terminale, settings);
  - `intellij.aiagentextensions.*` — skills, hooks e contributi IDE-specifici (IDEA, CLion, DataGrip, RubyMine, RustRover).

Moduli rilevanti per noi (nome → responsabilità dedotta dai tipi):

| Modulo | Contenuto |
|---|---|
| `backend.acp.runtime` | registro ACP, fetch catalogo, download runtime (npx/binario), install/update agenti |
| `backend.session` | registry agenti, launch, identity, session facts, cartelle, retention runtime |
| `backend.session.log` | log/proiezione sessioni, identity registry, unread, catalog, search |
| `backend.session.log.storage` | compaction del log, bundle ZIP di export |
| `backend.sessionList` | righe della lista, provider per agente, claim, archivio |
| `backend.session.terminal` | sessioni terminale: claim, prompt, cwd durevole, relaunch |
| `backend.terminal.threads` | persistenza dello stato dei thread terminale |
| `backend.claude.threads` | lettura transcript Claude, watcher, hook bridge, adozione sessioni |
| `backend.codex.threads`, `backend.opencode.threads`, `backend.junie.threads`, `backend.copilot.threads`, `backend.pi.threads` | adapter per singolo agente |
| `backend.worktree` | worktree Git temporanei per sessione |
| `shared.session.terminal` | macchina a stati del terminale (`SessionTerminalAction/State/Reducer`) |
| `session.analysis` | formati transcript (`SessionJsonlFormat`, `ClaudeSessionJsonlFormat`) |

### 2.2 Dove vivono i dati

Osservato su questa macchina:

```
%APPDATA%\JetBrains\IntelliJIdea2026.2\air\
  session-facts\session-facts.json
  session-identities\<projectHash>\session-identities.json

%APPDATA%\JetBrains\acp-agents\
  installed.json                 # agenti installati/riconosciuti, distribuzione, ToS, lastUsedAt
  archived-sessions.json.lock

%LOCALAPPDATA%\JetBrains\IntelliJIdea2026.2\acp\projects\<projectHash>\
  store.json                     # {schemaVersion, projectDirectory}
  projection.open
  threads\<urlencoded threadId>\
    summary.json
    events.jsonl
    changed-files.json

%LOCALAPPDATA%\JetBrains\acp-agents\
  registry.json, .downloads\, .runtimes\, .icons\, <agent>\
```

Punti importanti:

- `<projectHash>` è un hash della directory progetto (`549007fa` per `…/adOmnia`), quindi il ledger è **per progetto**, non globale.
- Il thread ID locale ha un namespace: `acp:<id>` per sessioni gestite via ACP, `local:<uuid>` per sessioni "adottate"/bindate a una sessione dell'agente.
- `installed.json` è la fotografia dell'ecosistema agenti: per ogni agente, versione, piattaforma, archivio/`npx`, `installedAt`, `lastUsedAt`, `autoUpdatePolicy`, `acceptedTermsOfServiceVersion`, `isExplicitlyInstalled`.

### 2.3 Schema su disco (esempi reali)

`store.json`:

```json
{
  "schemaVersion": 1,
  "projectDirectory": "C:/Users/Andrea/Desktop/Projects/adOmnia-workspace/adOmnia"
}
```

`summary.json` (proiezione, schema v8):

```json
{
  "schemaVersion": 8,
  "threadId": "local:8e293563-5856-45fe-a053-0c1e4b8be707",
  "providerUpdatedAt": 1793462529759,
  "association": { "namespaceId": "claude", "agentSessionId": "452edb5e-…" },
  "runtime": {
    "runtimeKind": "Acp",
    "launchTargetId": "acp.v1.…",
    "agentSessionId": "452edb5e-…"
  },
  "inventoryOwnerAgentId": "claude",
  "displayTitle": "Workspace e CPU di adOmnia",
  "automaticTitle": "Workspace e CPU di adOmnia",
  "chained": false
}
```

`events.jsonl` (append-only, un record per riga):

```json
{"id":"acp:b9bb3022#0","threadId":"acp:b9bb3022","seq":0,"timestamp":1793462515959,"source":"Runtime","type":"ThreadCreated","payload":{"title":"Claude Agent","runtimeKind":"Acp","agentId":"claude","cwd":"C:\\…\\adOmnia"},"version":1}
{"id":"acp:b9bb3022#1","threadId":"acp:b9bb3022","seq":1,"type":"TurnEnded","payload":{"phase":"discarded","outcome":"Completed"}}
{"id":"acp:b9bb3022#2","seq":2,"type":"ThreadDisconnected","payload":{"authRequired":true,"reason":"claude_subscription_not_supported","accountLabel":"Claude Pro","buttons":[…]}}
```

`session-facts.json` (metadati locali, per progetto):

```json
{
  "sessions": [
    {
      "projectDirectory": "C:/…/adOmnia",
      "localSessionId": "local:8e293563-…",
      "view": { "viewedAt": 1793462522780 },
      "changedAt": 1793462526118
    }
  ]
}
```

`session-identities.json` (ponte locale ↔ provider):

```json
{
  "schemaVersion": 1,
  "projectDirectory": "C:/…/adOmnia",
  "registrations": [
    {
      "localSessionId": "local:8e293563-…",
      "currentAgentIdentity": { "namespaceId": "claude", "sessionId": "452edb5e-…" },
      "updatedAt": 1793377569888
    }
  ]
}
```

Su questa macchina c'erano ~22 registrazioni di identità: sessioni Claude/Codex nate in terminale e poi riconosciute dall'IDE.

### 2.4 Come Air "ricorda" le sessioni da terminale

È la parte che ci interessa di più. Il meccanismo ha **tre gambe**:

**(a) Lettura diretta dei transcript dell'agente.**
`ClaudeStoreThreadBackend` risolve la "Claude home" (default `~/.claude`), cerca `projects/**/*.jsonl`, distingue transcript principali, sub-agent e file di sessione live, e costruisce un indice per thread. `ClaudeThreadsWatcher` osserva le stesse directory con un file watcher e produce change-set incrementali. Il backend estrae dal JSONL:

- turni e messaggi (`ClaudeTerminalTurnReader`, `ClaudeTextRecordReader`);
- attività (`PROCESSING`, `READY`, attesa di task in background);
- file di progetto toccati (`ProjectFileChangeEvidence`);
- uso/costo (`ClaudeSessionCostEstimator`);
- titolo automatico e nome agente.

**(b) Hook HTTP dell'agente.**
`ClaudeHookBridge` apre un endpoint locale `http://127.0.0.1:<port>/air/claude/hook`, genera un **token bearer per thread**, e scrive un file di settings temporaneo (`air-claude-hooks-*.json`) passato a Claude con `--settings`. Quando Claude esegue un hook (attività, pre/post tool, cambio file, ciclo di vita sessione) fa una POST all'IDE. Il bridge:

- rifiuta token mancanti/sbagliati o appartenenti a un altro agente;
- emette `AgentSessionSourceUpdateEvent` (attività, file cambiati, …);
- gestisce il **rebinding**: se dentro al terminale l'utente fa `/clear` o cambia sessione, il thread id viene riassociato senza perdere la riga nella lista;
- invalida i token alla chiusura del terminale e fa pulizia dei settings file orfani.

Questo è il pezzo che rende la lista "viva" senza polling aggressivo: il watcher copre il ritardo, gli hook danno la latenza bassa.

**(c) Registro delle identità.**
`SessionIdentityRegistry` mantiene la mappa `localSessionId ↔ (namespaceId, sessionId)` e la riconcilia quando il provider cambia id (resume, fork, clear). `chained` e le fork destination permettono di rappresentare sessioni derivate da una precedente.

**(d) Sessioni terminale.**
`backend.session.terminal` + `shared.session.terminal` modellano il terminale come macchina a stati event-sourced: `Prepare → Create → Hosted → Present → PromptDelivered/PromptFailed → OutputObserved → RecordCwd → Exit/Close`, con `PersistedTerminalThreadState`, `TerminalWorkingDirectoryStore`, coda prompt, retry, relaunch e "detached terminal retirement". Quindi anche un terminale chiuso resta una riga con la sua cwd e il suo stato.

### 2.5 Setup agenti

- Catalogo remoto `agentclientprotocol.com/registry` con cache locale, verifica firma, refresh periodico, override locale (`AcpRegistryLocation.Local|Remote|Inline`).
- `AcpPackageInstaller` + `AcpRuntimeManager`: supporta distribuzione **npx** e **binario per piattaforma** (darwin/linux/windows, x86_64/aarch64), con directory di download, runtime condivisi, version check, staged install.
- `ExternalCatalogEntry` rileva agenti già presenti sulla macchina e li propone come "già installati" invece di reinstallarli.
- `AutoUpdatePolicy`, `skippedVersion`, `acceptedTermsOfServiceVersion`, `lastUsedAt` sono persistiti per agente.
- Login: browser (`frontend.acp.browser.auth`) o terminale (`AgentCardTerminalLoginSettings`), con gestione esplicita degli errori di auth (es. "Claude Pro non supportato, serve Console/API").

### 2.6 UI e feature inventory

Dalle azioni dichiarate in `plugin.xml` (prefisso `AgentThreads.*`) la lista sessioni offre:

- nuova sessione, apertura in tab editor o toolwindow;
- **unread / needs input / working / ready** e notifiche;
- **cartelle di sessioni** (create/rename/mark done/remove member);
- **archivio** con provider di archivio;
- **sessioni concatenate** (`CreateChainedSession`, predecessore risolto);
- **changed files** per sessione, raggruppati per directory, con diff, patch copy/save;
- **outgoing commits** e azioni commit/push/cherry-pick su worktree;
- **costo** per sessione (toggle, anche stimato);
- **outline** del thread e "start new thread from here";
- **fork dell'ultimo turno**;
- layout: IDE-first / AI-first / toolwindow, pin chat in editor, "prevent sleep while working";
- multi-progetto: attach/detach progetto, "current project only";
- **automazioni** (add/enable/disable/delete/show chat).

---

## 3. Lezioni architetturali da copiare

1. **Ledger append-only + proiezione.** Il log è la verità, il summary è un indice ricostruibile. Costa poco, rende la lista veloce e il debug possibile.
2. **ID locale ≠ ID provider.** Serve un `localSessionId` nostro, con una tabella di alias verso `(provider, providerSessionId)`. Senza questo, ogni resume/fork/clear rompe la cronologia.
3. **Il provider possiede il transcript, noi possiamo possederne i metadati.** Titolo, colore, cartelle, read state, pin: nostri. Contenuto: del provider. In caso di conflitto, il contenuto si rilegge, i metadati no.
4. **Due sorgenti di aggiornamento, non una.** Watcher del filesystem (robusto, lento) + hook (veloce, opzionale). Se l'hook non c'è, si degrada senza rompere nulla.
5. **Adapter per agente con capability flags.** Non tutti gli agenti hanno resume, list, hook, cost. La UI deve saperlo, non indovinarlo.
6. **Il terminale è una sessione di prima classe.** Non "un tab con dentro claude": un oggetto con stato, cwd, coda prompt e storia.
7. **Retention e compaction esplicite.** I log crescono; servono policy di retention, replica e bundle di export.

### Cosa NON copiare

- La complessità del modello a 8 versioni di schema e delle migrazioni legacy multiple: noi partiamo puliti, con `schemaVersion` e migrazioni piccole.
- La dipendenza da un IDE per i contributi (skills/hooks iniettati dai plugin IDE): in adOmnia skills e tool sono nostri, li definiamo direttamente.
- Il doppio runtime frontend (GUI JCEF + TUI) per la stessa sessione: noi abbiamo già xterm e React, evitiamo un secondo layer.

---

## 4. Stato attuale di adOmnia (gap analysis)

Cosa c'è già:

| Area | Stato | File |
|---|---|---|
| Client ACP (JSON-RPC, `session/new`, `session/update`, permessi, fs read) | presente | `internal/milk/{conn,handler,manager,fs_read}.go` |
| Installer agenti + provider status | presente | `internal/milk/{installer,agents}.go` |
| MCP server per agenti | presente | `internal/milk/mcpservers.go`, `mcp_server_gen.go` |
| Adapter per agente | presenti | `internal/claudecode`, `internal/opencode`, `internal/pi`, `internal/copilot` |
| Agent task con worktree | presente | `internal/ide/agenttask`, `agenttask_bindings.go` |
| Live development session (processi Go, richieste) | presente | `internal/devsession`, `devsession_bindings.go` |
| Persistenza generica + SQLite + fsnotify | presente | `internal/storage`, `modernc.org/sqlite` |
| UI sessioni agenti unificata e persistente | **assente** | — |
| Adozione sessioni da transcript esterni | **assente** | — |
| Hook server per agenti CLI | **assente** | — |
| Costo/usage per sessione | **assente** | — |
| Ricerca full-text nei transcript | **assente** | — |

Quindi non partiamo da zero: manca il **layer di sessione** sopra il client ACP che già funziona.

---

## 5. Modello AgenticSession

### 5.1 Principi

1. **Una riga per sessione**, qualunque sia l'origine (`adomnia`, `terminal`, `external`, `automation`).
2. **Nessuna perdita su riavvio**: tutto ciò che serve a ridisegnare la lista sta su disco.
3. **Degradazione elegante**: agente senza resume/hook → sessione comunque listata, con capability dichiarate.
4. **Il transcript è read-only per noi** (tranne i nostri metadata sidecar): non riscriviamo mai la storia dell'agente.
5. **Privacy by default**: transcript locali, nessun upload, redazione dei segreti nei log.

### 5.2 Entità

```go
// internal/agentsession/model.go

type Session struct {
    ID            string    // ULID locale, es. "01J..." (mai riciclato)
    ProjectPath   string    // directory progetto (assoluta, normalizzata)
    Origin        Origin    // adomnia | terminal | external | automation
    Provider      string    // "claude" | "codex" | "opencode" | "pi" | "copilot" | "junie"
    ProviderSessionID string // può essere vuoto all'inizio
    Title         string    // manuale se presente, altrimenti automatico
    AutoTitle     string
    TitleSource   TitleSource // manual | auto | provider
    Color         string
    Status        Status    // idle | working | waiting_input | ready | done | error | archived
    Activity      Activity  // ultimo evento significativo
    CreatedAt     time.Time
    UpdatedAt     time.Time
    LastTurnAt    time.Time
    ReadAt        time.Time
    UnreadCount   int
    Pinned        bool
    ArchivedAt    *time.Time
    FolderID      string
    ParentID      string    // sessione concatenata/predecessore
    ForkedFromID  string
    WorktreePath  string
    Branch        string
    CostUSD       float64
    Tokens        TokenUsage
    ChangedFiles  int
    Capabilities  ProviderCapabilities
    SchemaVersion int
}

type ProviderCapabilities struct {
    List, Resume, Transcript, Hooks, Cost, Images, MCP bool
}
```

Altre entità: `Folder`, `Identity` (alias provider), `Fact` (read/view), `ChangedFile`, `CostEntry`, `HookRegistration`, `SourceState` (cursori incrementali per file).

### 5.3 Storage layout (adOmnia)

```
%APPDATA%\adomnia\
  agentic-sessions\
    index.db                      # SQLite: sessioni, folder, alias, FTS5
    projects\<projectHash>\
      store.json                  # {schemaVersion, projectPath}
      sessions\<sessionID>\
        summary.json              # proiezione (scrittura atomica)
        events.jsonl              # ledger append-only
        changed-files.json
        hooks.json                # token/porta se la sessione è live
    archived\<sessionID>.json     # tombstone leggero
    cache\
      transcripts\<provider>\<hash>.json  # indice di parsing, non contenuto
```

Regole:

- `<projectHash>` = SHA-256 troncato del path normalizzato (case-insensitive su Windows), non dell'`ID progetto` interno: sopravvive a rename della cartella.
- `events.jsonl`: append con `O_APPEND`, una riga = un evento, `fsync` non forzato su ogni riga ma su chiusura turno; `seq` monotono per sessione.
- `summary.json`: riscrittura atomica (`tmp` + `rename`) ogni N eventi o a fine turno.
- SQLite è **derivato**: può essere ricostruito scandendo i ledger. Questo evita un DB che, se corrotto, perde la storia.

### 5.4 Eventi del ledger

Envelope stabile:

```json
{
  "id": "<sessionID>#<seq>",
  "sessionId": "01J…",
  "seq": 42,
  "ts": 1793462529759,
  "source": "adomnia|terminal|provider|hook|system",
  "type": "TurnStarted",
  "version": 1,
  "payload": {}
}
```

Tipi minimi (P0):

| Tipo | Payload essentials |
|---|---|
| `SessionCreated` | origin, provider, cwd, launch args, projectPath |
| `ProviderBound` | providerSessionId, previous (per rebinding) |
| `TurnStarted` / `TurnEnded` | turnId, outcome, durationMs |
| `ActivityChanged` | activity (`working`/`waiting_input`/`ready`) |
| `MessageAppended` | role, textRef (offset nel transcript), tokens |
| `ToolCallStarted` / `ToolCallFinished` | toolName, targetPath, ok |
| `PermissionRequested` / `PermissionResolved` | requestId, decision |
| `FilesChanged` | paths[], cause (`tool`/`hook`/`watcher`) |
| `CwdChanged` | cwd |
| `CostUpdated` | usd, tokensIn/out |
| `SessionRenamed` | title, source |
| `SessionRead` | upToSeq |
| `SessionArchived` / `SessionRestored` | — |
| `SessionForked` / `SessionChained` | fromSessionId, atSeq |
| `TerminalExit` | code, reason |

Il ledger è **nostro**: gli eventi del provider vengono normalizzati in questi tipi, così la UI non conosce i formati di Claude/Codex.

### 5.5 Proiezioni

1. **summary.json** (per sessione) — riga della lista, letta al boot senza toccare SQLite.
2. **index.db** — elenco globale, filtri, ordinamenti, FTS5 su titolo + testo normalizzato.
3. **Viste live** — `status`, `unread`, `changed files`, `cost` aggiornati via eventi Wails, non via polling.

Coerenza: una sola goroutine per sessione scrive il ledger; le proiezioni sono consumer idempotenti con `lastAppliedSeq`.

---

## 6. Requisiti funzionali

Legenda: **M** = must (P0), **S** = should (P1), **C** = could (P2).

### F1 — Setup e rilevamento agenti

| # | Requisito | Pri |
|---|---|---|
| F1.1 | Catalogo agenti con cache locale e refresh manuale/periodico | M |
| F1.2 | Rilevamento agenti già installati (PATH, directory note, registry) e proposta "usa questo" | M |
| F1.3 | Install/update con staging, version check, rollback su fallimento | M |
| F1.4 | Login browser o terminale, con messaggio chiaro se il piano non è supportato | M |
| F1.5 | ToS per agente, accettazione persistita, `lastUsedAt` | S |
| F1.6 | Auto-update policy per agente (`auto`/`manual`/`pinned`) + skip versione | S |
| F1.7 | Stato installazione osservabile (downloading, verifying, ready, failed) | M |

**Accettazione F1:** con un agente già nel PATH, adOmnia lo mostra come disponibile senza scaricare nulla; con un agente assente, l'installazione completa in < 60 s su rete normale e la sessione parte senza riavvio.

### F2 — Ledger, lista e resume

| # | Requisito | Pri |
|---|---|---|
| F2.1 | Ogni sessione creata ha un `SessionCreated` persistito prima del primo prompt | M |
| F2.2 | Lista sessioni globale + filtro progetto, ordinata per attività | M |
| F2.3 | Stato per sessione: working / waiting input / ready / done / error / archived | M |
| F2.4 | Unread e "needs input" persistenti al riavvio | M |
| F2.5 | Riapertura sessione: resume ACP quando supportato, altrimenti "nuova sessione con contesto" | M |
| F2.6 | Titolo automatico + rinomina manuale (il manuale vince) | M |
| F2.7 | Cartelle di sessioni (create/rename/done/remove member) | S |
| F2.8 | Archivio con ripristino | S |
| F2.9 | Pin/finestra dedicata e "prevent sleep while working" | C |
| F2.10 | Ricostruzione indice da ledger (comando `RepairIndex`) | M |

**Accettazione F2:** chiudo adOmnia con 3 sessioni attive, riapro: le 3 righe ci sono, con stato e unread corretti; il resume di una sessione Claude riporta lo stesso `providerSessionId`.

### F3 — Adozione delle sessioni nate fuori

| # | Requisito | Pri |
|---|---|---|
| F3.1 | Discovery dei transcript per progetto: Claude (`~/.claude/projects/<encoded>/*.jsonl`), Codex, OpenCode | M |
| F3.2 | Mapping `localSessionId ↔ providerSessionId` con tabella alias e rebinding su cambio id | M |
| F3.3 | Import incrementale: cursore per file, nessuna rilettura completa a ogni avvio | M |
| F3.4 | Le sessioni adottate compaiono nella stessa lista con badge origine `external` | M |
| F3.5 | Dedup: stessa sessione vista da transcript + hook + registry = una sola riga | M |
| F3.6 | Adozione opt-in per progetto (privacy) con esclusione di path | S |
| F3.7 | Import di sessioni da un altro progetto con "attach project" | C |

**Accettazione F3:** lancio `claude` in Windows Terminal dentro il repo, faccio un turno; entro 5 s adOmnia mostra la sessione con titolo e file toccati; dopo un riavvio è ancora lì e apribile.

### F4 — Live mirror

| # | Requisito | Pri |
|---|---|---|
| F4.1 | Watcher fsnotify su directory transcript del progetto, con debounce e change-set | M |
| F4.2 | Hook server HTTP su `127.0.0.1` con porta effimera e token per sessione | S |
| F4.3 | Installazione hook per agente che li supporta (Claude: settings file temporaneo), senza toccare config globali dell'utente | S |
| F4.4 | Validazione token/agent/sessione; rifiuto esplicito e loggato | M |
| F4.5 | Rebinding su `/clear` o switch sessione nel terminale | S |
| F4.6 | Cleanup settings/token orfani alla chiusura | M |
| F4.7 | Fallback: se l'hook non arriva, lo stato si aggiorna dal watcher entro 3 s | M |

**Accettazione F4:** con hook attivo, lo stato passa a `working` entro 300 ms dal primo tool call; con hook disattivato, entro 3 s dal watcher. Nessun token valido dopo la chiusura della sessione.

### F5 — Sessioni terminale

| # | Requisito | Pri |
|---|---|---|
| F5.1 | Ogni terminale avviato dal pannello agenti è una sessione con ID, cwd, provider | M |
| F5.2 | Stato persistito: cwd, comando, argomenti, stato (running/exited), exit code | M |
| F5.3 | Coda prompt con stati `queued/delivered/failed` e retry manuale | S |
| F5.4 | Relaunch della sessione con lo stesso contesto | S |
| F5.5 | Rilevamento comandi agente lanciati a mano nel terminale integrato (shell integration) e proposta di adozione | S |
| F5.6 | Nessun processo orfano alla chiusura dell'app (grace period + kill tree) | M |

### F6 — Transcript, ricerca, contesto

| # | Requisito | Pri |
|---|---|---|
| F6.1 | Vista transcript normalizzata (messaggi, tool call, file, errori) | M |
| F6.2 | Ricerca full-text su tutte le sessioni (FTS5), con hit e jump al punto | S |
| F6.3 | Outline della sessione (turni/tool) e "parti da qui" | S |
| F6.4 | Export sessione (JSONL/ZIP) per debug o condivisione | C |
| F6.5 | Copia codice/patch e apertura file nel workspace | M |

### F7 — Modifiche, worktree, commit

| # | Requisito | Pri |
|---|---|---|
| F7.1 | Elenco file cambiati per sessione, dedotto da hook/tool + watcher | M |
| F7.2 | Diff per file e stato staged/unstaged | S |
| F7.3 | Worktree temporaneo per sessione (opzionale per sessione) | S |
| F7.4 | Commit/push/cherry-pick dal pannello sessione, con branch esplicito | C |
| F7.5 | Rilevamento "il worktree è diventato la root" (agente che crea worktree) | C |

### F8 — Costo e usage

| # | Requisito | Pri |
|---|---|---|
| F8.1 | Contatori token in/out per turno e per sessione, quando il provider li espone | S |
| F8.2 | Costo stimato con tabella prezzi locale e disclaimer "stima" | C |
| F8.3 | Avviso soglia costo per sessione/giorno | C |

### F9 — Multi-agente e catene

| # | Requisito | Pri |
|---|---|---|
| F9.1 | Provider multipli in parallelo nella stessa lista, con capability diverse | M |
| F9.2 | Fork dell'ultimo turno in nuova sessione | C |
| F9.3 | Sessione concatenata (predecessore → successore) con contesto ereditato | C |
| F9.4 | Automazioni: crea sessione da trigger (schedule/git event), con stato e log | C |

### F10 — Tool e skills

| # | Requisito | Pri |
|---|---|---|
| F10.1 | MCP server adOmnia esposto agli agenti con allowlist per progetto | M |
| F10.2 | Skills definite da adOmnia, iniettate solo se l'agente le supporta | S |
| F10.3 | Esperimenti/tooling per agente con default sicuri (opt-in) | C |

### F11 — Sicurezza e privacy

| # | Requisito | Pri |
|---|---|---|
| F11.1 | Hook server solo su loopback, token per sessione, scadenza | M |
| F11.2 | Nessun path fuori dal progetto passato all'agente senza conferma | M |
| F11.3 | Redazione di segreti in log/eventi (`internal/airedact` già presente) | M |
| F11.4 | Transcript e ledger locali; nessuna telemetria di contenuto | M |
| F11.5 | Cancellazione sessione = tombstone + rimozione transcript nostro, mai del provider | M |

---

## 7. Architettura tecnica per adOmnia

### 7.1 Package Go

```
internal/agentsession/
  model.go            # Session, Status, Activity, Capabilities
  ledger.go           # append/read JSONL, seq, compaction
  projection.go       # summary.json, atomic write, rebuild
  store.go            # per-project store, hash, layout
  index.go            # SQLite: tabelle + FTS5 + query
  identity.go         # alias localSessionId <-> providerSessionId
  facts.go            # read state, view, pin, color
  folders.go          # cartelle
  service.go          # orchestrazione, event bus, retention
  repair.go           # rebuild index da ledger

internal/agentsession/sources/
  source.go           # interface Source + capability
  claude/             # transcript reader, watcher, hook installer
  codex/
  opencode/
  pi/
  terminal/           # sessione terminale (usa internal/terminal existente/da creare)
  acp/                # sessione avviata da adOmnia via milk

internal/agentsession/hooks/
  server.go           # HTTP loopback, routing, auth
  registry.go         # token per sessione, scadenza, cleanup
  claude.go           # payload Claude -> eventi normalizzati
```

### 7.2 Interfaccia `Source`

```go
type Source interface {
    ID() string                                  // "claude", "terminal", ...
    Capabilities() ProviderCapabilities
    // Discover elenca le sessioni osservabili nel progetto (può essere costoso: cached).
    Discover(ctx context.Context, project string) ([]Discovered, error)
    // Open restituisce uno stream incrementale di eventi normalizzati.
    Open(ctx context.Context, ref Discovered) (Stream, error)
    // Resume avvia/riprende una sessione se supportato.
    Resume(ctx context.Context, s *Session, opts ResumeOptions) (Runtime, error)
}

type Stream interface {
    Events() <-chan Event   // già normalizzati
    Err() error
    Close() error
}

type Discovered struct {
    ProviderSessionID string
    ProjectPath       string
    Title             string
    UpdatedAt         time.Time
    Origin            Origin
    Cursor            Cursor   // offset/mtime/hash per import incrementale
}
```

Regola: **un Source non scrive mai** nel ledger. Emette eventi; il `Service` li applica. Così un adapter rotto non corrompe la storia.

### 7.3 Flusso di un evento

```
Source (watcher/hook/ACP)  ──Event──▶  Service.Apply(sessionID, ev)
                                        │  valida seq, dedup per id
                                        ├─▶ ledger.Append (JSONL)
                                        ├─▶ projection.Update (summary)
                                        ├─▶ index.Update (SQLite)
                                        └─▶ desktop.Event.Emit("agentsession:event", …)
```

### 7.4 Binding Wails (superficie minima)

```go
// AgenticSessions è il servizio esposto al frontend.
List(filter ListFilter) ([]SessionRow, error)
Get(sessionID string) (SessionDetail, error)
Create(req CreateRequest) (SessionRow, error)
Open(sessionID string) (OpenResult, error)       // apre tab/pannello
Resume(sessionID string) error
Rename(sessionID, title string) error
MarkRead(sessionID string, upToSeq int64) error
Archive(sessionID string) error
Restore(sessionID string) error
Delete(sessionID string) error
MoveToFolder(sessionID, folderID string) error
CreateFolder(name string) (Folder, error)
ListFolders() ([]Folder, error)
Search(query string, limit int) ([]SearchHit, error)
ExportBundle(sessionID, dest string) error
RepairIndex() (RepairReport, error)
```

Eventi Wails:

| Evento | Payload |
|---|---|
| `agentsession:event` | `{sessionId, seq, type, payload}` |
| `agentsession:rowsChanged` | `{sessionIds[]}` |
| `agentsession:unread` | `{sessionId, unreadCount}` |
| `agentsession:hookState` | `{sessionId, state}` |
| `agentsession:error` | `{sessionId, code, message}` |

### 7.5 Frontend

- `frontend/src/stores/agenticSessions.ts` — store zustand, idratazione da `List`, patch dagli eventi.
- `frontend/src/components/agentic-session/` — `SessionList`, `SessionRow`, `SessionBadges`, `SessionPanel`, `TranscriptView`, `ChangedFiles`, `SearchBox`, `FolderTree`.
- Riuso: `@xterm/xterm` per la vista terminale, `@monaco-editor/react` per i diff, `mermaid` per diagrammi nei transcript.
- Virtualizzazione della lista obbligatoria (target: 1.000 sessioni a 60 fps di scroll).

### 7.6 Indice SQLite (schema minimo)

```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  origin TEXT NOT NULL,
  title TEXT NOT NULL,
  auto_title TEXT,
  status TEXT NOT NULL,
  activity TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_turn_at INTEGER,
  read_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  folder_id TEXT,
  parent_id TEXT,
  forked_from_id TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  changed_files INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE identity_alias (
  local_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  PRIMARY KEY (local_session_id, provider, provider_session_id)
);

CREATE TABLE source_cursor (
  source_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  offset INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  PRIMARY KEY (source_id, project_path, file_path)
);

CREATE VIRTUAL TABLE session_fts USING fts5(
  session_id UNINDEXED, title, body, tokenize='unicode61'
);
```

### 7.7 Concorrenza e crash safety

- Una goroutine writer per sessione; canale bufferizzato; `Apply` serializzato per `sessionID`.
- `seq` assegnato dal writer, mai dal chiamante.
- Scrittura ledger: `bufio` + `Flush` a fine batch; `summary.json` atomico.
- All'avvio: per ogni sessione, se `summary.lastSeq < ledger.lastSeq` → replay incrementale; se `summary` manca/corrotto → rebuild dal ledger.
- File lock per sessione (`flock`/`LockFileEx`) per supportare due finestre adOmnia.
- Hook server: rate limit per token, body max 1 MB, timeout 5 s, nessun redirect.

---

## 8. Fasi di implementazione

### P0 — Fondamenta (1 sprint)

- `model`, `store`, `ledger`, `projection`, `service` con event bus.
- Binding `List/Get/Create/Open/Rename/MarkRead`.
- Sessione creata da Code Studio/agent task con `SessionCreated` + `Turn*` normalizzati dal client milk.
- Lista frontend con stato, unread, filtro progetto.
- `RepairIndex` + test di crash/restart.

**Done quando:** creo 3 sessioni, riavvio, le ritrovo con stato e unread; uccido il processo durante un turno e il ledger resta leggibile.

### P1 — Adozione e watcher

- `sources/claude` (transcript + watcher), `identity`, `source_cursor`.
- Adozione opt-in per progetto; dedup con sessioni ACP già note.
- Vista transcript normalizzata + changed files da transcript.

**Done quando:** una sessione Claude nata in Windows Terminal appare in lista entro 5 s, sopravvive al riavvio, e il doppio import non duplica la riga.

### P2 — Hook e terminale

- `hooks/server` + installazione hook Claude via settings temporaneo.
- `sources/terminal`: sessione terminale con cwd persistita, coda prompt, relaunch, kill tree.
- Rebinding su `/clear`, cleanup token.

**Done quando:** con hook, `working` entro 300 ms; senza hook, entro 3 s; nessun token attivo dopo la chiusura.

### P3 — Organizzazione e ricerca

- Cartelle, archivio, pin, ordinamenti, filtri per provider/origine.
- FTS5 + UI ricerca, export bundle.

### P4 — Lavoro e costi

- Worktree per sessione, diff, commit/push/cherry-pick.
- Token/costo per turno e sessione, soglie.

### P5 — Multi-agente avanzato

- Adapter Codex/OpenCode/Pi, fork, sessioni concatenate, automazioni.
- Multi-finestra e sessioni condivise.

---

## 9. Test e accettazione

**Unit**
- ledger: append/read/seq/compaction, replay da seq, file troncato a metà riga (skip + warning).
- projection: rebuild deterministico, atomicità.
- identity: rebinding, alias multipli, conflitti.
- hook server: token mancante/errato/scaduto, body malformato, agent mismatch.
- parser transcript per agente con fixture reali anonimizzate.

**Integration (Go)**
- 200 eventi/s per 10 sessioni per 1 minuto: nessun deadlock, nessuna perdita di `seq`.
- kill -9 durante scrittura: al riavvio il ledger è leggibile e la proiezione si ricostruisce.
- due istanze adOmnia: lock per sessione, nessuna corruzione.

**E2E (Playwright)**
- crea sessione → prompt → stato working → waiting input → ready → riavvio app → riga presente.
- sessione esterna simulata (file JSONL scritto dal test) → compare in lista → apre transcript.
- hook simulato (POST con token) → riga passa a working in < 1 s.

**Criteri globali**
- Avvio a freddo con 500 sessioni: lista visibile < 400 ms, nessuna query sincrona bloccante sul thread UI.
- Memoria: < 150 MB per 1.000 sessioni indicizzate (esclusi transcript aperti).
- Nessun processo agente orfano dopo la chiusura.
- Zero segreti nei log (test con token finti).

---

## 10. Performance e limiti

| Area | Budget |
|---|---|
| Ledger append | < 1 ms per evento (SSD), batch flush |
| summary.json | riscrittura < 5 ms per sessione |
| Lista (1.000 righe) | query SQLite < 30 ms, payload < 300 KB |
| Import transcript | incrementale per offset; full scan solo su `RepairIndex` |
| Hook | p99 < 50 ms lato server |
| Polling | vietato; solo watcher + hook + eventi |

Limiti espliciti:
- Transcript enormi (> 50 MB) non vengono caricati interi: cursore + finestre.
- Agenti senza list/resume: la sessione si crea solo se l'utente la avvia da adOmnia.
- Costo stimato = stima, mai fattura.

---

## 11. Rischi

| Rischio | Mitigazione |
|---|---|
| Formati transcript non documentati che cambiano | Parser versionati, fixture, fallback "raw text", capability `Transcript` disattivabile |
| Hook non installabili (permessi, policy) | Watcher come sorgente primaria, hook come acceleratore |
| Doppioni (hook + watcher + registry) | Chiave di dedup `(provider, providerSessionId, projectPath)`, eventi idempotenti |
| Crescita disco | Retention per età/dimensione, compaction, archivio tombstone |
| Privacy (transcript fuori progetto) | Opt-in per progetto, allowlist path, redazione, nessun upload |
| Path Windows/UNC/long path | Normalizzazione case-insensitive, `\\?\` dove serve, test dedicati |
| Conflitto con `internal/devsession` | Namespace chiaro: DevSession = processi Go; AgenticSession = agenti |

---

## 12. Non-goal (per ora)

- Sostituire Code Studio o il suo runtime.
- Eseguire agenti in cloud.
- Modificare i transcript del provider.
- Un formato di transcript proprietario da imporre agli agenti.
- Editing collaborativo multi-utente delle sessioni.

---

## 13. Domande aperte

1. La sessione terminale deve poter esistere **senza** un provider riconosciuto (terminale libero)? Proposta: sì, con `provider==""` e capability tutte false.
2. L'adozione automatica delle sessioni esterne deve essere ON di default o richiedere un consenso per progetto? Proposta: ON solo per il progetto aperto, con banner la prima volta.
3. Vogliamo un ledger unico globale invece che per progetto? Proposta: ledger per progetto + indice globale; il path resta la chiave di verità.
4. Il costo stimato va mostrato anche per agenti in abbonamento (dove è 0 marginale)? Proposta: sì, etichettato "stimato".
5. Serve un formato export stabile per supporto/debug? Proposta: ZIP con `summary.json`, `events.jsonl`, `manifest.json` e hash.

---

## Appendice A — Inventario moduli Air (riferimento)

**Backend / sessione**: `session`, `session.api`, `session.log`, `session.log.api`, `session.log.storage`, `session.log.reducer`, `session.projection`, `session.catalog`, `session.search`, `session.cost`, `session.cost.estimated`, `session.runtime`, `session.runtime.vcs`, `session.terminal`, `session.actions`, `sessionList`, `sessionList.paging`, `session.workflows`, `session.working.tree(.git)`, `sessionNotes`.

**ACP / agenti**: `acp`, `acp.api`, `acp.runtime`, `acp.mcp`, `acp.browser.auth`, `acp.debug`, `acp.claude`, `acp.codex`, adapter `claude.threads`, `codex.threads`, `copilot.threads`, `junie.threads`, `opencode.threads`, `pi.threads`, `terminal.threads`.

**Prompt / contesto**: `prompt`, `prompt.api`, `prompt.attachments`, `prompt.vcs`, `prompt.screenCapture`, `prompt.testrunner`.

**UI**: `frontend.agents`, `frontend.session.toolwindow(.terminal/.vcs)`, `frontend.session.view(.tui)`, `frontend.session.view.gui`, `frontend.session.preferences`, `frontend.prompt.ui`, `frontend.worktree`, `frontend.sessionNotes`.

**Altro**: `worktree`, `vcs.commit`, `vcs.merge`, `codeNotes.*`, `mobile.ahp`, `availability`, `settings`.

## Appendice B — Evidenze osservative chiave

| Evidenza | Dove |
|---|---|
| 210 content module, plugin `com.intellij.air` | `air-plugin.jar!/META-INF/plugin.xml` |
| Ledger per thread `summary.json` + `events.jsonl` | `%LOCALAPPDATA%\…\acp\projects\<hash>\threads\…` |
| Identità locale ↔ provider | `%APPDATA%\…\air\session-identities\<hash>\session-identities.json` |
| Read/view state | `%APPDATA%\…\air\session-facts\session-facts.json` |
| Hook Claude su loopback `/air/claude/hook`, token bearer per thread, settings file `air-claude-hooks-*` | classi `ClaudeHookBridge`, `ClaudeHookBridgeKt` |
| Lettura transcript `~/.claude/projects/**/*.jsonl` + sub-agent + live session | `ClaudeStoreThreadBackend`, `ClaudeThreadsWatcher`, `ClaudeThreadStoreFilesKt` |
| Macchina a stati terminale (`Prepare/Create/Hosted/Present/PromptDelivered/…`) | `shared.session.terminal.SessionTerminal*` |
| Catalogo ACP + installer npx/binario + auto-update | `backend.acp.runtime.registry.Acp*` |
| Feature UI (cartelle, archivio, concatenate, costo, changed files, automazioni) | azioni `AgentThreads.*` in `plugin.xml` |

## Appendice C — Glossario

- **Sessione / thread**: una conversazione con un agente, con stato e storia. In adOmnia l'entità `Session`.
- **Provider**: l'agente (Claude, Codex, OpenCode, …).
- **Transcript**: il file di storia scritto dal provider.
- **Ledger**: il nostro log append-only normalizzato.
- **Proiezione**: rappresentazione derivata e ricostruibile (summary, indice).
- **Hook**: callback HTTP che il provider invoca verso di noi durante l'esecuzione.
- **Adozione**: portare nella nostra lista una sessione nata altrove.
- **Rebinding**: riassociare una sessione locale a un nuovo id provider dopo resume/clear.
- **Capability**: cosa un provider sa fare (list, resume, hook, cost…).
