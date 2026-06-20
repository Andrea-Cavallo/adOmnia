# GIT_FEATURE_AUDIT.md

**Audit della sezione Git di adOmnia vs. client Git professionale (GitKraken-class)**
Data: 2026-06-20 · Branch: `master` · Metodo: revisione statica del codice + test pratici dei comandi `git` reali su repo temporaneo + verifica del wiring UI↔backend.

> **Nota metodologica.** Il backend Git di adOmnia è un layer sottile e fedele sopra il binario `git` (`internal/git/*`, eseguito via `runGit`/`runFull`). I test pratici sono stati eseguiti replicando in un repo temporaneo gli **esatti comandi** che il backend invoca (3 branch, commit divergenti, merge pulito, merge in conflitto, stash, tag, reset soft/mixed, cherry-pick, blame). Tutti gli esiti combaciano con il comportamento atteso del backend. Non è stato possibile pilotare la webview desktop Wails da questo ambiente: la colonna "Funzionante" valuta quindi backend (verificato per esecuzione) + cablaggio UI (verificato per lettura), non il rendering live.

---

## 0. Stato interventi — Fatto / Manca

### ✅ Fatto (sessioni di intervento — verificato con build + test Go + tsc + vite build)

| Area | Cosa | Riferimenti |
|------|------|-------------|
| Commit parziali (#39) | `CommitPaths` (stage + pathspec commit dei soli file scelti) | `internal/git/git.go`, `TestCommitPaths_*` |
| Staged/Unstaged (#37) | Due sezioni distinte + stage/unstage per file + Stage/Unstage all; commit dell'index (`Commit`) | `internal/git/staging.go`, `GitSyncPanel.tsx` |
| Staging per-hunk/per-riga (#38) | Selezione hunk o singole righe, patch ricostruita con contatori `@@` aggiornati | `staging.go`, `lib/git/hunks.ts`, `HunkStageDialog.tsx`, `hunks.test.ts` |
| Branch remoti (#15) | Checkout locale/remoto (tracking), delete locale (`-D` su conferma) e remoto, set upstream | `internal/git/branches.go`, `TestRemoteBranchLifecycle`, `TestDeleteLocalBranch` |
| Stash completo (#16) | `StashApply` (non distrugge) + `StashShow` (diff) + Drop per-stash con conferma | `internal/git/stash.go`, `TestStashApplyAndShow` |
| Guardrail (1.3) | Conferma su Remove file/remote, delete branch locale/remoto, force-push | `GitActionsTab.tsx`, `GitGraphActions.tsx` |
| Pulsanti morti (1.4) | Checkout dei branch dalla sidebar; "Starred" finta rimossa | `GitSyncPanel.tsx` |
| Bug parsing porcelain | `statusPorcelain()` (trim solo a destra): la prima riga di `git status` non viene più corrotta | `git.go`, `result.go` |
| Three-way conflict editor (#13) | Base/Ours/Theirs + risultato editabile, salvataggio sicuro e stage | `conflict.go`, `ConflictResolverDialog.tsx`, `TestConflictFileVersionsAndSaveResolution` |
| Undo generico (#20) | Recovery point da reflog + restore soft/mixed/hard con conferma | `rewrite.go`, `GitActionsTab.tsx`, `TestUndoToReflog_RestoresStateBeforeReset` |
| Azure DevOps deep-link (#26) | Commit/compare URL per HTTPS, SSH `v3` e host Visual Studio | `inspect.go`, `TestAzureDevOpsDeepLinks` |
| Branch implicito Push/Pull | Risoluzione del branch checkoutato; errore esplicito su detached HEAD | `git.go`, `TestResolveCurrentBranch_UsesCheckedOutBranch` |
| Stash file selezionati (#16) | Selezione file reale + `stash push -u -- <paths>` | `stash.go`, `GitActionsTab.tsx`, `TestStashPaths_LeavesUnselectedChanges` |
| Blame/history visuali (#6–7) | Gutter blame cliccabile + timeline file con diff per revisione | `FileInsightsDialog.tsx`, `BlameLines`, `blame_test.go` |
| AI staged/working/branch (#30, #32) | Generazione messaggio, spiegazione/risk scan e analisi branch | `GitSyncPanel.tsx`, `ChangesDiff`, `changes_diff_test.go` |
| Pin e profili Git (#33, #36) | Pin persistenti repo/branch; profili nominati con host auto-switch | `gitRepos.ts`, `gitProfiles.ts` |
| Repository avanzato (#22, #24, #25) | Worktree, submodule e sparse checkout completi di UI | `advanced.go`, `GitActionsTab.tsx`, `advanced_test.go` |
| Scalabilità e drag&drop (§3.3, #40) | Grafo virtualizzato/lazy; branch→branch, commit→branch e file→stage | `GitSyncPanel.tsx` |

### ❌ Manca (in ordine di priorità)

| Priorità | Cosa | Rif. | Note |
|----------|------|------|------|
| **Alta** | Pull Request: creazione/lista/merge + integrazione API host | #26–28 | Richiede scelta host + OAuth/token (Fase 5.1) — **serve input utente** |
| **Alta** | Account/credenziali host multipli | #34 | Token/OAuth in `vault.go` — **serve input utente** |
| Media | Terminale integrato sul repo | #29 | (Fase 5.3) |

---

## Mappa dei file rilevanti

**Backend Go** (`internal/git/`): `git.go`, `staging.go`, `stash.go`, `branches.go`, `advanced.go`, `conflict.go`, `result.go`, `inspect.go`, `compare.go`, `commitops.go`, `rebase.go`, `rewrite.go`, `sequencer.go`, `bisect.go`, `search.go`, `helpers.go`, `exec_hidden_*.go`.
**Bindings Wails**: `git_bindings.go`, `git_bindings_ops.go` (struct `GitSync`).
**Frontend** (`frontend/src/`): `GitSyncPanel.tsx`, `GitActionsTab.tsx`, `GitCompareTab.tsx`; sotto `components/workspace/git/`: `GitGraphActions.tsx`, `GitCommitGraph.tsx`, `InteractiveRebaseDialog.tsx`, `ConflictResolverDialog.tsx`, `FileInsightsDialog.tsx`, `HunkStageDialog.tsx`, `BisectPanel.tsx`, `CompareView.tsx`, `HistorySearchBar.tsx`, `dialogs.tsx`; sotto `lib/`: `git/gitService.ts`, `git/aiCommitAnalysis.ts`, `git/hunks.ts`, `gitRepos.ts`, `gitProfiles.ts`.

---

## 1. Tabella di copertura

| # | Feature | Stato | Qualità UX | Funzionante | Priorità intervento | Note |
|---|---------|-------|-----------|-------------|--------------------|------|
| 1 | Grafo visuale commit/branch/merge/tag | **Presente** | Buona | Sì | Bassa | `GitCommitGraph` + `buildGitGraphLayout`; `log --all --topo-order`, decorazioni e badge "merge". Manca lane-color per branch e tooltip ref. |
| 2 | Confronto visuale tra branch | **Presente** | Buona | Sì | Bassa | Tab Compare + menu `compare.branch`; ref arbitrari. |
| 3 | Confronto branch ↔ tag | **Presente** | Buona | Sì | Bassa | `compare.tag`, ref liberi in `GitCompareTab`. |
| 4 | Diff tra commit | **Presente** | Buona | Sì | Bassa | `CompareCommits`/`compare.previous` → `CompareView`/`DiffModal`. |
| 5 | Diff tra file | **Presente** | Buona | Sì | Bassa | `GetFileDiff`, menu file `compareCurrent`/`comparePrevious`. |
| 6 | Cronologia completa di un file | **Presente** | Buona | Sì | Bassa | ✅ Timeline navigabile; click su commit apre il diff di quella revisione del file. |
| 7 | Git blame visuale | **Presente** | Buona | Sì | Bassa | ✅ Gutter strutturata per riga con hash/autore/data/contenuto; click apre il diff del commit. |
| 8 | Merge tramite GUI | **Presente** | Buona | Sì | Bassa | Pulsante Merge (Actions) + `ConflictResolverDialog` su conflitto. |
| 9 | Rebase visuale | **Presente** | Buona | Sì | Bassa | `rebase.onto` + interactive; pre-flight `RepoState`. |
| 10 | Interactive rebase (reorder/squash/fixup/reword/drop) | **Presente** | Ottima | Sì | Bassa | `InteractiveRebaseDialog`: drag&drop reorder, 6 azioni, reword inline, warning published. Punto di forza. |
| 11 | Cherry-pick singolo e multiplo | **Presente** | Buona | Sì | Bassa | `CherryPick(shas[])`, multi-selezione ordinata (oldest→newest), opzioni no-commit/new-branch/record-origin. |
| 12 | Risoluzione visuale conflitti | **Presente** | Buona | Sì | Bassa | `ConflictResolverDialog`: ours/theirs/mark-resolved/view, continue/skip/abort sul sequencer. |
| 13 | Editor three-way per merge conflict | **Presente** | Ottima | Sì | Bassa | ✅ Base/Ours/Theirs simultanei, risultato editabile, scorciatoie “Use in result”, salvataggio e stage in-app. |
| 14 | Creazione e gestione branch | **Presente** | Buona | Sì | Bassa | Create / create+switch / da commit. |
| 15 | Branch locali e remoti | **Presente** | Buona | Sì | Bassa | ✅ *Risolto:* checkout dei branch **locali e remoti** (tracking) dalla sidebar, **delete** locale (con fallback `-D` su conferma) e remoto (`push --delete`, con conferma), **set upstream**. |
| 16 | Stash: apply, pop, drop | **Presente** | Buona | Sì | Bassa | ✅ Apply/Show/Drop per-stash e stash dei soli file selezionati con selezione reale in UI. |
| 17 | Gestione tag | **Presente** | Buona | Sì | Bassa | Create (annotated/lightweight)/delete/push; `points-at` nel menu. |
| 18 | Reset soft/mixed/hard | **Presente** | Buona | Sì | Bassa | `ResetDialog` (con avviso published/protected) + `ResetHard` con `window.confirm`. |
| 19 | Revert di commit | **Presente** | Buona | Sì | Bassa | `RevertCommit` con supporto mainline per merge. |
| 20 | Undo delle operazioni Git | **Presente** | Buona | Sì | Bassa | ✅ Recovery point reflog visuali con restore soft/mixed/hard; ripristino esatto protetto da conferma. |
| 21 | Ripristino singolo file da commit | **Presente** | Buona | Sì | Bassa | `RestoreFileFromCommit` + dialog di anteprima, opzione restore+stage. |
| 22 | Git worktree | **Presente** | Buona | Sì | Bassa | ✅ Lista, creazione su branch nuovo/esistente e rimozione con conferma. |
| 23 | Più repository nello stesso workspace | **Presente** | Buona | Sì | Bassa | ✅ Sidebar persistente con refresh simultaneo di branch, dirty/clean e ahead/behind per tutti i repo; operazioni focalizzate sul repo attivo. |
| 24 | Gestione submodule | **Presente** | Buona | Sì | Bassa | ✅ Lista stato, add, init/update ricorsivo, update singolo e remove con conferma. |
| 25 | Sparse checkout | **Presente** | Buona | Sì | Bassa | ✅ Lettura, set cone/non-cone e disable dalla UI. |
| 26 | Integrazione GitHub/GitLab/Bitbucket/Azure | **Parziale** | Buona | Parz. | Alta | Deep-link commit/compare per GitHub/GitLab/Bitbucket/**Azure DevOps**; restano API/auth/oggetti remoti. |
| 27 | Creazione e gestione Pull Request | **Assente** | — | No | **Alta** | Nessuna creazione PR (al più apre la compare-URL nel browser). |
| 28 | Visualizzazione PR aperte | **Assente** | — | No | Alta | Nessuna lista PR. |
| 29 | Terminale integrato sul repo | **Assente** | — | No | Media | Nessun terminale embedded. |
| 30 | Generazione automatica messaggi di commit | **Presente** | Buona | Sì | Bassa | ✅ “Generate” usa esclusivamente il diff staged e inserisce il Conventional Commit nel box. |
| 31 | Generazione AI descrizione PR | **Assente** | — | No | Media | Dipende da #27. |
| 32 | Spiegazione AI di commit/branch/modifiche | **Presente** | Ottima | Sì | Bassa | ✅ Commit, working changes e range branch; explain, risk scan e summary. |
| 33 | Profili Git separati | **Presente** | Buona | Sì | Bassa | ✅ Profili nominati persistenti name/email/host con applicazione manuale o auto-switch sul remote. |
| 34 | Credenziali e account multipli | **Assente** | — | No | Alta | Delega al credential helper di sistema; nessuna UI. |
| 35 | Ricerca/filtro commit/branch/tag/autore | **Presente** | Buona | Sì | Bassa | `HistorySearchBar` (search strutturata backend `SearchHistory`) + filtro rapido client. |
| 36 | Pin / preferiti per branch e repo | **Presente** | Buona | Sì | Bassa | ✅ Pin reali persistenti per repository e branch locali/remoti, ordinati prima degli altri. |
| 37 | Visualizzazione modifiche staged/unstaged | **Presente** | Buona | Sì | Bassa | ✅ *Risolto:* due sezioni distinte **Staged / Unstaged** (modello index di Git) con stage/unstage per file e Stage-all/Unstage-all; un file `MM` compare in entrambe. Il commit registra l'index. |
| 38 | Stage/unstage di righe o blocchi (hunk) | **Presente** | Ottima | Sì | Bassa | ✅ Selezione hunk e singole righe +/- con ricostruzione patch e ricalcolo dei contatori `@@`. |
| 39 | Commit parziali | **Presente** | Buona | Sì | Bassa | ✅ *Risolto:* nuovo `CommitPaths` (stage + pathspec commit dei soli file spuntati). Il box di commit committa **solo i file selezionati**; gli altri restano modificati. |
| 40 | Operazioni Git via drag & drop | **Presente** | Buona | Sì | Bassa | ✅ Reorder rebase, branch→branch merge/rebase, commit→branch cherry-pick e file tra staged/unstaged, sempre con conferma dove distruttivo. |

---

## 2. Percentuale complessiva

Base: **40 feature** valutate.

| Metrica | Conteggio | % |
|---------|-----------|---|
| Feature **presenti** (almeno parzialmente implementate: Presente + Parziale) | 35/40 | **~87.5%** |
| Feature **completamente funzionanti** (stato "Presente") | 34/40 | **~85%** |
| Feature **solo parziali** | 1/40 | **~2.5%** |
| Feature **mancanti** (Assente) | 5/40 | **~12.5%** |

> *Aggiornamento post-intervento:* sono ora completi anche blame/history visuali, AI staged/working/branch, profili e pin persistenti, staging per-riga, worktree/submodule/sparse checkout, vista multi-repo, virtualizzazione lazy e drag&drop operativo. Le feature pienamente funzionanti salgono da ~43% a **~85%**.

> Le percentuali sono stime basate sulla classificazione qui sopra. Lettura sintetica: **la sezione Git locale è ormai completa per il lavoro quotidiano e avanzato** (staging per-riga, graph, diff, merge/rebase, conflitti three-way, reflog, submodule/worktree/sparse, multi-repo e AI). Il divario residuo è concentrato nello strato **collaborazione/hosting** e nel terminale PTY.

---

## 3. Gap principali (Top 10 vs. client professionale)

1. ~~**Commit parziali non funzionanti**~~ — ✅ **risolto** (`CommitPaths` + commit fedele all’index).
2. ~~**Nessuno staging per-hunk/per-riga**~~ — ✅ **risolto** per hunk e singola riga, con patch e contatori ricalcolati. (#38)
3. **Niente Pull Request** (creazione/lista/merge) e **nessuna integrazione API** con GitHub/GitLab/Bitbucket/Azure: solo deep-link web. (#26–28)
4. ~~**Vista staged vs unstaged non separata**~~ — ✅ **risolto** (due sezioni Staged/Unstaged con stage/unstage rapido). (#37)
5. ~~**Editor three-way assente**~~ — ✅ **risolto:** base/ours/theirs + risultato editabile, salvataggio e stage. (#13)
6. ~~**Undo limitato all'ultimo commit**~~ — ✅ **risolto:** recovery point reflog con restore soft/mixed/hard. (#20)
7. ~~**Branch remoti read-only**~~ — ✅ **risolto** (checkout tracking, delete remoto, set upstream da UI). (#15)
8. ~~**Blame e file-history testuali**~~ — ✅ **risolto** con gutter/timeline cliccabili e diff per revisione. (#6–7)
9. **Nessun account/credenziali host multipli** con token/OAuth nel vault; i profili Git name/email con auto-switch sono ora presenti. (#34)
10. **Nessun terminale integrato** sul repo corrente. (#29)

---

## 4. Bug e problemi UX (per categoria)

### ✅ Interventi applicati in questa sessione
- **Branch remoti gestibili (#15) — RISOLTO.** `CheckoutRemoteBranch` (crea branch locale tracking), `DeleteLocalBranch` (con `-D` su conferma), `DeleteRemoteBranch` (`push --delete`), `SetUpstream` (`internal/git/branches.go`). In UI: branch locali/remoti **cliccabili** per checkout nella sidebar (`GitSyncPanel.tsx`) con delete-on-hover e conferma; delete-branch + set-upstream nel tab Actions. Test: `TestRemoteBranchLifecycle`, `TestDeleteLocalBranch`.
- **Stash completo (#16) — RISOLTO.** `StashApply` (non distrugge lo stash) e `StashShow` (diff) (`internal/git/stash.go`); nel tab Actions ogni stash ha **Apply / Show / Drop** (drop con conferma). Test: `TestStashApplyAndShow`.
- **Guardrail conferme (#bug ops pericolose) — RISOLTO.** Conferma su Remove file, Remove remote, Delete branch (locale/remoto) e **force-push**.
- **Pulsanti morti (#bug) — RISOLTO.** Branch in sidebar ora fanno checkout; sezione "Starred" finta rimossa.
- **Staged/Unstaged separati (#37) — RISOLTO.** Il pannello mostra ora due sezioni **Staged** e **Unstaged** derivate dal modello index/worktree (`GitSyncPanel.tsx`), con pulsanti per-file (+ stage / − unstage), **Stage all / Unstage all**, e il commit che registra l'index via nuovo `Commit(repoPath, message)` (`internal/git/staging.go`). Un file `MM` appare in entrambe le sezioni.
- **Staging per-hunk e per-riga (#38) — RISOLTO.** `FileDiff` + `ApplyHunkToIndex`, parser diff e `HunkStageDialog` permettono di scegliere interi hunk o singole righe `+/-`; `selectHunkLines` ricostruisce la patch e aggiorna i contatori. Coperto da test Go e `hunks.test.ts`.
- **Commit parziali (#39) — RISOLTO.** Nuovo `CommitPaths(repoPath, message, paths)` (stage + pathspec commit). Con il passaggio al modello Staged/Unstaged il commit predefinito registra l'index; `CommitPaths` resta disponibile per il flusso "scegli i file". Coperto da `TestCommitPaths_*`.
- **Bug di parsing porcelain (prima riga) — RISOLTO.** `runGit` faceva `TrimSpace` sull'intero output, eliminando lo spazio in colonna 0 della **prima** riga di `git status --porcelain` (` M file` → `M file`): la prima voce della lista Changes veniva mostrata con nome/stato errati (es. `.file`). Aggiunto `statusPorcelain()` (trim solo a destra) usato da `GetStatus`/`GetOverview`/`inspectState`/`conflictChanges`.

### 🐞 Bug funzionali (residui)
- ✅ **`Push`/`Pull` senza branch — RISOLTO.** Usa il branch realmente checkoutato; su detached HEAD chiede una scelta esplicita invece di inventare `main`/`master`.

### 🚧 Feature incomplete (residue)
- PR create/list/merge e API host (#26–28), credenziali multi-account nel Vault (#34), descrizione AI della PR (#31), terminale PTY embedded (#29).

### 🔘 Pulsanti senza comportamento reale — ✅ RISOLTO
- ~~Pulsante "Starred / branch corrente" senza `onClick`~~ → sezione rimossa.
- ~~Voci "Branches" in sidebar senza checkout~~ → ora cliccabili (checkout locale; checkout-tracking per i remoti) con delete-on-hover.
- Le voci **Remotes** in sidebar restano informative (le azioni sui remoti vivono nel tab Actions).

### 🧭 Flussi poco chiari (residui)
- ✅ *Migliorato:* il flusso "vedo le modifiche → stago (file o hunk) → committo" è ora nel tab **Sync** con sezioni Staged/Unstaged e commit dell'index. Il tab "Actions" resta come pannello avanzato/ridondante.
- **Reset/merge/rebase distribuiti tra tab Actions e menu contestuale del grafo**: due punti d'ingresso con UX diversa per la stessa operazione.

### ⚠️ Operazioni pericolose senza (o con) conferma
- **Con conferma/guardrail:** `ResetHard` ha `window.confirm`; il `ResetDialog` e l'interactive rebase mostrano warning su branch *published*/*protected* (`RepoState.Published/Protected`, lista `main/master/develop/release`). Buono.
- **Senza conferma esplicita:** ✅ *risolto* — `danger.forcePush`, `RemoveFile`, `RemoveRemote`, delete branch locale e remoto ora richiedono conferma. Resta da valutare una conferma più marcata sull'hard reset dal grafo (oggi passa dal `ResetDialog` con avviso published/protected).

### 🔕 Mancanza di feedback visivo
- Le azioni AI e i dialog "text" mostrano loader, bene. Però **molte azioni del menu contestuale** (es. compare, copy) non danno feedback se il backend ritorna vuoto. Il **commit non mostra l'hash risultante** in UI (lo restituisce il backend ma non viene mostrato).
- **Nessun progress per operazioni lunghe** (clone, fetch su repo grandi): solo spinner globale generico.

### 🧯 Errori non gestiti / gestiti male
- Buono: `OpResult` tipizzato instrada conflitti vs errori; il service layer (`gitService.ts`) normalizza i reject in `syntheticFail`. Le query (es. `Overview`) rigettano con messaggio.
- Migliorato: blame e file-history visuali mostrano gli errori nel dialog dedicato. Restano alcuni fallback vuoti su `fileAtCommit`/preview che possono nascondere file assenti o query fallite.

### 🐢 Prestazioni su repository grandi
- `GetOverview` usa ancora **`log --all --topo-order --max-count=n`**; il frontend limita però il carico iniziale e richiede blocchi successivi di 240 commit vicino al fondo.
- ✅ La lista del grafo è virtualizzata con righe fisse e overscan: il DOM resta proporzionale alla viewport, non al numero di commit caricati.
- `SearchHistory`/`FileHistory` non hanno limiti adattivi oltre al parametro fisso.

---

## 5. Piano di miglioramento (roadmap a fasi)

Legenda complessità: **S** (≤0.5gg) · **M** (1–3gg) · **L** (3–7gg) · **XL** (>1 settimana).

### Fase 1 — Correzioni critiche

**1.1 Commit rispetta la selezione (fix `CommitAll`)** — ✅ **FATTO** in questa sessione.
- *Implementato:* `CommitPaths` (stage + pathspec commit dei soli file selezionati) + checkbox/Select-all nel pannello Changes + binding completi + test backend. Criterio di accettazione ("con un file selezionato e uno no, il commit include solo il primo") verificato.

**1.2 Vista staged vs unstaged separata** — ✅ **FATTO** in questa sessione.
- *Implementato:* due sezioni Staged/Unstaged alimentate da `FileChange.index`/`worktree` con stage/unstage inline e Stage-all/Unstage-all; il commit (1.1) registra l'index. Criterio verificato.

**1.3 Conferme e guardrail sulle operazioni distruttive** — ✅ **FATTO** in questa sessione.
- *Implementato:* conferma su `RemoveFile`, `RemoveRemote`, `forcePush`, delete branch locale e remoto.

**1.4 Pulsanti morti → azioni reali** — ✅ **FATTO** in questa sessione.
- *Implementato:* checkout cliccando il branch in sidebar (locali + remoti tracking); sezione "Starred" finta rimossa.

### Fase 2 — Feature Git essenziali

**2.1 Staging per-hunk / per-riga** — ✅ **FATTO.** Selezione hunk o singole righe; le patch parziali trasformano le cancellazioni escluse in contesto e ricalcolano i contatori `@@`. Test `hunks.test.ts`.

**2.2 Branch remoti gestibili** — ✅ **FATTO** (checkout-as-tracking, delete remote, set-upstream). Test `TestRemoteBranchLifecycle`.

**2.3 Stash completo** — ✅ **FATTO** per apply/show/drop per-stash e stash dei soli file selezionati (`git stash push -u -- <paths>`).

**2.4 Undo via reflog** — ✅ **FATTO.** `Reflog` + `UndoToReflog` (restore soft/mixed/hard a un recovery point precedente, con conferma); cablato in `GitActionsTab.tsx`. Criterio verificato: dopo un reset/rebase, "Undo" riporta `HEAD` allo stato precedente. Test `reflog_test.go`.

### Fase 3 — UX avanzata

**3.1 Editor three-way dei conflitti** — ✅ **FATTO.** `GetConflictFileVersions` (stage 1/2/3 = base/ours/theirs) + `SaveConflictResolution`; `ConflictResolverDialog.tsx` mostra le tre colonne, "Use in result" e il risultato fuso **editabile**, poi salva e stagia il file. Criterio verificato. Test `conflict_test.go`.

**3.2 Blame e file-history visuali** — ✅ **FATTO.** Gutter per-riga e timeline file; click apre il diff della revisione.

**3.3 Virtualizzazione + lazy del grafo** — ✅ **FATTO.** Finestra DOM con overscan e caricamento incrementale a blocchi di 240 commit.

**3.4 Drag & drop operativo** — ✅ **FATTO.** Branch→branch merge/rebase, commit→branch cherry-pick e file staged↔unstaged con dialog esplicito.

### Fase 4 — AI e automazioni

**4.1 Messaggio di commit generato dallo staged** — ✅ **FATTO.** “Generate” analizza esclusivamente il diff index e inserisce il messaggio suggerito.

**4.2 AI su working changes e branch** — ✅ **FATTO.** Explain/risk sul working diff e summary del range base…HEAD.

**4.3 Descrizione PR generata** — una volta presenti le PR, generare titolo+body dal range. *Complessità:* **M**. *Dipendenze:* 5.1.

### Fase 5 — Funzionalità enterprise

**5.1 Integrazione host (PR create/list) GitHub→GitLab→Bitbucket→Azure** — provider con OAuth/token in vault, lista PR aperte, creazione PR dal branch. *Valore:* elimina il context-switch verso il browser; coerente col pilastro "enterprise". *Complessità:* **XL**. *Dipendenze:* storage credenziali (5.2). *Criteri:* da un branch pushato si apre una PR senza lasciare adOmnia; lista PR aperte navigabile.

**5.2 Account/credenziali multipli + profili Git** — ✅ profili name/email/host con auto-switch **FATTI**. Restano token/OAuth multi-account nel vault, che richiedono la policy auth della Fase 5.1.

**5.3 Terminale integrato sul repo** — terminale embedded con CWD sul repo attivo. *Complessità:* **L** (PTY cross-platform). *Criteri:* comandi git eseguiti nel terminale si riflettono al refresh del pannello.

**5.4 Submodule / worktree / sparse-checkout** — ✅ **FATTO.** Status/list, add/update/remove e sparse set/disable dalla UI. Test `advanced_test.go`.

---

## Sintesi per il decisore

La sezione Git **non è un mock**: è un client single-repo sorprendentemente completo, con punte d'eccellenza (interactive rebase drag&drop, menu contestuale del grafo ricchissimo, AI sui commit, `OpResult`/`RepoState` con pre-flight di sicurezza).

**Stato attuale:** lo strato locale Git è ora sostanzialmente completo, incluse operazioni avanzate e controllo multi-repo. Feature pienamente funzionanti ~43% → **~85%**.

**Divario residuo:** esclusivamente lo strato **collaborazione/hosting** — PR create/list/merge (#26–28), credenziali host nel vault (#34), descrizione PR (#31) — e il terminale PTY embedded (#29). Richiedono rispettivamente una policy auth/provider e una scelta PTY cross-platform.
