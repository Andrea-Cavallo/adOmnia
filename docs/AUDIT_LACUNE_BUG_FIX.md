# Audit lacune, bug e fix prioritari

Data audit: 2026-05-21  
Scope: backend Go/Wails, HTTP sidecar, storage, plugin/runtime, frontend React/TypeScript, UX prodotto.  
Verifiche eseguite: `npm run build` in `frontend/` OK; `go test ./...` OK, ma il repo non contiene test reali.

## Legenda checklist

- [ ] 🔴 **P0 / Critico** - blocca affidabilita, sicurezza o promessa core del prodotto.
- [ ] 🟠 **P1 / Alto** - impatta workflow reali, fiducia utente o stabilita percepita.
- [ ] 🟡 **P2 / Medio** - migliora coerenza, manutenibilita o polish prodotto.
- [ ] 🟢 **Quick win** - intervento piccolo ad alto ritorno operativo.

## Sintesi esecutiva

adOmnia compila e il backend e' molto ampio, ma il prodotto ha alcuni rischi strutturali: il client HTTP core usa ancora `fetch` dal renderer, molte impostazioni sono salvate ma non applicate, il sidecar locale espone endpoint potenti con CORS aperto, e parecchi pannelli frontend sono monoliti difficili da stabilizzare. La priorita non e' aggiungere feature: e' chiudere i buchi tra promesse del prodotto e comportamento reale.

## P0 - Fix urgenti

### ☑ 🔴 P0-01 - Sidecar locale controllabile da qualunque origine web

Evidenza: `server.go:174-184` imposta `Access-Control-Allow-Origin: *` su tutti gli endpoint del sidecar. Gli endpoint includono storage, vault encrypt/decrypt/import/export, proxy start/stop, mock start/stop, database query, folder diff e strumenti di rete.

Impatto: un sito web esterno visitato dall'utente potrebbe tentare richieste verso `127.0.0.1:<porta>`. La porta e' casuale, ma una scansione locale da browser e' realistica. Anche senza cookie, alcuni endpoint non richiedono autenticazione o token anti-CSRF.

Fix consigliato:
- rimuovere CORS wildcard di default;
- accettare solo Origin Wails/app atteso o nessun Origin;
- introdurre un token di sessione generato all'avvio e passato dal frontend Wails al sidecar;
- applicare `http.MaxBytesReader` sugli endpoint POST.

### ☑ 🔴 P0-02 - Client HTTP core non rispetta la promessa "desktop, no browser limits"

Evidenza: `frontend/src/lib/sendRequest.ts:43-49` invia le richieste con `fetch` dal renderer. OAuth2 usa ancora `fetch` diretto in `sendRequest.ts:128-132`.

Impatto prodotto: l'HTTP client resta soggetto a CORS, limiti header/cookie del browser, impossibilita pratica di mTLS/JKS, `skipCertVerify`, max redirect reale, cookie jar controllato e diagnostica TLS. Questo contraddice le promesse in README/SOUL: "no header restrictions", enterprise/legacy first-class, desktop API tool.

Fix consigliato:
- spostare l'esecuzione HTTP in Go con binding Wails o endpoint sidecar autenticato;
- usare Go `http.Client` configurabile per timeout, redirect policy, TLS, client cert, proxy upstream e cookie jar;
- lasciare al frontend solo composer, rendering e history.

### ☑ 🔴 P0-03 - XSS nel Markdown editor

Evidenza: `frontend/src/components/markdown/MarkdownPanel.tsx:31`, `:34` inseriscono `href`, `src`, `alt` e testo link in HTML costruito a regex; `:131` rende con `dangerouslySetInnerHTML`.

Impatto: input markdown locale puo' iniettare attributi HTML o URL `javascript:`. In una WebView desktop questo e' piu grave di una pagina web normale, perche' vive accanto ai binding Wails e allo stato locale.

Fix consigliato:
- usare un parser Markdown con sanitizer o render React nativo senza `innerHTML`;
- bloccare protocolli non sicuri per link/immagini;
- se resta HTML, escapare anche virgolette e attributi.

