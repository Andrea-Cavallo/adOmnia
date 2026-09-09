# TODO — Log Analyzer / Log Inspector

Valutazione del codice al 9 settembre 2026, baseline **v0.9.4 / fa6ade4**.
Questo documento è un backlog proposto, non un elenco di funzionalità già implementate.
Le criticità indicate derivano dalla lettura del codice; gli scenari di accettazione
sono verifiche da eseguire durante l'implementazione, non bug riprodotti in questa analisi.

## Obiettivo

Permettere al developer di rispondere rapidamente a cinque domande:
**quale richiesta è fallita, dove, perché, con quali dati e come riprodurla?**
Il salto di qualità consiste nel passare dalla lettura di eventi a un'indagine
persistente, verificabile e collegata agli strumenti API di adOmnia.

## Cosa esiste già

- Importazione locale di più file, paste, editor e campioni; parsing JSON, JSONL, testo e log misti.
- Worker di parsing, avanzamento, annullamento e lista virtualizzata con limite di eventi.
- Ricerca testuale e per campi annidati, regex, alternative, esclusioni, filtri e query salvate.
- Scoperta automatica dei campi e memoria locale delle forme dei log.
- Correlazione esplicita per correlation ID, trace ID e request ID; cronologia e delta tra eventi.
- Riepilogo richieste e diagnostica euristica per timeout, errori HTTP, retry e lentezza.
- Dettaglio JSON, request/response, messaggio, stack trace e contesto.
- Colonne adattive, identificazione del file negli import multipli, masking ed export.

## P0 — Rendere attendibili i risultati prima di aggiungere potenza

Stato: primo incremento implementato e pubblicato in **v0.9.7**. Restano possibili
raffinamenti futuri, ma il Log Inspector ora gestisce trace-only, successi dopo
retry, durate esplicite vs finestre osservate, body `attributes.http.*`,
provenienza in export e import multi-file senza spread massivi.

- [x] **LA-01 — Separare esito finale, tentativi e anomalie intermedie.**
  Oggi `requestStatus()` dà precedenza a qualsiasi timeout o errore nella catena:
  una richiesta recuperata può rimanere classificata come fallita.
  Modellare tentativi, retry, completamento e risposta del servizio di ingresso;
  evitare che l'ultimo status di un downstream diventi automaticamente quello finale.
  **Accettazione:** timeout → retry → risposta 200 produce “successo con retry”,
  conservando l'evidenza del timeout; una risposta finale assente resta sconosciuta.

- [x] **LA-02 — Correlazione coerente tra analisi e vista eventi.**
  `analyzeLog()` raggruppa solo per `correlationId || requestId`, mentre la vista
  correlata supporta anche `traceId`. Gli eventi con solo trace ID non entrano nel riepilogo.
  Unificare il modello, mantenere il tipo di identificatore e gestire collegamenti
  espliciti tra ID senza fondere catene soltanto perché due stringhe coincidono.
  **Accettazione:** catene con solo trace ID vengono analizzate; ID riutilizzati in
  ambienti diversi non si mescolano; eventi senza ID restano visibili e conteggiati.

- [x] **LA-03 — Distinguere durata reale, intervallo osservato e latenza downstream.**
  `requestDuration()` usa il massimo tra durata e latenza disponibili: non è
  necessariamente il tempo totale della richiesta. Conservare valore, unità e origine;
  separare durata dichiarata del root, intervallo tra log e tempi delle chiamate.
  **Accettazione:** due chiamate sequenziali e due parallele non producono la stessa
  durata inventata; log parziali mostrano “intervallo osservato”, non durata certa.

- [x] **LA-04 — Completare riconoscimento e navigazione request/response.**
  Gli alias attuali non includono, per esempio, `attributes.http.request.body`,
  `attributes.http.response.body` e oggetti diretti `attributes.request/response`.
  Gestire anche stringhe JSON, body null, testo, XML, header e payload troncati.
  Il cambio evento deve uscire dal tab payload quando il nuovo evento non ha body:
  oggi il fallback del tab copre solo gli stack trace.
  **Accettazione:** ogni variante ha una fixture e un dettaglio leggibile; passando
  a un evento senza payload non compare una vista vuota senza spiegazione.

