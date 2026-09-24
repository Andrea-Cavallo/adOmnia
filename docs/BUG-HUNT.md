# a0: Bug Hunt — Deploy del venerdì

**Stato:** v0.9.20 — movimento e percorsi platform collegati.

## Developer Desk — 2026-09-24

Corsa con accelerazione progressiva, frenata e controllo in aria separati. Spazio premuto: salto alto; rilascio anticipato: salto basso. **C scivola a terra, C → Spazio conserva lo slancio in un salto lungo**. La scivolata abbassa a0 ma non rende invulnerabili; X/Shift rimane lo scatto.

Tenere Spazio quando si atterra su un nemico produce un rimbalzo alto; senza pressione il rimbalzo è basso. I nemici diventano appoggi del percorso: bug a terra, bug sulla prima pila, libri a quote diverse, corazzato e flyer conducono al ramo alto facoltativo, con pavimento sicuro sotto.

Livello di 6020 px. Gremlin e Phantom attraversabili; solo Brute chiude l'arena 5020–5960. Salto/schianto fisico, carica lunga e recupero leggibile. Checkpoint 1090/3130/4960; Hotfix 5810; uscita 5900. Sagome dei nemici comuni distinte dai tre mostri; rimosso l'accessorio arma sovrapposto ad a0.

622 test frontend passati, inclusi 120 Bug Hunt; build e TypeScript passati. Verifica browser di scivolata, salto lungo e controlli. Da completare una partita umana integrale per tarare divertimento e difficoltà. Record v6 offline, preferenze accessibilità compatibili con le chiavi precedenti; nessuna migrazione del workspace.

## Storico — developer world v0.9.19

- Tre ambienti riconoscibili: Buggy Dev Desk (21 nemici), Production Datacenter (17), Legacy Dimension (14, oltre ai cloni evocati).
- Precisione su tasti instabili, ventole/ascensori/pod e fuga dall'overheat, poi lezioni di gravità/offline/cloni.
- Monolith: 6 segmenti, 3 fasi, 3 moduli da distruggere. GRAVITY_OVERRIDE annunciato per 3 secondi, attivo per 5, soffitto giocabile e zona sicura a gravità normale vicino al boss.
- Preferenze locali `developer-world.v5`: solo audio/effetti migrano da v4/v3/v2/v1; vecchie chiavi e record conservati.
- Verifica desktop Windows avviata con `wails3 task dev`; revisione visiva anche delle scene datacenter e boss. Il precedente blocco della CLI è risolto.
- Resta utile una partita umana completa per tarare difficoltà e ritmo. Le verifiche automatiche isolano geometria, combattimenti e regole, non misurano il divertimento.
- Dettagli: [v0.9.19](releases/v0.9.19.md).

## Storico v0.9.18 — 2026-09-22: personalità, Localhost esteso e tre vite

**Prossimo passo:** partita completa umana nel desktop per tarare la campagna con tre vite totali. Le regole qui sotto sostituiscono salute e tentativi illimitati dello storico.

- [x] a0 segue con lo sguardo nemici/proiettili vicini; sorriso e sopracciglia reagiscono al pericolo senza cambiare la hitbox.
- [x] Atterraggio elastico proporzionale all'impatto, recupero dell'equilibrio sul bordo, braccia alzate al checkpoint. Effetti delicati mantengono le pose ma eliminano oscillazioni e deformazioni.
- [x] Fumetti IT/EN: «Sul mio PC funzionava», «Salvato. Respiriamo», «Era tutto calcolato». Posizionati sopra i popup per evitare sovrapposizioni.
- [x] Localhost da 3220 a 4820 px, da 8 a 15 nemici, 21 bit aggiuntivi (156 nella campagna), piattaforme e ancore aggiuntive; Hotfix a x=4590 e uscita a x=4700. Gateway/Production conservano geometria e uscita originali.
- [x] Tre cuori in alto, tre vite per tutta la campagna. Colpo/caduta consuma un cuore; checkpoint e cambio ambiente non ricaricano. A zero la simulazione si ferma e si può ricominciare la campagna o uscire. Una sconfitta non salva record di vittoria.
- [x] Record separati in `adomnia.bughunt.preferences.three-lives.v4`: migra soltanto audio/effetti dalla prima chiave presente tra arcade.v3, campaign.v2 e v1. Vecchie chiavi conservate; nessuna modifica al workspace `.adomnia`.
- [x] 560 test frontend verdi (58 Bug Hunt); controlli su tre perdite, restart, vite tra ambienti, percorso Localhost completo, espressioni/pose e migrazione preferenze. TypeScript e build frontend passati; `go build ./...` e `go test ./...` passati.
- [x] Anteprima browser reale: menu e cuori; scena temporanea per pose, rewind, tratto esteso e game over. Scena rimossa dopo la verifica. Questi controlli non sostituiscono una partita umana completa.
- [ ] Prova desktop: `wails3 task dev` non avviabile in questo ambiente perché il comando Wails 3 non è installato (neppure in `~/go/bin`).


