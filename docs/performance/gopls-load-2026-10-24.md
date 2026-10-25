# gopls: cosa costa il caricamento del workspace — 2026-10-24

Risposta a **PERF-1.4**: profilare cosa fa gopls durante i secondi di "workspace pronto" e stabilire se la sospensione per inattività si ripaga.

## Misura

Profilo CPU di gopls durante il caricamento, non dell'app:

```powershell
$env:ADOMNIA_MEASURE_LSP_ROOT = (Get-Location).Path
$env:ADOMNIA_MEASURE_LSP_BINARY = "$env:APPDATA\adomnia\goide\tools\bin\gopls.exe"
$env:ADOMNIA_MEASURE_LSP_TYPING = "1"
$env:ADOMNIA_MEASURE_LSP_DURATION = "3s"
$env:ADOMNIA_MEASURE_LSP_DEBUG = "localhost:6061"
$env:ADOMNIA_MEASURE_LSP_CPUPROFILE = "$env:TEMP\gopls-load.cpuprofile"
go test ./internal/codestudio -run '^TestMeasureLanguageServerTyping$' -count=1 -timeout 20m -v
go tool pprof -top -nodecount=20 "$env:TEMP\gopls-load.cpuprofile"
```

`gopls serve` non ha `-cpuprofile`: il profilo arriva dal server di debug (`-debug`) mentre il workspace si carica.

## Esito

6 secondi di profilo, 17,65 s di campioni su più thread (294%): il tempo non è CPU di analisi.

| Voce | flat | cum |
|---|---:|---:|
| `runtime.cgocall` | 99,77% | 99,77% |
| `internal/poll.(*FD).Read` / `io.Copy` / `bytes.(*Buffer).ReadFrom` | — | 66,1% |
| `gocommand.runCmdContext` (sottoprocesso `go`) | — | 33,0% |
| `modindex.Update` (indice della module cache) | — | 0,7% |
| `gopathwalk.WalkSkip` | — | 0,5% |

gopls passa quasi tutto il tempo **bloccato a leggere l'output del comando `go`** che esegue per caricare i pacchetti (`go/packages`): lettura della pipe, non parsing Go. L'indicizzazione della module cache e il walk delle directory sono rumore (<1%).

Conferma esterna: sul repo adOmnia (111 pacchetti, cache calda) `go list ./...` da solo misura **3,35 s**. Il caricamento completo misurato dal banco è 6,2–7,6 s: circa metà è il `go list`, il resto parsing e type-check dei pacchetti da parte di gopls.

Conseguenze:

- Il budget `GOMEMLIMIT` non c'entra col tempo di caricamento: in tutte le campagne 768 e 512 MiB hanno gli stessi `load_ms` (6,2–7,8 s contro 6,1–7,8 s).
- Il tempo scala con il progetto, non con il limite: stesso banco su un modulo di 4 file carica in 0,5–1,1 s, cioè un ordine di grandezza in meno, a qualunque budget.
- Filtrare directory o sorgenti non è una leva automatica: la misura del 2026-10-16 con `directoryFilters` non ha garantito né meno RSS né meno tempo, e non va escluso in blocco codice Go.

## Sospensione per inattività: non c'è

`internal/codestudio/lsp_idle.go` non ha un timer. `armIdle` registra soltanto *quando* il server è diventato inattivo; niente viene fermato per inattività. L'unico meccanismo che spegne un server è il budget di memoria globale (`lsp_budget.go`), che iberna il server rimasto inattivo più a lungo **solo quando la RAM misurata supera il budget** — e non uccide PID, riusa gli stessi controlli della sospensione normale (editor sporchi, richieste pendenti, avvii espliciti).

Quindi non c'è nulla da "ripagare a ogni resume" nel funzionamento normale: il riavvio costa il caricamento completo (≈7 s su questo repo, misurato), e si paga solo quando la RAM è davvero esaurita. La scelta di non avere un timer è coerente con i numeri: spendere 7 s e ~0,5 core per liberare ~650 MiB a intervalli fissi peggiorerebbe l'editor senza un beneficio di RAM continuo.

## Cosa resta aperto

La voce chiedeva anche di valutare come ridurre il tempo di caricamento. Le strade misurate non lo riducono (budget, filtri). Le due che restano hanno costo e rischio propri e vanno affrontate come voci separate, non dentro PERF-1.4:

1. **Ridurre il lavoro di `go list`**: dipende da quanti moduli e pacchetti il workspace espone all'avvio, non da gopls.
2. **Non ripetere il caricamento al resume**: richiede un daemon condiviso o uno stato serializzato, cioè PERF-3.4 con i suoi numeri.