### ☑ 🔴 P0-04 - Plugin ID consente path traversal con `..`

Evidenza: `plugins.go:121` accetta punti nel plugin id; `plugins.go:301` usa `filepath.Join(pm.pluginDir, manifest.ID)`. L'id `..` o sequenze equivalenti passano il regex attuale.

Impatto: install/uninstall plugin puo' creare o rimuovere directory fuori dalla plugin dir. `UninstallPlugin` chiama `os.RemoveAll(inst.InstallDir)` in `plugins.go:353-354`.

Fix consigliato:
- vietare `.` e `..` come segmenti;
- risolvere `Abs` e verificare che il path finale resti sotto `pm.pluginDir`;
- preferire id tipo `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` o namespace espliciti senza path semantics.

## P1 - Bug prodotto ad alto impatto

### ☑ 🟠 P1-05 - Molte impostazioni UI sono finte o parzialmente scollegate

Evidenza: `frontend/src/stores/settings.ts` definisce impostazioni come `restoreTabsOnStartup`, `confirmBeforeClosingDirtyTabs`, `defaultTimeoutMs`, `maxConcurrentRequests`, `skipCertVerify`, `clientCertPem`, `sendCookiesAutomatically`, `maxRedirects`, `stripAuthOnRedirect`. La ricerca nel frontend mostra quasi solo SettingsPanel/i18n e poco uso runtime.

Impatto: il pannello Settings comunica controllo, ma molti toggle non cambiano il comportamento reale. Questo danneggia fiducia e percezione di stabilita.

Fix consigliato:
- dividere impostazioni in "operative" e "coming soon", oppure nascondere quelle non cablate;
- applicare subito almeno default timeout/follow redirects/default method/mock/proxy defaults;
- aggiungere un test manuale per ogni setting visibile.

### ☑ 🟠 P1-06 - Persistenza tab/history dichiarata ma non implementata

Evidenza: `frontend/src/stores/tabs.ts` mantiene tab e responseHistory solo in memoria. `restoreTabsOnStartup` esiste in settings ma non viene usato. `responseHistory` viene limitata sempre a 100 in `tabs.ts:110`, ignorando `maxResponseHistoryPerTab`.

Impatto: dopo riavvio l'utente perde contesto operativo, nonostante l'impostazione dica il contrario. Per un tool desktop e local-first e' un gap forte.

Fix consigliato:
- persistere tab aperti e activeTabId in bbolt/local storage versionato;
- rispettare `restoreTabsOnStartup` e `confirmBeforeClosingDirtyTabs`;
- salvare response history secondo setting e per tab, non globale fisso a 100.

### ☑ 🟠 P1-07 - Storage backend perde dati silenziosamente su bucket inesistenti

Evidenza: `storage.go:114-120` ritorna `nil` se il bucket non esiste. Lo stesso pattern appare per get/delete.

Impatto: chiamate con typo nel bucket sembrano riuscire ma non salvano nulla. Questo rende bug di persistenza difficili da diagnosticare.

Fix consigliato:
- validare bucket contro allowlist;
- far fallire `storePut`/`storeDelete` su bucket non esistente;
- loggare warning con bucket/key e propagare errore UI.

### ☑ 🟠 P1-08 - Storage PUT non limita dimensione body

Evidenza: `storage.go:303` usa `io.ReadAll(r.Body)` senza limite. Il sidecar ha CORS aperto.

Impatto: possibile memory pressure o blocco UI/backend con payload enormi.

Fix consigliato:
- usare `http.MaxBytesReader` o `io.LimitReader`;
- scegliere limiti per bucket: settings piccoli, workspace piu grande, snapshot dedicato.

### ☑ 🟠 P1-09 - Auto-load demo ignora l'intento dell'utente

Evidenza: `frontend/src/App.tsx:226-233` carica `loadForgeCoreDemo()` quando collections/environments sono vuoti. Non controlla `showWelcomeOnEmptyWorkspace`.