## Ripresa attiva — v0.9.17, boss battibile e piattaforme vere

- [x] **Bug bloccante corretto:** la lastra dell'arena a x=2872 stava sopra il nucleo e intercettava la caduta che lo danneggia. Il boss era imbattibile in v0.9.16. Lastra spostata a x=2944.
- [x] Test di regressione: nessuna piattaforma puo' invadere i 170 px sopra il nucleo. Verificato che fallisce sulla geometria vecchia prima di accettarlo.
- [x] Piattaforme ridisegnate come telai: rail luminoso, tappi, tracce di circuito, finestrella con glifo per ruolo (`>>>`, `</>`, `<   >`, `/ / /`), accento neon per ruolo.
- [x] Sottostruttura del terreno: baie di ventilazione con spie, bulloni, piloni e cavi. Supporti antigravita' pulsanti sulle fluttuanti; soffitto dell'arena = stesso slab capovolto.
- [x] Menu iniziale in tre blocchi: obiettivo, griglia comandi con tasti disegnati, pannello VITE con la regola. Pillola HUD `VITE ♥♥♥ 3`, rossa all'ultima vita.
- [x] Verifica visiva in browser: ha trovato il terreno "senza peso" dopo la rimozione dei rettangoli, da cui la sottostruttura.
- [x] 553 test frontend (113 file, 51 del gioco), `tsc`, build, `go build ./...` e `go test ./...` passati.
- [ ] Prova umana del boss ora che e' battibile: tarare le tre fasi.

**Stato precedente (v0.9.16):** pistola di debug, nemici reattivi e Legacy Monolith che lancia buste SOAP e riscrive una regola per fase.
**Ultimo aggiornamento:** 2026-09-19 (combattimento e boss).
**Prossimo passo:** partita umana completa. Tarare a mano cadenza delle torrette, velocita' dei chaser e durata delle fasi del boss.

## Ripresa attiva — v0.9.16, si spara e il boss cambia le regole

- [x] Pistola di debug su **F** (tenuta premuta): 640 px/s, cooldown 0,22 s, rinculo a terra; abbatte anche le buste SOAP in volo (+25 punti).
- [x] Nemici **chaser** (si svegliano a 320 px, caricano a 196 px/s, non escono dalla banda di pavimento solido) e **turret** (mirano a 430 px, sparano ogni 1,85 s con mira tratteggiata e tre tacche di carica).
- [x] Corazza visibile: alcuni bug reggono due colpi; lo stomp non letale da' 0,45 s di invulnerabilita' ad a0.
- [x] Boss che riscrive le regole: annuncio 1,7 s poi `sudo reverse gravity` / `fork() -> 3 cloni` / `systemctl stop platforms`. Regole locali all'arena, si spengono con la fase, congelabili col Breakpoint.
- [x] Legacy Monolith ridisegnato come torre: faccia CRT che segue a0, stack legacy, post-it, due pugni che lanciano buste SOAP ad arco. Onda a terra rimossa.
- [x] Soffitto dell'arena e tre lastre `arena` per le fasi gravita'/offline.
- [x] Segreto piu' facile: un giro completo del logo apre l'invito "vuoi giocare?"; niente tre giri, niente attesa di 30 secondi.
- [x] Verifica visiva reale in browser (Chrome headless via CDP): hub, intro, Localhost, arena del boss, volata di buste, annuncio e gravita' invertita.
- [x] Quattro difetti di impaginazione trovati dalla verifica visiva e corretti: annuncio duplicato sulla faccia, riga di stato sopra lo stack legacy, graffito sul terminale del checkpoint, `aO` che si leggeva `90` a testa in giu'.
- [x] 552 test frontend (113 file, 50 del gioco), `tsc`, build, `go build ./...` e `go test ./...` passati.
- [ ] Prova umana: cadenza torrette (1,85 s), velocita' chaser (196 px/s), durata annuncio (1,7 s) e difficolta' complessiva delle tre fasi.
- [ ] Partita completa nel runtime desktop Wails 3.

