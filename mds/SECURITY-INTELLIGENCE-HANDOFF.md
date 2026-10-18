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

La CLI `wails3` **non è installata** in questa macchina, quindi `wails3 generate bindings`
non è stato eseguito. Il file è stato scritto a mano replicando la forma generata, con ID
di metodo corretti. La formula è:

```
methodID = FNV-1a 32-bit di "main.<TypeName>.<MethodName>"
```

Verificata: `main.OASLint.Lint` = 325496117, identico al file generato.
Quando aggiungi o rinomini un metodo del servizio `SecurityIntel` devi ricalcolare l'ID
nello stesso modo, oppure far rigenerare il file appena la CLI è disponibile.

## Cosa manca — i quattro punti aperti

### 1. CVSS 4.0 base score — `internal/securityintel/cvss4.go`
Oggi il punteggio 4.0 viene **preso dalla fonte** (NVD/GHSA), non calcolato. Va implementato
l'algoritmo delle macrovector del FIRST "CVSS v4.0 Specification Document".
- Calcolare solo quando la fonte non fornisce il punteggio; il punteggio di fonte resta
  autorevole e non va mai sovrascritto.
- Poi `Severity.NormalizeSeverity()` deve poter riempire `CVSS40Score` con `ScoreSource: "computed"`.
- **Attenzione**: un punteggio sbagliato qui è peggio che non averlo. La suite di test va
  costruita sui reference vector ufficiali di FIRST (https://www.first.org/cvss/calculator/4.0
  e https://www.first.org/cvss/examples), non su valori ricavati dalla stessa implementazione.

Vettori di riferimento da verificare contro i documenti FIRST (non darli per buoni a priori):
- `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H` → 10.0
- `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H` → 9.3
- `CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N` → 8.2
- `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:L` → 8.7

### 2. Raggiungibilità Maven via bytecode — `internal/securityintel/maven/bytecode.go`
`internal/securityintel/maven` non implementa ancora `ReachabilityAnalyzer`.
Va creata l'implementazione che cerca riferimenti a classi/metodi vulnerabili nelle classi
compilate (`target/classes`, `target/*.jar`) e produce `Evidence` con `Method: "bytecode-reference"`.
Il punto di prodotto è la **distinzione onesta** richiesta per Java:
- **confermata** → `Conflicted: true`, `ReachabilityCalled` (solo con una chiamata provata)
- **potenzialmente raggiungibile** → `ReachabilityPotentiallyReachable` (riferimento trovato,
  chiamata non provabile: riflessione, class loading, framework, OSGi)
- **inconcludente** → `ReachabilityUnknown` con `Note` che lo dice
Mai promuovere un'ipotesi a conferma. L'assenza di riferimenti **non** diventa `notReachable`
senza un'analisi che lo dimostri.

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
`components/security/SecurityUpgradeFlow.tsx`, montato in `SecurityFindingInspector`. Verifica manuale:
`mds/MANUAL-CHECK.md` → **SEC-1** (non eseguita qui: la CLI `wails3` non è installata).

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

cd frontend
npx tsc --noEmit          # 1 errore PREESISTENTE non collegato: src/lib/code-studio/codeStudioTestTree.ts (javaFilters inutilizzato)
npm run check:startup     # budget 650 kB, il pannello Security Center deve restare lazy
npx vitest run src/lib/uiI18n.test.ts
```

Verifica manuale obbligatoria (questo è un prodotto, non una libreria):
`wails3 task dev` → apri il pannello **Security Center**, scansiona un progetto reale con un
`pom.xml` e/o un `go.mod`, clicca un finding e leggi l'inspector come farebbe un utente.

## Modifiche non commesse da NON toccare

Il working tree contiene lavoro preesistente non mio (adapter Java/IDE, `codeStudioTestTree.ts`,
`internal/codestudio/lsp*.go`, `internal/languages/java/*`). Non è parte di questo task: non
riformattarlo, non "sistemarlo".
