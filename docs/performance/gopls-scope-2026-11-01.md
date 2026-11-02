# gopls: budget, scope e hover sul repo reale — 2026-11-01

Misura a supporto della preferenza **Hover detail** (`hoverKind`, default `synopsis`) e della
decisione se restringere lo scope della view. Banco già presente nel repo
(`internal/languages/golang/gopls_memory_measure_test.go`), nessuno strumento nuovo.

## Misura

```powershell
$env:ADOMNIA_MEASURE_LSP_ROOT = (Get-Location).Path
$env:ADOMNIA_MEASURE_LSP_BINARY = "$env:APPDATA\adomnia\goide\tools\bin\gopls.exe"
go test ./internal/languages/golang -run TestMeasureLanguageServerMemory -v -count=1 -timeout 45m
```

Repo adOmnia, gopls v0.24.0, Windows 11, 28 CPU logici. Nove celle: budget 1 GiB / 768 MiB /
512 MiB × scope `full` / `codestudio-subdirectory` (`expandWorkspaceToModule=false`) /
`selected-directories` (`-` tutto, `+internal/codestudio`, `-**/node_modules`). Ogni cella avvia
un gopls nuovo, chiede i workspace symbol, un hover e cinque symbol a caldo.

## Esito

| Budget | Scope | RSS MiB | load ms | hover ms | symbol a caldo ms | CPU s | simboli |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 GiB | full | 997,6 | 10.149 | 136 | 124,6 | 21,03 | 100 |
| 1 GiB | subdirectory | 449,3 | 8.810 | 64 | 49,4 | 4,95 | 100 |
| 1 GiB | selected dirs | 273,3 | 8.731 | 71 | 16,5 | 2,72 | 35 |
| 768 MiB | full | 706,6 | 9.024 | 72 | 43,1 | 7,95 | 100 |
| 768 MiB | subdirectory | 303,5 | 8.513 | 59 | 50,9 | 4,59 | 100 |
| 768 MiB | selected dirs | 371,7 | 8.350 | 65 | 13,1 | 2,61 | 35 |
| 512 MiB | full | 376,1 | 8.510 | 68 | 46,0 | 5,09 | 100 |
| 512 MiB | subdirectory | 306,9 | 8.443 | 59 | 52,9 | 4,03 | 35 |
| 512 MiB | selected dirs | 277,9 | 8.403 | 69 | 14,9 | 2,94 | 35 |

## Cosa dicono i numeri

- **`GOMEMLIMIT` è un obiettivo di allocazione, non un tetto.** Sullo stesso scope `full`: 1 GiB →
  997,6 MiB, 768 MiB → 706,6 MiB, 512 MiB → 376,1 MiB. gopls riempie il budget che gli dai, quindi
  alzarlo non compra margine: sposta il consumo verso l'alto. Il valore misurato nella registrazione
  dell'app (675 MiB con budget 768 MiB, 88%) è esattamente questo comportamento, non una fuga.
- **Lo scope, non l'hover, decide la RSS.** A 768 MiB il repo intero sta a 706,6 MiB, la view sulla
  sottocartella a 303,5 MiB: **−57%**. È l'unica leva che sposta la memoria di centinaia di MiB.
- **Ma lo scope costa copertura, e non è gratis.** Con `selected-directories` la ricerca symbol
  trova **35** simboli invece di 100, e a 512 MiB anche `subdirectory` scende a 35: restringere la
  view riduce quello che il server conosce. Per questo non diventa un default (vedi sotto).
- **Il tempo di caricamento non si muove.** `load_ms` resta 8,4–10,1 s in tutte e nove le celle: non
  dipende né dal budget né dallo scope. È il `go list` + type-check già profilato in
  [gopls-load-2026-10-24](gopls-load-2026-10-24.md), ed è la causa dei 4 `go.exe` e del 32% di CPU
  visti nella registrazione dell'app.
- **Hover a caldo costa uguale in ogni cella: 59–72 ms.** Il 136 ms della prima cella è cache
  fredda (prima esecuzione della sessione, 21 CPU-secondi contro 5–8 delle successive), non il
  budget né lo scope.

## Limiti dichiarati

- **Una misura per cella (n=1)**: nessuna deviazione standard, e le celle sono state eseguite in
  sequenza, quindi la prima paga la cache fredda. Le direzioni (budget → RSS, scope → RSS, scope →
  copertura) sono coerenti, l'ordine di grandezza esatto no.
- **Questo banco non isola `hoverKind`.** Misura un hover su un documento già caricato, dove la
  latenza è dominata dallo stato caldo. Il risparmio di `synopsis` sta nella documentazione risolta
  per i pacchetti **non ancora caricati**, che qui non viene misurata. Dichiararlo misurato sarebbe
  falso: la verifica è lo scenario `hover-browse` della suite di scenario in [PERFORMANCE.md](../PERFORMANCE.md).

## Decisione

1. **Nessun cambio di default sullo scope.** `expandWorkspaceToModule` e `directoryFilters` restano
   scelte dell'utente: dimezzano la RSS ma riducono la copertura dei symbol, e la cella che lo
   dimostra (`subdirectory`) cambia **due** variabili insieme (cartella di checkout e flag), quindi
   non attribuisce il guadagno al solo flag.
2. **Il budget resta 768 MiB.** I numeri qui confermano che abbassarlo riduce la RSS (376 MiB a
   512) ma la campagna [typing-2026-10-24](typing-2026-10-24.md) ha già misurato il prezzo sulla
   completion (4× più lenta, 7,6× CPU).
3. **`hoverKind` resta una preferenza con default `synopsis`**, perché riduce il payload di
   documentazione senza toccare ciò che questo banco misura (hover a caldo e symbol invariati).
   La conferma quantitativa richiede lo scenario `hover-browse`.