Impatto: un workspace vuoto non resta vuoto. L'utente puo' percepire dati "apparsi da soli", il contrario del controllo local-first.

Fix consigliato:
- mostrare Welcome/Onboarding se vuoto;
- caricare demo solo su azione esplicita;
- rispettare `showWelcomeOnEmptyWorkspace`.

### ☑ 🟠 P1-10 - ErrorBoundary mostra stack trace all'utente

Evidenza: `frontend/src/App.tsx:39-42` renderizza `error.stack`.

Impatto: UX non professionale e possibile esposizione di percorsi locali o dettagli interni.

Fix consigliato:
- mostrare messaggio pulito e pulsanti "reload", "open dev logs";
- mandare stack solo ai Dev Logs locali.

## P1 - Sicurezza e isolamento

### ☑ 🟠 P1-11 - Script utente eseguiti nel renderer senza timeout/sandbox

Evidenza: `frontend/src/components/flows/FlowsPanel.tsx:139-145` usa `new Function`; `frontend/src/components/websocket/WebSocketPanel.tsx:563` usa `new Function` per on-message.

Impatto: loop infinito congela la UI; script malevolo puo' accedere al contesto renderer. Il TODO cita gia' il problema per script Composer.

Fix consigliato:
- eseguire script in Web Worker con timeout;
- esporre solo API `pm.*`/vars serializzate;
- killare worker su timeout e mostrare errore recuperabile.

### ☑ 🟠 P1-12 - Folder diff file endpoint si fida dei root passati dal client

Evidenza: `folderdiff_go.go:134-142` accetta `LeftRoot`, `RightRoot` e `Path`, poi legge file piccoli sotto quei root. Il controllo evita path relativo `..`, ma il root arriva dal client.

Impatto: con sidecar accessibile, un caller puo' chiedere file arbitrari se conosce il path assoluto e un relativo valido.

Fix consigliato:
- associare un `scanId` server-side ai root approvati da `folderDiffHandler`;
- in `/folderdiff/file` accettare solo `scanId + path`;
- scadere gli scanId e non esporre root assoluti se non serve.

### ☑ 🟠 P1-13 - Estrazione JKS passa password su command line

Evidenza: `certtools_go.go:72-95` passa `-srcstorepass`, `-deststorepass`, `-passin pass:<password>` ad altri processi.

Impatto: su alcuni sistemi la passphrase puo' comparire in process list o log di sistema.

Fix consigliato:
- usare file descriptor/stdin/env temporanei dove supportato;
- almeno documentare il rischio nella UI e cancellare output/errori che includono segreti.

## P2 - Coerenza frontend/backend e UX

### ☑ 🟡 P2-14 - Mock/Proxy defaults da Settings non applicati nei pannelli

Evidenza: `MockPanel.tsx:449-450` parte da `9090` e password vuota. La ricerca mostra `defaultMockPort`, `mockServerPassword`, `defaultProxyPort`, limiti body proxy e upstream proxy usati quasi solo nel SettingsPanel/i18n.

Impatto: l'utente modifica Settings ma quando apre Mock/Proxy vede altri valori. Sembra che l'app non salvi.

Fix consigliato:
- leggere `useSettingsStore` in MockPanel/ProxyPanel;
- inizializzare state dai settings al primo mount;
- quando si cambia setting globale, decidere se aggiornare solo nuovi server o anche sessione corrente.

### ☑ 🟡 P2-15 - Pannelli monolitici troppo grandi per qualita prodotto

Evidenza: file frontend piu grandi:
- `UtilsPanel.tsx` 125 KB
- `SettingsPanel.tsx` 57 KB
- `BrokerStudioPanel.tsx` 49 KB
- `ProxyPanel.tsx` 42 KB
- `WebSocketPanel.tsx` 39 KB
- `HarViewerPanel.tsx` 36 KB
- `MockPanel.tsx` 33 KB

Impatto: bug UX piccoli diventano rischiosi, rendering e stato si intrecciano, difficile rifinire coesione visuale.

