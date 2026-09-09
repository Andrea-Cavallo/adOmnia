# Log Inspector

Studio di adOmnia per investigare log applicativi — pensato per l'output che
esce da un pod OpenShift: JSON compresso su una riga, JSON Lines, testo misto,
stack trace multilinea, ANSI escape del terminale.

Trasforma quel materiale in eventi navigabili, filtrabili e correlabili.
**Tutto resta sulla macchina locale: nessuna chiamata di rete, nessuna telemetria.**

| | |
|---|---|
| **Dove** | Power Tools → Power Studios → *Log Inspector* |
| **Command palette** | `Ctrl/Cmd + K` → "Log Inspector" |
| **Logica** | `frontend/src/lib/loginspector/` |
| **UI** | `frontend/src/components/loginspector/` |
| **Test** | 73 test dedicati in `frontend/src/lib/loginspector/*.test.ts` (suite frontend: 353) |
| **Dipendenze nuove** | nessuna |

---

## In 30 secondi

1. Copia l'output di `oc logs <pod>` dal terminale.
2. Apri **Power Tools → Log Inspector** e premi `Ctrl+V` (o trascina il file sul pannello).
3. Ogni riga diventa un evento: timestamp, livello, servizio, pod, messaggio.
4. Scrivi `level:error` nella barra di ricerca per isolare i problemi.
5. Apri un evento, clicca il chip **Correlation ID** → *Show related events*:
   hai la richiesta ricostruita in ordine cronologico con i delta temporali.

---

## 1. Acquisizione input

Cinque sorgenti, tutte dietro un'unica interfaccia (`lib/loginspector/sources.ts`):

| Sorgente | Come |
|---|---|
| Appunti | pulsante **Paste** o `Ctrl+V` |
| Editor di testo | riquadro nella schermata vuota → **Analyze** (un incolla > 2000 caratteri parte da solo) |
| Drag & drop | trascina il file ovunque sul pannello |
| File locale | pulsante **Open** |
| Esempi | 5 campioni selezionabili nella schermata vuota |

### Il formato si decide leggendo il contenuto, mai dall'estensione

Questo è un punto fermo del design. Il file picker accetta **qualsiasi file**
(`accept="*"`) e il drop non filtra nulla: puoi trascinare `pod-2026-03-11.txt`,
`app.log`, `dump.json`, `output.out` o un file **senza estensione**, e il
risultato è identico a parità di contenuto. `detectFormat()` guarda i primi
byte reali e sceglie tra `json`, `json-array`, `jsonl`, `mixed`, `text`.

Unica eccezione: se i primi 4 KB contengono byte NUL il file è binario, e
l'import viene rifiutato con un messaggio esplicito invece di riempire la lista
di caratteri illeggibili.

> Coperto dai test: *"detects the format from the content, whatever the extension says"*,
> *"reads a .txt file that actually contains JSON Lines"*, *"reads a file with no
> extension at all"*, *"refuses a binary file instead of showing mojibake"*.

### `oc logs` — predisposto, non implementato

`sources.ts` espone `OC_LOGS_SOURCE` con `available: false` e la UI mostra la
voce disabilitata con il motivo. Manca solo il binding Go che esegue
`oc logs -f`; tutto il resto della pipeline è già indipendente dalla sorgente.

---

## 2. Parsing

### Formati riconosciuti

- JSON singolo (anche pretty-printed su più righe)
- Array JSON di oggetti
- JSON Lines / NDJSON
- Testo semplice
- **Log misti**: prefisso testuale seguito da JSON, incluso il formato CRI-O che
  `oc logs` produce → `2026-03-11T09:14:02.481774331Z stderr F {"level":"error",…}`
  Il prefisso viene rimosso, il timestamp e lo stream (`stdout`/`stderr`) vengono
  recuperati come fallback.
- ANSI escape codes: rimossi prima di qualsiasi analisi

### Aggregazione degli stack trace

Il parser è una macchina a righe incrementale. Una riga è *continuazione*
dell'evento precedente — quindi finisce nel suo stack trace, non diventa un
evento nuovo — quando riconosce:

- **Java**: `\tat …`, `Caused by:`, `Suppressed:`, `... 14 more`, e una riga che
  è un nome di throwable (`java.lang.IllegalStateException: …`)
- **Go**: `panic:` / `fatal error:` aprono la modalità panic, che assorbe anche
  la riga vuota, `goroutine 42 [running]:`, i frame `/src/cmd/worker/main.go:57 +0x2d4`,
  `created by …` ed `exit status 2`
