# adOmnia - OpenShift Studio TODO

## Obiettivo

Integrare in adOmnia un modulo **OpenShift Studio** orientato al workflow dello sviluppatore.

L'obiettivo non è replicare la OpenShift Console, ma collegare in modo diretto:

```text
CODE -> BUILD -> DEPLOY -> POD -> LOG -> DEBUG -> API TEST
```

Il modulo deve funzionare con Kubernetes standard e aggiungere funzionalità specifiche OpenShift quando disponibili.

---

## Stato attuale (verificato nel codice il 2026-10-10)

Esiste già la **Kubernetes Studio** (`internal/kube`, `frontend/src/components/kube`), basata su `kubectl` con output JSON letto in Go: context dal kubeconfig/`KUBECONFIG` senza modificarlo, namespace, pod (stato, ready, restart, nodo, container, label), log in streaming per container, exec, lettura/scrittura file nel container, port-forward di pod e service su `127.0.0.1` con porta libera automatica, elenco di deployment, service, configmap e secret (solo metadati: i valori non lasciano il backend), strumenti Go sui pod. Le voci già coperte sono state rimosse da questo file.

**Scelta aperta prima di P0:** l'architettura sotto (`internal/platform/cluster` con API native) è il traguardo; oggi si estende `internal/kube`. Passare a client-go conviene quando servono watch, discovery delle API OpenShift e metriche: fino ad allora `kubectl` resta l'adapter.

---

# Principi architetturali

- Kubernetes-first.
- OpenShift come estensione del provider Kubernetes.
- Nessuna dipendenza del core da OpenShift.
- API native prima di invocare `oc`.
- Configurazione cluster riusabile tra sessioni.
- Nessuna credenziale sensibile salvata in chiaro.
- RBAC sempre rispettato.
- PROD read-only di default.
- Tutte le operazioni distruttive devono avere conferma esplicita.
- Supporto multi-cluster e multi-namespace.
- UI non bloccante.
- Streaming logs e watch gestiti in background.
- Reconnect automatico in caso di perdita connessione.
- Timeout e cancellazione tramite `context.Context`.
- Nessun polling aggressivo quando esistono Kubernetes Watch API.

---

# Architettura proposta

```text
internal/platform/cluster/

├── provider.go
├── models.go
├── errors.go
├── capabilities.go
├── auth/
│   ├── kubeconfig.go
│   └── credentials.go
├── kubernetes/
│   ├── provider.go
│   ├── workloads.go
│   ├── pods.go
│   ├── logs.go
│   ├── events.go
│   ├── exec.go
│   ├── portforward.go
│   └── metrics.go
└── openshift/
    ├── provider.go
    ├── routes.go
    ├── buildconfigs.go
    ├── deploymentconfigs.go
    └── capabilities.go
```

Interfaccia base:

```go
type ClusterProvider interface {
    ListNamespaces(ctx context.Context) ([]Namespace, error)
    ListWorkloads(ctx context.Context, namespace string) ([]Workload, error)
    ListPods(ctx context.Context, namespace string) ([]Pod, error)
    StreamLogs(ctx context.Context, request LogRequest) (LogStream, error)
    PortForward(ctx context.Context, request PortForwardRequest) error
}
```

Interfacce opzionali:

```go
type RouteProvider interface {
    ListRoutes(ctx context.Context, namespace string) ([]Route, error)
}

type MetricsProvider interface {
    GetPodMetrics(ctx context.Context, namespace string) ([]PodMetrics, error)
}

type ExecProvider interface {
    Exec(ctx context.Context, request ExecRequest) error
}
```

Il frontend deve abilitare le funzionalità in base alle capability rilevate sul cluster.

---

# P0 - Foundation

## Cluster Connection

- [ ] Mostrare cluster corrente.
- [ ] Mostrare user corrente.
- [ ] Mostrare namespace corrente. — *Parziale: namespace scelto nel pannello, non letto dal context.*
- [ ] Verificare la connettività.
- [ ] Mostrare versione Kubernetes.
- [ ] Rilevare se il cluster è OpenShift.
- [ ] Rilevare la versione OpenShift.
- [ ] Rilevare API disponibili tramite discovery.
- [ ] Implementare timeout configurabile. — *Parziale: timeout fisso per chiamata `kubectl`.*
- [ ] Implementare reconnect automatico.
- [ ] Gestire certificati custom.
- [ ] Gestire proxy HTTP/HTTPS aziendali.
- [ ] Rispettare `NO_PROXY`.

