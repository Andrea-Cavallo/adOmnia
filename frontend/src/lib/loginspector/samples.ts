export interface LogSample {
  id: string
  label: string
  detail: string
  text: string
}

const SINGLE_JSON = `{
  "@timestamp": "2026-03-11T09:14:02.481Z",
  "level": "ERROR",
  "service": "payments-api",
  "namespace": "prod-payments",
  "pod": "payments-api-7d9f5c8b46-x2kzq",
  "container": "payments-api",
  "thread": "http-nio-8080-exec-7",
  "logger": "com.acme.payments.SettlementController",
  "correlationId": "c8f1e2a4-91bd-4f0a-9d3e-77c2b1a0e551",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "requestId": "req-88213",
  "message": "Settlement rejected by upstream clearing house",
  "http": { "method": "POST", "path": "/v2/settlements", "status": 502 },
  "upstream": { "endpoint": "https://clearing.internal/v1/submit", "latencyMs": 4821 }
}`

const JSONL = `{"time":"2026-03-11T09:14:01.902Z","level":"info","service":"api-gateway","pod":"gateway-59c7d4f8-abcde","correlationId":"c8f1e2a4","msg":"POST /v2/settlements accepted","requestId":"req-88213"}
{"time":"2026-03-11T09:14:01.944Z","level":"debug","service":"payments-api","pod":"payments-api-7d9f5c8b46-x2kzq","correlationId":"c8f1e2a4","msg":"Loading merchant profile","merchantId":"M-4471"}
{"time":"2026-03-11T09:14:02.310Z","level":"warn","service":"payments-api","pod":"payments-api-7d9f5c8b46-x2kzq","correlationId":"c8f1e2a4","msg":"Clearing house latency above threshold","latencyMs":4210,"thresholdMs":2000}
{"time":"2026-03-11T09:14:02.481Z","level":"error","service":"payments-api","pod":"payments-api-7d9f5c8b46-x2kzq","correlationId":"c8f1e2a4","msg":"Settlement rejected by upstream clearing house","status":502}
{"time":"2026-03-11T09:14:02.503Z","level":"info","service":"api-gateway","pod":"gateway-59c7d4f8-abcde","correlationId":"c8f1e2a4","msg":"POST /v2/settlements -> 502","durationMs":601}`

const JAVA_STACK = `2026-03-11 09:14:02.481 ERROR 1 --- [http-nio-8080-exec-7] c.a.payments.SettlementController : Unhandled failure while submitting settlement
java.lang.IllegalStateException: Clearing house returned an unmapped status: 502
\tat com.acme.payments.clearing.ClearingClient.submit(ClearingClient.java:118)
\tat com.acme.payments.SettlementService.settle(SettlementService.java:64)
\tat com.acme.payments.SettlementController.create(SettlementController.java:41)
\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
Caused by: java.net.SocketTimeoutException: Read timed out
\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)
\tat com.acme.payments.clearing.ClearingClient.submit(ClearingClient.java:112)
\t... 14 more
2026-03-11 09:14:02.503  INFO 1 --- [http-nio-8080-exec-7] c.a.payments.SettlementController : Returning 502 to caller`

const GO_PANIC = `2026-03-11T09:20:11.004Z INFO  ledger-worker starting batch 8814
panic: runtime error: index out of range [3] with length 2

goroutine 42 [running]:
github.com/acme/ledger/internal/batch.(*Runner).apply(0xc0000b4000, 0x3)
\t/src/internal/batch/runner.go:212 +0x1a5
github.com/acme/ledger/internal/batch.(*Runner).Run(0xc0000b4000)
\t/src/internal/batch/runner.go:88 +0x9c
main.main()
\t/src/cmd/worker/main.go:57 +0x2d4
exit status 2
2026-03-11T09:20:11.220Z WARN  supervisor restarting ledger-worker (attempt 3)`

// Real `oc logs` output: CRI-O prefixes, ANSI colours, a plain startup banner,
// escaped JSON inside `message`, and one truncated line.
const OPENSHIFT_MIXED = `2026-03-11T09:13:58.100311842Z stdout F Starting Acme Payments API v4.2.1 (profile=prod)
2026-03-11T09:13:59.221004112Z stdout F [32mINFO[0m  Connected to postgres://payments-db:5432/payments
2026-03-11T09:14:01.944211004Z stdout F {"time":"2026-03-11T09:14:01.944Z","severity":"DEBUG","app":"payments-api","kubernetes":{"pod_name":"payments-api-7d9f5c8b46-x2kzq","namespace_name":"prod-payments","container_name":"payments-api"},"correlation_id":"c8f1e2a4","message":"Loading merchant profile"}
2026-03-11T09:14:02.100000000Z stdout F {"time":"2026-03-11T09:14:02.100Z","severity":"INFO","app":"payments-api","correlation_id":"c8f1e2a4","message":"{\\"event\\":\\"upstream.request\\",\\"endpoint\\":\\"/v1/submit\\",\\"attempt\\":2,\\"headers\\":{\\"authorization\\":\\"Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature\\"}}"}
2026-03-11T09:14:02.481774331Z stderr F {"time":"2026-03-11T09:14:02.481Z","severity":"ERROR","app":"payments-api","correlation_id":"c8f1e2a4","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","message":"Settlement rejected by upstream clearing house","status":502}
2026-03-11T09:14:02.482991002Z stderr F java.lang.IllegalStateException: Clearing house returned an unmapped status: 502
2026-03-11T09:14:02.483001002Z stderr F \tat com.acme.payments.clearing.ClearingClient.submit(ClearingClient.java:118)
2026-03-11T09:14:02.483011002Z stderr F \tat com.acme.payments.SettlementService.settle(SettlementService.java:64)
2026-03-11T09:14:02.900112004Z stdout F {"time":"2026-03-11T09:14:02.900Z","severity":"INFO","app":"payments-api","message":"truncated payload follows","data":{"items":[1,2,
2026-03-11T09:14:03.010112004Z stdout F Shutdown hook registered`

export const LOG_SAMPLES: LogSample[] = [
  { id: 'single-json', label: 'Single JSON event', detail: 'One pretty-printed structured event', text: SINGLE_JSON },
  { id: 'jsonl', label: 'JSON Lines (NDJSON)', detail: 'One request across two services', text: JSONL },
  { id: 'java-stack', label: 'Java stack trace', detail: 'Spring Boot log with Caused by', text: JAVA_STACK },
  { id: 'go-panic', label: 'Go panic', detail: 'goroutine dump with file frames', text: GO_PANIC },
  { id: 'openshift', label: 'OpenShift mixed log', detail: 'CRI prefixes, ANSI, nested JSON, one broken line', text: OPENSHIFT_MIXED },
]
