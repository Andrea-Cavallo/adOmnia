# adOmnia Security Intelligence — handoff

Stato al 2026-10-18. Serve a una sessione che riprende il lavoro **a partire da zero**.

## Contesto in una riga

adOmnia è un toolbox desktop (Wails 3 + Go backend + React 19/TS frontend). Il modulo
**adOmnia Security Intelligence** è il motore di sicurezza delle dipendenze: un solo
engine estendibile, adapter per ecosistema. Prima di toccare codice leggi `CLAUDE.md`
e `AGENTS.md`. Filosofia: **product-first**, local-first, piccole modifiche mirate.

## Cosa esiste già (verificato, test verdi)

```
internal/securityintel/            core del motore (NON importa adapter — architecture_test.go)
  model.go        Component, Advisory, VersionRange, Origin, Scope, Exposure
  severity.go     CVSS 3.1 calcolato dal vettore, parsing CVSS 4.0, EPSS, KEV separati
  reachability.go called/potentiallyReachable/imported/required/notReachable/unknown
  risk.go         priorità P0-P3 con 10 regole esplicite + lista reasons
  source.go       Source/Enricher, deduplica per alias, enrichAdvisory
  osv.go          OSV batch API + normalizzazione intervalli per pacchetto
  enrichment.go   FIRST EPSS, CISA KEV
  cache.go        database locale JSON → scansioni offline
  version.go      confronto versioni (semantica Maven ComparableVersion) + range
  export.go       JSON, SARIF 2.1.0, HTML, CycloneDX 1.5, SPDX 2.3 (purl)
  workspace.go    suppression in .adomnia/dependency-security.json (motivo + scadenza)
  engine.go       orchestratore Scan(ctx, ScanRequest) (ScanReport, error)
  adapter.go      EcosystemAdapter + capability opzionali per type assertion
  architecture_test.go   vieta core → adapter
  maven/          pom.go, resolve.go, adapter.go  (parent/BOM/dependencyManagement)
  gomod/          adapter.go  (go.mod/go.work, replace, exclude, stdlib+toolchain)
  govuln/         stream.go  (parser puro stream govulncheck)
```

- **Refactor già fatto**: il parser govulncheck vive in `internal/securityintel/govuln`.
  `internal/codestudio/vulncheck.go` lo riusa con **alias di tipo** (`VulnReport = govuln.Report`
  ecc.) per non rompere i nomi e i tag JSON esposti ai binding Wails. **Non cambiarli.**
- Binding Wails: `securityintel_bindings.go` (servizio `SecurityIntel`, package `main`).
  Registrato in `main.go` con `application.NewService(securityIntel)`.
- Frontend: `src/lib/securityIntel-api.ts`, `src/components/security/SecurityCenterPanel.tsx`,
  `src/components/security/SecurityFindingInspector.tsx`, rail id `security`.
- Catalogo: `docs/adomnia-feature-catalog.en.md` sezione **K. SECURITY INTELLIGENCE** (K1.1–K1.13).

## Perché `frontend/bindings/adomnia/securityintel.ts` è scritto a mano

**SUPERATO (2026-10-18).** La CLI `wails3` non era installata e il binding era stato scritto a mano
replicando la forma generata, con ID di metodo calcolati a mano come
`methodID = FNV-1a 32-bit di "main.<TypeName>.<MethodName>"` (verificato: `main.OASLint.Lint` = 325496117).
Oggi la CLI si lancia senza installarla e i bindings sono **generati**:

```
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28 generate bindings -clean=true -ts ./...
```

(attenzione: il progetto usa `wails/v3 v3.0.0-beta.28` in `go.mod`, `@latest` prende beta.31). I metodi
`PreviewUpgrade`, `PlanUpgrade`, `RunUpgradeStep`, `FinishUpgrade` sono nel file generato con ID corretti:
non serve più ricalcolare nulla a mano.

## Cosa manca — i quattro punti aperti

**Stato al 2026-10-18: tutti e quattro implementati, test verdi, catalogo K aggiornato, flusso di
remediation provato end-to-end su manifest reali.** Resta solo la **verifica che la UI mostri il
flusso come un utente lo vede**: `MANUAL-CHECK.md` → **SEC-1** (9 voci + gate). Quella richiede
`wails3 task dev` e un occhio umano sul pannello; la logica sotto è provata dal test
`internal/securityintel/e2e`.