### Acceptance Criteria

- [ ] Gli errori TLS, proxy, auth e timeout sono distinguibili.
- [ ] Le credenziali non vengono loggate.

---

## OpenShift Context Bar

Aggiungere una barra persistente nell'IDE.

Esempio:

```text
mau-transaction
DEV | ocp-dev | eurodigitale-dev | mau-transaction | 2/2 Pods ●
```

- [ ] Mostrare environment.
- [ ] Mostrare cluster.
- [ ] Mostrare namespace.
- [ ] Mostrare workload associato.
- [ ] Mostrare pod ready/total.
- [ ] Mostrare stato cluster connection.
- [ ] Cambio rapido environment.
- [ ] Cambio rapido namespace.
- [ ] Evidenziare PROD.
- [ ] Aggiornamento live tramite watch.

### Acceptance Criteria

- [ ] Lo sviluppatore vede sempre dove sta lavorando.
- [ ] Il cambio namespace aggiorna tutto il modulo OpenShift.
- [ ] PROD è graficamente distinguibile dagli altri ambienti.

---

## Namespace Explorer

- [ ] Ricerca namespace.
- [ ] Namespace preferiti.
- [ ] Namespace recenti.
- [ ] Persistenza ultimo namespace per workspace.
- [ ] Mostrare namespace non accessibili senza generare errori globali.

---

## Workloads Explorer

Supportare:

- [ ] StatefulSet.
- [ ] DaemonSet.
- [ ] Job.
- [ ] CronJob.
- [ ] DeploymentConfig OpenShift.
- [ ] ReplicaSet.

Mostrare:

- [ ] Namespace.
- [ ] Status.
- [ ] Image tag.
- [ ] Creation time.
- [ ] Restart count aggregato.
- [ ] Labels.

### Acceptance Criteria

- [ ] La lista si aggiorna senza refresh manuale.
- [ ] `CrashLoopBackOff` è visibile immediatamente.
- [ ] I workload legacy OpenShift vengono mostrati se presenti.

---

## Pods

- [ ] Lista pods del workload. — *Parziale: i pod sono elencati per namespace, non filtrati per workload.*
- [ ] Init containers.
- [ ] Pod IP.
- [ ] Start time.
- [ ] Container image.
- [ ] Container state.
- [ ] Last termination reason.
- [ ] Exit code.
- [ ] OOMKilled detection.
- [ ] Pending reason.
- [ ] ImagePullBackOff detection.
- [ ] CrashLoopBackOff detection.
- [ ] Evicted detection.

---

## Live Logs

- [ ] Aggregazione logs da più pod.
- [ ] Pause. — *Parziale: c'è Stop dello stream, non una pausa che conserva il buffer.*
- [ ] Resume.
- [ ] Clear.
- [ ] Download log.
- [ ] Copy.
- [ ] Timestamp.
- [ ] Tail configurabile.
- [ ] Since configurabile. — *Parziale: fisso a 300 s.*
- [ ] Ricerca testuale.
- [ ] Regex.
- [ ] Filtro `ERROR`.
- [ ] Filtro `WARN`.
- [ ] Filtro `INFO`.
- [ ] Filtro correlation ID.
- [ ] Filtro request ID.
- [ ] Evidenziare pod/container origine.
- [ ] Supportare JSON logs.
- [ ] Pretty-print JSON.
- [ ] Gestire reconnect dello stream.

### Acceptance Criteria

- [ ] Nessun blocco UI durante lo streaming.
- [ ] Lo stream viene cancellato correttamente cambiando workspace.
- [ ] Nessuna goroutine resta attiva dopo la chiusura del pannello.
- [ ] La ricerca funziona anche su stream con più pod.

---

## Events

- [ ] Kubernetes Events per namespace.
- [ ] Events filtrati per workload.
- [ ] Events filtrati per pod.
- [ ] Warning separati dagli eventi normali.
- [ ] Ordinamento cronologico.
- [ ] Mostrare reason.
- [ ] Mostrare message.
- [ ] Mostrare involved object.
- [ ] Mostrare count.
- [ ] Mostrare first/last timestamp.

---

## Port Forward

