# adOmnia Gap Closure Plan vs Bruno e Insomnia

Data: 2026-06-26
Stato: implementazione incrementale avviata
Origine: revisione di `C:\Users\Andrea\Desktop\2026-06-25-bruno-gap-closure-design.md`

Questo documento consolida il piano per chiudere i gap competitivi con Bruno e
Insomnia senza tradire i pilastri di adOmnia: local-first, user-extensible,
browser debugging integrato, enterprise/legacy first-class.

## Decisione di prodotto

adOmnia non deve copiare Bruno o Insomnia. Deve prendere i loro punti forti
compatibili con il prodotto e integrarli in modo piu' coerente:

- Bruno: collezioni leggibili su disco, versionabili, diff-friendly.
- Insomnia: CLI headless, governance/lint OpenAPI, ambienti locali/privati.
- adOmnia: bbolt resta la fonte primaria dentro l'app; la cartella su disco e'
  una proiezione deterministica, sincronizzabile e importabile.

Fuori scope permanente perche' contrari al local-first:

- cloud sync obbligatorio
- account obbligatori
- telemetria
- RBAC/SSO/SAML/OIDC/SCIM come requisito cloud
- cifratura cloud E2E

## Correzioni rispetto al piano originale

Il piano originale e' valido nella direzione, ma non va implementato alla
lettera. Le modifiche operative sono queste:

1. Aggiungere una Fase -1 di audit e freeze dei contratti reali.
2. Riscrivere la Fase 0: `ExecuteHTTP` e' gia' parzialmente estratto in Go; il
   vero lavoro e' rendere condivisibili request resolution, auth, variabili,
   assertions, script, cookie/vault behavior e reporter.
3. Rendere esplicito e versionato il formato file-based prima di scrivere
   importer/exporter.
4. Definire una parity matrix per la CLI: cosa funziona nel MVP, cosa arriva
   dopo, cosa non ha senso in headless.
5. Separare il motore OpenAPI lint dalla CLI: prima engine, poi comando
   `adomnia lint`, poi UI.

## Ancora codice reale

Questi sono i punti di partenza attuali da rispettare:

- Collection model: `frontend/src/lib/types.ts`
- Collections store: `frontend/src/stores/collections.ts`
- Environments store: `frontend/src/stores/environments.ts`
- HTTP transport Go: `internal/httpexec/execute.go`
- Wails binding: `App.ExecuteHTTP`
- Request resolution frontend: `frontend/src/lib/sendRequest.ts`
- Assertions: `frontend/src/lib/assertionEngine.ts`
- Scripts: `frontend/src/lib/scriptRuntime.ts`
- Contract validation: `frontend/src/lib/contractValidator.ts`
- Workspace export/import: `frontend/src/lib/workspaceState.ts`
- Git Sync: `internal/git/*`, `frontend/src/components/workspace/GitSyncPanel.tsx`,
  `frontend/src/lib/gitsync-api.ts`
- OpenAPI import/export: `frontend/src/lib/openapi.ts`,
  `frontend/src/lib/openapiImport.ts`, `frontend/src/lib/oasExport.ts`

## Fase -1 - Audit e contract freeze

Obiettivo: evitare di costruire il file-based sync sopra assunzioni sbagliate.

Artefatti prodotti:

- `docs/collection-contract-freeze.md`
- `docs/fixtures/collection-contract-freeze.v1.adomnia.json`
- `frontend/src/lib/collectionContractFreeze.test.ts`

Attivita':

- Mappare il formato persistito attuale per collections, workspaces,
  environments, tabs e settings.
- Documentare quali campi sono canonici e quali sono solo derivati UI.
- Preparare una fixture reale con:
  - collection con cartelle annidate
  - request GET/POST/PATCH
  - headers, params, path params, cookies
  - body raw/json/graphql/urlencoded
  - auth bearer/basic/apikey/oauth2/aws4/digest dove possibile
  - assertions
  - script pre/post/tests
  - OpenAPI metadata
  - environment con variabili `text` e `secret`
- Definire la prima compatibility policy:
  - vecchi dati bbolt leggibili
  - export folder non distruttivo
  - import folder non cancella dati utente senza conferma

Done quando:

- esiste una fixture versionata usabile nei test
- e' chiaro quali campi devono round-trippare al 100%
- il formato file-based puo' essere implementato senza inventare dati nuovi

## Fase 0 - Shared request execution contract

