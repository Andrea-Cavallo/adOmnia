# size.md — Piano riduzione dimensione .exe

Data: 2026-05-17

Obiettivo: ridurre il peso del binary di adOmnia da ~45 MB a ~12–16 MB senza
modificare funzionalità visibili. Nessun passo deve essere applicato senza
verifica manuale del risultato.

---

## Baseline da misurare prima di iniziare

- [ ] Eseguire `wails build` senza modifiche e annotare la dimensione del `.exe` prodotto.
- [ ] Annotare la dimensione del bundle frontend: `wails build` poi misurare `frontend/dist/`.
- [ ] Salvare i valori qui come riferimento per ogni step successivo.

```
Baseline .exe:         44.26 MB   (data: 2026-05-17) — con -s -w -trimpath già applicati
Baseline frontend/dist: da misurare
```

---

## Step 1 — Build flags (5 min, zero rischio)

Impatto atteso: **−20–35%** dalla dimensione grezza.

- [x] Aggiungere il flag al comando di build di produzione:
  ```
  wails build -ldflags "-s -w" -trimpath
  ```
  - `-s` rimuove la symbol table dal binary.
  - `-w` rimuove le DWARF debug info.
  - `-trimpath` rimuove i path locali di build dall'eseguibile.
  > Implementato in `build.sh` e `build.ps1` (root).
- [ ] Verificare che l'app si avvii normalmente dopo il build con i nuovi flag.
- [ ] Verificare che tutti i pannelli principali funzionino (HTTP, Proxy, Broker, gRPC).
- [ ] Annotare la nuova dimensione del `.exe`.
- [x] Documentare il comando definitivo di build produzione in `docs/BUILD.md`.

```
Dimensione dopo Step 1: 44.26 MB  (build riuscita 2026-05-17)
```

---

## Step 2 — UPX post-build (2 min, rischio AV da valutare)

Impatto atteso: **−50–60%** sul binary già strippato.

- [ ] Verificare che UPX sia installato (`upx --version`). Se non presente, scaricarlo da https://upx.github.io/.
- [ ] Eseguire la compressione sul `.exe` prodotto dallo Step 1:
  ```
  upx --best --lzma adOmnia.exe
  ```
- [ ] Verificare avvio e funzionamento normale dopo compressione.
- [ ] Testare su una macchina con Windows Defender attivo per rilevare falsi positivi.
- [ ] Se il binario viene flaggato dall'AV: valutare se usare `upx --best` senza `--lzma`
  oppure abbandonare questo step per build destinate a distribuzione enterprise.
- [ ] Annotare la dimensione finale e il tempo di avvio (deve restare sotto 2 secondi).

```
Dimensione dopo Step 2: 14.82 MB  (build riuscita 2026-05-17, UPX 5.1.1 --best --lzma, ratio 33.49%)
Tempo avvio dopo Step 2: da misurare
```

---

## Step 3 — Verifica tree-shaking frontend (1 ora)

Impatto atteso: piccolo sul .exe, ma migliora il tempo al primo frame.

- [x] Configurare `rollup-plugin-visualizer` come opt-in in `vite.config.ts`:
  ```bash
  # Installare solo quando si vuole analizzare (non incluso in package.json)
  npm install --save-dev rollup-plugin-visualizer
  # Lanciare l'analisi
  VITE_ANALYZE=1 npm run build   # apre dist/bundle-report.html
  ```
  > `vite.config.ts` ora carica il plugin dinamicamente solo se `VITE_ANALYZE=1`.
- [x] Cercare import wildcard da lucide: nessun `import *` trovato — tree-shaking già corretto.
- [ ] Eseguire l'analisi e verificare che nessun chunk superi i 250 KB gzippato.
- [ ] Annotare la dimensione di `frontend/dist/` prima e dopo eventuali correzioni.

```
Dimensione frontend/dist prima: ___ KB
Dimensione frontend/dist dopo:  ___ KB
```

---

## Step 4 — Lazy loading panel pesanti (2–4 ore)

Impatto atteso: nessuna riduzione .exe, ma **−30–50% del JS parsato all'avvio**.
I pannelli pesanti vengono caricati solo quando l'utente li apre per la prima volta.

Panel candidati (in ordine di impatto):