### 1. CVSS 4.0 base score — `internal/securityintel/cvss4.go`
**IMPLEMENTATO (2026-10-18).** Punteggio base con l'algoritmo delle macrovector del documento FIRST
(§3.1 lookup + §3.2 interpolazione), tabella `cvss40Lookup` dai valori di `cvss_lookup.js` del
calcolatore di riferimento. Calcolato **solo** quando la fonte non fornisce il punteggio: quello di
fonte resta autorevole e `NormalizeSeverity()` non lo sovrascrive mai (`ScoreSource: "computed"` solo
sul calcolato). Test `cvss4_test.go` costruiti sui vettori di riferimento FIRST, non su valori
dell'implementazione stessa. **Da fare:** nessuno.

> **Nota importante sui vettori di riferimento di questo documento:** due dei quattro valori
> ipotizzati qui erano **sbagliati** e il test li ha corretti verificando il validation reference set
> FIRST (`FIRSTdotorg/cvss-resources`, `base-threat-vectors` / `base-threat-scores`) e gli esempi
> ufficiali:
> - `…/UI:P/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H` → **9.4** (non 9.3: è uno dei vettori peggiori del proprio
>   macrovector, e la differenza di gravità dentro un macrovector si recupera solo interpolando);
> - `…/AV:N/AC:H/AT:P/…/SC:N/SI:N/SA:N` → **9.2** (non 8.2: quel valore appartiene alla stessa serie
>   con la metrica Threat `E:P`).
> È la prova che il vincolo "un punteggio sbagliato è peggio che non averlo" è stato rispettato.

### 2. Raggiungibilità Maven via bytecode — `internal/securityintel/maven/bytecode.go`
**IMPLEMENTATO (2026-10-18).** Analisi delle classi compilate (`target/classes/**/*.class` e i jar in
`target/`), `Evidence` con `Method: EvidenceMethodBytecodeReference` (`"bytecode-reference"`).
Distinzione onesta rispettata e verificata in `reachability_test.go`:
- invocazione reale sull'istruzione verso il simbolo vulnerabile → `Confirmed: true` → `ReachabilityCalled`
- riferimento senza chiamata provabile (riflessione, class loading, framework, OSGi) → `ReachabilityPotentiallyReachable`
- niente trovato → `ReachabilityUnknown` con `Note` che lo dice
L'assenza di riferimenti **non** diventa mai `notReachable`. **Da fare:** nessuno.

### 3. Security Impact Before Update — `internal/securityintel/remediation.go`
**IMPLEMENTATO (2026-10-18).** `PreviewUpgrade(ctx, sources, report, component, targetVersion)` confronta per
identità advisory (`advisoryIdentity`) il set corrente, letto dal report, con quello che le stesse `Source`
danno per il componente alla versione target. Produce `UpgradePreview`: advisory risolti, quelli che restano,
quelli introdotti, classe di compatibilità (`CompatibilityClassOf`) e consiglio. `Engine.fillRemediationImpact`
popola `Remediation.Resolves`/`Introduces`/`Compatibility` a ogni scansione e imposta `Blocked`/`BlockedReason`
quando la correzione non è applicabile (nessun fix pubblicato, versione gestita da parent/BOM/
`dependencyManagement`, dipendenza transitive, `replace`, toolchain). Binding `PreviewUpgrade` sul servizio
`SecurityIntel` + wrapper in `src/lib/securityIntel-api.ts`. Test: `remediation_test.go`, `gomod/manifest_test.go`,
`maven/manifest_test.go`.

