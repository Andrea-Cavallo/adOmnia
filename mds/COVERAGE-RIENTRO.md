# Coverage — piano di rientro al gate SonarCloud

**Stato al 2026-10-23** (analisi `main` delle 14:47, progetto `Andrea-Cavallo_adOmnia`).

Il gate è rosso su una sola condizione sostanziale:

| Condizione new code | Valore | Soglia | Esito |
|---|---|---|---|
| `new_coverage` | **52,4%** | ≥ 80% | **ERROR** |
| `new_reliability_rating` | 3 | 1 | ERROR → dovuto ai finding chiusi il 2026-10-23, da confermare alla prossima scansione |
| `new_security_rating` | 3 | 1 | ERROR → idem |
| `new_maintainability_rating` | 1 | 1 | OK |
| `new_duplicated_lines_density` | 0,4% | ≤ 3% | OK |
| `new_security_hotspots_reviewed` | 100% | 100% | OK |

Questo documento riguarda `new_coverage`. Le due rating si chiudono con la scansione del lavoro già
committato (`e8e42023`, `a9c0ba11`), non con altro codice.

## 1. Aritmetica del rientro

| Grandezza | Valore |
|---|---|
| Righe nuove da coprire | 7.484 |
| Righe nuove scoperte | 3.576 |
| Coverage attuale | 52,2% |
| Scoperte massime a 80% | 1.497 |
| **Righe da coprire per il gate** | **2.079** |
| Scoperte massime a 82% (margine) | 1.347 |
| **Righe da coprire per 82%** | **2.229** |

Il piano punta a **82%**, non a 80%: la misura dipende da quali file entrano in `lcov.info` e da
quali righe Sonar considera "nuove", quindi serve margine per non restare appesi al decimale.

## 2. Dove sono le righe

| Area | Righe nuove | Scoperte | Coverage |
|---|---|---|---|
| Go (`internal/`, `scripts/`, `cmd/`) | 5.245 | 2.098 | 60,0% |
| Frontend (`frontend/src/`) | 2.239 | 1.478 | 34,0% |

Il frontend è il problema più grave in percentuale, il Go lo è in valore assoluto.

**Go** — 18 file contengono 1.349 delle 2.098 righe scoperte (64%), e sono tutti in pacchetti che
hanno già una suite di test: non manca l'infrastruttura, mancano i casi.

| Fascia | File | Scoperte | Note |
|---|---|---|---|
| ≥ 20 righe, test già presente | 18 | 1.349 | concentrazione massima, miglior rapporto righe/ora |
| 10–19, test presente | 18 | 254 | |
| 5–9, test presente | 27 | 176 | |
| 1–4, test presente | 83 | 166 | chiusura fine |
| qualsiasi fascia, nessun test | 13 | 105 | |

**Frontend** — 1.396 delle 1.478 righe scoperte stanno in file che **nessun test importa**: con
Vitest una componente non importata non compare in `lcov.info`, quindi Sonar la conta interamente
scoperta. Non è "codice difficile da testare", è codice senza alcun test.

| Fascia | File | Scoperte |
|---|---|---|
| ≥ 20 righe, nessun test | 7 | 224 |
| 10–19, nessun test | 38 | 501 |
| 5–9, nessun test | 60 | 405 |
| 1–4, nessun test | 130 | 266 |

I file più pesanti: `CodeStudioRustToolchain.tsx` (58), `CodeStudioRunTarget.tsx` (45),
`lib/assertionEngine.ts` (31), `CodeStudioRustTree.tsx` (27), `collab/CollabProject.tsx` (21),
`codeStudioRustCommands.ts` (20), `apidocs/OASGovernancePanel.tsx` (19).

## 3. Il piano in sei ondate

Ogni ondata è una PR indipendente e verificabile. Le percentuali sono cumulative e calcolate sulle
7.484 righe nuove.

| # | Ondata | Righe | Scoperte dopo | Coverage |
|---|---|---|---|---|
| 0 | Strumenti e regole | — | 3.576 | 52,2% |
| 1 | Go — logica pura e orchestrazione | **~570** ✅ | ~3.006 | ~60% |
| 2 | Go — sottosistema Rust | ~244 | ~2.650 | ~65% |
| 3 | Go — driver esterni dietro interfaccia | ~445 | ~2.205 | ~70% |
| 4 | Frontend — i 45 componenti con ≥ 10 righe | ~725 | ~1.480 | ~80% |
| 5 | Margine: frontend 5–9 e Go 1–4 | ~380 | ~1.100 | ~85% |

**Il gate si attraversa alla fine dell'ondata 4**, ma senza margine: la 5 serve a non tornarci.

### Ondata 0 — Strumenti e regole (mezza giornata)

Serve a non lavorare alla cieca e a non riaprire il buco domani.