- [ ] Restart automatico opzionale.
- [ ] Copia URL locale.
- [ ] "Open in API Client".
- [ ] "Open in Browser".
- [ ] Stop automatico alla chiusura workspace configurabile.

Esempio:

```text
mau-transaction
8080 -> localhost:18080
Status: Active
```

### Acceptance Criteria

- [ ] Porta già occupata produce errore chiaro.
- [ ] Un port-forward può essere riutilizzato dal REST client di adOmnia.

---

# P1 - Developer Operations

## Workspace Binding

Ogni workspace può avere una configurazione OpenShift.

Esempio:

```yaml
openshift:
  environment: DEV
  context: ocp-dev
  namespace: eurodigitale-dev
  workload: mau-transaction
  service: mau-transaction
```

- [ ] Associare workspace a cluster.
- [ ] Associare workspace a namespace.
- [ ] Associare workspace a workload.
- [ ] Associare workspace a Service.
- [ ] Associare workspace a Route.
- [ ] Persistenza configurazione.
- [ ] Configurazioni differenti per DEV/TEST/UAT/PROD.
- [ ] Auto-detection tramite nome progetto.
- [ ] Auto-detection tramite labels.
- [ ] Auto-detection tramite repository metadata.

---

## Services

- [ ] EndpointSlices.
- [ ] Pod collegati.
- [ ] Avviare port-forward direttamente dal Service. — *Parziale: il backend accetta `svc/`; manca l'azione nella lista Services.*

---

## OpenShift Routes

- [ ] Rilevare API Route.
- [ ] Lista Routes.
- [ ] Host.
- [ ] Path.
- [ ] TLS mode.
- [ ] Service target.
- [ ] Port target.
- [ ] Copy URL.
- [ ] Open browser.
- [ ] Open in REST Client.
- [ ] Test health endpoint.

### Acceptance Criteria

- [ ] La sezione non compare su Kubernetes puro.
- [ ] Le Route sono disponibili solo se l'API esiste e l'utente ha permessi.

---

## Pod Terminal

- [ ] Terminal interattivo.
- [ ] Selezione container.
- [ ] Shell detection.
- [ ] `/bin/bash`.
- [ ] `/bin/sh`.
- [ ] Fallback shell.
- [ ] Resize terminal.
- [ ] Kill session.
- [ ] Audit locale delle sessioni senza registrare command output sensibile.

---

## Restart / Scale / Rollout

- [ ] Restart Deployment.
- [ ] Restart DeploymentConfig.
- [ ] Scale replicas.
- [ ] Rollout status.
- [ ] Rollout history.
- [ ] Rollback.
- [ ] Visualizzare ReplicaSet.
- [ ] Visualizzare revision.
- [ ] Mostrare motivo rollout failure.

### Safety

- [ ] Confirm dialog per restart.
- [ ] Confirm dialog per scale.
- [ ] Confirm dialog per rollback.
- [ ] PROD read-only di default.
- [ ] Override PROD solo da Settings.
- [ ] Nessuna operazione consentita se RBAC la vieta.

---

## ConfigMap

- [ ] Ricerca.
- [ ] Preview YAML.
- [ ] Preview JSON.
- [ ] Diff.
- [ ] Copy value.
- [ ] Individuare workload che la usa.
- [ ] Edit opzionale fuori PROD.
- [ ] Validazione prima del salvataggio.

---

## Secrets

- [ ] Workload che lo utilizza.
- [ ] Reveal solo con azione esplicita.
- [ ] Copy disabilitabile tramite policy.
- [ ] Mai includere Secret nei crash report.
- [ ] Mai includere Secret negli export workspace.

---

# P2 - Advanced Diagnostics

## Smart Troubleshooting

Creare un motore diagnostico locale.

Analizzare:

- [ ] Pod status.
- [ ] Container status.
- [ ] Exit code.
- [ ] Restart count.
- [ ] Last termination state.
- [ ] Kubernetes Events.
- [ ] Readiness probe.
- [ ] Liveness probe.
- [ ] Startup probe.
- [ ] Image pull.
- [ ] ConfigMap missing.
- [ ] Secret missing.
- [ ] PVC issues.
- [ ] Scheduling issues.
- [ ] Resource requests.
- [ ] Resource limits.
- [ ] OOMKilled.
- [ ] CPU throttling.
- [ ] Node pressure.
- [ ] Quota.
- [ ] LimitRange.
- [ ] Network policy quando disponibile.

