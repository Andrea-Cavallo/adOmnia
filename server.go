package main

import (
	"log"
	"net"
	"net/http"
)

func startHTTPServer() {
	dlogInfo("startHTTPServer", "avvio HTTP sidecar", nil)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("[server] failed to bind HTTP sidecar: %v", err)
		dlogErr("startHTTPServer", "bind TCP fallito", err, nil)
		return
	}
	serverPort = ln.Addr().(*net.TCPAddr).Port
	dlogInfo("startHTTPServer", "porta assegnata dal SO", map[string]any{"port": serverPort})

	mux := http.NewServeMux()

	// Kafka
	mux.HandleFunc("/kafka/produce", kafkaProduceHandler)
	mux.HandleFunc("/kafka/bulk-produce", kafkaBulkProduceHandler)
	mux.HandleFunc("/kafka/consume", kafkaConsumeHandler)
	mux.HandleFunc("/kafka/topics", kafkaTopicsHandler)

	// Broker Studio — RabbitMQ, MQTT, Redis, NATS, Presets
	mux.HandleFunc("/broker/rabbitmq/publish", rabbitPublishHandler)
	mux.HandleFunc("/broker/rabbitmq/consume", rabbitConsumeHandler)
	mux.HandleFunc("/broker/rabbitmq/exchanges", rabbitExchangesHandler)
	mux.HandleFunc("/broker/mqtt/publish", mqttPublishHandler)
	mux.HandleFunc("/broker/mqtt/subscribe", mqttSubscribeHandler)
	mux.HandleFunc("/broker/redis/publish", redisPublishHandler)
	mux.HandleFunc("/broker/redis/subscribe", redisSubscribeHandler)
	mux.HandleFunc("/broker/nats/publish", natsPublishHandler)
	mux.HandleFunc("/broker/nats/subscribe", natsSubscribeHandler)
	mux.HandleFunc("/broker/presets/save", brokerPresetsSaveHandler)
	mux.HandleFunc("/broker/presets/list", brokerPresetsListHandler)
	mux.HandleFunc("/broker/presets/delete", brokerPresetsDeleteHandler)

	// WebSocket Client
	mux.HandleFunc("/ws/connect", wsConnectHandler)
	mux.HandleFunc("/ws/disconnect", wsDisconnectHandler)
	mux.HandleFunc("/ws/send", wsSendHandler)
	mux.HandleFunc("/ws/ping", wsPingHandler)
	mux.HandleFunc("/ws/stream", wsStreamHandler)
	mux.HandleFunc("/ws/list", WsListHandler)
	mux.HandleFunc("/ws/close-all", WsCloseAllHandler)
	mux.HandleFunc("/sse/connect", sseConnectHandler)
	mux.HandleFunc("/sse/disconnect", sseDisconnectHandler)
	mux.HandleFunc("/sse/stream", sseStreamHandler)
	mux.HandleFunc("/sse/list", SseListHandler)
	mux.HandleFunc("/sse/close-all", SseCloseAllHandler)

	// WebSocket Mock Server
	mux.HandleFunc("/ws/mock/start", wsMockStartHandler)
	mux.HandleFunc("/ws/mock/stop", wsMockStopHandler)
	mux.HandleFunc("/ws/mock/status", wsMockStatusHandler)
	mux.HandleFunc("/ws/mock/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			wsMockRulesSaveHandler(w, r)
		} else {
			wsMockRulesGetHandler(w, r)
		}
	})
	mux.HandleFunc("/ws/mock/hits/clear", wsMockHitsClearHandler)

	// Load Test
	mux.HandleFunc("/loadtest", loadTestHandler)
	mux.HandleFunc("/loadtest/report", loadTestReportHandler)
	mux.HandleFunc("/loadtest/scenario/save", loadTestScenarioSaveHandler)
	mux.HandleFunc("/loadtest/scenario/list", loadTestScenarioListHandler)
	mux.HandleFunc("/loadtest/scenario/load", loadTestScenarioLoadHandler)
	mux.HandleFunc("/loadtest/compare", loadTestCompareHandler)
	mux.HandleFunc("/loadtest/grpc", loadTestGrpcHandler)

	// Mock server control
	mux.HandleFunc("/mock/start", mockStartHandler)
	mux.HandleFunc("/mock/stop", mockStopHandler)
	mux.HandleFunc("/mock/status", mockStatusHandler)
	mux.HandleFunc("/mock/hits", mockHitsHandler)
	mux.HandleFunc("/mock/record", recordReplayHandler)

	// Proxy
	mux.HandleFunc("/proxy/start", proxyStartHandler)
	mux.HandleFunc("/proxy/stop", proxyStopHandler)
	mux.HandleFunc("/proxy/traffic", proxyTrafficHandler)
	mux.HandleFunc("/proxy/breakpoints", proxyBreakpointsHandler)
	mux.HandleFunc("/proxy/export", proxyExportHandler)
	mux.HandleFunc("/proxy/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			proxyRulesPutHandler(w, r)
		} else {
			proxyRulesGetHandler(w, r)
		}
	})
	mux.HandleFunc("/proxy/rules/test", proxyRulesTestHandler)
	mux.HandleFunc("/proxy/rules/log", proxyRulesLogHandler)
	mux.HandleFunc("/proxy/map/local", proxyMapLocalHandler)
	mux.HandleFunc("/proxy/map/remote", proxyMapRemoteHandler)
	mux.HandleFunc("/proxy/throttle", proxyThrottleHandler)
	mux.HandleFunc("/proxy/repeat", proxyRepeatHandler)
	mux.HandleFunc("/proxy/ca/status", caStatusHandler)
	mux.HandleFunc("/proxy/ca/generate", caGenerateHandler)
	mux.HandleFunc("/proxy/ca/export", caExportHandler)
	mux.HandleFunc("/proxy/ca/delete", caDeleteHandler)

	// Storage
	mux.HandleFunc("/storage/status", storageStatusHandler)
	mux.HandleFunc("/storage/get", storageGetHandler)
	mux.HandleFunc("/storage/put", storagePutHandler)
	mux.HandleFunc("/storage/delete", storageDeleteHandler)
	mux.HandleFunc("/storage/list", storageListHandler)
	mux.HandleFunc("/storage/migrate", storageMigrateHandler)
	mux.HandleFunc("/storage/export", storageExportHandler)
	mux.HandleFunc("/storage/import", storageImportHandler)
	mux.HandleFunc("/storage/snapshot", storageSnapshotHandler)
	mux.HandleFunc("/storage/restore", storageRestoreHandler)
	mux.HandleFunc("/storage/search", storageSearchHandler)

	// Database Studio
	mux.HandleFunc("/database/test", databaseTestHandler)
	mux.HandleFunc("/database/query", databaseQueryHandler)

	// Workspace
	mux.HandleFunc("/workspace/list", workspaceListHandler)
	mux.HandleFunc("/workspace/save", workspaceSaveHandler)
	mux.HandleFunc("/workspace/load", workspaceLoadHandler)
	mux.HandleFunc("/workspace/delete", workspaceDeleteHandler)

	// Vault
	mux.HandleFunc("/vault/status", vaultStatusHandler)
	mux.HandleFunc("/vault/unlock", vaultUnlockHandler)
	mux.HandleFunc("/vault/lock", vaultLockHandler)
	mux.HandleFunc("/vault/encrypt", vaultEncryptHandler)
	mux.HandleFunc("/vault/decrypt", vaultDecryptHandler)
	mux.HandleFunc("/vault/export", vaultExportHandler)
	mux.HandleFunc("/vault/import", vaultImportHandler)

	// JSON tools
	mux.HandleFunc("/json/query", jsonQueryHandler)
	mux.HandleFunc("/json/set", jsonSetHandler)
	mux.HandleFunc("/json/diff", jsonDiffHandler)
	mux.HandleFunc("/json/human", jsonHumanHandler)
	mux.HandleFunc("/json/stream", jsonStreamHandler)
	mux.HandleFunc("/json/mimetype", mimeDetectHandler)
	mux.HandleFunc("/cert/jks-split", certJksSplitHandler)
	mux.HandleFunc("/folderdiff/scan", folderDiffHandler)
	mux.HandleFunc("/folderdiff/file", folderDiffFileHandler)

	// Net Tools
	mux.HandleFunc("/dns/lookup", dnsLookupHandler)
	mux.HandleFunc("/dns/trace", dnsTraceHandler)
	mux.HandleFunc("/dns/compare", dnsCompareHandler)
	mux.HandleFunc("/dns/cache", dnsCacheGetHandler)
	mux.HandleFunc("/dns/cache/clear", dnsCacheClearHandler)
	mux.HandleFunc("/portscan", portScanHandler)
	mux.HandleFunc("/cors", corsTestHandler)

	// gRPC
	mux.HandleFunc("/grpc/reflect", grpcReflectHandler)
	mux.HandleFunc("/grpc/describe", grpcDescribeHandler)
	mux.HandleFunc("/grpc/invoke", grpcInvokeHandler)

	handler := withSecurity(mux)

	go func() {
		log.Printf("[server] HTTP sidecar on port %d", serverPort)
		dlogInfo("startHTTPServer.goroutine", "HTTP sidecar in ascolto", map[string]any{"port": serverPort})
		if err := http.Serve(ln, handler); err != nil {
			log.Printf("[server] HTTP sidecar stopped: %v", err)
			dlogErr("startHTTPServer.goroutine", "HTTP sidecar terminato", err, nil)
		}
	}()
}