- comandi di misura per singolo file (vedi §5), verificati;
- script `scripts/coverage-gap.mjs` che interroga Sonar e stampa il divario (totale, per area, file
  peggiori) senza aprire il browser; esce con codice ≠ 0 finché il divario è aperto, così può diventare
  un gate una volta chiuso il debito:

  ```bash
  node scripts/coverage-gap.mjs
  node scripts/coverage-gap.mjs --top 40 --json out.json
  ```

- `docs/QUALITY.md`: sezione "Coverage on new code" con la regola di ingaggio (§4) e il significato
  del numero;
- prima misura registrata in fondo a questo file (§7).

### Ondata 1 — Go, logica pura e orchestrazione (~680 righe)

Nessun servizio esterno da avviare: sono funzioni che producono testo, decidono percorsi o
orchestrano passaggi già iniettati.

**FATTA il 2026-10-23.** Misure locali (`go test -coverprofile` per package), prima → dopo:

| Package | Prima | Dopo | Righe Sonar coperte |
|---|---|---|---|
| `internal/adomniacli` (`mcp_bench.go`) | 64,0% | **75,6%** | ~220 su 248 |
| `internal/loadtest` (`loadtest.go`) | 30,5% | **88,4%** | ~52 su 52 |
| `internal/archivetest` (nessun test) | 0% | **75,0%** | ~30 su 35 |
| `internal/ide/run` (`processes.go`) | 12,8% | **37,3%** | ~35 su 38 |
| `internal/languages/golang` (`handler_testgen.go`) | 67,9% | **71,4%** | 92 su 92 (file al 100%) |
| `internal/codestudio` (`service_rust*.go`, `trace.go`) | 0% sulle funzioni | **97,0% / 80,3% / 88,1%** | ~140 su 159 |

Evidenza: `go build ./...`, `go vet` sui cinque package, test verdi su Windows; nessuna rete, nessun
binario esterno, nessun `time.Sleep` di sincronizzazione. File nuovi: `<file>_coverage_test.go`
accanto a ciascun file coperto.

Due punti da ricordare:

- **`mcp_bench.go`: unica modifica al codice di produzione** — `var startupProbe = (*mcpServer).appStartupTime`
  e un call-site in `performanceReport`, per non lanciare un sottoprocesso nei test. Comportamento
  identico; `appStartupTime` resta a 0% con il motivo scritto, invece di essere forzata.
- **Bug reale trovato dai test** in `handler_testgen.go`: `handlerImportNames` ricavava il nome del
  package da `path.Base`, quindi `github.com/labstack/echo/v4` diventava `v4` e un handler Echo con
  import **non aliasato** non veniva riconosciuto. Corretto con `importPackageName` (il segmento
  `/vN` è una major version, non il nome del package) e coperto da un test dedicato.

Consuntivo: circa **570 righe** coperte sui ~680 previsti. Il residuo è `internal/update/apply.go`
(58 righe), che non è stato fatto: installer e swap di file, molti rami di errore di piattaforma —
va trattato a parte, con `t.TempDir()` e percorsi iniettati, non dentro un'ondata "senza I/O". Finisce
nell'ondata 5 insieme al margine.

### Ondata 2 — Go, sottosistema Rust (~244 righe)

| File | Scoperte |
|---|---|
| `internal/languages/rust/toolchain.go` | 63 |
| `internal/languages/rust/codelldb.go` | 48 |
| `internal/securityintel/cargo/adapter.go` | 41 |
| `internal/languages/rust/debug.go` | 37 |
| `internal/languages/rust/runner.go` | 36 |
| `internal/languages/rust/coverage.go` | 19 |

Regola: si sostituisce l'esecuzione (`exec.Command`, download) con una funzione iniettata nel test;
non si scarica e non si compila nulla in CI.

> Nota: `internal/languages/rust/debug_test.go` è in lavorazione in un'altra sessione. Questa ondata
> riparte da lì e non duplica quel lavoro.

### Ondata 3 — Go, driver esterni dietro interfaccia (~445 righe)

È l'ondata con più lavoro di progetto e meno righe: richiede di introdurre un'interfaccia stretta
attorno al client, così il test parla con un finto invece che con un server.

| File | Scoperte | Interfaccia da introdurre |
|---|---|---|
| `internal/database/mongo_ops.go` | 271 | `collection`/`cursor` minimi (find, aggregate, insert, update, delete) |
| `internal/database/redis.go` | 81 | comandi usati dal pannello, non `redis.Client` intero |
| `internal/docker/lab.go` | 71 | client Docker come interfaccia già usata altrove nel package |
| `internal/broker/broker.go` | 22 | pubblicazione/consumo |

Alternativa da valutare solo se il refactor costa più delle righe guadagnate: escludere dal calcolo
**solo** i punti che parlano con il driver nudo (policy in §4), mai il file intero.