- [x] **LA-05 — Conservare la provenienza dall'import all'export.**
  `sourceName` è assegnato solo negli import multipli e `exporters.ts` non lo esporta.
  Introdurre un ID sorgente stabile, nome visualizzato e posizione originale;
  distinguere file omonimi. Il filtro del dettaglio emette `sourceName:...`, ma
  `FIELD_SYNONYMS` riconosce `source`, non `sourcename`: allineare i percorsi UI/query.
  **Accettazione:** due `app.log` restano distinguibili e l'export mantiene file e riga;
  cliccare il filtro del dettaglio restituisce gli eventi della sorgente selezionata.

- [x] **LA-06 — Rendere sicuro il percorso dei grandi import.**
  In `multiSource.ts`, `events.push(...labelled)` passa l'intero file come argomenti
  e può superare il limite del motore JavaScript. L'acquisizione legge inoltre tutti
  i file con `Promise.all`, prima del limite di eventi. Usare accumulo senza spread
  massivi, budget di memoria e annullamento anche durante l'acquisizione.
  **Accettazione:** quattro file grandi non bloccano l'interfaccia; nessun overflow;
  limiti raggiunti e sorgenti non lette sono dichiarati esplicitamente.

- [x] **LA-07 — Esportare diagnosi proporzionate alle evidenze.**
  Le soglie attuali sono fisse (500 ms e riferimento a 10 s); una latenza superiore
  a 10 s non prova che la deadline configurata sia 10 s. Distinguere fatto,
  regola applicata, ipotesi e verifica suggerita; collegare ogni finding agli eventi.
  Calcolare inventario servizi/ambienti anche sugli eventi senza correlation ID.
  **Accettazione:** nessuna causa viene presentata come certa senza evidenza;
  un log senza ID conserva comunque servizi, versioni e diagnostica per evento.

## P1 — Completare l'indagine quotidiana

- [ ] **LA-08 — Gestore delle sorgenti.** Aggiungere file a una sessione senza
  sostituire tutto; rimuovere, disattivare, rinominare e ricaricare singole sorgenti.
  Mostrare formato, dimensione, eventi, errori e intervallo temporale per file.
  **Accettazione:** si caricano tre microservizi e poi il quarto, mantenendo query e selezione.

- [ ] **LA-09 — Deduplicazione controllata.** Riconoscere import ripetuti e finestre
  sovrapposte; proporre deduplica con conteggi e provenienza, senza eliminare
  silenziosamente eventi identici che possono essere tentativi reali.
  **Accettazione:** duplicati di acquisizione e retry applicativi restano distinguibili.

- [ ] **LA-10 — Waterfall per servizio e chiamata.** Corsie per microservizio,
  chiamate espandibili, retry, pause e collegamenti request/response.
  Usare span/parent span quando disponibili; marcare le connessioni inferite.
  **Accettazione:** da una richiesta di quattro servizi si apre il log esatto del
  tratto lento, senza confondere ordine temporale e causalità.

- [ ] **LA-11 — Payload della chiamata, anche su righe diverse.** Abbinare request e
  response per tentativo/span, non semplicemente per correlation ID. Mostrare
  input, output, header, status e provenienza nello stesso dettaglio.
  **Accettazione:** due downstream paralleli non si scambiano le response.

- [ ] **LA-12 — Diff tra richieste e trasformazioni dei dati.** Confrontare una
  richiesta riuscita con una fallita e i payload tra servizi; evidenziare campi
  mancanti, valori e tipi diversi. Consentire esclusioni di timestamp e ID variabili.
  **Accettazione:** selezionando due catene emerge il campo che differisce con JSONPath copiabile.

- [ ] **LA-13 — Contesto prima e dopo l'evento.** Aprire ±N righe della sorgente e
  ±N secondi di tutti i servizi anche se esclusi dalla query corrente.
  **Accettazione:** da un errore filtrato si leggono i precedenti e si torna al filtro iniziale.

- [ ] **LA-14 — Errori raggruppati per causa osservata.** Raggruppare stack e
  messaggi con fingerprint, conteggio, prima/ultima occorrenza e servizi coinvolti;
  mantenere accessibili gli originali e rendere trasparenti le regole di normalizzazione.
  **Accettazione:** mille varianti dello stesso errore diventano un gruppo ispezionabile.

- [ ] **LA-15 — Ricerca strutturata più espressiva.** Aggiungere AND/OR con parentesi,
  confronti numerici, null/assenza, range, uguaglianza esatta e percorso negli array.
  Autocomplete dai campi presenti e messaggi precisi per sintassi non valida.
  **Accettazione:** `duration_ms > 1000 AND (status = 500 OR status = 502)` è eseguibile
  con semantica documentata e senza conversioni silenziose dei tipi.