Obiettivo: permettere a GUI e CLI di condividere il comportamento importante,
senza forzare subito tutta la logica frontend dentro Go.

Artefatti iniziali prodotti:

- `frontend/src/lib/requestExecutionContract.ts`
- `frontend/src/lib/requestExecutionContract.test.ts`
- `frontend/src/lib/sendRequest.ts` ora costruisce un `ResolvedRequest` prima
  di chiamare il transport Go.
- `internal/requestcontract/resolve.go`
- `internal/requestcontract/resolve_test.go`
- `internal/adomniacli/run.go` usa il resolver Go condiviso invece di logica
  duplicata locale.

Stato completato Fase 0:

- GUI continua a passare un `ResolvedRequest` al transport Go.
- CLI headless usa lo stesso livello concettuale del contratto:
  - variable substitution `{{var}}`
  - path params `:id` e `{id}`
  - query/header/body resolution
  - body `raw`, `urlencoded`, `graphql`
  - auth headless `none`, `bearer`, `basic`, `apikey`
  - assertion engine headless per status, response time, content type, header e
    body text
  - `--env-var KEY=VALUE`
  - `--env name` da `environments/<name>.json`
- Le parti non headless o non ancora compatibili restano limiti dichiarati, non
  successi finti.

Stato attuale:

- `App.ExecuteHTTP` delega gia' a `internal/httpexec.Execute`.
- Il transport HTTP Go e' riusabile.
- La logica indispensabile per il CLI MVP e' ora disponibile in Go.
- Restano intenzionalmente in TypeScript o "later parity":
  - OAuth2 browser/PKCE interattivo
  - AWS Signature v4
  - Vault refs
  - cookie jar completa
  - FormData/browser fallback
  - settings UI-dependent defaults avanzati

Attivita':

- Definire un payload risolto `ResolvedRequest` stabile:
  - method
  - full URL
  - headers
  - body string o file descriptors
  - timeout
  - redirect policy
  - TLS settings
  - hosts map
  - metadata per report/assertions
- Estrarre o duplicare consapevolmente solo il minimo necessario per il CLI MVP.
- Spostare in Go le parti indispensabili per headless:
  - env variable resolution
  - header/body/query/path param resolution
  - basic/bearer/apikey/digest auth
  - assertion engine
  - reporter base
- Lasciare come "later parity" le parti piu' complesse:
  - OAuth browser/PKCE interattivo
  - cookie jar completa condivisa con renderer
  - FormData file upload avanzato
  - Vault UI-dependent flows
  - AWS4 se non viene portato subito in Go

Done quando:

- [x] la GUI continua a inviare request come prima
- [x] il CLI puo' eseguire almeno request HTTP risolte con env vars, headers,
  params, body, auth semplice e assertions
- [x] i limiti di parity sono documentati e visibili

## Fase 1 - Collezioni file-based

Obiettivo: esportare/importare una collection come cartella versionabile,
leggibile e diff-friendly, mantenendo bbolt come fonte primaria in-app.

Artefatti iniziali prodotti:

- `internal/collectionfs/collectionfs.go`
- `internal/collectionfs/collectionfs_test.go`
- il primo exporter scrive `adomnia.collection.json`, `collection.json`,
  `.gitignore`, `.adomnia-sync.json`, folder metadata e request file
  deterministici dalla fixture Fase -1.
- il primo importer ricostruisce la collection dalla cartella e il test
  conferma export -> import -> re-export deterministico.
- `CollectionFS` espone i metodi Wails-safe
  `ExportCollectionToFolder(folderPath, collectionJSON)` e
  `ImportCollectionFromFolder(folderPath)` senza leggere o cancellare dati bbolt
  implicitamente.
- `frontend/src/lib/collectionfs-api.ts` aggiunge il wrapper typed per il
  bridge Wails.
- `frontend/src/components/workspace/GitSyncPanel.tsx` espone una prima sezione
  `Collection Folder` nella Git Sync:
  - selezione collection attiva
  - export deterministico sotto `adomnia-collections/<collection>-<id>`
  - import di una folder collection nello store collection esistente
  - drift check reale tra collection corrente e folder importata

Formato cartella v1:

```text
adomnia.collection.json
collection.json
environments/
  dev.json
  prod.json
folders/
  001-auth/
    folder.json
    001-login.request.json
    002-refresh-token.request.json
  002-users/
    folder.json
    001-list-users.request.json
.gitignore
.adomnia-sync.json
```

