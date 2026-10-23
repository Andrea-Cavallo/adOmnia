# Piano: adOmnia su awesome-go

> Aggiornato: 2026-10-23. Stati verificati contro il repo, il proxy Go e GitHub alla data qui sopra: riverificare prima di agire.
> Obiettivo: far accettare adOmnia in **awesome-go → Software Packages → Other Software** (dove c'è già Chapar, alternativa a Postman in Go).
> Eccezione voluta: `mds/CLAUDE.md` regola 4 sconsiglia i file `todos-*`. Questo esiste su richiesta esplicita; a pubblicazione fatta si fonde in `01-RILASCIO-V1.md` e si cancella.
> Le verifiche che richiedono l'app in esecuzione vanno in `MANUAL-CHECK.md` (regola 2); qui solo comandi, test ed evidenze di repo.

## 1. Stato a colpo d'occhio

| Requisito awesome-go | Stato oggi | Prova (data 2026-10-23) |
|----------------------|------------|-------------------------|
| ≥ 5 mesi di storia | OK, margine di 3 giorni | primo commit 2026-05-20 (`git log --reverse`) |
| Release SemVer | OK | tag `v1.0.16` (2026-10-22), servito da `proxy.golang.org` |
| `go.mod` nella radice | OK | `module adomnia`, `go 1.27.3` |
| Documentazione in inglese | OK per il README; da fare per i doc comment | 43 pacchetti su 110 senza commento di pacchetto |
| Progetto mantenuto | OK | push di oggi; 0 issue e 0 PR aperte |
| Licenza OSS riconosciuta | **BLOCCA** | `gh repo view` → `licenseInfo.key = "other"`; `LICENSE.md` dice `Copyright (c) 2027` |
| Link pkg.go.dev funzionante | **BLOCCA** | `pkg.go.dev/github.com/Andrea-Cavallo/adOmnia` → HTTP 404 |
| Go Report Card A- o superiore | Non verificato | la pagina risponde 200 ma non c'è un voto; dipende da AW-2 |
| Coverage ≥ 80% (non-data) | Non misurata | nessun Codecov/Coveralls in `.github` o README |

Controlli automatici che possono bloccare la PR: `go.mod`, tag SemVer, pkg.go.dev raggiungibile, link a pkg.go.dev e a un report di coverage (Codecov o Coveralls raggiungibile), licenza riconosciuta da GitHub, 5 mesi, ordine alfabetico, descrizione con punto finale e non promozionale.

## 2. Correzioni al brief iniziale

1. **Il modulo non è "da verificare": è confermato come blocco.** Il proxy serve `v1.0.16` ma il suo `go.mod` dice `module adomnia`: richiesto come `github.com/Andrea-Cavallo/adOmnia`, `go get` fallisce per path non corrispondente, quindi pkg.go.dev dà 404. Lo stesso vale per Go Report Card, che scarica il modulo con `go get`.
2. **Il tag `v1.0.16` non si può riparare.** Il proxy è immutabile: dopo la rinomina serve una **nuova release** (`v1.0.17`) il cui `go.mod` abbia il path giusto. Ogni tag di release obbliga anche all'allineamento del sito (vedi AW-2.7).
3. **La rinomina non è solo Go.** Le binding Wails 3 stanno in `frontend/bindings/<path del modulo>/`: cambiare il path sposta `frontend/bindings/adomnia/` e tocca 133 file frontend che le importano.
4. **L'anno 2027 è un refuso confermato** (`LICENSE.md` riga 3). Il primo commit è del 2026-05-20: l'anno giusto è 2026.
5. **Il coverage dell'80% vale "quando applicabile"** e i manutentori rileggono i test. Il `CLAUDE.md` non insegue la coverage: qui si misura il numero vero e si decide con quello (AW-5), senza promettere 80%.

## 3. Ordine di esecuzione

```
AW-1 licenza ─┐
              ├─> release v1.0.17 ─> AW-3 pkg.go.dev ─┐
AW-2 modulo ──┘                      AW-4 Go Report ──┼─> AW-7 PR awesome-go
              AW-5 coverage ────────────────────────────┤
              AW-6 doc comment ─────────────────────────┘
```

AW-1 e AW-2 sono indipendenti e vanno in PR separate (una voce = una modifica rivedibile). AW-5 e AW-6 si possono fare in parallelo.

## 4. Voci

### AW-1 — Licenza riconosciuta da GitHub

Causa: `LICENSE.md` contiene l'MIT più una sezione "Third-Party Licenses"; il rilevatore di GitHub non lo riconosce come MIT puro e lo classifica `other`.

- [ ] AW-1.1 Creare `LICENSE` con il **testo MIT standard identico**, `Copyright (c) 2026 Andrea Cavallo`, senza nient'altro. Non lasciare anche `LICENSE.md`: due file di licenza confondono il rilevamento.
- [ ] AW-1.2 Spostare la sezione terze parti, parola per parola, in `NOTICE.md` (JohnChadwick, Meta, Babel, ecc.) con una riga di intestazione che spiega cosa contiene.
- [ ] AW-1.3 Aggiornare i riferimenti a `LICENSE.md`: `README.md`, `README.es-ES.md`, `README.ja.md`, `README.zh-CN.md` (badge e link), `CLAUDE.md`, `frontend/public/README.md`. Rifare la ricerca con `grep -rIl "LICENSE.md"` prima di chiudere, e controllare che installer, pacchetti (`build/`, `scripts/`) e la schermata licenze dell'app non leggano il file per nome.
- [ ] AW-1.4 Link a `NOTICE.md` dal README (sezione licenza) perché le attribuzioni restano visibili agli utenti.
- **Prova:** dopo il push, `gh repo view Andrea-Cavallo/adOmnia --json licenseInfo` → `key: "mit"` (il rilevamento può impiegare qualche minuto). Registrare comando ed esito.

### AW-2 — Path del modulo Go (blocco principale)

Obiettivo: `module github.com/Andrea-Cavallo/adOmnia`, con la release `v1.0.17` indicizzabile.

Impatto misurato: 599 file Go e 1.060 righe di import `"adomnia/…"`; 133 file frontend importano `bindings/adomnia`. Nessun riferimento al path in YAML, `.golangci.yml`, `sonar-project.properties`, Taskfile o script (grep del 2026-10-23: da rifare).

- [ ] AW-2.1 **Branch dedicata**, nessun altro cambiamento dentro. Partire da `main` pulito.
- [ ] AW-2.2 `go mod edit -module github.com/Andrea-Cavallo/adOmnia` e riscrittura meccanica degli import `"adomnia/` → `"github.com/Andrea-Cavallo/adOmnia/` (sed/`gofmt -r` sul prefisso, **mai a mano**). Controllare `-ldflags -X`, `go:generate`, `//go:embed` e i test che citano il path come stringa.
- [ ] AW-2.3 `go build ./...`, `go vet ./...`, `go test ./internal/ide/ -run 'Architecture|CoreDoesNot|AdaptersDo'` (il gate dei livelli cita i path degli import).
- [ ] AW-2.4 **Decisione sulle binding**, da prendere prima di rigenerare (contratti pubblici stabili, regola "mantra" del `CLAUDE.md`):
  - (a) rigenerare con `wails3 generate bindings` e riscrivere i 133 import frontend sul nuovo percorso; oppure
  - (b) mantenere il percorso `bindings/adomnia` con un alias di Vite/tsconfig che punta alla cartella generata, lasciando i 133 file intatti.
  - Consiglio: (b) se l'alias regge `tsc` e il build, perché sposta meno codice; altrimenti (a). Il nome del servizio `GoIDE` e i nomi persistiti non dipendono dal path e restano uguali.
- [ ] AW-2.5 `cd frontend && npx tsc --noEmit && npm run build`, poi `wails3 task build` (build vera, come da `CLAUDE.md`: mai `go build .` nella radice, sovrascrive l'exe).
- [ ] AW-2.6 Aggiornare `docs/BUILD.md` e `AGENTS.md` dove citano il path o la cartella delle binding.
- [ ] AW-2.7 **Release `v1.0.17`** con il flusso normale (`VERSION`/`BUILD_DATE`/`GIT_COMMIT` da ambiente). **A tag fatto, nella stessa sessione, aggiornare il sito** `C:\Users\Andrea\Desktop\adomniaWeb\adOmniaWeb` (regola obbligatoria del `CLAUDE.md`): badge versione, nomi degli asset, regex delle card; commit e push su `master`.
- **Prova:** `curl https://proxy.golang.org/github.com/!andrea-!cavallo/ad!omnia/@v/v1.0.17.mod` mostra `module github.com/Andrea-Cavallo/adOmnia`; `go list -m github.com/Andrea-Cavallo/adOmnia@v1.0.17` riesce da una cartella vuota; build e test verdi in CI.
- **Rischi:** import e binding rotti in blocco → per questo il branch è isolato e la rigenerazione è l'ultimo passo. I tag vecchi restano con il path `adomnia`: va bene, non si toccano.

### AW-3 — Pagina pkg.go.dev raggiungibile

- [ ] AW-3.1 Dopo `v1.0.17`, aprire `https://pkg.go.dev/github.com/Andrea-Cavallo/adOmnia` e, se risponde 404, usare **Request** (oppure `GOPROXY=https://proxy.golang.org go list -m github.com/Andrea-Cavallo/adOmnia@v1.0.17`) per forzare l'indicizzazione.
- [ ] AW-3.2 Controllare che licenza (AW-1) e versione risultino sulla pagina; badge `pkg.go.dev/badge/…` nel README (con AW-8).
- **Prova:** HTTP 200 sulla pagina, con licenza MIT riconosciuta.

### AW-4 — Go Report Card A- o superiore

Il voto dipende da gofmt, `go vet`, `gocyclo` (> 15), `ineffassign`, `misspell` e dalla licenza (controllare l'elenco attuale sul sito: cambia nel tempo). Il gate interno di `gocyclo` è 40, quindi le funzioni tra 16 e 40 pesano sul voto pur essendo "a norma" per noi.

- [ ] AW-4.1 Misurare in locale prima di toccare: `gofmt -s -l .`, `go vet ./...`, `gocyclo -over 15 .`, `ineffassign ./...`, `misspell .` (installarli con `go install`, versioni fissate). Registrare i numeri.
- [ ] AW-4.2 Correggere solo ciò che sposta il voto in modo economico: formattazione, errori di battitura, assegnazioni inutili. **Niente refactor di funzioni grandi solo per il voto**: se `gocyclo` domina, annotare le funzioni peggiori e decidere dopo, non a monte.
- [ ] AW-4.3 Generare il report su `https://goreportcard.com/report/github.com/Andrea-Cavallo/adOmnia` dopo AW-2 e AW-3 (con il vecchio path non può funzionare).
- **Prova:** voto del report con data; se è sotto A-, elenco dei 3 controlli che pesano di più e decisione scritta qui.

### AW-5 — Coverage reale e link raggiungibile

Il `quality.yml` produce già `coverage.out`/`lcov.info` per Sonar; manca il link che awesome-go verifica (Codecov o Coveralls).

- [ ] AW-5.1 **Misurazione automatica** (implementata il 2026-10-23, manca la prova in CI: spuntare dopo la prima run verde con il riepilogo visibile). Il job `Checks` di `build.yml` scrive `coverage.out` nello stesso `go test` e `scripts/coverage-summary.sh` pubblica totale e tabella per pacchetto nel riepilogo del job (artifact `go-coverage`, 30 giorni). Locale: `go test ./internal/... ./cmd/... -coverprofile=coverage.out -covermode=atomic && scripts/coverage-summary.sh coverage.out`. Il pacchetto radice Wails è escluso. Resta da incollare qui il primo numero vero (vedi Registro) dopo la prima run in CI.
- [ ] AW-5.2 Pubblicare il risultato: aggiungere l'upload a Codecov (o Coveralls) nel job di qualità esistente, **senza** un secondo job di test, e il badge nel README.
- [ ] AW-5.3 **Decisione con il numero in mano**, scritta qui:
  - ≥ 80% sui pacchetti non-dati → si presenta il link e basta;
  - sotto → si alzano solo i pacchetti dove il test serve davvero (parser, validazioni, percorsi di sicurezza), oppure si spiega nella PR perché "applicabile" non vale per una app desktop con UI. I manutentori controllano anche la qualità dei test: niente test gonfiati per salire.
- **Prova:** link Codecov/Coveralls raggiungibile (HTTP 200) con il numero pubblicato e il comando per riprodurlo.

### AW-6 — Documentazione Go per pkg.go.dev

Awesome-go chiede commenti di documentazione in stile Go sulle API pubbliche. Qui quasi tutto è in `internal/`, ma pkg.go.dev mostra comunque i pacchetti e un pacchetto senza commento fa brutta figura.

- [ ] AW-6.1 Misurare: `go list -f '{{if not .Doc}}{{.ImportPath}}{{end}}' ./...` (oggi 43 su 110 senza commento di pacchetto).
- [ ] AW-6.2 Aggiungere un commento di pacchetto (`// Package x …`, una frase vera, non riempitivi) ai pacchetti pubblici/principali: radice `main`, `cmd/*`, poi i domini che un lettore apre per primi (`internal/ide`, `internal/languages/*`, `internal/devcontext`).
- [ ] AW-6.3 Nessun `doc.go` vuoto e nessun commento che ripete il nome: se non c'è nulla di utile da dire, si lascia stare.
- **Prova:** lo stesso comando di AW-6.1 con il nuovo conteggio; la pagina pkg.go.dev mostra la sintesi dei pacchetti principali.

### AW-7 — Pull request su awesome-go

- [ ] AW-7.1 Rileggere `CONTRIBUTING.md` di awesome-go **il giorno della PR**: le regole e i controlli automatici cambiano. Fork aggiornato, una sola voce per PR.
- [ ] AW-7.2 Voce in **Other Software**, ordine alfabetico: `adOmnia` va **per prima** (la lista oggi parte da `Backrest`; verificare di nuovo). Formato `- [nome](url) - Descrizione.` Bozza, breve e senza superlativi:

  `- [adOmnia](https://github.com/Andrea-Cavallo/adOmnia) - Local-first desktop toolbox for API development with an integrated IDE, database and Kafka clients, and browser debugging.`

- [ ] AW-7.3 Corpo della PR con i link: repository, pkg.go.dev, Go Report Card, report di coverage. Dire onestamente cos'è (app desktop, non libreria) e dove sta la coverage.
- [ ] AW-7.4 Tenere d'occhio i controlli automatici della PR e rispondere ai manutentori entro pochi giorni.
- **Prova:** PR aperta con tutti i controlli verdi (link alla PR e alla run).

### AW-8 — Badge e README

Il README è rifatto di recente su `main`: toccarlo poco.

- [ ] AW-8.1 Badge: licenza (già presente, link corretto dopo AW-1), pkg.go.dev, Go Report Card, coverage. Solo quelli che hanno un valore reale al momento della PR.
- [ ] AW-8.2 `docs/RELEASE.md` e `.github/SECURITY.md` non cambiano per questo piano; `docs/ISSUES.md` solo se si apre un debito (es. funzioni oltre 15 di complessità).

## 5. Fuori scopo

- Rinominare il progetto o passare a `/v2`.
- Rifattorizzare codice solo per alzare il voto di Go Report Card.
- Candidarsi ad altre liste (awesome-wails, awesome-api-clients) prima di avere awesome-go: nel README di `main` sono già citate.
- Modificare i tag esistenti: il proxy Go non lo permette.

## 6. Gate delle sezioni

Chi implementa compila Impl / Test / Doc; "Verificato da altra persona/agente" lo spunta qualcun altro rileggendo evidenza e diff (regola 8 di `mds/CLAUDE.md`). Nessuna voce di questo piano richiede l'app in esecuzione, quindi non c'è colonna Manuale e nulla da aggiungere a `MANUAL-CHECK.md`.

| Sezione | Impl | Test / comando | Doc | Verificato da altri |
|---------|------|----------------|-----|---------------------|
| AW-1 Licenza | [ ] | [ ] `gh repo view … licenseInfo` = mit | [ ] README×4, CLAUDE.md | [ ] |
| AW-2 Modulo | [ ] | [ ] build, vet, gate architettura, tsc, `wails3 task build`, proxy `.mod` | [ ] BUILD.md, AGENTS.md | [ ] |
| AW-3 pkg.go.dev | [ ] | [ ] pagina HTTP 200 con licenza | [ ] | [ ] |
| AW-4 Go Report Card | [ ] | [ ] numeri prima/dopo, voto con data | [ ] | [ ] |
| AW-5 Coverage | [ ] | [ ] tabella per pacchetto, link raggiungibile | [ ] badge README | [ ] |
| AW-6 Doc Go | [ ] | [ ] `go list` senza commento: da 43 a … | [ ] | [ ] |
| AW-7 PR awesome-go | [ ] | [ ] controlli PR verdi | [ ] | [ ] |
| AW-8 Badge | [ ] | [ ] link dei badge raggiungibili | [ ] | [ ] |

## 7. Registro delle prove

| Voce | Data | Comando / link | Esito |
|------|------|----------------|-------|
| Brief iniziale | 2026-10-23 | `gh repo view … licenseInfo`; `curl proxy.golang.org/…/v1.0.16.mod`; `curl pkg.go.dev/…` | licenza `other`; `module adomnia`; pkg.go.dev 404 |
| AW-5.1 | 2026-10-23 | `go test ./internal/... ./cmd/... -coverprofile -covermode=atomic` + `scripts/coverage-summary.sh` (Windows, locale) | **58,5%** (36.880 / 63.003 statement); 25 pacchetti su 107 a ≥ 80%; 12 pacchetti a 0% (tra cui `broker`, `sse`, `oauth`, `jsonutil`, `cmd/*`). `codestudio` impiega 751 s con coverage `atomic`: il timeout CI è salito da 10 a 15 minuti. |
| AW-8.1 | 2026-10-23 | `README.md` | Badge aggiunti: build & tests, lint & security, CodeQL, OpenSSF Scorecard, Dependabot, downloads, 5 badge SonarCloud (`Andrea-Cavallo_adOmnia`). Go Report Card e pkg.go.dev **non** aggiunti: restano 404 finché AW-2/AW-3 non sono chiusi. |
| | | | |