## Ripresa attiva — v0.9.15, il pavimento si cancella e il rampino

- [x] Ondata `DELETE` in Production: parte a x=640, 430 px dietro a0, a 176 px/s; si spegne al checkpoint (x=2460) con +400 punti.
- [x] Le piattaforme superate diventano `deleted`: niente collisione, resta il contorno tratteggiato. Chi si ferma perde una vita e l'ondata si azzera.
- [x] Quattro rampe alte nuove nella zona di fuga; il Breakpoint congela anche l'ondata.
- [x] Rampino magnetico su tasto **E**: aggancio al nodo piu' vicino entro 300 px sopra a0, pendolo vero (velocita' radiale annullata, tangenziale conservata), **W**/**S** accorciano e allungano il cavo.
- [x] Rilascio di **E** o **Spazio**: lancio con spinta e scatto ricaricato; lo scatto stacca il cavo. Catena rampino -> lancio -> scatto -> bug senza toccare terra.
- [x] Ancore sopra ogni buco del percorso principale nei tre ambienti (nove in Production); restano facoltative e l'aggancio a vuoto non penalizza.
- [x] Testi IT/EN, pillole HUD, legenda tasti e suggerimenti di ambiente aggiornati.
- [x] 539 test frontend (37 del gioco, 5 nuovi), TypeScript, build di produzione, `go build ./...` e `go test ./...` passati.
- [ ] Prova umana: taratura della velocita' dell'ondata (176 px/s), della portata del rampino (300 px) e della spinta di lancio.
- [ ] Verifica in `wails3 task dev` della nuova tranche.

## Ripresa attiva — v0.9.14, ritmo e incontri

- [x] Scatto ricaricato da ogni colpo diretto su un bug: concatenazioni di rimbalzi e scatti.
- [x] Incontri aggiuntivi con nemici aerei facoltativi; la via principale resta aperta.
- [x] Bonus Rush per ambiente: 6 bit in 8 secondi, +500 punti; nessuna penalita al fallimento, niente farming via morte o rewind.
- [x] Grado finale S/A/B/C, conteggio bonus e punti boss assegnati una sola volta per soglia salute.
- [x] Ultima fase del boss con doppia onda annunciata.
- [x] 32 test del gioco passati nella verifica iniziale di questa tranche.
- [x] 534 test frontend (113 file), inclusi 32 del gioco; TypeScript/build e `go build ./...`, `go test ./...` passati.
- [x] Verifica visiva browser: HUD Bonus Rush, pulsante di passaggio realmente azionato, schermata finale con grado S (stati sintetici in fixture temporanea, record non salvati; fixture rimossa).
- [x] Risolto clipping del canvas con righe/colonne grid `minmax(0,1fr)`; suggerimenti spostati sopra il percorso per non coprire a0.
- [x] `wails3 task dev`: nuova build avviata in WebView2 e Home desktop ispezionata. La partita completa a mano rimane da fare.
- [x] Commit `de2d0ce`, tag annotato `v0.9.14` e push atomico di master + tag su origin completati il 2026-09-17. La pubblicazione dei binari viene eseguita dalla CI del tag.
- [ ] Prova umana del ritmo e della difficolta: il divertimento non e' dimostrato dai test.

## Poteri da sviluppatore — 2026-09-17

Richiesta dell'utente: poteri speciali "fighi" a tema informatico. Supera la voce "abilità" fuori perimetro della specifica iniziale.

| Potere | Raccolta | Effetto |
|---|---|---|
| ↺ **git revert** | cariche (max 3), tasto **R** | Riavvolge ~3 s di movimento in 0,75 s con scia e overlay VHS; invulnerabilità breve all'arrivo. Caduta o morte azzerano la storia: non si può tornare nella buca. |
| ⏸ **Breakpoint** | immediato, 5 s | Ferma il "tempo del mondo": bug (pallino rosso), firewall, piattaforme mobili e boss. a0 si muove normalmente. |
| # **sudo** | immediato, 6 s | Aura root: i bug si cancellano al contatto; spuntoni, firewall e onde del boss non feriscono. Lampeggia nell'ultimo 1,5 s. Non salva dalle buche e non colpisce il nucleo del boss. |
| ♻ **Garbage Collector** | immediato | Onda circolare (raggio 640) che libera tutti i bug raggiunti (`free(0x…)`) e cancella le onde del boss. |

- [x] Stato puro in `powers.ts`, grafica in `powerVisuals.ts`, agganci in `prototype.ts`/`visuals.ts`; `worldTime` separato da `visualTime` per il Breakpoint.
- [x] Quattro chip per ambiente in `level.ts`; revert all'inizio di ogni ambiente, sudo come premio del ramo segreto in Localhost, GC sopra gli spuntoni.
- [x] HUD (cariche R, timer Breakpoint/sudo), legenda tasti, riga nell'intro, testi IT/EN, suoni sintetizzati dedicati.
- [x] 7 test in `powers.test.ts` (29 totali del gioco); i percorsi completi dei tre ambienti restano verdi.
- [x] Browser: ogni potere osservato a schermo. Desktop Wails 3 (build production temporanea con debug port, `main.go` non modificato): gesto segreto, tutti e 4 i poteri in tutti e 3 gli ambienti, R da tastiera, passaggi di ambiente e finale, 75 fps, nessun canvas dopo la chiusura, nessun errore. Chiavi `adomnia.bughunt.*` rimosse dal profilo reale.
- [ ] Taratura a mano: durate (5 s / 6 s), raggio GC e posizioni dei chip.

## Feedback divertimento — tranche precedente

- [x] Menu di passaggio `levelComplete` (coperto da `BugHuntOverlay.test.tsx`).
- [x] Doppio salto e scatto offensivo con ricarica, attraversamento dei firewall (test in `prototype.test.ts`).
- [x] Combo e punteggio senza farming; rampe di lancio e percorsi premio (test in `prototype.test.ts`).
- [x] Nuove mosse e percorsi dei tre ambienti verificati dai test; interfaccia verificata nel desktop insieme ai poteri.

## Checkpoint di ripresa — 2026-09-17

- [x] Collegati tre ambienti con schermata di passaggio; tempo e bit cumulativi, 111 bit univoci, salute ripristinata a ogni nuovo ambiente.
- [x] API Gateway: piattaforme mobili con trasporto del giocatore, firewall OFF/avviso/attivo e bug Retry saltellanti.
- [x] Production: piattaforme instabili (0,8 s prima del cedimento, ripristino a 3,5 s), firewall e checkpoint a x=2500 prima dell'arena.
- [x] Legacy Monolith: avviso 1,3 s, onda a terra, nucleo vulnerabile da 2 a 4,8 s, tre colpi e reset a ogni caduta/morte. Hotfix raccoglibile prima del boss; uscita richiede entrambi.
- [x] Nucleo abbassato a 82 px: colpo verificato con un vero salto in corsa, senza teletrasporto sul bersaglio.
- [x] Sfondi distinti (viola, ciano, rosso), segnali per pericoli, suggerimenti IT/EN, indicatori di avanzamento e finale della campagna.
- [x] Record campagna in `adomnia.bughunt.preferences.campaign.v2`: migrazione solo di audio/effetti dalla v1. Record Localhost conservati nella vecchia chiave, esclusi dal confronto. Nessuna modifica al workspace `.adomnia`.
- [x] 15 test Vitest passati: percorsi fisici dei tre ambienti, piattaforme, firewall, boss, reset, no farming esistente e migrazione preferenze.
- [x] `go build ./...` e `go test ./...` completati con successo.
- [x] TypeScript e build frontend passati; resta il consueto avviso sui chunk grandi dell'app.
- [x] Scene Gateway/Production ispezionate nel browser con fixture temporanea, poi rimossa. Intro della campagna verificata nell'app browser.
- [x] `wails3 task dev` avviato: compilazione e startup WebView2 riusciti, Home desktop verificata. Questa verifica non sostituisce una partita completa nel desktop.
- [ ] Partita completa desktop dei tre ambienti; verifica manuale di passaggi, boss, finale e accessibilita a dimensioni ridotte.
- [ ] Taratura divertimento/difficolta e durata obiettivo 10-15 minuti; musica opzionale e asset definitivi restano rifiniture.

**File da cui ripartire:** `frontend/src/components/bughunt/level.ts` (mappe), `prototype.ts` (fisica/campagna/boss), `visuals.ts` (disegno), `BugHuntOverlay.tsx` e `copy.ts` (UI), `prototype.test.ts` e `preferences.test.ts` (verifiche).
**Riavvio partita:** il pulsante esplicito “Ricomincia campagna” azzera tutta la partita; caduta/morte mantengono bit e Hotfix e riprendono dal checkpoint del livello.
**Nota:** i dati di sviluppo qui sotto datati 2026-09-16 sono lo storico di Localhost; il checkpoint sopra prevale.

## Come riprendere il lavoro

Questo documento è il punto di ripresa del progetto. All'inizio di ogni sessione leggere prima questa sezione e `git status`, poi verificare nel codice le voci già spuntate. Alla fine di ogni sessione:

1. Spuntare `[x]` solo per un risultato presente nel repository e verificato; lasciare `[ ]` per il lavoro non iniziato o incompleto.
2. Aggiornare **Stato attuale**, **Prossimo passo**, **Verifiche e problemi aperti** con data, file toccati, esito delle verifiche e ostacoli concreti.
3. Se una voce è parzialmente svolta, dividerla in una parte completata e una ancora aperta. Non usare una spunta per una decisione di progetto scambiandola per una feature funzionante.
4. Dopo ogni tranche di lavoro, lasciare in cima una singola azione iniziale chiara, così un'altra sessione può ripartire anche se la precedente si è interrotta per limiti di crediti.

## Stato attuale — 2026-09-16 (seconda sessione)

- [x] Letta la proposta allegata e analizzato il punto di integrazione nel repository.
- [x] Ricevuta la reference visiva di a0; copia stabile: [`docs/assets/bug-hunt-a0-reference.png`](assets/bug-hunt-a0-reference.png).
- [x] Definite qui decisioni, perimetro, fasi e criteri di verifica.
- [x] Creato un disegno vettoriale temporaneo di a0 su canvas, riconoscibile a piccola scala dalla reference.
- [x] Localhost giocabile e completo: tutorial a terminali, 37 bit (ramo segreto facoltativo), 3 bug, spuntoni Null Pointer, checkpoint, Hotfix obbligatorio, uscita `BUILD PASSED`, finale con tempo/bit/morti, medaglie e record locale.
- [x] Audio sintetizzato offline (Web Audio, niente asset), mute persistente, "Effetti delicati" (meno particelle, niente scuotimento; default da `prefers-reduced-motion`).
- [x] Integrati overlay caricato solo all'apertura, gesto a tre rotazioni, pressione di 30 secondi e accesso di prova nell'ambiente di sviluppo.
- [x] Verificati entrambi i gesti segreti e la sessione nel runtime desktop Wails 3 (WebView2, build `production`), pilotati via CDP.
- [ ] Prova umana "a sensazione" di salto, velocità, bug e buche (non automatizzabile).
- [x] Implementati i livelli 2 e 3 e il boss (2026-09-17; vedi checkpoint sopra).

**Prossimo passo operativo storico (superato dal checkpoint 2026-09-17):** avviare adOmnia, aprire la Home, fare tre giri del logo (o tenerlo premuto 30 s) e giocare Localhost fino in fondo. Annotare qui cosa non è piacevole (salto troppo alto/basso, corsa, bug che colpiscono alle spalle, buche). Tarare `GRAVITY`, `RUN_SPEED`, `JUMP_SPEED` in `prototype.ts`, poi iniziare API Gateway (fase 2).

**Verifiche e problemi aperti (2026-09-16, seconda sessione):**

- Corretto un bug del gesto: la soglia "movimento > 10 px" era calcolata dal punto di pressione a ogni evento, quindi ripassando vicino al punto di partenza a ogni giro si perdeva progresso e servivano ~3,3 giri. Ora la soglia si aggancia una volta sola (`movedPastThreshold` in `WelcomePanel.tsx`). Misurato: 2,8 giri non aprono, 3,05 giri aprono in entrambe le direzioni.
- Ripristinata l'inerzia del logo (l'altra sessione l'aveva tolta, mentre il tooltip e il tasto Invio promettevano ancora lo slancio): ora gira con slancio e poi si riassesta dritto con animazione dolce. L'inerzia non conta per il gesto.
- i18n: "Caricamento Bug Hunt…", "Rigioca Bug Hunt", "Prova Bug Hunt" passano da `tr()` con traduzioni in `uiI18n.ts`; il test guard `uiI18n.test.ts` era rosso ed è tornato verde. Tutti i testi del gioco (overlay, popup e cartelli sul canvas) seguono la lingua dell'app: italiano e inglese in `frontend/src/components/bughunt/copy.ts`, con la forma inglese come contratto di tipo (una riga mancante non compila).
- Browser (Playwright, vite): nessuna apertura per click, trascinamento breve, 2 giri, avanti-indietro; apertura con 3 giri; pausa con Esc e su blur; resize in pausa; `requestAnimationFrame` a zero in pausa, dopo la chiusura e dopo 6 aperture/chiusure; focus riportato al pulsante di origine; nessun errore JS.
- Desktop Wails 3 (WebView2, build `production` con `--remote-debugging-port` solo in un eseguibile temporaneo, `main.go` non modificato): pressione 30 s apre il gioco (bagliore dopo 4 s), 3 giri in 2,8 s aprono il gioco, 76 fps = refresh del monitor, pausa, uscita e 4 riaperture pulite, nessun errore. Chiavi `adomnia.bughunt.*` rimosse dal profilo reale dopo la prova.
- Decisione motore: **canvas puro**. Il chunk del gioco è 28,7 KB (10,7 KB gzip) caricato con `import()` solo all'apertura; a 76 fps non c'è motivo di adottare Phaser.
- `npx tsc --noEmit` pulito; `vitest` bughunt (7) e i18n verdi.
- Resta: lo sprite definitivo di a0 (il PNG reference ha la scacchiera nei pixel); i due gesti non hanno test automatici nel repo (verificati solo con script e2e esterni).

## Valutazione e identità

L'idea funziona come sorpresa breve: meccaniche familiari, tema di debugging comprensibile e un protagonista già riconoscibile. Va mantenuta separata dai flussi di lavoro professionali: caricamento solo all'attivazione, uscita immediata, nessuna modifica alle collezioni. I pilastri toccati sono **local-first** (gioco e record offline) e **user-extensible** in forma minima (asset e mappe dati locali sostituibili in futuro); l'espansione non giustifica un sistema di plugin nella prima versione. Il rischio di prodotto è spendere troppo su contenuti prima di sapere se il movimento è piacevole.

La reference di a0 definisce testa nera lucida con `a0` bianco e sorriso viola, corpo e arti geometrici viola. È una guida, non uno sprite pronto: prospettiva 3D, dettagli fini e possibile sfondo a scacchi perdono leggibilità in una figura di circa 40–56 pixel. La prima versione userà **geometria 2D netta**, silhouette squadrata, volto leggibile e due o tre toni viola. Non imitare personaggi, livelli, suoni o grafica di altri platform.

## Specifica funzionale della prima versione

- **Avvio:** nella hub, tre giri completi trascinando il logo entro otto secondi oppure pressione continua di 30 secondi. Contare la rotazione netta attorno al centro, con soglia iniziale di movimento, cambi di direzione che sottraggono progresso e limite per salti angolari implausibili. L'inerzia visiva non conta come gesto. Alla fine di un gesto incompleto il logo torna con animazione dolce all'origine. La pressione si annulla su rilascio, perdita del focus e smontaggio della hub; dopo qualche secondo compare un bagliore discreto. Il normale comportamento del logo resta disponibile e il gesto consumato non genera click involontari.
- **Dopo la scoperta:** `Rigioca Bug Hunt` in una sezione secondaria. Lo sblocco è locale e per profilo dell'app; non entra nel formato `.adomnia`.
- **Presentazione:** overlay sull'intera area della finestra, senza fullscreen di sistema. Introduzione breve, tre livelli, pausa e finale. Chiudere ripristina pannello, tab, focus e lavoro precedenti.
- **Controlli:** A/D o frecce, Spazio, Esc. Il menu pausa offre Riprendi, Ricomincia livello, Audio on/off, Esci. Intercettare i tasti solo mentre l'overlay è attivo; impedire che Space e frecce muovano la pagina.
- **Fisica:** movimento e salto ad altezza variabile, coyote time e jump buffer brevi, simulazione a passo fisso, hitbox visibili e coerenti. Gravità e distanze si tarano giocando, non solo dai numeri.
- **Regole:** tre punti salute, invulnerabilità breve dopo danno, caduta = perdita di un punto e ritorno al checkpoint. A zero salute, ripartenza dal checkpoint con salute piena e tentativi illimitati. Ogni livello ha un checkpoint intermedio; quello del terzo è prima del boss. Un Hotfix obbligatorio per livello e una pipeline finale attivabile solo dopo averlo preso. Bit facoltativi aumentano il punteggio; ogni bit contribuisce al massimo una volta per partita, anche dopo morte o retry dal checkpoint.
- **Progressione:** tre mappe disegnate a mano, 10–15 minuti al primo tentativo come obiettivo da validare. Il boss si resetta a ogni nuovo tentativo. Risultato finale: tempo, bit, morti, Rigioca e Torna ad adOmnia. Un record locale può tenere miglior tempo e massimo bit separatamente.
- **Accessibilità minima:** pericoli distinti per forma e animazione oltre che per colore; avvisi prima dell'attivazione; niente flash aggressivi; scuotimento limitato e disattivabile; menu usabile da tastiera; audio disattivabile.
- **Fuori perimetro:** multiplayer, touch, editor, mappe procedurali, inventario, combattimento complesso, classifiche online. (Le abilità sono entrate su richiesta: vedi *Poteri da sviluppatore*.)

## Livelli, per sezioni giocabili

| Livello | Sezioni | Uscita |
|---|---|---|
| 1 · Localhost — Sul mio PC funziona | 1. Pavimento sicuro per movimento e salto. 2. Due buche e piattaforme statiche. 3. Primo bug rosso con spazio per imparare l'attacco dall'alto. 4. Checkpoint. 5. Spuntoni Null Pointer annunciati dalla forma; breve deviazione facoltativa con bit. 6. Hotfix nel percorso principale. | Terminale `BUILD PASSED`; pipeline verde. |
| 2 · API Gateway — Timeout in arrivo | 1. Richiamo di salto e bug base. 2. Pacchetti/piattaforme mobili a ciclo corto. 3. Firewall intermittente con preavviso e zona sicura. 4. Checkpoint. 5. Bug Retry che salta con ritmo leggibile. 6. Percorso bit opzionale più difficile e Hotfix sulla via principale. | Varco `200 OK`. |
| 3 · Production — Chi ha fatto deploy? | 1. Combinazione breve di piattaforme, bug e firewall. 2. Piattaforme instabili con chiaro preavviso. 3. Hotfix obbligatorio. 4. Checkpoint immediatamente prima del boss. 5. Legacy Monolith: impulso a terra annunciato, pausa con punto debole raggiungibile, tre colpi. | Allarmi verdi; «Deploy riuscito. Puoi andare a casa.» Poi «Nuovo ticket: il pulsante è leggermente spostato.» |

Cartelli brevi possono usare «Sul mio computer funzionava», «È solo una piccola modifica», «TODO: sistemare prima della produzione» e «Hai sconfitto il bug. Ora chiudi il ticket». Non fermano il controllo o la lettura del percorso.

## Proposta tecnica coerente col repository

Il progetto usa **Wails 3 + Go + React/TypeScript/Vite**. La hub è `frontend/src/components/layout/WelcomePanel.tsx`: `FidgetLogo` ha già trascinamento e inerzia, quindi va esteso con riconoscimento del gesto, non duplicato. Il logo della rail in `frontend/src/components/layout/Rail.tsx` riporta alla Home e non è il bersaglio del gesto. C'è anche un placeholder easter egg in `frontend/src/components/utils/UtilsPanel.tsx`; si può riusare come accesso secondario dopo la scoperta. Il contenitore globale è `frontend/src/App.tsx`; i pannelli usano `MainAreaRouter.tsx`. Non esiste un motore di gioco in `frontend/package.json`.

Prima scelta per il prototipo: canvas 2D con ciclo `requestAnimationFrame` e fisica a timestep fisso, in un modulo caricato con `import()` solo all'apertura. React controlla overlay e menu, non lo stato di ogni frame. Risoluzione logica 960×540, scala uniforme e bande laterali quando serve. Se il prototipo mostra costi elevati di collisioni, animazioni o gestione livelli, valutare Phaser con una misura reale di bundle, avvio e teardown nel WebView Wails prima di adottarlo. Nessun Go aggiuntivo è necessario per le regole del gioco.

La persistenza può usare chiavi `localStorage` dedicate e versionate per scoperta, audio e record, seguendo i moduli frontend esistenti; non scrivere nei bucket del workspace né leggere richieste o credenziali. Salvare solo dati piccoli, non l'intera partita. Al cambio di versione gestire valore assente o malformato con default sicuri, senza migrazione del formato `.adomnia`. Su blur il gioco si mette in pausa; su uscita si cancellano RAF, timer, listener e audio e si ripristina il focus. Verificare che l'apertura non sovrascriva shortcut globali, che la chiusura non lasci CPU attiva e che più aperture non creino doppie istanze.

## Asset minimi

- [ ] Sprite/sagome 2D originali di a0: idle, corsa, salita/discesa, danno; volto leggibile a scala di gioco.
- [ ] Tileset condiviso: terreno, piattaforme, bordi, checkpoint, pipeline, Hotfix, bit, Null Pointer, firewall e piattaforme mobili/instabili.
- [ ] Due nemici base (bug pattuglia e Retry) con stati essenziali; Legacy Monolith con scudo, avviso impulso e punto debole.
- [ ] Tre sfondi leggeri e differenziati per Localhost, Gateway e Production; HUD, icone salute, pausa e schermata finale.
- [ ] Effetti locali brevi per salto, bit, danno, checkpoint, Hotfix e boss; musica opzionale con mute persistente. Tutti inclusi nel bundle, con licenza compatibile e senza fetch in partita.

## Checklist di sviluppo

### Fase 1 — Prototipo e decisione di fattibilità

- [x] Preparare disegno 2D temporaneo basato sulla reference e un tratto breve di Localhost.
- [x] Implementare movimento, salto variabile, coyote time, jump buffer e collisioni a timestep fisso; copertura delle regole in `prototype.test.ts`.
- [x] Aggiungere buche, piattaforme, un bug calpestabile, tre punti salute, morte e checkpoint; copertura di bug e checkpoint in `prototype.test.ts`.
- [x] Aprire e chiudere il prototipo in overlay; ritorno alla hub verificato nel frontend locale.
- [x] Provare su Wails 3: fluidità, focus, pausa/blur, uscita e apertura ripetuta verificati nel runtime desktop via CDP; resize verificato nel browser.
- [ ] Prova umana dei controlli (sensazione di salto e corsa, morte e checkpoint giocati a mano).
- [x] Decisione motivata: canvas puro (10,7 KB gzip lazy, 76 fps su WebView2).
- [ ] Annotare la taratura dei controlli dopo la prova umana.

### Fase 2 — Gioco completo

- [x] Implementare i due gesti segreti e l'accesso `Rigioca` nella hub; verificati gesti e falsi positivi (browser e desktop).
- [x] Completare Localhost con tutorial, bit, Hotfix e uscita.
- [x] Completare API Gateway con pacchetti, firewall, Retry, checkpoint e uscita.
- [x] Completare Production con piattaforme instabili, checkpoint e boss a tre colpi.
- [x] Implementare introduzione, pausa, riavvio, audio, finale, statistiche e record locali (estesi alla campagna il 2026-09-17).
- [x] Verificare percorsi fisici nel motore dei tre ambienti e regole di boss/progressione/no farming.
- [ ] Confermare la giocabilita completa a mano nel desktop.

### Fase 3 — Rifinitura e rilascio

- [ ] Sostituire gli asset temporanei, completare animazioni ed effetti leggibili senza dipendere dal colore.
- [x] Integrare audio offline, mute persistente e riduzione/disattivazione dello scuotimento.
- [ ] Verificare gestione del focus, scorciatoie, cleanup, resize e dati di adOmnia aperti prima del gioco.
- [ ] Misurare FPS e avvio nel runtime desktop su portatile normale; obiettivo 60 FPS e nessun lavoro continuo a gioco chiuso.
- [ ] Eseguire `cd frontend && npx tsc --noEmit`, `npm run build`, `go build ./...`, `go test ./...` e prova manuale `wails3 task dev`.
- [ ] Aggiornare catalogo funzioni e note di rilascio quando il gioco è effettivamente disponibile.

## Rischi, compromessi e stima

| Rischio | Contromisura |
|---|---|
| La reference 3D perde chiarezza a piccola scala e ha la scacchiera nei pixel | Ridisegnare sprite 2D semplificato e scontornare la figura. |
| L'inerzia di `FidgetLogo` genera false attivazioni | Contare solo movimento reale con puntatore premuto, soglia e rotazione netta; testare normali drag e click. |
| Un overlay blocca scorciatoie o lascia listener dopo la chiusura | Input circoscritto all'overlay, pausa su blur e teardown verificato aprendo/chiudendo più volte. |
| Salti e boss sono formalmente validi ma poco piacevoli | Gate di prova manuale dopo il primo tratto; boss con segnali e finestra vulnerabile misurabili. |
| Un motore terzo aumenta bundle e avvio | Prima misurare canvas puro; integrare Phaser solo se il guadagno giustifica il costo. |

Stima indicativa, da rivedere dopo il prototipo: **sviluppo 12–20 giorni persona** (prototipo 3–5, livelli e sistemi 6–10, integrazione e verifica 3–5); **asset 5–9 giorni persona** (sprite e tileset 3–5, sfondi/UI/audio 2–4). Il tempo degli asset dipende soprattutto dalla qualità delle animazioni richiesta. Il prototipo è il gate: una sua prova negativa richiede ritoccare controlli e collisioni prima di impegnarsi sulle altre mappe.

Developer Desk v0.9.23: module-bearing shelves stay stable, the final objective is a grounded flagged module, and exit graphics distinguish a missing objective from a living guard. Placement and power regression tests cover shields, healing and fall cleanup. Browser rendering checked; native desktop playthrough remains outstanding.