Regole:

- Ogni file contiene `schemaVersion`.
- Ogni nodo mantiene `id`.
- L'ordine e' dato da `seq`, non dall'ordine della filesystem.
- I filename sono slug Windows-safe.
- Collisioni risolte con suffisso stabile.
- JSON pretty 2 spazi.
- Key order stabile.
- `.gitignore` include `.env` e file temporanei.
- `.adomnia-sync.json` contiene metadata di sync:
  - collectionId
  - repoPath
  - lastExportedAt
  - formatVersion
  - hash per drift detection

UI:

- Integrato primo pass nella Git Sync esistente.
- Azioni gia' cablate:
  - "Export" della collection selezionata verso cartella versionabile
  - "Import" da folder collection selezionata via picker
  - "Drift" per confrontare hash canonico della collection corrente e della
    projection su disco
- Azioni successive:
  - "Export changed request"
- Dopo modifica di una request linkata a cartella, esportare solo quel request
  file quando possibile.

Done quando:

- export di una collection produce una cartella leggibile
- modifica di un header in UI produce diff Git di un solo file
- import ricostruisce l'albero identico
- round-trip test passa sulla fixture della Fase -1
- drift manuale viene rilevato senza watcher live

## Fase 2A - CLI headless run

Obiettivo: eseguire collezioni in CI/CD senza GUI.

Artefatti iniziali prodotti:

- `internal/adomniacli/run.go`
- `internal/adomniacli/run_test.go`
- `main.go` intercetta `adomnia run ...` prima di avviare Wails.

Stato MVP implementato:

- `adomnia run <collection-folder>`
- reporter `cli`
- reporter `json`
- `--out <file>`
- `--bail`
- import da cartella Fase 1
- esecuzione HTTP reale tramite `internal/httpexec`
- request con URL/headers/body letterali `http`/`https`
- body `raw`, `urlencoded`, `graphql`
- auth `none`, `bearer`, `basic`
- assertion minima `statusCode eq`
- skip esplicito per variabili `{{...}}`, body/auth non ancora supportati e
  URL non HTTP(S)

Limite intenzionale MVP: non risolve ancora environment, path params,
OAuth2/AWS4/Vault/cookie jar o script renderer-dependent. Questi restano nella
parity matrix sotto e non vengono mascherati come successi.

Comando MVP:

```bash
adomnia run ./my-collection --env prod --reporter junit --out report.xml --bail
```

Input:

- cartella Fase 1
- fallback `.adomnia.json` quando compatibile

Funzioni MVP:

- run di una collection intera
- run di una folder con `--folder`
- env da `environments/*.json`
- override `--env-var KEY=VAL`
- reporters:
  - cli
  - json
  - junit
- exit code non zero su request/assertion fallita

Parity matrix:

| Area | MVP CLI | Dopo | Note |
|---|---:|---:|---|
| GET/POST/PATCH/DELETE | si | - | transport Go gia' presente |
| headers/query/path params | si | - | deve usare stesso contract GUI |
| raw/urlencoded/graphql body | si | - | FormData avanzato dopo |
| bearer/basic/apikey/digest | si | - | headless-friendly |
| OAuth2 client credentials/password/refresh | parziale | si | no browser flow nel MVP |
| OAuth2 PKCE browser | no | forse | richiede UX/headless policy |
| AWS4 | forse | si | portare firma in Go |
| Vault refs | no | si | serve policy secrets headless |
| cookie jar | semplice | completa | storage locale separato |
| pre/post/tests script | parziale | si | evitare renderer dependency |
| assertions | si | - | portare engine in Go |
| contract validation OpenAPI | no | si | collegare dopo lint/contract engine |

Done quando:

- una collection folder gira in CI
- una assertion fallita produce exit code non zero
- viene generato JUnit leggibile da pipeline

## Fase 5A - OpenAPI governance lint engine

Obiettivo: creare il motore locale di linting OpenAPI prima di esporlo in CLI/UI.

Package:

- `internal/oaslint/`

Regole default:

- `operationId` obbligatorio
- summary o description obbligatoria per operazione
- response 2xx documentata
- response error 4xx/5xx consigliata
- security definita dove richiesto
- tag coerenti
- path naming coerente
- no operationId duplicati
- schema response presente per JSON response

Ruleset:

- default built-in
- override da file locale `adomnia.oaslint.json`
- severity: `error`, `warn`, `info`
- nessuna chiamata esterna
- compatibilita' concettuale con Spectral, senza dipendenza diretta

