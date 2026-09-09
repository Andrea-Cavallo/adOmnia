# Log Inspector — piano di lavoro

Feature: **Log Inspector**, nuovo Power Studio dentro **Power Tools**.
Obiettivo: trasformare log OpenShift (JSON compresso, JSONL, testo misto, stack trace)
in una vista navigabile, local-first, fluida con 100.000 eventi.

Stato: **v1 completa e verificata**. Ultimo aggiornamento: 2026-09-09.

---

## 0. Analisi

- [x] Struttura Power Tools (`components/utils/UtilsPanel.tsx`, `toolRegistry.ts`)
- [x] Componenti riusabili individuati: `FileDropZone`, `ResizeHandle`, `fileUtils`
      (`downloadText`, `readFileSmart`), token `--color-*`, pattern pannello `HarViewerPanel`
- [x] Nessuna dipendenza nuova: virtual list scritta a mano, parser puro TS
- [x] Parsing in Web Worker con batch incrementali (progress + cancel + rendering
      progressivo); fallback a chunk per test e WebView senza Worker

---

## 1. Livello logico — `frontend/src/lib/loginspector/`

- [x] `types.ts` — modello normalizzato `LogEvent` (raw, json originale, campi non
      riconosciuti, riga sorgente, errore di parsing), `ParseSummary`, `ParseResult`
- [x] `detect.ts` — strip ANSI, rilevamento formato (json / json-array / jsonl /
      mixed / text), individuazione JSON in coda a un prefisso testuale
- [x] `normalize.ts` — alias campi (timestamp/time/@timestamp, level/severity/logLevel,
      message/msg, service/application/app, namespace, pod/podName, container,
      traceId, correlationId, requestId, thread, logger), livelli numerici
      bunyan/pino, timestamp multi-formato, decodifica JSON annidato in stringa
- [x] `parse.ts` — macchina a righe incrementale: separazione eventi, prefisso CRI-O
      (`<ts> stdout F …`), aggregazione stack trace Java/Go, righe non parsabili
      marcate senza interrompere l'import, riepilogo validi/non validi/errori/warning,
      limite `maxEvents`, versione a chunk con progress e annullamento
- [x] `query.ts` — mini-linguaggio `level:error service:payments pod:* -noise`,
      wildcard, frasi tra virgolette, esclusioni, filtri strutturati combinati,
      segmenti per l'evidenziazione
- [x] `correlate.ts` — eventi correlati per correlationId / traceId / requestId,
      ordinamento cronologico, delta tra eventi consecutivi, conteggio errori
- [x] `stats.ts` — conteggio per livello, facet, estensione temporale, istogramma
- [x] `mask.ts` — "Clear sensitive fields": token, Authorization, cookie, password,
      secret + campi configurabili; produce copie, non muta gli eventi originali
- [x] `exporters.ts` — export JSON / JSONL / testo dei risultati filtrati
- [x] `samples.ts` — esempi: JSON singolo, JSONL, stack trace Java, panic Go,
      log OpenShift misto
- [x] `sources.ts` — seam unica di acquisizione input (paste / editor / file /
      sample / `oc logs` predisposto)
- [x] `index.ts` — barrel

## 2. Livello UI — `frontend/src/components/loginspector/`

- [x] `LogInspectorPanel.tsx` — toolbar, layout a 3 colonne ridimensionabili,
      ingest (paste / editor / drag&drop / file / sample), scheduler di parsing a
      chunk, progress + annulla, pausa/ripresa del rendering, barra di riepilogo,
      scorciatoie (Ctrl+V, Ctrl+F, Ctrl+Shift+F, Ctrl+L, Ctrl+E, Esc), preferenze
      persistite in `adomnia.loginspector`
- [x] `EventList.tsx` — lista virtualizzata (fixed row height), riga sintetica
      (timestamp, livello, servizio, pod/container, messaggio, correlation/trace ID,
      indicatore stack e riga non parsabile), compact/comfortable, word wrap,
      scelta colonne, evidenziazione match
- [x] `EventDetail.tsx` — schede Overview / JSON / Message / Stack Trace / Context,
      copia riga originale, filtro rapido su un campo, "show related events"
- [x] `JsonTree.tsx` — highlighting, nodi collassabili, espandi/comprimi tutto,
      copia JSON, copia valore, copia JSONPath, ricerca interna, word wrap, raw