Fix consigliato:
- spezzare per feature/state hook, non per estetica;
- iniziare da `UtilsPanel` e `SettingsPanel`;
- mantenere API interna semplice: `PanelShell`, `Toolbar`, `ResultPane`, hooks per side effects.

### ☑ 🟡 P2-16 - Bundle iniziale ancora pesante

Evidenza build: `assets/index-*.js` circa 831.76 KB, gzip 200 KB. Alcuni pannelli sono chunk separati, ma molta logica resta nel main.

Impatto: startup percepito peggiore, specialmente su desktop vecchi.

Fix consigliato:
- lazy-load piu pannelli tramite route/rail;
- spostare demo workspace pesante e utilita non core fuori dal chunk iniziale;
- misurare con `VITE_ANALYZE=1`.

### ☑ 🟡 P2-17 - Binding Wails duplicati e potenzialmente stale

Evidenza: ci sono binding sotto `frontend/wailsjs/...` e una copia sotto `frontend/src/wailsjs/...`; gli import TS usano `@/wailsjs` o `../wailsjs`, quindi la copia sotto `src` e' quella compilata.

Impatto: una rigenerazione Wails puo' aggiornare `frontend/wailsjs` ma non `frontend/src/wailsjs`, lasciando il frontend su binding vecchi.

Fix consigliato:
- scegliere una sola directory canonical;
- aggiornare alias/import in modo coerente;
- documentare il comando di generazione binding.

### ☑ 🟡 P2-18 - SOAP forza il tema Win95 quando si entra nel pannello

Evidenza: `frontend/src/App.tsx:136-150` applica `builtin-win95` quando `activeRail === 'soap'`.

Impatto: effetto sorpresa e rottura della coesione visuale. Puo' essere simpatico come skin, ma non deve cambiare pannello in automatico in un prodotto professionale.

Fix consigliato:
- rimuovere switch automatico;
- offrire la skin Win95 come scelta utente nel theme panel.

### ☑ 🟡 P2-19 - Stato mock duplicato tra localStorage e backend

Evidenza: `MockPanel.tsx:454-490` salva endpoint in `localStorage`; `record_replay.go:127-133` salva config mock in bbolt bucket `mock/config`. HAR/Browser/Template scrivono anche `adomnia.mock.endpoints`.

Impatto: mock creati da record/replay/backend possono non coincidere con quelli visibili nel pannello; import/export workspace rischia di non rappresentare tutto.

Fix consigliato:
- definire un solo owner dello stato mock;
- preferire bbolt/workspace con migrazione localStorage;
- notificare frontend dopo record/replay per refresh.

### ☐ 🟡 P2-20 - Nessun test reale sui flussi critici

Evidenza: `go test ./...` restituisce solo `[no test files]`. Frontend ha solo build TypeScript.

Impatto: regressioni su import/export, variable substitution, mock matching, proxy replay, vault e workspace non vengono catturate.

Fix consigliato product-first:
- pochi test end-to-end mirati, non coverage massiva;
- target iniziali: `substVars`, `parseCurl`, Postman import, workspace roundtrip, mock path matching, vault encrypt/decrypt, proxy rule matching.

## Seconda passata - finding aggiuntivi

### ☑ 🔴 P0-21 - Persistenza core rotta: bucket bbolt mancanti

Evidenza: `storage.go:29-34` crea solo i bucket `workspace`, `history`, `mock`, `proxy`. Il frontend pero' salva in bucket non creati:
- `frontend/src/stores/collections.ts:6`, `:177` usa `collections/all`;
- `frontend/src/stores/environments.ts:6`, `:53` usa `environments/all`;
- `frontend/src/components/database/DatabasePanel.tsx:39`, `:183`, `:201`, `:259`, `:285` usa `database/*`.

Il problema e' amplificato da `storage.go:114-120`: se il bucket non esiste, `storePut` ritorna successo senza scrivere nulla.