- **Generico**: qualsiasi riga indentata

I frame che portano il proprio prefisso CRI-O vengono comunque agganciati
all'evento giusto — è il caso reale di `oc logs` su una eccezione Java.

### Campi normalizzati

Alias riconosciuti, primo presente vince:

| Campo | Alias |
|---|---|
| `ts` / `tsRaw` | `timestamp`, `time`, `@timestamp`, `ts`, `eventTime`, `datetime`, `date` |
| `level` | `level`, `severity`, `logLevel`, `log_level`, `lvl`, `levelname`, `priority` |
| `message` | `message`, `msg`, `log`, `text`, `event` |
| `service` | `service`, `application`, `app`, `serviceName`, `service_name`, `component` |
| `namespace` | `namespace`, `ns`, `kubernetes.namespace_name`, `k8s.namespace` |
| `pod` | `pod`, `podName`, `pod_name`, `kubernetes.pod_name`, `instance`, `host`, `hostname` |
| `container` | `container`, `containerName`, `container_name`, `kubernetes.container_name` |
| `traceId` | `traceId`, `trace_id`, `traceID`, `dd.trace_id`, `otel.trace_id` |
| `correlationId` | `correlationId`, `correlation_id`, `corrId`, `cid` |
| `requestId` | `requestId`, `request_id`, `reqId`, `req_id` |
| `thread` | `thread`, `threadName`, `goroutine`, `worker` |
| `logger` | `logger`, `loggerName`, `caller`, `source`, `class`, `category` |

Il payload viene appiattito di **un** livello, così `kubernetes: { pod_name }`
risolve attraverso gli alias puntati senza far esplodere payload profondi.

**Livelli**: testuali (`SEVERE`, `WARNING`, `FINE`…) e numerici bunyan/pino
(`30` → info, `50` → error). Per le righe di testo il livello viene estratto dal
contenuto.

**Timestamp** riconosciuti: ISO con nanosecondi, ISO con offset, formato Java con
la virgola (`09:14:02,481`), epoch in secondi / millisecondi / microsecondi /
nanosecondi, CLF (`11/Mar/2026:09:14:02 +0000`), syslog, orologio nudo.

**JSON annidato come stringa**: i campi `message`, `msg`, `body`, `payload`,
`response`, `request`, `data` vengono decodificati automaticamente se contengono
JSON escapato. Il risultato finisce in `decoded` — il payload originale non viene
mai modificato — e se il JSON interno ha un suo `message` quello diventa il
messaggio mostrato in lista.

### Robustezza

- Una riga non valida **non** interrompe l'import: viene conservata, marcata
  `RAW` in lista, con l'errore di parsing nel dettaglio.
- Le righe non parsabili restano a livello `unknown`, per non inquinare il
  conteggio degli errori applicativi.
- Riepilogo finale: eventi validi, righe non valide, righe totali, errori,
  warning, formato rilevato, durata, ed eventuale troncamento.
  Le liste di errori/warning sono campionate a 100 voci — il conteggio è
  completo, ma un file da 100k righe rotte non duplica sé stesso in memoria.

### Modello interno

`LogEvent` normalizza i campi ma conserva sempre:

- `raw` — testo sorgente originale (senza ANSI, che è rumore del terminale)
- `json` — payload JSON originale, intatto
- `extra` — i campi che non sono stati promossi
- `decoded` — il JSON estratto dai campi testuali
- `line` / `lineCount` — riga sorgente e quante righe occupa l'evento
- `parseError` — non vuoto quando la riga non era parsabile
- `prefix` — testo che precedeva il JSON sulla stessa riga

---

## 3. Interfaccia

```
┌──────────────────────────────────────────────────────────────┐
│ toolbar: Paste · Open · Clear · ricerca · toggle · Export    │
├──────────────────────────────────────────────────────────────┤
│ istogramma temporale (click = filtra su quel bucket)         │
├───────────┬──────────────────────────────┬───────────────────┤
│ filtri    │ lista virtualizzata          │ dettaglio /       │
│ (chiudi-  │ (una riga = un evento)       │ related events    │
│  bile)    │                              │ (ridimensionabile)│
├───────────┴──────────────────────────────┴───────────────────┤
│ riepilogo: mostrati / totali / validi / non parsati / errori │
└──────────────────────────────────────────────────────────────┘
```

**Riga della lista** (sintetica, non un blocco JSON): timestamp, livello,
servizio, pod o container, messaggio, correlation/trace ID, più due indicatori —
presenza di stack trace e riga non parsabile. Le colonne sono selezionabili.

