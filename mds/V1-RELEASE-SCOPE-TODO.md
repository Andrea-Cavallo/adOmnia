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

- [x] Skin e palette aggiornano le icone native delle finestre Windows (WM_SETICON, 16/32 px), incluse le anteprime colore.
- [x] Colori rapidi coalescenti e una sola coppia di handle custom: nessuna cache illimitata durante lo slider.
- [x] Test Windows con HWND reale: icone piccola/grande ricevute, cambio skin e creazione colore; build e budget startup passati.
- [ ] Verifica visiva nella taskbar con l'app compilata: skin bianca/nera, palette custom, DPI e finestre separate.
- [ ] Launcher Linux/Dock macOS: cambio colore palette ancora da implementare; cambio light/dark preesistente conservato.

L'icona aggiornata appartiene all'app in esecuzione. La risorsa dell'EXE e il collegamento pinnato quando l'app è chiusa rimangono statici; Windows può mantenere la propria cache del collegamento.

## Toolbar API compatta

- [x] Body/Headers/Params e toolbar Body sempre visibili: eliminata la scomparsa su hover/focus.
- [x] Workspace/Environments/Hosts con titoli Nothing e colori della palette, linea sottile e focus visibile.
- [x] Tab richieste compatte: barra 40 px, tab 32 px, larghezze e calcolo overflow aggiornati insieme.
- [ ] Verifica visiva nell'app desktop: skin chiara/scura, palette, menu, molte tab, tab pinnate e ridimensionamento.