### Ondata 4 — Frontend, i 45 componenti con ≥ 10 righe (~725 righe)

Un test per componente, con almeno un'asserzione di comportamento: render, una interazione, il
risultato visibile. I 45 file sono elencati dallo script dell'ondata 0, in ordine di righe scoperte.

Criterio di scrittura (evita test che gonfiano il numero senza valore):

- si parte dalla funzione o dal ramo più utile, non dal "renderizzare e basta";
- ogni test asserisce qualcosa di osservabile (testo, `role`, chiamata a un handler);
- i rami di errore (`catch`, validazione, stato vuoto) valgono più del ramo felice: sono quelli che
  nessuno esercita mai a mano.

### Ondata 5 — Margine (~380 righe)

- frontend, banda 5–9: 60 file, 405 righe — si prendono i primi ~50 per righe scoperte;
- Go, banda 1–4 con test già presente: 83 file, 166 righe — chiusura a basso costo per file.

## 4. Regole di ingaggio

Valgono da subito, altrimenti il buco si riapre con lo stesso ritmo con cui lo si chiude.

1. **Definition of done**: un file nuovo o modificato arriva con i test delle righe che cambiano.
   Nessuna PR che aggiunge codice senza test, anche piccola.
2. **Il gate new code non si aggira**: non si sposta la baseline, non si restringe `sonar.sources`,
   non si riduce il new code period per far tornare il numero.
3. **Esclusioni ammesse** (`sonar.coverage.exclusions`), ognuna con una riga di motivo in
   `docs/QUALITY.md`:
   - codice generato (bindings Wails, `*.generated.*`, `frontend/dist/**`);
   - entry point puri (`main.tsx`, `cmd/**/main.go`) che non contengono logica;
   - codice che richiede un dispositivo o un servizio reale e non ha un punto di iniezione — **solo
     se** il refactor costerebbe più delle righe che copre, e solo per le righe di chiamata, non per
     il file intero.
4. **Vietati i test che non asseriscono.** Un `render()` senza asserzione, `expect(true)`,
   snapshot automatici di componenti interi: alzano il numero e non proteggono nulla. In review si
   guarda cosa asserisce il test, non la percentuale.
5. **Una ondata = una PR**, con nel corpo il prima/dopo della misura.

## 5. Strumenti (verificati il 2026-10-23)

Copertura di un singolo file frontend, con le righe scoperte in chiaro:

```bash
cd frontend
npx vitest run src/lib/substVars.test.ts \
  --coverage --coverage.include=src/lib/substVars.ts --coverage.reporter=text
```

Copertura Go di un pacchetto, ordinata per funzione peggiore:

```bash
go test ./internal/nettools/ -coverprofile=c.out -count=1
go tool cover -func=c.out
```

Totale Go del progetto e tabella per pacchetto:

```bash
go test ./internal/... ./cmd/... -coverprofile=coverage.out -covermode=atomic
scripts/coverage-summary.sh coverage.out
```

Lettura del divario reale dal gate (quello che conta per il rientro):

```
https://sonarcloud.io/api/measures/component_tree?component=Andrea-Cavallo_adOmnia&branch=main
  &metricKeys=new_lines_to_cover,new_uncovered_lines&qualifiers=FIL&ps=500&p=1
```

Somma di `new_uncovered_lines` sui file: se scende sotto 1.497 il gate è verde.

## 6. Rischi

| Rischio | Effetto | Mitigazione |
|---|---|---|
| La copertura si misura sui file importati: una componente "testata" ma non importata resta a 0 | ondata 4 sembra non muovere il numero | verificare con `--coverage.include` sul file prima di chiudere il test |
| Mongo/Redis/Docker senza server in CI | ondata 3 si blocca | interfaccia stretta + finto; mai Testcontainers in CI per questo gate |
| Test fragili scritti di fretta | rossi intermittenti, il gate torna rosso per altri motivi | niente timer reali, niente rete, `vi.useFakeTimers()` dove serve |
| Il denominatore cresce a ogni commit | il 52,4% peggiora anche lavorando | regola 1: il codice nuovo nasce coperto |
| Coverage gonfiata senza asserzioni | numero verde, prodotto fragile | regola 4, review sul contenuto dei test |
| Lavoro concorrente sullo stesso file (Rust) | conflitti | ondata 2 parte dopo il merge del lavoro Rust in corso |

## 7. Registro delle misure

| Data | Scoperte | Da coprire | Coverage | Note |
|---|---|---|---|---|
| 2026-10-23 | 3.576 | 7.484 | 52,4% | baseline, analisi `main` 14:47 |
| 2026-10-23 | — | — | — | ondata 0+1: ~570 righe coperte (misure locali per package, §3). Il dato Sonar si aggiorna alla prima scansione dopo il commit |