Output esempio:

```text
Problem detected

mau-transaction-6d9f74d7dd-b82xs

Reason:
Readiness probe failed.

Endpoint:
GET /health

Target:
8080

Last error:
connection refused

Suggested checks:
1. Verify application startup.
2. Check container port.
3. Check readinessProbe.port.
4. Inspect previous container logs.
```

### Acceptance Criteria

- [ ] Ogni diagnosi deve riportare le evidenze utilizzate.
- [ ] Evitare conclusioni se i dati non sono sufficienti.
- [ ] Distinguere errore certo da possibile causa.

---

## Environment Diff

Confrontare:

```text
DEV <-> TEST
TEST <-> UAT
UAT <-> PROD
DEV <-> PROD
```

Confrontare:

- [ ] Image.
- [ ] Image tag.
- [ ] Image digest.
- [ ] Environment variables.
- [ ] ConfigMap references.
- [ ] Secret references, solo nomi.
- [ ] Replicas.
- [ ] CPU requests.
- [ ] CPU limits.
- [ ] Memory requests.
- [ ] Memory limits.
- [ ] Liveness probe.
- [ ] Readiness probe.
- [ ] Startup probe.
- [ ] Service ports.
- [ ] Route.
- [ ] Labels.
- [ ] Annotations.

Esempio:

```text
mau-transaction

                DEV             PROD
Image tag       1.9.4           1.9.2
Replicas        1               3
Memory limit    512Mi           1Gi
FEATURE_X       true            false
Route TLS       edge            reencrypt
```

- [ ] Filtrare differenze irrilevanti.
- [ ] Ignorare metadata runtime.
- [ ] Export diff Markdown.
- [ ] Export diff JSON.

---

## Topology Graph

Visualizzare:

```text
Route
  |
Service
  |
Deployment
  |
ReplicaSet
  |
Pods
  |
ConfigMap / Secret / PVC
```

- [ ] Zoom.
- [ ] Pan.
- [ ] Click node.
- [ ] Status color.
- [ ] Error badge.
- [ ] Restart count.
- [ ] Open logs dal Pod.
- [ ] Open Route.
- [ ] Port-forward dal Service.
- [ ] Mostrare dipendenze ConfigMap.
- [ ] Mostrare dipendenze Secret.
- [ ] Mostrare PVC.
- [ ] Mostrare Ingress su Kubernetes standard.

---

## Metrics

- [ ] CPU Pod.
- [ ] Memory Pod.
- [ ] CPU container.
- [ ] Memory container.
- [ ] Requests.
- [ ] Limits.
- [ ] Restart rate.
- [ ] Historical chart.
- [ ] Metrics Server fallback.
- [ ] Prometheus integration opzionale.
- [ ] PromQL query editor.
- [ ] Saved queries.
- [ ] Correlazione deploy -> metric spike.

---

# P3 - Delivery & GitOps

## Build & Deploy

Pipeline:

```text
Code
  ↓
Build
  ↓
Test
  ↓
Container Build
  ↓
Push
  ↓
Deploy
  ↓
Rollout Watch
  ↓
Logs
  ↓
API Test
```

- [ ] Build Go project.
- [ ] Run tests.
- [ ] Build container.
- [ ] Push container.
- [ ] Update image.
- [ ] Wait rollout.
- [ ] Show logs.
- [ ] Run health check.
- [ ] Open API client.
- [ ] Rollback automatico opzionale se rollout fallisce.

---

## Helm

- [ ] Detect Helm project.
- [ ] `helm template`.
- [ ] Values viewer.
- [ ] Values diff.
- [ ] Release list.
- [ ] Release status.
- [ ] Release history.
- [ ] Upgrade.
- [ ] Rollback.
- [ ] Dry-run obbligatorio configurabile.

---

## Kustomize

- [ ] Detect `kustomization.yaml`.
- [ ] Render manifests.
- [ ] Overlay DEV.
- [ ] Overlay TEST.
- [ ] Overlay UAT.
- [ ] Overlay PROD.
- [ ] Diff overlay.
- [ ] Preview final manifest.

---

## Argo CD

- [ ] Detect Argo CD Applications.
- [ ] Application status.
- [ ] Sync status.
- [ ] Health.
- [ ] Revision.
- [ ] Repository.
- [ ] Target revision.
- [ ] Resource tree.
- [ ] Diff.
- [ ] Sync.
- [ ] Refresh.
- [ ] Hard refresh.
- [ ] Link commit -> deployment.

