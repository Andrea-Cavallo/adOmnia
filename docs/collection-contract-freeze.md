# Collection Contract Freeze

Data: 2026-06-26
Piano: `docs/bruno-insomnia-gap-closure-plan.md`
Fase: -1 - Audit e contract freeze
Fixture: `docs/fixtures/collection-contract-freeze.v1.adomnia.json`

Questo documento congela il contratto dati reale da cui devono partire
`collectionfs`, CLI e lint/governance. Lo scopo e' impedire che il formato
file-based inventi un modello parallelo scollegato da quello che l'app usa oggi.

## Stato reale della persistenza

| Area | Owner attuale | Chiave/bucket | Forma persistita | Note |
|---|---|---|---|---|
| Collections | `frontend/src/stores/collections.ts` | bbolt `collections/all` | `{ version, activeWorkspaceId, workspaces }` | `version` attuale 2. Le collection effettive stanno dentro `workspaces[].collections`. |
| Environments | `frontend/src/stores/environments.ts` | bbolt `environments/all` | `{ environments, activeEnvId }` | Nessun `version` oggi. `private` non esiste ancora. |
| Tabs | `frontend/src/stores/tabs.ts` | bbolt `tabs/session-v1` | `{ version: 2, tabs, activeTabId, responseHistory }` | Tabs sono sessione UI, non sorgente canonica della collection. |
| Settings | `frontend/src/stores/settings.ts` | `LoadSettings` / `SaveSettings` | `AppSettings` v3 | Influenza execution defaults, TLS, redirect e history. |
| Workspace import | `frontend/src/lib/workspaceState.ts` | applica agli store | `WorkspaceState` | Formato aggregato, non uguale al futuro folder format. |
| HTTP transport | `internal/httpexec/execute.go` | Wails `App.ExecuteHTTP` | `HTTPExecRequest` / `HTTPExecResponse` | Transport Go gia' riusabile. |

## Campi canonici per collectionfs v1

Questi campi devono round-trippare senza perdita nella Fase 1.

### Collection

- `id`
- `name`
- `color`
- `children`
- `_openapiSpec`

`CollectionWorkspace` e' canonico per la persistenza bbolt, ma il folder export
deve trattare la singola collection come unita' versionabile. Il workspace puo'
restare metadata di sync, non deve contaminare i request file.

### Folder

- `id`
- `name`
- `type: "folder"`
- `children`

Per la Fase 3 verranno aggiunti campi di inheritance, ma oggi non esistono nel
tipo `FolderItem`; `collectionfs` non deve anticiparli con nomi non confermati.

### Request

- `id`
- `name`
- `description`
- `type: "request"`
- `method`
- `url`
- `params`
- `pathParams`
- `headers`
- `cookies`
- `bodies`
- `activeBodyIdx`
- `auth`
- `scripts`
- `timeout`
- `followRedirects`
- `_openapiPath`
- `_xExtensions`
- `_openapiResponses`
- `_openapiSecurity`
- `assertions`

### KV row

- `id`
- `key`
- `value`
- `enabled`

L'`id` e' parte del contratto perche' la UI usa righe modificabili e ordinabili.
Non va rigenerato durante import/export.

### Body

- `id`
- `name`
- `type`
- `raw`
- `lang`
- `form`
- `graphqlVariables`

`formdata` oggi passa dal fallback browser in `sendRequest.ts`; la CLI non deve
promettere piena parity finche' i file descriptor non sono definiti.

### Auth

Tipi esposti dal modello:

- `none`
- `bearer`
- `basic`
- `apikey`
- `oauth2`
- `aws4`
- `digest`

Implementazione reale nel send path attuale:

- `bearer`: implementato
- `basic`: implementato
- `apikey`: implementato
- `oauth2`: implementato lato frontend tramite token fetch e cache
- `aws4`: implementato lato frontend tramite WebCrypto
- `digest`: tipo presente nel modello, ma non gestito nello switch di
  `applyAuth` al momento di questo audit

La fixture include un request digest apposta: serve a congelare il tipo e a
rendere visibile la non-parity prima della CLI.

### Environment

- `id`
- `name`
- `variables`

### EnvVariable

- `id`
- `key`
- `value`
- `enabled`
- `type: "text" | "secret"`

Il futuro flag `private` della Fase 4 non esiste ancora. Quando verra'
introdotto, dovra' migrare senza rompere gli environment correnti privi di flag.

## Campi derivati o UI-only

Questi dati possono essere esportati in workspace snapshot, ma non devono
diventare parte del formato request file-based salvo decisione esplicita.

- `Tab.dirty`
- `Tab.loading`
- `Tab.response`
- `tabs.activeTabId`
- `responseHistory`
- `viewStateByTabId`
- sidebar/rail state
- transient OAuth token cache
- cookie jar runtime
- script execution results

## Execution contract reale

Il transport Go accetta gia':

- method
- url
- headers
- body string
- timeout
- redirect policy
- TLS skip verify
- client cert PEM path/passphrase
- hosts map

La GUI prima del transport risolve:

- vault refs
- environment variables
- path params
- query params
- headers
- cookies
- body serialization
- content-type default
- auth
- request settings defaults

Quindi la Fase 0 deve produrre un contract intermedio esplicito, ad esempio:

```text
ResolvedRequest
  id
  sourceRequestId
  method
  url
  headers
  body
  timeoutMs
  followRedirects
  maxRedirects
  stripAuthOnRedirect
  skipTlsVerify
  clientCertPem
  clientCertPassphrase
  hostsMap
  assertionPlan
  scriptPlan
  sourceMetadata
```

La CLI MVP non deve chiamare direttamente il modello `RequestItem` fingendo che
sia gia' risolto: deve passare attraverso questo contract.

## Compatibility policy iniziale

1. bbolt resta fonte primaria dentro l'app.
2. Il folder export e' una proiezione deterministica e non distruttiva.
3. Import da folder deve riconciliare per `id` quando possibile.
4. Import non deve cancellare dati locali senza conferma esplicita.
5. I secret con `type: "secret"` non devono essere scritti in chiaro in un file
   versionato senza policy dedicata.
6. `vault:` refs sono valori intenzionali: non vanno risolti durante export.
7. ID e ordine logico devono restare stabili.
8. Vecchie collection senza campi opzionali restano valide.

## Fixture v1

La fixture `docs/fixtures/collection-contract-freeze.v1.adomnia.json` copre:

- collection con cartelle annidate
- request GET, POST e PATCH
- query params, path params, headers e cookies
- body `none`, `raw`, `urlencoded`, `graphql`
- auth bearer, apikey, oauth2, aws4 e digest
- scripts pre/post/tests
- assertions status/jsonPath/contentType
- OpenAPI raw spec e metadata per request
- environment con variabili `text` e `secret`
- tab sessione collegata a una request reale
- settings parziali che influenzano execution

Uso previsto:

- test golden-file del futuro `collectionfs`
- test round-trip import/export
- test CLI parser per folder format
- test parity tra request model e `ResolvedRequest`

## Gate per chiudere la Fase -1

- La fixture e' JSON valido.
- I campi canonici sono esplicitati in questo documento.
- I campi UI-only sono separati dal formato file-based.
- I limiti noti di execution/auth sono documentati prima della CLI.
- La Fase 1 puo' iniziare senza dover indovinare il modello dati.