Impatto: collezioni, ambienti e preset/storia/favoriti database possono non persistere tra riavvii pur mostrando UI di salvataggio riuscito. Questo e' un bug product-critical per un'app local-first.

Fix consigliato:
- aggiungere bucket `collections`, `environments`, `database`, e qualsiasi altro bucket usato dal frontend;
- far fallire `storePut` se il bucket non esiste;
- aggiungere test Go per `StoragePut("collections","all",...)` seguito da `StorageGet`;
- migrare eventuali dati gia' salvati sotto `workspace/v2`.

### ☑ 🔴 P0-22 - Workspace nominati non caricano il workspace selezionato

Evidenza: `workspace_go.go:84-95` salva metadata sotto `ws/<name>`, ma lo stato reale viene sempre salvato in `workspace/v2` a `workspace_go.go:71`. `workspaceLoadHandler` in `workspace_go.go:105-112` ignora il nome e carica sempre `workspace/v2`. Il frontend chiama `/workspace/load` senza nome in `WorkspacePanel.tsx:91-97`.

Impatto: la lista mostra workspace multipli, ma tutti puntano di fatto all'ultimo stato globale salvato. Eliminare un workspace (`workspace_go.go:121-122`) elimina solo il metadata `ws/<name>`, non lo stato. E' una feature apparentemente completa ma semanticamente falsa.

Fix consigliato:
- salvare lo stato in `workspace/ws-state/<id-or-name>`;
- far accettare a `/workspace/load?name=...` il workspace richiesto;
- separare metadata e payload;
- rendere delete atomico su metadata + payload.

### ☑ 🔴 P0-23 - Import drag-and-drop `.adomnia` perde quasi tutto tranne le collection

Evidenza: `App.tsx:292-328` promette drop di `.json/.yaml/.adomnia`, ma usa `importCollectionsFromText(text)` e poi importa solo `result.collections`. Non applica ambienti, active env, mock config, proxy config, flows, settings o workspace metadata.

Impatto: l'utente trascina un workspace `.adomnia` aspettandosi un ripristino completo, ma ottiene solo collection. Per un prodotto local-first/versionabile, questo e' un buco nel workflow di import/export.

Fix consigliato:
- distinguere "collection import" da "workspace import";
- se il file e' `.adomnia` o `format: adomnia-workspace`, mostrare conferma e applicare tutto lo stato;
- fare pre-scan segreti prima di import/export.

### ☑ 🟠 P1-24 - Pre-request/post-response/tests sono editabili ma non eseguiti

Evidenza: `ScriptsEditor.tsx` salva `pre`, `post`, `tests`, e `collectionTransfer.ts` importa script Postman, ma `MainArea.tsx:147-153` chiama direttamente `sendRequest(...)`; `sendRequest.ts` non esegue `request.scripts`; `runnerEngine.ts` valuta solo `request.assertions`.

Impatto: una delle feature core mostrate nel Composer e importate da Postman non produce effetti. `pm.environment.set(...)` nel placeholder non funziona.

Fix consigliato:
- implementare runtime script in Worker con timeout;
- eseguire pre-script prima della sostituzione variabili o con API esplicita;
- eseguire tests/post dopo response e mostrare risultati accanto alle assertions;
- se non pronto, marcare il tab Scripts come "draft" o nasconderlo.

### ☑ 🟠 P1-25 - SOAP Studio e OAuth2 restano bloccati da browser/CORS

Evidenza: `SoapPanel.tsx:79` fa fetch WSDL da URL nel renderer; `soapClient.ts:396-401` invia SOAP con `fetch`; `sendRequest.ts:128-132` fa token request OAuth2 con `fetch`.

Impatto: SOAP/WSDL e OAuth2 enterprise falliscono contro endpoint senza CORS, proprio dove un desktop tool dovrebbe eccellere. Anche qui la promessa "desktop, enterprise/legacy first-class" non e' rispettata.

Fix consigliato:
- spostare WSDL fetch, SOAP send e OAuth2 token exchange nel backend Go;
- aggiungere TLS/mTLS/proxy/timeout condivisi con il nuovo HTTP engine backend.