### Pannello dettagli — 5 schede

| Scheda | Contenuto |
|---|---|
| **Overview** | campi principali con etichette leggibili; ogni campo si può trasformare in filtro con un click; chip per gli ID di correlazione |
| **JSON** | albero con syntax highlighting, nodi collassabili, espandi/comprimi tutto, copia JSON intero, copia singolo valore, **copia JSONPath**, ricerca interna, word wrap, vista raw |
| **Message** | messaggio completo, senza troncamenti, più l'eventuale JSON decodificato |
| **Stack Trace** | monospaziato, righe numerate, word wrap opzionale, copia |
| **Context** | metadati Kubernetes/OpenShift, tracing, riga sorgente, e albero dei campi non riconosciuti |

Le schede **JSON** e **Context** rispettano i campi nascosti (vedi *Campi rumorosi*
al §6): le chiavi elencate lì spariscono dall'albero a qualsiasi profondità.

`Esc` chiude il dettaglio.

### Comportamento responsive

Il pannello si misura da solo con un `ResizeObserver`:

- sotto i **640 px** i filtri si chiudono automaticamente al primo render;
- sempre sotto i 640 px, aprire un evento porta il dettaglio a schermo intero
  invece di comprimere la lista in una colonna illeggibile;
- sopra quella soglia le tre colonne convivono e sono ridimensionabili a mano
  (le larghezze vengono ricordate).

---

## 4. Filtri e ricerca

### Mini-linguaggio di query

```
level:error                    livello
service:payments               campo esatto (contains, case-insensitive)
pod:pay-*                      wildcard
traceId:*                      il campo esiste ed è valorizzato
-service:noisy-cron            esclusione
"latency above threshold"      frase esatta
merchant                       ricerca full-text su raw + message + stack
```

Le clausole si combinano in AND. I sinonimi sono accettati (`svc`, `ns`, `cid`,
`req`, `trace`…). Un campo sconosciuto non fa fallire la query: viene cercato
come testo e la UI segnala l'ambiguità.

### Filtri strutturati