---

## OpenShift Pipelines / Tekton

- [ ] Pipeline list.
- [ ] PipelineRun list.
- [ ] TaskRun list.
- [ ] Trigger PipelineRun.
- [ ] Live PipelineRun logs.
- [ ] Pipeline status.
- [ ] Failed task detection.
- [ ] Retry support.
- [ ] Workspace / PVC visibility.
- [ ] Parameters viewer.

---

# Security

## Environment Protection

Default:

```text
DEV   -> Full access
TEST  -> Full access
UAT   -> Confirm destructive operations
PROD  -> Read-only
```

- [ ] Environment classification configurabile.
- [ ] PROD read-only default.
- [ ] Warning persistente quando PROD è selezionato.
- [ ] Confirmation con nome environment.
- [ ] Optional typed confirmation per delete.
- [ ] Disabilitare delete se non strettamente necessario.
- [ ] Rispettare Kubernetes RBAC.
- [ ] Supportare impersonation solo se esplicitamente configurata.

---

## Credential Security

- [ ] Mai salvare token in plaintext.
- [ ] Usare OS keychain quando necessario.
- [ ] Rispettare kubeconfig exec providers.
- [ ] Supportare token rotation.
- [ ] Supportare OAuth OpenShift.
- [ ] Supportare client certificates.
- [ ] Redaction automatica token nei log.
- [ ] Redaction automatica `Authorization`.
- [ ] Redaction automatica Secret.
- [ ] Nessuna credenziale nella telemetry.

---

# Performance

- [ ] Usare Kubernetes Watch API.
- [ ] Evitare polling continuo.
- [ ] Cache locale controllata.
- [ ] Invalidazione cache su cambio context.
- [ ] Lazy loading delle risorse.
- [ ] Limitare numero di log lines in memoria.
- [ ] Ring buffer per logs.
- [ ] Backpressure sullo streaming.
- [ ] Cancellare goroutine tramite context.
- [ ] Detect goroutine leak durante test.
- [ ] Rate limiter client Kubernetes.
- [ ] Retry solo per errori transitori.
- [ ] Exponential backoff.

---

# Error Handling

Definire errori tipizzati:

```go
type ClusterErrorCode string

const (
    ErrAuthentication ClusterErrorCode = "AUTHENTICATION"
    ErrAuthorization  ClusterErrorCode = "AUTHORIZATION"
    ErrConnection     ClusterErrorCode = "CONNECTION"
    ErrTimeout        ClusterErrorCode = "TIMEOUT"
    ErrTLS            ClusterErrorCode = "TLS"
    ErrProxy          ClusterErrorCode = "PROXY"
    ErrNotFound       ClusterErrorCode = "NOT_FOUND"
    ErrUnsupported    ClusterErrorCode = "UNSUPPORTED"
)
```

- [ ] Error wrapping.
- [ ] Root cause.
- [ ] User-friendly error.
- [ ] Debug details separati.
- [ ] Retry suggestion quando appropriato.
- [ ] Nessun panic per errori cluster.

---

# UI

Menu principale:

```text
OpenShift

├── Overview
├── Topology
├── Workloads
├── Pods
├── Logs
├── Events
├── Networking
├── Config
├── Metrics
├── Deploy
└── Settings
```

## Overview

Mostrare:

- [ ] Cluster.
- [ ] Namespace.
- [ ] OpenShift version.
- [ ] Workload status.
- [ ] Pods.
- [ ] Restart count.
- [ ] Current image.
- [ ] Route.
- [ ] CPU.
- [ ] Memory.
- [ ] Recent warnings.
- [ ] Last deployment.

---

# Integrazione con moduli adOmnia

## REST Client

- [ ] Route -> REST request.
- [ ] Service port-forward -> REST request.
- [ ] Import auth headers configurati.
- [ ] Eseguire health endpoint.
- [ ] Mostrare pod logs mentre viene eseguita una request.
- [ ] Ricercare correlation ID nei logs dopo una request.

Flusso ideale:

```text
Send API Request
      ↓
Capture correlationId
      ↓
Search OpenShift Logs
      ↓
Open matching pod logs
```

---

## gRPC

- [ ] Port-forward gRPC service.
- [ ] Aprire automaticamente gRPC client.
- [ ] Reflection check.
- [ ] TLS support.

