# adOmnia v1.0.0 — perimetro frontend e TODO di rilascio

Aggiornato: 2026-10-11. Stato: preparazione, non pubblicazione della v1.

## Decisioni approvate

| Area | Esposizione v1 | Stato e motivo |
| --- | --- | --- |
| API Workspace, SOAP, gRPC, WebSocket/SSE, mock, proxy | Mantenuta | Workflow centrale e protocolli enterprise |
| Database e broker | Mantenuta | Collaudo già effettuato dall'utente; nessuna riduzione dei driver |
| Go Studio, runtime, browser, log | Mantenuta | Codice e runtime connessi |
| AI e fuzzing/analisi avanzate | Mantenuta | Nessun nascondimento indiscriminato; richiedono limitazioni concrete per diventare sperimentali |
| PDF e firme | Accesso da file mantenuto integralmente | Nascosta solo la voce autonoma in Home/sidebar/ricerca; import PDF e apertura dal progetto IDE usano l'editor completo |
| Arcade | Nascosto dall'Hub | Codice e giochi conservati; logo statico |
| LaTeX | Nascosto dalla navigazione | Fuori dal perimetro centrale v1; codice e dati conservati |
| Kubernetes/OpenShift Studio | Nascosto dalla navigazione | Integrazioni di cluster da collaudare; i target remoti dell'IDE non vengono eliminati |
| Plugin manager/marketplace/WASM | Nascosto dalla navigazione e dalle impostazioni | Nessun cambio alla compatibilità dei plugin già installati; temi/template locali mantenuti |
| Collaborazione realtime | Beta opt-in | Visibile con Show experimental features, disattivato di default; badge Beta nella sidebar |
| Git | Essenziali mantenuti | Diff, stage, commit, branch, push/pull, merge e risoluzione conflitti; rebase/cherry-pick drag actions nascoste |
| IDE Java/altri linguaggi | Rimandato | Il registry corrente registra solo Go; piattaforma multilanguage conservata |

## Implementazione e prove

- [x] Gate unico `V1_HIDDEN_FEATURES` in featureRegistry; applicato a sidebar, command palette e Search Everywhere.
- [x] Home: candidati e tile personalizzate rispettano il gate senza cancellare il layout salvato.
- [x] Rimossi ingresso Arcade e azione del logo; sorgenti conservati.
- [x] Plugin manager e relativo toggle tolti dalle impostazioni; configurazioni preesistenti conservate.
- [x] Collaborazione opt-in sperimentale con badge Beta.
- [x] Apertura PDF dall'IDE collegata al medesimo PdfEditorPanel, anche nella finestra Go Studio separata; pannelli mantenuti montati per preservare il lavoro.
- [x] Lettura PDF del progetto limitata a 100 MiB, con confine del progetto e symlink verificati; nessuna modifica al file originale.
- [x] Test automatico: strumenti rimandati invisibili anche con lab attivi; PDF importato conserva i byte.
- [x] Test Go: PDF più grande del limite dei documenti testuali, header invalido e file fuori progetto.
- [ ] Collaudo desktop: drag/drop PDF, apertura dall'albero IDE e finestra separata; annotazioni, moduli, firma, salvataggio e riapertura.
- [ ] Collaudo Home con layout salvato contenente strumenti nascosti, ricerca globale e Search Everywhere.
- [ ] Collaudo collaborazione con opzione sperimentale off/on, due computer, conflitti e riconnessione.
- [ ] Collaudo Git: branch, push/pull, merge, conflitti; nessun ingresso rebase/cherry-pick tramite drag.

Il gate riguarda la scoperta delle funzionalità, non l'eliminazione dei dati: i router file e gli opener di compatibilità restano disponibili. Nessuna migrazione del workspace e nessuna cancellazione di codice. Funzioni AI, PDF e progetti già salvati conservano i formati esistenti.

## Criteri di riattivazione

- [ ] LaTeX: scegliere un perimetro documentale, collaudare import/export e packaging TeX per le piattaforme supportate.
- [ ] Kubernetes/OpenShift: matrice cluster/versioni, autenticazione, RBAC, timeout e riconnessione; distinguere operazioni di lettura e modifiche.
- [ ] Plugin marketplace/WASM: contratto pubblico versionato, compatibilità, permessi, installazione/aggiornamento/rimozione e test dei moduli installati.
- [ ] Collaborazione stabile: due macchine reali, disconnessione/ripresa, permessi, conflitti e integrità del salvataggio.
- [ ] Git avanzato: preview e recupero verificati per rebase/cherry-pick prima di ripristinare gli ingressi UI.
- [ ] Altri linguaggi: adapter completo, debug/toolchain/editor verificati; evitare ingressi a implementazioni incomplete.
- [ ] Arcade: valutare una distribuzione/accesso separato dal workflow professionale.

## Versioning e gate della v1 ufficiale

La versione installata rimane beta finché il rilascio non è verificato. Seguire `docs/RELEASE.md` e `docs/V1-CHECKLIST.md`: beta → eventuale v1.0.0-rc.N → v1.0.0, senza riutilizzare tag pubblicati.