### ☑ 🟠 P1-26 - Theme system ha due owner che si pestano i piedi

Evidenza: `App.tsx:98-118` applica builtin dark/light e chiama `setActiveThemeId`; `ThemeProvider.tsx:66-109` carica e applica temi. Inoltre `App.tsx:136-150` forza `builtin-win95` sul rail SOAP.

Impatto: temi custom o importati possono essere sovrascritti quando cambia `appearance.theme` o rail. Il comportamento percepito diventa casuale: l'utente seleziona un tema, poi un altro effect lo cambia.

Fix consigliato:
- rendere `ThemeProvider` l'unico owner dell'applicazione CSS variables;
- separare "mode dark/light" da "activeThemeId";
- rimuovere lo switch automatico Win95 dal pannello SOAP.

### ☑ 🟠 P1-27 - Browser debug usa porta/profilo fissi e non pulisce il profilo temporaneo

Evidenza: `browser_debug.go:90-95`, `browser_debug_discover.go:178-183` e `:471-476` usano `--user-data-dir=%TEMP%/adomnia-debug-profile`; la porta CDP base e' fissa (`cdpDebugPort`, usata in `browser_debug.go:91` e discover su `:496`).

Impatto: sessioni concorrenti o crash lasciano profilo sporco, lock del browser, estensioni/stato contaminati e conflitti porta. Puo' far sembrare instabile una delle feature distintive del prodotto.

Fix consigliato:
- generare profilo temporaneo per sessione;
- memorizzare path e rimuoverlo su stop/shutdown;
- scegliere porta libera o rendere la porta esplicita nel frontend con stato chiaro.

### ☑ 🟠 P1-28 - WebSocket/SSE sessioni senza limite globale

Evidenza: `websocket_client.go:60` usa `sync.Map` globale per sessioni; `wsConnectHandler` crea sessioni senza cap in `websocket_client.go:188-195`. Pattern analogo esiste per stream/polling nei pannelli frontend.

Impatto: reconnect, errori UI o chiamate esterne al sidecar possono accumulare connessioni e goroutine. Su app desktop lunga-sessione e' un rischio di degrado progressivo.

Fix consigliato:
- limite massimo sessioni per tipo;
- reap automatico sessioni inattive;
- endpoint status/list/close-all per cleanup;
- cleanup su shutdown app.

### ☑ 🟡 P2-29 - Proxy Map Remote probabilmente non riscrive i glob

Evidenza: il match usa `matchesGlob(targetURL, rule.Pattern)`, ma la riscrittura fa `strings.Replace(targetURL, rule.Pattern, rule.Replacement, 1)` in `proxy.go:360-363` e `:569-572`. Se il pattern contiene `*`, la stringa letterale non esiste nell'URL, quindi non cambia nulla.

Impatto: un utente configura `https://api.prod/* -> https://api.stage/*`, vede il match ma la request puo' andare comunque al target originale.

Fix consigliato:
- implementare rewrite con cattura wildcard o regex esplicita;
- aggiungere preview "from -> to" nel pannello prima di salvare;
- testare pattern con `*`.

### ☑ 🟡 P2-30 - Runner mostra progresso sbagliato con dataset

Evidenza: `runnerEngine.ts:58` calcola `totalSteps = requests.length * config.iterations`, ma il loop reale include anche `dataset.length` (`runnerEngine.ts:67-76`).

Impatto: progress bar e stato runner mentono quando si usa CSV/JSON dataset, proprio una feature product-facing.

Fix consigliato:
- `totalSteps = requests.length * config.iterations * dataset.length`;
- aggiungere test con 2 request, 3 iterazioni, 4 righe dataset.

### ☑ 🟡 P2-31 - Parser CSV dataset troppo fragile

Evidenza: `runnerEngine.ts:182-191` fa `split(',')`, quindi rompe campi quotati con virgole, newline, escape quote.

