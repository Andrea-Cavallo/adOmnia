# 01 · Rilascio v1 — perimetro, gate e riattivazioni

Aggiornato: 2026-10-13 (contenuto di prova: 2026-10-11). Indice dei piani: [README.md](README.md).

> **Stato reale.** I manifest desktop/npm sono a **1.0.1** (`build/config.yml`, `frontend/package.json`) e la bozza `docs/releases/v1.0.0.md` esiste. La pubblicazione è stata autorizzata dall'utente, ma **i gate nativi qui sotto restano aperti**: il tag non certifica installer, updater, rollback né i collaudi desktop. Fino a prova contraria la v1 va presentata come "pubblicata con gate nativi ancora da chiudere".

## Come si collega agli altri piani

- Collaudo e funzioni dell'IDE: [03-GO-STUDIO-PIANO-UNIFICATO.md](03-GO-STUDIO-PIANO-UNIFICATO.md). Le priorità implementate **non** attestano l'accettazione desktop; le idee 2027 non sono prerequisiti v1.
- Verifiche visive dell'app desktop (icona, toolbar API, screenshot): [02-UI-DESKTOP-VERIFICHE-VISIVE.md](02-UI-DESKTOP-VERIFICHE-VISIVE.md).
- Funzioni nascoste in v1: Kubernetes/OpenShift → [04](04-OPENSHIFT-KUBERNETES-STUDIO.md); Collaborazione (beta opt-in) → [05](05-COLLABORAZIONE-REALTIME.md).
- La proposta JS/TS resta separata e rimandata: [`docs/architecture/ide-web-languages-action-plan.md`](../../docs/architecture/ide-web-languages-action-plan.md).

---

## 1. Decisioni approvate sul perimetro

| Area | Esposizione v1 | Stato e motivo |
| --- | --- | --- |
| API Workspace, SOAP, gRPC, WebSocket/SSE, mock, proxy | Mantenuta | Workflow centrale e protocolli enterprise |
| Database e broker | Mantenuta | Collaudo già effettuato dall'utente; nessuna riduzione dei driver |
| Go Studio, runtime, browser, log | Mantenuta | Codice e runtime connessi |
| AI e fuzzing/analisi avanzate | Mantenuta | Nessun nascondimento indiscriminato; servono limitazioni concrete per renderle sperimentali |
| PDF e firme | Accesso da file mantenuto | Nascosta solo la voce autonoma in Home/sidebar/ricerca; import PDF e apertura dal progetto IDE usano l'editor completo |
| Arcade | Nascosto dall'Hub | Codice e giochi conservati; logo statico |
| LaTeX | Nascosto dalla navigazione | Fuori dal perimetro centrale; codice e dati conservati |
| Kubernetes/OpenShift Studio | Nascosto dalla navigazione | Integrazioni di cluster da collaudare; i target remoti dell'IDE non vengono eliminati |
| Plugin manager/marketplace/WASM | Nascosto da navigazione e impostazioni | Nessun cambio alla compatibilità dei plugin installati; temi/template locali mantenuti |
| Collaborazione realtime | Beta opt-in | Visibile con *Show experimental features*, disattivata di default; badge Beta nella sidebar |
| Git | Essenziali mantenuti | Diff, stage, commit, branch, push/pull, merge, conflitti; drag di rebase/cherry-pick nascosti |
| IDE Java/altri linguaggi | Rimandato | Il registry registra solo Go; piattaforma multilanguage conservata |

Il gate riguarda la **scoperta** delle funzioni, non l'eliminazione dei dati: router file e opener di compatibilità restano. Nessuna migrazione del workspace, nessuna cancellazione di codice, formati AI/PDF/progetti invariati.

## 2. Implementato (con test automatici)

