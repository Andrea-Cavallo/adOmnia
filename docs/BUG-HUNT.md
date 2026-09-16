# a0: Bug Hunt — Deploy del venerdì

**Stato:** Localhost completo e verificato nel runtime desktop Wails 3 (WebView2); in attesa della prova "a sensazione" dei controlli prima dei livelli 2 e 3.  
**Ultimo aggiornamento:** 2026-09-16 (seconda sessione).  
**Prossimo passo:** far giocare Localhost a una persona e raccogliere il feedback su salto, velocità e bug; poi costruire API Gateway.

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
- [ ] Implementati i livelli 2 e 3 e il boss.

**Prossimo passo operativo:** avviare adOmnia, aprire la Home, fare tre giri del logo (o tenerlo premuto 30 s) e giocare Localhost fino in fondo. Annotare qui cosa non è piacevole (salto troppo alto/basso, corsa, bug che colpiscono alle spalle, buche). Tarare `GRAVITY`, `RUN_SPEED`, `JUMP_SPEED` in `prototype.ts`, poi iniziare API Gateway (fase 2).

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
- **Fuori perimetro:** multiplayer, touch, editor, mappe procedurali, inventario, abilità, combattimento complesso, classifiche online.

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
- [ ] Completare API Gateway con pacchetti, firewall, Retry, checkpoint e uscita.
- [ ] Completare Production con piattaforme instabili, checkpoint e boss a tre colpi.
- [x] Implementare introduzione, pausa, riavvio, audio, finale, statistiche e record locali (per Localhost; da estendere ai tre livelli).
- [ ] Verificare che ogni mappa sia completabile, senza salti impossibili, softlock o farming dei bit.

### Fase 3 — Rifinitura e rilascio

- [ ] Sostituire gli asset temporanei, completare animazioni ed effetti leggibili senza dipendere dal colore.
- [ ] Integrare audio offline, mute persistente e riduzione/disattivazione dello scuotimento.
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