- [ ] **LA-16 — Colonne personalizzate dai campi reali.** Promuovere qualsiasi campo
  scoperto a colonna; riordinare, ridimensionare, fissare e salvare un preset per formato.
  Stabilizzare le larghezze durante la ricerca, evitando salti continui del layout.
  **Accettazione:** `attributes.client` e `http.status_code` diventano colonne in un clic.

- [ ] **LA-17 — Sessioni di indagine persistenti.** Salvare sorgenti, query, layout,
  catena selezionata, bookmark e note in un formato locale versionato ed esportabile.
  Separare metadati e grandi contenuti; gestire file spostati o mancanti.
  **Accettazione:** riaprendo adOmnia si riprende l'indagine senza reimpostare tutto.

- [ ] **LA-18 — Pacchetto di evidenze condivisibile.** Esportare una catena con
  timeline, payload, righe originali, sorgenti, filtri, note e riepilogo Markdown.
  Anteprima della redazione; distinguere campi nascosti nella UI da dati rimossi.
  **Accettazione:** il destinatario ricostruisce il problema offline e i segreti
  selezionati non ricompaiono nelle copie raw, JSON annidate o note generate.

## P2 — Collegare i log al lavoro di sviluppo

- [ ] **LA-19 — Dal log al Composer API.** Creare una richiesta modificabile con
  metodo, URL, header e body estratti, indicando i valori mancanti. Riutilizzare
  ambienti e Vault; esecuzione solo tramite il normale comando Send.
  **Accettazione:** un errore nei log diventa una richiesta riproducibile senza copia/incolla manuale.

- [ ] **LA-20 — Dalla catena al Flow e al mock.** Proporre passi e mapping
  response → request verificabili; generare fixture per il Mock Server dai payload.
  Distinguere associazioni confermate da semplici coincidenze di valori.
  **Accettazione:** una demo riproduce la sequenza osservata con dipendenze esplicite.

- [ ] **LA-21 — Correlare con Browser Debug e cronologia API.** Collegare header
  di correlazione/trace, richieste del Composer, traffico proxy e log applicativi.
  **Accettazione:** da una chiamata del browser si raggiunge la relativa catena backend.

- [ ] **LA-22 — Stack trace verso il codice.** Mapping repository/sorgente,
  apertura file:riga nell'editor, distinzione frame applicativi/framework e catene
  `Caused by`; fallback copiabile se il sorgente non è disponibile.
  **Accettazione:** un frame Go o Java apre la posizione corretta del repository scelto.

- [ ] **LA-23 — Validazione payload con gli schemi esistenti.** Collegare OpenAPI
  e JSON Schema già presenti in adOmnia, segnalando violazioni sul JSONPath.
  **Accettazione:** un campo obbligatorio mancante viene mostrato insieme al contratto atteso.

- [ ] **LA-24 — Acquisizione live locale e da container.** Tail di file con rotazione,
  stop/ripresa, buffer limitato e `oc logs`/`kubectl logs`/Docker tramite backend Go.
  Selezione esplicita di contesto, namespace, pod e container; indicare dipendenze CLI.
  **Accettazione:** eventi live si correlano con file già importati, senza duplicazioni
  dopo la riconnessione; il processo si ferma chiudendo la sorgente.

## P3 — Scala, analisi avanzata ed estensibilità

- [ ] **LA-25 — Dataset superiori alla RAM disponibile.** Lettura incrementale,
  indice su disco, query e analisi fuori dal thread UI, paginazione e budget cancellabili.
  **Accettazione:** benchmark su hardware dichiarato con 1 GB di log, misurando
  memoria, tempo al primo evento, filtro, cancellazione e navigazione.

- [ ] **LA-26 — Profili di parsing configurabili.** Mapping di campi, timestamp,
  timezone, unità delle durate, ID e body; regole multilinea e profili import/export.
  Avvisare sui limiti di profondità/campi invece di lasciare valori non indicizzati invisibili.
  **Accettazione:** un formato custom è supportato senza cambiare il codice applicativo.

- [ ] **LA-27 — Clock skew e catene incomplete.** Offset per sorgente, timestamp
  originale preservato, segnalazione di orologi discordanti, inizio/fine mancanti e buchi.
  **Accettazione:** nessun tempo negativo viene corretto silenziosamente; l'utente
  distingue tempo corretto, tempo originale e intervallo non osservato.

