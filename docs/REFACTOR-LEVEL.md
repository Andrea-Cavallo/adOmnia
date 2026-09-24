# Refactor Livello 1 — Developer Desk

Obiettivo: il primo livello deve **insegnare** il gioco, non mostrarlo tutto insieme.
Principio "a battute" (Mario 1-1): ogni tratto introduce **una** meccanica → la fa provare in sicurezza → la varia → la mette alla prova.

Riferimento codice: `frontend/src/components/bughunt/level.ts` (`LEVELS[0]`, blocco `localhost`), `prototype.ts`.

---

## Aggiornamento implementato — 23 settembre 2026

Il percorso misura **6020 px**. Tra 800 e 1540 tre pile di libri creano una linea di salti su quote diverse, con terreno sicuro sotto, uno zombie sulla pila centrale e un flyer facoltativo. Seguono piattaforme instabili, molla e segreto; poi ponte di tasti e rampino. Gremlin e Phantom sono incontri attraversabili, senza cancelli né obbligo di eliminarli: il ritmo resta quello del platform.

La salita finale sui libri resta tra 4300 e 4940, con checkpoint a 4960. Solo il Brute chiude l'arena, ampliata a **5020–5960** con due piattaforme laterali; salta fisicamente verso il punto annunciato e alterna una carica lunga, con 1,8 secondi di recupero. Hotfix a 5810 e uscita a 5900. Nessun ritorno obbligatorio ai mostri precedenti.

Rimosso il disegno dell'arma sovrapposto al polso: resta a0 senza accessori grafici aggiunti, con rinculo, proiettili e HUD delle munizioni. I nemici comuni hanno sagome proprie (coleotteri meccanici, torrette e droni USB), diverse dai tre mostri principali. Barra HP solo per il Brute, senza indicatori duplicati.

Verifica automatica: percorsi sui libri in tutte le difficoltà, incontri risolvibili senza danni in meno di 25 secondi, salto/carica del Brute, uscita senza sconfiggere i mostri facoltativi. Verifica browser delle scene e degli attacchi. **Restano aperte la partita umana completa nelle tre difficoltà e la scoperta del segreto senza conoscenza preventiva**: i test non certificano il divertimento.

## 1. Problemi di partenza

- Troppe meccaniche in 4820px: 6 power-up, rampino, molla, piattaforme instabili, pulse, cavi USB oscillanti, tastiera che crolla, 7 tipi di nemico + miniboss.
- Tutte le piattaforme sospese tra x 800 e 2400 sono `unstable` (`level.ts`, loop skin del livello 0): punitivo prima che il giocatore si fidi dei controlli.
- Un solo checkpoint (`CHECKPOINT_X = 1090`) su un livello lungo quasi il doppio degli altri.
- Il Legacy Brute arriva senza arena, senza ingresso in scena e senza pausa: sembra solo un nemico più grosso.

## 2. Struttura a battute

- [x] **0–800 · Corsa, salto, sparo**: solo patrol a terra, nessun buco mortale, `revert` subito (resta com'è)
- [x] **800–1540 · Stomp + doppio salto**: piattaforme **stabili**, un solo zombie, un flyer come gradino facoltativo
- [x] **1600–2400 · Piattaforme instabili**: `unstable` solo qui, sempre con il pavimento sotto (fallire costa quota, non una vita)
- [x] **2400–3100 · Tastiera che crolla + rampino**: resta com'è
- [x] **~3100 · Secondo checkpoint**
- [x] **3100–4300 · Esame**: Phantom seguito da turret + chaser + timeout
- [x] **4300–4960 · Libri**: salita, bonus facoltativo e checkpoint
- [x] **5020+ · Legacy Brute**: l'arena si chiude gradualmente, ingresso e pausa, poi combattimento

## 3. Contenuti e bilanciamento

- [x] Limitare `unstable` alle piattaforme nel range 1600–2400
- [x] Supporto a più checkpoint per livello (oggi `checkpointX` è unico) + checkpoint a ~3100
- [x] Spostare turret e timeout dopo il secondo checkpoint
- [x] Power-up del livello 1: da 6 a 3 (revert, breakpoint, sudo nel segreto); `gc` e il secondo `breakpoint` passano al livello 2
- [x] Ridurre i tipi di nemico nella prima metà del livello a patrol, zombie e flyer

## 4. Sensazione di gioco

- [x] Hitstop di 50–80ms su stomp e colpo al Brute (si aggiunge al `shake` esistente)
- [x] Segreto più visibile: un "?" o un piccolo effetto sulla prima piattaforma segreta dietro la molla
- [x] Ingresso del Legacy Brute: blocco della camera, battuta, pausa, barra HP
- [x] Riassunto a fine livello: tempo, bit, segreto sì/no, combo migliore (dati già in `publish()`)

## 5. Armi

Oggi aO ha un solo sparo (anche verso l'alto e da accovacciato). Aggiungiamo armi raccoglibili con una propria identità visiva.

- [x] **Riferimento grafico**: tavola "a0 // Weapons & Abilities" (8 armi). Per ora usiamo le prime due:
  - **01 Code Blaster** (arma base): spara frammenti di codice `</>`; è lo sparo attuale (cooldown 0.22s, velocità 640)
  - **02 JSON Shuriken**: shuriken `{}` rapidi che trapassano i nemici; pickup a munizioni (14 colpi, trapassa 3 bug, velocità 820), poi torna il Code Blaster
  - Da fare in seguito: Terminal Beam, Git Missile, Firewall Shield, Data Drone, Ctrl Z Bomb, Deploy Platform
- [x] Definire l'elenco delle armi (Code Blaster + JSON Shuriken) (nome a tema dev, comportamento, cadenza, danno, munizioni o durata)
- [x] Decidere il modello: arma a munizioni raccolta come i power-up; finite le munizioni torna il Code Blaster
- [x] Pickup delle armi nel livello: la prima arma arriva nel tratto 800–1600, **dopo** che lo sparo base è stato imparato
- [ ] Nuovo sprite arma integrato nelle pose di a0; rimossa la precedente sovrapposizione poco leggibile
- [x] HUD: icona dell'arma attiva + munizioni/tempo rimasto
- [ ] Bilanciamento contro il Legacy Brute (l'arma non deve rendere banale il miniboss)
- [x] Testi IT/EN in `copy.ts` (nome dell'arma + suggerimento al primo pickup)

## 6. Verifica

- [x] `npm run build` + test bughunt (`campaign.test.ts`, `prototype.test.ts`) verdi
- [ ] Partita completa del livello 1 a tutte le difficoltà: nessun tratto con due meccaniche nuove insieme
- [ ] Il segreto si trova giocando, senza saperlo in anticipo

## Animazioni a0 — 23 settembre
Passo legato alla velocità, inclinazione smorzata, compressione all'atterraggio, rinculo e orientamento dello sparo, esultanza e curiosità durante soste sicure. Trasformazioni applicate alle pose raster esistenti; non sono nuovi fotogrammi o uno scheletro 3D. Timer nella simulazione, hitbox invariate, effetti delicati rispettati. TypeScript, build e 105 test Bug Hunt passati.

## Movimento e percorso — v0.9.20
Punti 1–6: accelerazione/frenata e correzione in aria, salto modulabile, C scivolata con salto lungo a 450 px/s, sequenza di libri collegata, bug a terra e sulla prima pila come trampolini, rimbalzo basso/alto controllato da Spazio (360/720 px/s). Percorso alto facoltativo dopo corazzato/flyer; nessun obbligo di sparare. X resta lo scatto. Verifiche fisiche con input reali e controllo browser delle pose; partita umana completa ancora da fare.