### 4. One-click Safe Remediation
**IMPLEMENTATO (2026-10-18).** `internal/securityintel/apply.go` (`PlanStore`): `PlanUpgrade` genera il testo
modificato del manifest — capability `UpgradeEditor`, implementata in `gomod/manifest.go` (via
`golang.org/x/mod/modfile`) e `maven/manifest.go` (pom.xml: `<version>` dichiarato o proprietà) — **senza
scrivere nulla**, con il diff unificato da rivedere. `RunUpgradeStep` esegue un passo alla volta: write (con
backup `*.adomnia-restore`), resolve, poi i passi descritti dall'adapter (checksums/build/test) e il rescan
confrontato con `UpgradePreview`. `FinishUpgrade` rende definitiva la modifica solo dopo la conferma
dell'utente; con `apply=false` il manifest torna esattamente com'era. Ogni passo che avvia un processo
controlla `ResolveOptions.AllowProcesses` (lo schema già in uso per `mvn`/`govulncheck`): senza
autorizzazione il passo risulta `skipped`, mai eseguito. Offline: `GOPROXY=off` (Go) e `mvn -o` (Maven).
Frontend: flusso *Preview diff → Run checks → Apply* con stato per passo in
`components/security/SecurityUpgradeFlow.tsx`, montato in `SecurityFindingInspector`.
**Bug trovato e corretto il 2026-10-18:** il passo `resolve` ignorava `AllowProcesses` e, quando la
risoluzione falliva per mancanza di autorizzazione, risultava `failed` invece di `skipped` —
violava SEC-1.4. Ora: senza autorizzazione il passo non è mai `ok` per supposizione; se la verifica
non è possibile resta `skipped — external tools are not authorized`, se invece è possibile senza
strumenti esterni (Maven legge il pom) è davvero `ok`.
**Prova end-to-end su manifest reali**: `internal/securityintel/e2e/e2e_test.go` esegue l'intero
flusso su `go.mod` o `pom.xml` reali (copiati in temp, il progetto non si tocca):
`SECURITY_SAMPLE_DIR=<progetto> go test ./internal/securityintel/e2e/ -run TestSafeRemediationOnARealManifest -v`.
Copre SEC-1.1—SEC-1.5 a livello di logica; resta la verifica che la UI le mostri.
Verifica manuale: `mds/MANUAL-CHECK.md` → **SEC-1**.

## Vincoli da non violare

- I nomi e i tag JSON dei tipi esposti ai binding Wails restano identici (`VulnReport` ecc.).
- Il core `internal/securityintel` **non** importa `maven/`, `gomod/`, `govuln/`, `languages/`,
  `codestudio`. C'è `architecture_test.go` che lo impone.
- **Privacy by design**: solo coordinate di pacchetto verso l'esterno, mai sorgenti o nomi di
  file. Rispettare `internal/netpolicy` e la modalità Offline.
- Nessun valore di sicurezza inventato: se un calcolo non è verificabile, non si calcola.
- Le suppression richiedono motivo scritto e scadenza.
- Aggiornare `docs/adomnia-feature-catalog.en.md` (sezione K) quando cambia un comportamento.

## Comandi di verifica

```bash
go build ./...                                   # deve passare
go vet ./internal/securityintel/...
gofmt -l internal/securityintel                  # deve essere vuoto
go test ./internal/securityintel/... -count=1
go test ./internal/codestudio/ -run "Vuln|Govuln" -count=1   # il refactor non deve rompersi
# flusso di remediation end-to-end su un manifest reale (go.mod o pom.xml):
SECURITY_SAMPLE_DIR=<progetto> go test ./internal/securityintel/e2e/ -run TestSafeRemediationOnARealManifest -v

cd frontend
npx tsc --noEmit          # pulito (prima c'era un errore preesistente in codeStudioTestTree.ts: risolto)
npm run check:startup     # budget 650 kB, il pannello Security Center deve restare lazy
npx vitest run src/lib/uiI18n.test.ts
```

**Esecuzione del 2026-10-18:** tutti verdi — `go build`, `go vet`, `gofmt` (vuoto),
`go test ./internal/securityintel/...` (core + gomod + maven `ok`), `go test ./internal/codestudio/
-run "Vuln|Govuln"` (`ok`), `tsc --noEmit` pulito, `check:startup` con
`deferredModulesStillOnStartup: []`, `uiI18n` + `SecurityUpgradeFlow` 9 verdi.

Verifica manuale obbligatoria (questo è un prodotto, non una libreria):
`wails3 task dev` → apri il pannello **Security Center**, scansiona un progetto reale con un
`pom.xml` e/o un `go.mod`, clicca un finding e leggi l'inspector come farebbe un utente.

## Modifiche non commesse da NON toccare

Il working tree contiene lavoro preesistente non mio (adapter Java/IDE, `codeStudioTestTree.ts`,
`internal/codestudio/lsp*.go`, `internal/languages/java/*`). Non è parte di questo task: non
riformattarlo, non "sistemarlo".