- [x] `BrokerStudioPanel` (5 sub-pannelli: Kafka, RabbitMQ, MQTT, Redis, NATS)
- [x] `DatabasePanel` (driver multipli, query editor)
- [x] `GrpcPanel` (protoreflect binding, proto tree)
- [x] `DockerLabPanel`
- [x] `HarViewerPanel`

Per ogni pannello:

- [x] Sostituire l'import statico con `React.lazy` in `MainArea.tsx`:
  ```tsx
  const BrokerStudioPanel = React.lazy(() =>
    import('@/components/kafka/BrokerStudioPanel').then(m => ({ default: m.BrokerStudioPanel }))
  )
  ```
- [x] Aggiungere `<Suspense fallback={<PanelSkeleton />}>` nel punto di render in `MainArea.tsx`.
- [x] Creare componente `PanelSkeleton` minimo (spinner) in `MainArea.tsx`.
- [ ] Verificare che il pannello si carichi correttamente alla prima apertura.
- [ ] Verificare che lo stato non venga perso tra navigazioni (dipende da come il panel è montato/smontato).
- [ ] Misurare il tempo al primo frame con DevTools prima e dopo.

---

## Step 5 — Build tag lite/full (2–3 giorni, sforzo maggiore)

Impatto atteso: **−15–20 MB** dal binary lite escludendo SQLite, MongoDB,
Kafka, gRPC e i relativi driver.

Prerequisiti: completare Step 1 e 2 prima di valutare se questo step è necessario.

### 5a — Mappare i file di backend per tag

- [ ] Identificare tutti i file `.go` che importano dipendenze pesanti:
  - `modernc.org/sqlite` → `database_go.go` o file correlati
  - `go.mongodb.org/mongo-driver` → file DB
  - `github.com/IBM/sarama` → file Kafka
  - `github.com/jhump/protoreflect` + `google.golang.org/grpc` → file gRPC
- [ ] Per ogni file: aggiungere build tag in cima:
  ```go
  //go:build full
  ```
- [ ] Creare file stub per ogni feature esclusa con tag inverso:
  ```go
  //go:build !full
  // Stub: funzione restituisce errore "feature not available in lite build"
  ```

### 5b — Wails command registration condizionale

- [ ] Verificare che `app.go` registri i command condizionalmente in base ai tag.
- [ ] Testare che il build lite (`wails build -ldflags "-s -w" -trimpath`) compili senza errori.
- [ ] Testare che il build full (`wails build -tags full -ldflags "-s -w" -trimpath`) compili e funzioni.

### 5c — UI frontend condizionale

- [ ] Nel frontend, nascondere le voci Rail che corrispondono a feature non incluse nel lite build.
- [ ] Strategia: il backend può esporre una rotta `/api/features` che restituisce le feature attive.
  Oppure, più semplice: compilare due versioni separate del frontend con Vite `define`.

### 5d — Verifica e misura

- [ ] Annotare la dimensione del binary lite.
- [ ] Annotare la dimensione del binary full.
- [ ] Aggiornare `docs/BUILD.md` con i due comandi di build separati.
- [ ] Aggiornare `README.md` con la distinzione lite/full se viene rilasciata come scelta.

```
Dimensione binary lite (Step 5): ___ MB
Dimensione binary full (Step 5): ___ MB
```

---

## Riepilogo target

| Step | Tecnica                    | Rischio  | Sforzo   | Risparmio atteso |
|------|----------------------------|----------|----------|------------------|
| 1    | `-s -w -trimpath`          | Nessuno  | 5 min    | −20–35%          |
| 2    | UPX `--best --lzma`        | AV check | 2 min    | −50–60% sul resto|
| 3    | Analisi tree-shaking Vite  | Nessuno  | 1 ora    | −5–10% frontend  |
| 4    | React.lazy panel pesanti   | Basso    | 2–4 ore  | 0 sul .exe, avvio|
| 5    | Build tag lite/full        | Medio    | 2–3 gg   | −15–20 MB lite   |

**Target realistico con Step 1+2:** da ~45 MB a **~12–16 MB**.
**Target con Step 1+2+5 (lite):** potenzialmente sotto **8–10 MB**.

---

## Regola finale

Un binary più piccolo non vale nulla se l'app non si avvia o una feature si rompe.
Ogni step deve essere verificato manualmente prima di procedere al successivo.