- livelli multipli con conteggio per livello
- intervallo temporale (`From` / `To`, o click su una barra dell'istogramma)
- facet per servizio, namespace, pod, container, logger, thread — con
  **inclusione** e **esclusione** per valore
- "solo eventi con stack trace"
- "solo righe non parsabili"
- reset immediato

I termini della query vengono **evidenziati** nel messaggio in lista.

### Query builder visuale

Campo + operatore (`is` / `is not` / `exists`) + valore → clausola aggiunta alla
query. Per chi non vuole scrivere la sintassi a mano.

### Query salvate

Salvate localmente in `localStorage` (`adomnia.loginspector`) insieme alle altre
preferenze: densità, word wrap, colonne visibili, limite eventi, larghezza delle
colonne, campi sensibili aggiuntivi e campi rumorosi nascosti.

Sono preferenze di macchina: non vengono sincronizzate, non finiscono nel
workspace `.adomnia` e non escono dal computer. Se `localStorage` non è
disponibile (finestra privata, quota esaurita) lo strumento funziona comunque
con i valori predefiniti.

---

## 5. Correlazione degli eventi

Da un evento con `correlationId`, `traceId` o `requestId` → **Show related events**.

La vista mostra:

- tutti gli eventi correlati, in ordine cronologico
- il **delta temporale** rispetto all'evento precedente (`+156ms`)
- durata totale della catena, numero di errori, catena dei servizi attraversati
- errori evidenziati
- due modalità: **lista** e **timeline** (posizione proporzionale nel tempo)
- copia del valore, e **"Use as filter"** per portarlo nella query principale

È il modo per ricostruire cronologicamente una richiesta distribuita.

---

## 6. Funzionalità aggiuntive

- ordinamento crescente / decrescente per timestamp
- **pausa e ripresa del rendering** durante l'import di grandi quantità di dati
- densità **compact** / **comfortable**
- word wrap
- copia della riga originale (`Raw` nel dettaglio)
- copia degli eventi filtrati negli appunti
- esportazione dei risultati **filtrati** in JSON, JSONL o testo
- scelta delle colonne visibili in lista
- conteggio degli eventi per livello
- mini istogramma temporale con quota di errori in rosso
- **Clear sensitive fields**: maschera `Bearer …`, `Authorization`, `token`,
  `password`, `secret`, `cookie`, `api_key`, `session`, `credential`,
  `private_key` — a qualsiasi profondità del JSON e anche nel testo libero.
  Produce copie: gli eventi originali restano intatti e il mascheramento si
  disattiva senza reimportare.

### Campi sensibili aggiuntivi

L'icona accanto all'interruttore di mascheramento apre un popover dove si
aggiungono nomi di campo propri del dominio — `customer_email`, `iban`,
`fiscal_code` — che si sommano al riconoscimento predefinito. Restano salvati tra
una sessione e l'altra.

### Campi rumorosi

Nel popover delle colonne, la sezione **Hide noisy JSON fields** accetta i nomi
delle chiavi da togliere di mezzo (`kubernetes`, `hostname`, `stream`…). Vengono
rimosse dall'albero JSON e dalla scheda Context, a qualsiasi profondità, senza
toccare i dati: è una scelta di visualizzazione, non un filtro sugli eventi.

> Attenzione alla differenza: **mascherare** sostituisce il valore con
> `[redacted]` e vale anche per l'export; **nascondere** toglie la chiave solo
> dalla vista di dettaglio.

---

## 7. Prestazioni con file grandi

Obiettivo: fluidità con almeno 100.000 eventi. Verificato dai test.

- **Parsing in Web Worker**, a blocchi da 2.000 righe: il lavoro non occupa il
  renderer, la progress bar si aggiorna, il pulsante **Cancel** interrompe anche
  documenti JSON molto grandi e la lista si riempie progressivamente. Ogni
  messaggio contiene solo il nuovo blocco, non una copia di tutti gli eventi.
- **Lista virtualizzata**: viene montata solo la finestra visibile, quindi
  100.000 eventi costano quanto 40.
- **Filtri** su predicati economici, con haystack di ricerca calcolato una volta
  sola per evento e conservato in una `WeakMap` (si libera insieme al batch).
- **Digitazione non bloccante**: la query passa da `useDeferredValue`, quindi il
  campo di ricerca risponde a ogni tasto mentre il ricalcolo della lista resta
  indietro di un frame invece di bloccare l'input.
- **Limite massimo configurabile**: 50k / 100k / 200k / 500k eventi, con
  troncamento segnalato nella barra di riepilogo.
- **Errori di memoria gestiti esplicitamente**: messaggio dedicato che suggerisce
  di abbassare il limite o dividere il file, invece di una schermata bianca.

### Worker e compatibilità

Il browser usa `parser.worker.ts`; test e WebView privi di supporto Worker usano
la stessa macchina incrementale sul thread principale. Il protocollo scambia
batch incrementali per contenere il costo di serializzazione.

---

## 8. Architettura

I livelli sono separati, come da specifica:

| Livello | File |
|---|---|
| Acquisizione input | `lib/loginspector/sources.ts` |
| Rilevamento formato | `lib/loginspector/detect.ts` |
| Parsing | `lib/loginspector/parse.ts` |
| Normalizzazione campi | `lib/loginspector/normalize.ts` |
| Filtri e query | `lib/loginspector/query.ts` |
| Statistiche / indicizzazione | `lib/loginspector/stats.ts` |
| Correlazione | `lib/loginspector/correlate.ts` |
| Mascheramento | `lib/loginspector/mask.ts` |
| Esportazione | `lib/loginspector/exporters.ts` |
| Esempi | `lib/loginspector/samples.ts` |
| Presentazione | `components/loginspector/*` |

Componenti riusati da adOmnia: `FileDropZone`, `ResizeHandle`, `downloadText` /
`readFileSmart`, i token `--color-*` del design system, il pattern di pannello di
`HarViewerPanel`. Nessuna dipendenza npm aggiunta: la virtual list e l'albero
JSON sono scritti su misura (~50 e ~130 righe).

### File

```
frontend/src/lib/loginspector/
  types.ts        93   modello LogEvent, ParseSummary, ParseResult
  detect.ts       70   ANSI, rilevamento formato, JSON in coda a un prefisso
  normalize.ts   251   alias campi, livelli, timestamp, JSON annidato
  parse.ts       458   macchina a righe, stack trace, chunked + cancel
  query.ts       257   mini-linguaggio, filtri strutturati, evidenziazione
  stats.ts        82   conteggi per livello, facet, istogramma
  correlate.ts    68   catene correlate, delta, ordinamento cronologico
  mask.ts         59   Clear sensitive fields
  exporters.ts    54   JSON / JSONL / testo
  samples.ts      75   5 esempi
  sources.ts      64   seam di acquisizione, guardia binario, oc logs
  parse.test.ts  292   test parser + drop di file
  query.test.ts  225   test query, correlazione, mask, stats, export

frontend/src/components/loginspector/
  LogInspectorPanel.tsx  631   orchestrazione, toolbar, layout, scorciatoie
  FilterSidebar.tsx      334   livelli, tempo, facet, query builder, salvate
  JsonTree.tsx           310   albero JSON con copia valore / JSONPath
  EventDetail.tsx        261   5 schede
  EventList.tsx          223   lista virtualizzata
  RelatedEvents.tsx      141   lista + timeline
  EmptyState.tsx         125   esempi, drop zone, editor, scorciatoie
  Histogram.tsx           45   istogramma temporale
```

### Wiring

- `components/utils/toolRegistry.ts` — voce `loginspector` in *Power Studios*
- `components/utils/UtilsPanel.tsx` — `case 'loginspector'`
- `lib/commandPalette.ts` — comando "Log Inspector"
- `lib/featureRegistry.ts` — **non toccato di proposito**: i suoi `id` sono voci
  del rail, e Log Inspector vive dentro Power Tools

---

## 9. Scorciatoie

| Tasti | Azione |
|---|---|
| `Ctrl+V` | incolla e analizza |
| `Ctrl+F` | ricerca |
| `Ctrl+Shift+F` | mostra/nasconde i filtri |
| `Ctrl+L` | pulisci |
| `Ctrl+E` | esporta |
| `Esc` | chiudi il dettaglio |

---

## 10. Test

`frontend/src/lib/loginspector/*.test.ts` — **73 test**, tutti verdi.

- JSON singolo, array JSON, JSON Lines
- righe malformate: non bloccano l'import, vengono marcate, non contano come
  errori applicativi
- stack trace Java (con `Caused by` e `... N more`)
- panic Go (goroutine, frame `.go:NN`, riga vuota interna, `exit status`)
- log con prefissi OpenShift, inclusi i frame Java con prefisso proprio
- timestamp differenti: ISO nano, ISO con offset, Java con virgola, epoch s/ms, CLF
- JSON annidato come stringa in `message` / `body` / `payload` / `response`
- ANSI escape codes
- drop di file: formato dedotto dal contenuto per `.txt`, `.log`, `.json` e file
  senza estensione; rifiuto dei file binari
- correlazione via `traceId` e `correlationId`, con delta e durata della catena
- filtraggio combinato: query + livelli + facet + esclusioni + intervallo temporale
- file di grandi dimensioni: 100k eventi, limite, troncamento, annullamento, progress
- mascheramento dei dati sensibili, incluso il non-mutare gli originali

### Verifica eseguita

- `npx tsc --noEmit` pulito
- `npm run test` verde — 72 file, 353 test
- `npm run build` verde
- smoke manuale sul dev server: apertura da Power Tools, sample OpenShift,
  dettaglio evento, stack trace associato all'evento corretto, related events con
  delta `+156ms` / `+381ms`, barra di riepilogo
  `7 shown / 7 events · 6 valid · 1 unparsed · mixed · 1ms` — nessun errore in console

---

## 11. Criteri di accettazione

| Criterio | Stato |
|---|---|
| Incollare direttamente i log copiati da un pod OpenShift | ✅ |
| Ogni evento come riga sintetica e leggibile | ✅ |
| Aprire e ispezionare il JSON completo | ✅ |
| Stack trace multilinea associato all'evento corretto | ✅ |
| Filtrare rapidamente errori, servizi, pod e correlation ID | ✅ |
| Ricostruire cronologicamente una richiesta | ✅ |
| Una riga non valida non blocca le altre | ✅ |
| Interfaccia fluida con 100.000 eventi | ✅ |
| Tutti i dati restano sul computer | ✅ |
| Test principali superati | ✅ 71/71 |

---

## 12. Limiti noti e prossimi passi

- **`oc logs` non implementato** — seam pronto, manca il binding Go.
- Un singolo array JSON enorme viene comunque parsato in un colpo solo da
  `JSON.parse`: è un limite del formato, non dell'implementazione. L'errore di
  memoria è gestito con un messaggio dedicato.
- `raw` conserva la riga originale **senza** ANSI: gli escape sono rumore del
  terminale e renderebbero inutile "copia riga originale".
- Non implementato perché non richiesto: streaming live (tail continuo) e diff
  tra due import. Da aggiungere se serve seguire un pod in tempo reale.