---

## IDE

Dal file o package corrente:

- [ ] Run locally.
- [ ] Build.
- [ ] Test.
- [ ] Open associated workload.
- [ ] Open pod logs.
- [ ] Port-forward.
- [ ] Open Route.
- [ ] Compare environments.
- [ ] Deploy.
- [ ] Restart workload.

---

## Git

- [ ] Mostrare Git SHA deployato.
- [ ] Confrontare SHA locale con SHA deployato.
- [ ] Evidenziare workspace ahead/behind.
- [ ] Link commit -> Deployment.
- [ ] Link Deployment -> commit.
- [ ] Mostrare branch associato se disponibile.

Esempio:

```text
Local
main @ a83c21f

DEV
a83c21f ✓

TEST
91fce21 ⚠

PROD
72bb801 ⚠
```

---

# Testing

## Unit Test

- [ ] Provider tests.
- [ ] Capability detection tests.
- [ ] Error mapping tests.
- [ ] Environment diff tests.
- [ ] Config parsing tests.
- [ ] Security redaction tests.

## Integration Test

Usare cluster locale:

- [ ] Kind.
- [ ] Minikube.
- [ ] CRC OpenShift quando disponibile.
- [ ] Test Kubernetes puro.
- [ ] Test OpenShift.

## Failure Test

Simulare:

- [ ] Cluster offline.
- [ ] VPN disconnect.
- [ ] Proxy unavailable.
- [ ] Expired token.
- [ ] Forbidden RBAC.
- [ ] Pod deleted durante log stream.
- [ ] Container restart.
- [ ] Namespace deleted.
- [ ] Port-forward interrotto.
- [ ] API server timeout.
- [ ] Certificate error.

---

# Telemetry interna

Telemetry opzionale e locale-first.

Misurare solamente metriche tecniche:

- [ ] Connection duration.
- [ ] API latency.
- [ ] Watch reconnect.
- [ ] Port-forward failure.
- [ ] Log stream reconnect.
- [ ] Goroutine count.
- [ ] Memory consumption.
- [ ] Cache size.

Mai raccogliere:

- [ ] Token.
- [ ] Secret.
- [ ] Log applicativi.
- [ ] Request payload.
- [ ] Response payload.
- [ ] Namespace sensibili senza consenso.

---

# Definition of Done P0

P0 è completato quando lo sviluppatore può:

1. Aprire un workspace adOmnia.
2. Collegarlo a un cluster OpenShift.
3. Selezionare un namespace.
4. Vedere Deployment e Pod.
5. Vedere lo stato dei container.
6. Leggere live logs.
7. Consultare Kubernetes Events.
8. Avviare un port-forward.
9. Aprire il servizio nel REST Client.
10. Cambiare cluster senza riavviare adOmnia.
11. Perdere temporaneamente la connessione senza bloccare l'app.
12. Recuperare automaticamente la connessione.
13. Lavorare senza esporre token o Secret.

**Oggi (Kubernetes Studio):** coperti 3, 5, 6, 8, 10 e 13, e in parte 4 (deployment e pod non ancora collegati tra loro). Mancano 1–2 (binding del workspace al cluster), 7 (Events), 9 (port-forward → REST Client) e 11–12 (reconnect automatico). Prossimo passo consigliato: **Events** e **Open in API Client** dal port-forward, poi il binding del workspace.

---

# Priorità sintetica

```text
P0
Cluster Connection
Context Bar
Namespaces
Workloads
Pods
Logs
Events
Port Forward

P1
Workspace Binding
Services
Routes
Terminal
Restart / Scale / Rollout
ConfigMap
Secrets

P2
Smart Troubleshooting
Environment Diff
Topology
Metrics

P3
Build & Deploy
Helm
Kustomize
Argo CD
Tekton
```

---

# Obiettivo finale

adOmnia deve permettere questo workflow:

```text
Open project
    ↓
Select DEV
    ↓
Code
    ↓
Build
    ↓
Deploy
    ↓
Watch rollout
    ↓
Open logs
    ↓
Call API
    ↓
Capture correlation ID
    ↓
Find request in pod logs
    ↓
Debug
    ↓
Compare DEV / TEST / PROD
```

Il modulo OpenShift deve essere uno strumento da sviluppatore integrato nel workspace, non una replica della console amministrativa OpenShift.