- [x] `FilterSidebar.tsx` — livelli multipli con conteggi, intervallo temporale,
      facet (servizio, namespace, pod, container, logger, thread) con inclusione ed
      esclusione, solo con stack trace, solo righe non parsabili, reset,
      query builder visuale, query salvate
- [x] `RelatedEvents.tsx` — vista lista e vista timeline, delta temporali,
      errori evidenziati, copia del valore, "use as filter"
- [x] `Histogram.tsx` — mini istogramma temporale con quota errori, click = range
- [x] `EmptyState.tsx` — esempi selezionabili, drop zone, editor, scorciatoie
- [x] `index.ts` — barrel UI

## 3. Wiring

- [x] `toolRegistry.ts` — voce `loginspector` in "Power Studios" + descrizione
- [x] `UtilsPanel.tsx` — import + `case 'loginspector'`
- [x] `commandPalette.ts` — comando "Log Inspector"
- [ ] `featureRegistry.ts` — **non aggiunto di proposito**: gli `id` di quel registro
      sono voci del rail (`RAIL_ITEMS`) e Log Inspector vive dentro Power Tools.
      Da fare solo se in futuro gli si dà un'icona propria nel rail.

## 4. Test — `frontend/src/lib/loginspector/*.test.ts` (67 test)

- [x] JSON singolo, array JSON, JSONL
- [x] Righe malformate (non bloccano le altre, vengono marcate, non contano come errori applicativi)
- [x] Stack trace Java (con `Caused by` e `... N more`)
- [x] Panic Go (goroutine, frame `.go:NN`, riga vuota interna, `exit status`)
- [x] Log con prefissi OpenShift (`<ts> stdout F {json}`, frame Java con prefisso proprio)
- [x] Timestamp differenti (ISO nano, ISO con offset, Java con virgola, epoch s/ms, CLF)
- [x] JSON annidato come stringa in message/body/payload/response
- [x] ANSI escape codes
- [x] Correlazione via traceId e correlationId (delta, span, conteggio errori)
- [x] Filtraggio combinato (query + livelli + facet + esclusioni + range temporale)
- [x] File di grandi dimensioni (100k eventi, limite, troncamento, annullamento, progress)
- [x] Mascheramento dati sensibili (bearer, campi annidati, campi extra configurabili)

## 5. Verifica finale

- [x] `npx tsc --noEmit` pulito
- [x] `npm run test` verde — 72 file, 353 test
- [x] `npm run build` verde
- [x] Smoke manuale sul dev server: apertura da Power Tools, sample OpenShift,
      dettaglio evento, stack trace associato, related events con delta,
      barra di riepilogo — nessun errore in console

---

## Predisposto ma non implementato

- [ ] **Integrazione `oc logs`** — `lib/loginspector/sources.ts` espone
      `OC_LOGS_SOURCE` con `available: false`; la UI mostra la voce disabilitata.
      Manca il binding Go che esegue `oc logs -f` e ne fa lo streaming.
      Tutto il resto della pipeline (rilevamento formato, parsing, filtri) è già
      indipendente dalla sorgente.

## Aggiunte dopo la prima consegna

- [x] Il file picker accetta **qualsiasi** file (`accept="*"`): il formato si
      deduce sempre dal contenuto, mai dall'estensione — `.txt`, `.log`, `.json`,
      `.out` o senza estensione danno lo stesso risultato
- [x] Guardia sui file binari: byte NUL nei primi 4 KB → rifiuto con messaggio
      esplicito invece di mojibake in lista
- [x] Fix doppio import quando si rilascia un file sopra la drop zone della
      schermata vuota (l'evento veniva gestito due volte)
- [x] 4 test nuovi (`dropping a file of any kind`)
- [x] `docs/LOG-INSPECTOR.md` — documentazione completa della feature

## Note / limiti noti

- Il parsing gira in un Web Worker a blocchi da 2.000 righe. Un array JSON viene
  ancora letto con una singola `JSON.parse`, ma fuori dal renderer e può essere
  interrotto terminando il worker. L'errore di memoria è gestito esplicitamente.
- `raw` conserva la riga originale **senza** ANSI: gli escape sono rumore del
  terminale e renderebbero inutile "copia riga originale".
- Le righe che iniziano con `{` ma non parsano sono marcate `RAW` e restano a
  livello `unknown`, per non inquinare il conteggio degli errori applicativi.