- [ ] CI e pacchetti Windows/Linux/macOS del commit candidato verdi.
- [ ] Installer, aggiornamento firmato, sostituzione, rollback e conservazione dei dati verificati su installazioni reali.
- [ ] Smoke test del perimetro stabile e PDF completati sulle piattaforme dichiarate supportate.
- [ ] Changelog e note v1 dichiarano chiaramente beta opt-in e funzionalità rimandate.
- [ ] Solo dopo i gate: versione finale, commit candidato, tag e pubblicazione v1.0.0.


## Icona nativa Windows e palette

- [x] Ripristinato il logo nativo originale Windows bianco/nero secondo la skin.
- [ ] Colorazione nativa secondo palette disattivata dopo la regressione segnalata nella taskbar: verificare visivamente forma, trasparenza e colore prima di riattivarla.
- [x] Cambi skin coalescenti: viene applicata la modalità più recente senza una coda di aggiornamenti.
- [x] Test Windows con HWND reale: icone piccola/grande ricevute, cambio skin e creazione colore; build e budget startup passati.
- [ ] Verifica visiva nella taskbar con l'app compilata: skin bianca/nera, palette custom, DPI e finestre separate.
- [ ] Launcher Linux/Dock macOS: cambio colore palette ancora da implementare; cambio light/dark preesistente conservato.

L'icona aggiornata appartiene all'app in esecuzione. La risorsa dell'EXE e il collegamento pinnato quando l'app è chiusa rimangono statici; Windows può mantenere la propria cache del collegamento.

## Toolbar API compatta

- [x] Body/Headers/Params e toolbar Body sempre visibili: eliminata la scomparsa su hover/focus.
- [x] Workspace/Environments/Hosts con titoli Nothing e colori della palette, linea sottile e focus visibile.
- [x] Tab richieste compatte: barra 40 px, tab 32 px, larghezze e calcolo overflow aggiornati insieme.
- [ ] Verifica visiva nell'app desktop: skin chiara/scura, palette, menu, molte tab, tab pinnate e ridimensionamento.

## Riparazione build 2026-10-11

- [x] Corrette le stringhe Markdown multilinea non terminate nel tooltip dei valori debugger, conservando i valori completi.
- [x] Build frontend (TypeScript + Vite) e budget startup passati: 598602 byte su 650000.

## Audit candidato v1 — 2026-10-11

- [x] Integrato origin/main 1bc2b77 con fast-forward, conservando modifiche locali. CI di questo commit remoto verde (run 38134553058); non certifica il working tree successivo.
- [x] Presente secret GitHub ADOMNIA_UPDATE_SIGNING_KEY (verificato solo il nome, nessun contenuto esposto).
- [x] Preparato build.yml: ZIP updater per tre piattaforme e firma manifest prima della release del tag. Verifica reale in CI ancora aperta.
- [x] Preparata bozza docs/releases/v1.0.0.md con perimetro e limiti.
- [x] Allineati config desktop, fallback Windows e manifest npm alla beta.2 già rilasciata.
- [ ] Cambiare tutti a 1.0.0 solo alla promozione finale.
- [ ] Test installer shell su Linux/macOS: tentativo su Windows fallito per percorsi/host bash incompatibili; non prova un difetto dell'installer.
- [ ] Installer Windows grafico e firma Authenticode: gli script di installazione attuali non equivalgono a Setup/MSI.
- [ ] macOS Developer ID/notarizzazione, installazione e updater su bundle firmato.
- [ ] Verificare ZIP, manifest firmato e download updater dalla release candidata; aggiornamento reale con dati, rollback e finestre IDE.
- [ ] Risolvere i gate desktop della checklist v1 e congelare il commit candidato prima del push/tag.
- [ ] Decidere se i due asset export GIF/MP4 non tracciati appartengono alla release; esclusi dalla preparazione corrente.

- [x] Suite frontend completa: 1357 test/311 file, TypeScript/Vite e startup 598669 byte.
- [x] CI preparata per eseguire test installer sul runner Linux e controllare budget startup.

- [x] Suite Go completa senza timeout (10 minuti per package), inclusi git, goide e updater, e go build ./... su Windows.

## Pubblicazione autorizzata — 2026-10-11

- [x] Versione 1.0.0 impostata nei manifest desktop/npm.
- [ ] Gate nativi precedenti ancora aperti: il tag è richiesto esplicitamente dall’utente e non certifica installer/update/rollback o collaudi desktop.

## README e guida utente — 2026-10-11
- [x] README riscritto sul flusso API, debugger, IDE e studi connessi; CLI/build spostati fuori dal percorso principale.
- [x] Preview demo YouTube cliccabile da 0:38 e screenshot reali selezionati con provenienza documentata.
- [x] Guide pratiche inglese/italiano e link locali verificati; corretti link release e nomi artefatti in INSTALL.md.
- [ ] Rinnovare le catture nella build desktop corrente: screenshot selezionati reali ma precedenti agli ultimi ritocchi toolbar.