- [x] Gate unico `V1_HIDDEN_FEATURES` in `featureRegistry`, applicato a sidebar, command palette e Search Everywhere.
- [x] Home: candidati e tile personalizzate rispettano il gate senza cancellare il layout salvato.
- [x] Ingresso Arcade e azione del logo rimossi; sorgenti conservati.
- [x] Plugin manager e toggle tolti dalle impostazioni; configurazioni preesistenti conservate.
- [x] Collaborazione opt-in sperimentale con badge Beta.
- [x] Apertura PDF dall'IDE collegata allo stesso `PdfEditorPanel` (anche nella finestra Go Studio separata); pannelli mantenuti montati.
- [x] Lettura PDF del progetto limitata a 100 MiB, con confine del progetto e symlink verificati; file originale mai modificato.
- [x] Test: strumenti rimandati invisibili anche con lab attivi; PDF importato conserva i byte; PDF oltre limite, header invalido e file fuori progetto.
- [x] Build frontend riparata (stringhe Markdown multilinea nel tooltip dei valori debugger) — startup 598 602 byte su budget 650 000.
- [x] Suite frontend completa 1357 test / 311 file; suite Go completa (timeout 10 min per package, inclusi git, goide, updater) e `go build ./...` su Windows.
- [x] CI: `build.yml` prepara gli ZIP updater per le tre piattaforme e firma il manifest prima della release; test installer sul runner Linux e controllo budget startup. Secret `ADOMNIA_UPDATE_SIGNING_KEY` presente (verificato solo il nome).
- [x] README e guide EN/IT riscritti sul flusso API → debugger → IDE; link locali verificati; INSTALL.md corretto.
- [x] Versione impostata nei manifest (oggi 1.0.1).

## 3. Collaudi desktop del perimetro (da fare)

Ordinati per rischio per l'utente.

- [ ] **Git:** branch, push/pull, merge, conflitti; nessun ingresso rebase/cherry-pick tramite drag.
- [ ] **Home con layout salvato** che contiene strumenti nascosti; ricerca globale e Search Everywhere.
- [ ] **PDF:** drag/drop, apertura dall'albero IDE e dalla finestra separata; annotazioni, moduli, firma, salvataggio, riapertura.
- [ ] **Collaborazione** con opzione sperimentale off/on, due computer, conflitti, riconnessione → runbook in [05](05-COLLABORAZIONE-REALTIME.md).

## 4. Gate della release ufficiale

Seguire `docs/RELEASE.md` e `docs/V1-CHECKLIST.md`: beta → eventuale `rc.N` → finale, senza riusare tag pubblicati.

- [ ] CI e pacchetti Windows/Linux/macOS del **commit candidato** verdi. (L'ultimo run verde verificato, 38134553058, riguarda `origin/main` 1bc2b77 e non il working tree successivo.)
- [ ] Verifica reale in CI di ZIP updater + manifest firmato + download dalla release candidata.
- [ ] Installer, aggiornamento firmato, sostituzione, **rollback** e conservazione dati su installazioni reali (inclusi dati e finestre IDE).
- [ ] Test installer shell su Linux/macOS (il tentativo su Windows è fallito per percorsi/host bash incompatibili: non prova un difetto).
- [ ] Installer Windows grafico e firma Authenticode — gli script attuali non equivalgono a Setup/MSI.
- [ ] macOS: Developer ID, notarizzazione, installazione e updater su bundle firmato.
- [ ] Smoke test del perimetro stabile e del PDF sulle piattaforme dichiarate supportate.
- [ ] Gate desktop della checklist v1 chiusi e commit candidato congelato prima di push/tag.
- [ ] Changelog e note v1 dichiarano chiaramente beta opt-in e funzioni rimandate.
- [ ] Decidere se i due asset export GIF/MP4 non tracciati appartengono alla release (oggi esclusi).

## 5. Criteri di riattivazione delle funzioni nascoste

- [ ] **Git avanzato:** preview e recupero verificati per rebase/cherry-pick prima di ripristinare gli ingressi UI.
- [ ] **Collaborazione stabile:** due macchine reali, disconnessione/ripresa, permessi, conflitti, integrità del salvataggio.
- [ ] **Altri linguaggi:** adapter completo, debug/toolchain/editor verificati; mai ingressi a implementazioni incomplete.
- [ ] **Plugin marketplace/WASM:** contratto pubblico versionato, compatibilità, permessi, installazione/aggiornamento/rimozione, test dei moduli installati.
- [ ] **LaTeX:** perimetro documentale, import/export e packaging TeX per le piattaforme supportate.
- [ ] **Arcade:** valutare distribuzione/accesso separato dal workflow professionale.
- [ ] **Kubernetes/OpenShift:** matrice cluster/versioni, autenticazione, RBAC, timeout, riconnessione; distinguere lettura e modifica → [04](04-OPENSHIFT-KUBERNETES-STUDIO.md).

## 6. Incoerenze corrette in questo riordino

- La nota "la versione installata rimane beta" contraddiceva i manifest a 1.0.x: riscritta nello "Stato reale".
- "Cambiare tutti a 1.0.0 solo alla promozione finale" (aperto) contraddiceva "Versione 1.0.0 impostata" (fatto): unificato.
- "Allineati ... alla beta.2" era superato: rimosso.
- Link a `todo-ide.md` e a `../docs/...` aggiornati alla nuova posizione.