- [ ] **LA-28 — Metriche e confronto tra esecuzioni.** Conteggi, error rate e
  percentili per route, servizio e versione; confronto prima/dopo una modifica.
  Mostrare denominatore, copertura del campione e unità; non sommare durate concorrenti.
  **Accettazione:** una regressione è accompagnata dai campioni e dalle catene che la spiegano.

- [ ] **LA-29 — Regole diagnostiche estensibili.** Soglie per servizio/route,
  regole dichiarative con evidenza e azione, versionabili e verificabili su fixture.
  Coprire circuit breaker, retry storm, pool esauriti e duplicazioni solo quando
  i log contengono segnali sufficienti; integrare i plugin esistenti se necessario.
  **Accettazione:** ogni finding espone regola, versione ed eventi che lo hanno generato.

- [ ] **LA-30 — Assistenza AI locale opzionale.** Riassumere la catena selezionata,
  proporre ipotesi e query con riferimenti agli eventi; distinguere deduzione da prova.
  Riutilizzare l'AI Engine esistente con modalità locale e redazione del contesto.
  **Accettazione:** il debugging principale funziona senza AI; nessun log viene
  inviato automaticamente a provider esterni e ogni suggerimento resta verificabile.

## Ordine di consegna proposto

| Incremento | Contenuto | Risultato per il developer |
|---|---|---|
| 1 — Fiducia nei dati | LA-01…07 | Esiti, durate, payload e provenienza attendibili |
| 2 — Una richiesta completa | LA-08…14, LA-16 | Quattro microservizi leggibili come un'indagine unica |
| 3 — Indagine ripetibile | LA-15, LA-17…18 | Ricerca avanzata, salvataggio e passaggio al collega |
| 4 — Riproduzione | LA-19…23 | Dal log alla richiesta, al codice e alla demo |
| 5 — Uso continuativo | LA-24…29 | Live, grandi dataset e diagnostica personalizzata |
| 6 — Assistenza | LA-30 | Sintesi assistita sopra evidenze già affidabili |

## Scenario finale di accettazione

- [ ] Caricare quattro file di quattro microservizi, con JSONL Go e log misti.
- [ ] Cercare un correlation ID e ottenere tutti gli eventi pertinenti con file/riga.
- [ ] Vedere chiamate, request/response, retry e risultato finale nella stessa indagine.
- [ ] Riconoscere dati mancanti, clock skew, log troncati e correlazioni incerte.
- [ ] Confrontare una catena fallita con una riuscita e individuare la differenza nel body.
- [ ] Aprire il frame applicativo e preparare una richiesta API riproducibile.
- [ ] Salvare, chiudere, riaprire e condividere le evidenze redatte.
- [ ] Eseguire il percorso su Windows, Linux e macOS, con tastiera e pannelli ridimensionati.

## Riferimenti verificati nel repository

- `frontend/src/lib/loginspector/analyze.ts`: grouping, esiti, durate, alias body, soglie e finding.
- `frontend/src/lib/loginspector/correlate.ts`: correlazione per ID e cronologia attuale.
- `frontend/src/lib/loginspector/multiSource.ts`: aggregazione file e provenienza.
- `frontend/src/lib/loginspector/sources.ts`: acquisizione file e sorgente OpenShift non implementata.
- `frontend/src/lib/loginspector/query.ts`: operatori e alias effettivamente supportati.
- `frontend/src/lib/loginspector/exporters.ts`: proiezione esportata degli eventi.
- `frontend/src/lib/loginspector/normalize.ts`: normalizzazione e limiti di indicizzazione.
- `frontend/src/components/loginspector/LogInspectorPanel.tsx`: import, stato sessione, preferenze e azioni.
- `frontend/src/components/loginspector/EventDetail.tsx`: payload per evento e navigazione dei tab.
- `frontend/src/components/loginspector/AnalysisOverview.tsx`: riepilogo delle richieste.
- `docs/SOUL.md`, `CLAUDE.md`, `docs/adomnia-feature-catalog.en.md`: vincoli e moduli da riutilizzare.

La roadmap valorizza soprattutto Local-First, User-Extensible e integrazione con
Browser Debug; formati Go/Java, OpenShift e SOAP sostengono il pilastro enterprise.
Le integrazioni devono riutilizzare i moduli esistenti, con logica backend in
`internal/<domain>/` e persistenza compatibile con le versioni precedenti.