Output:

- JSON strutturato
- testo human-readable
- path/operation/severity/ruleId/message

Done quando:

- una spec valida passa
- una spec con violazioni produce risultati stabili
- severity `error` e' distinguibile per exit code CLI

## Fase 2B - CLI lint

Obiettivo: portare in CI il linting OpenAPI in stile `inso lint spec`.

Comando:

```bash
adomnia lint ./openapi.yaml --ruleset adomnia.oaslint.json --reporter json
adomnia lint ./my-collection
```

Regole:

- exit code non zero se ci sono violation `error`
- warning non bloccanti salvo flag `--fail-on-warn`
- reporter `text` e `json`

Done quando:

- una pipeline puo' fallire su governance OpenAPI
- il risultato e' leggibile sia da umani sia da CI

## Fase 3 - Ereditarieta' collection/folder

Obiettivo: evitare duplicazione di auth, headers, vars e script su collection
grandi.

Modello:

- collection puo' avere:
  - auth
  - headers
  - variables
  - preScript
  - postScript
- folder puo' avere gli stessi campi
- request puo' scegliere:
  - inherit
  - own
  - none

Funzione unica:

```text
resolveEffectiveRequest(tree, requestId)
```

Consumatori:

- Composer
- Runner
- CLI
- Codegen
- file-based export/import

Regole merge:

- top-down collection -> folders -> request
- request vince
- disabled row resta disabled
- secret non viene mai materializzato in file versionato senza policy

Done quando:

- bearer token su collection si applica alle request figlie
- folder puo' aggiungere header comune
- request puo' fare override o disabilitare inheritance

## Fase 4 - .env e private environments

Obiettivo: segreti leggeri e workflow Git-friendly, senza sostituire Vault.

Regole `.env`:

- `.env` caricato solo da cartella collection linkata
- precedenza piu' bassa degli environment in app
- valori marcati come `from .env`
- export genera `.gitignore` con `.env`
- variabili `secret` esportate come placeholder

Private environments:

- nuovo flag `private: true` su Environment
- un environment private non viene esportato nella cartella
- un environment private non entra nel Git workflow
- resta solo in bbolt locale

Done quando:

- `{{KEY}}` si risolve da `.env`
- `.env` e' ignorato da Git di default
- environment private non compare mai nell'export folder

## Fase 5B - UI OpenAPI governance

Obiettivo: rendere il linting OpenAPI visibile e utile dentro adOmnia.

UI:

- tab o pannello nel surface OpenAPI/API Docs
- badge:
  - pass
  - warnings
  - errors
- lista violazioni filtrabile
- click su violazione porta alla posizione o all'operation interessata
- stile coerente con Contract tab, non pannello separato decorativo

Done quando:

- una spec con violazioni mostra errori in UI
- una regola custom locale cambia il risultato
- lo stesso engine alimenta UI e CLI

## Sequenza consigliata

1. Fase -1: audit + contract freeze + fixture reale.
2. Fase 0: shared request execution contract.
3. Fase 1: file-based collections.
4. Fase 2A: CLI `run`.
5. Fase 5A: OpenAPI lint engine.
6. Fase 2B: CLI `lint`.
7. Fase 3: inheritance.
8. Fase 4: `.env` + private env.
9. Fase 5B: UI governance.

## Criteri di successo complessivi

- Un team puo' committare una collection come file e leggere diff per-request.
- La GUI resta bbolt-first e non perde dati.
- Il Git Sync di adOmnia diventa workflow di versionamento collection, non solo
  pannello Git generico.
- La stessa collection puo' girare in CI con report JUnit.
- I segreti hanno un percorso locale chiaro: Vault sicuro, `.env` leggero,
  private env mai esportato.
- OpenAPI governance funziona offline in UI e CLI.

## Non obiettivi per questa milestone

- watcher live bidirezionale
- migrare a "file come unica fonte di verita'"
- compatibilita' nativa `.bru`
- dipendenza diretta da Spectral
- cloud/team sync
- account/login
- RBAC enterprise cloud

## Nota di implementazione

Ogni fase deve chiudere una capacita' usabile, non lasciare superfici finte:

- se compare un bottone, deve fare qualcosa di reale
- se compare un badge, deve riflettere stato vero
- se compare una export/import action, deve round-trippare dati reali
- se un limite esiste, va mostrato nel punto giusto invece di nasconderlo