Impatto: dataset reali esportati da Excel/Postman possono essere importati male senza errore visibile.

Fix consigliato:
- usare parser CSV piccolo e locale o implementare state machine RFC4180;
- mostrare preview righe/colonne e warning su righe malformate.

### ☑ 🟡 P2-32 - Source/docs hanno mojibake diffuso

Evidenza visibile in molti file letti: `CLAUDE.md`, `docs/TODO.md`, commenti e stringhe UI mostrano sequenze mojibake comuni documentate dallo script di validazione.

Impatto: polish percepito basso, localizzazione italiana compromessa, rischio che testi UI/documentazione sembrino corrotti nel prodotto.

Fix consigliato:
- normalizzare encoding a UTF-8;
- correggere docs e stringhe utente;
- aggiungere check semplice che segnali caratteri mojibake comuni.

## Quick wins consigliati

- [x] 🟢 QW-01 - Fixare immediatamente `storeBuckets` e far fallire `storePut` su bucket sconosciuti.
- [x] 🟢 QW-02 - Correggere workspace nominati: payload per workspace, load per nome, delete atomico.
- [x] 🟢 QW-03 - Chiudere CORS sidecar con token sessione.
- [x] 🟢 QW-04 - Spostare HTTP send in Go o creare un endpoint `/request/send` autenticato.
- [x] 🟢 QW-05 - Disattivare/nascondere settings e Scripts non cablati.
- [x] 🟢 QW-06 - Fixare Markdown sanitizer.
- [x] 🟢 QW-07 - Validare plugin ID e path finale.
- [x] 🟢 QW-08 - Rendere bbolt unico owner di mock config.
- [x] 🟢 QW-09 - Implementare import `.adomnia` completo o rinominare il drop in "Import collections".
- [x] 🟢 QW-10 - Spezzare `UtilsPanel.tsx` in moduli (estratti FileDropZone, RegexTester, HmacTool, DockerGenerator; ridotto da 2237 a 1580 righe).

## Note di verifica

- `node scripts/check-mojibake.mjs` passa (ultima verifica: 2026-05-21, fix P2-32).
- `npm run build` passa (ultima verifica: 2026-05-21).
- `go test ./...` passa (ultima verifica: 2026-05-21).
- `bash release.sh` passa e genera `build/bin/adOmnia.exe` (49.26 MB); exe avviato e processo verificato vivo.
- Fix verificati: P0-01 (sidecar token + CORS allowlist, inclusi stream EventSource con token query), P0-03 (Markdown URL/attribute sanitization), P0-21/QW-01 (bucket bbolt reali + test), QW-08 (mock endpoint store su bbolt), P2-32 (checker mojibake + pulizia repo).
- Fix verificati 2026-05-22: P0-22 (workspace_go.go gia' corretto: save su ws-state/name + v2 fallback, load per nome), P0-23/QW-09 (import drag&drop ripristina ora anche websocket state; App.tsx e WorkspacePanel.tsx aggiornati), P1-24 (executeRequest.ts gia' esegue pre/post/tests scripts), P1-25 (SoapPanel usa ExecuteHTTP Go, OAuth2 usa ExecuteHTTP Go), P1-27 (browser_debug.go usa gia' os.MkdirTemp + findFreePort), P1-28 (websocket_client.go ha gia' maxWSSessions=20 + idle timeout), P2-17 (frontend/src/wailsjs e' canonical; frontend/wailsjs e' solo backup generato), P2-18 (SOAP Win95 auto-switch rimosso da App.tsx), P2-19 (MockPanel carica da bbolt con migrazione one-shot da localStorage), P2-29 (proxy_traffic.go implementa globRewrite con wildcard capture), P2-30 (totalSteps = requests * iterations * dataset.length corretto), P2-31 (CSV parser RFC 4180 compliant).
- P2-15/QW-10 chiuso 2026-05-22: FileDropZone, RegexTester, HmacTool, DockerGenerator estratti in file separati; UtilsPanel.tsx ridotto da 2237 a 1580 righe.
