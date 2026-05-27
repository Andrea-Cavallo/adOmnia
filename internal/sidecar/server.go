package sidecar

import (
	"adomnia/internal/broker"
	"adomnia/internal/database"
	"adomnia/internal/devlog"
	igrpc "adomnia/internal/grpc"
	"adomnia/internal/jsonutil"
	"adomnia/internal/kafka"
	"adomnia/internal/loadtest"
	"adomnia/internal/mock"
	"adomnia/internal/nettools"
	"adomnia/internal/oauth"
	"adomnia/internal/proxy"
	"adomnia/internal/sse"
	"adomnia/internal/storage"
	"adomnia/internal/vault"
	"adomnia/internal/ws"
	"context"
	"log"
	"net"
	"net/http"
	"time"
)

var httpSidecar *http.Server

func Stop() {
	if httpSidecar == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := httpSidecar.Shutdown(ctx); err != nil {
		log.Printf("[server] HTTP sidecar shutdown error: %v", err)
	}
}

func Start() int {
	devlog.Info("startHTTPServer", "avvio HTTP sidecar", nil)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("[server] failed to bind HTTP sidecar: %v", err)
		devlog.Err("startHTTPServer", "bind TCP fallito", err, nil)
		return 0
	}
	port := ln.Addr().(*net.TCPAddr).Port
	oauth.SetServerPort(port)
	devlog.Info("startHTTPServer", "porta assegnata dal SO", map[string]any{"port": port})

	mux := http.NewServeMux()

	// Kafka
	kafka.RegisterHandlers(mux)

	// Broker Studio — RabbitMQ, MQTT, Redis, NATS, Presets
	broker.SetDB(storage.DB())
	broker.RegisterHandlers(mux)

	// WebSocket Client
	ws.RegisterHandlers(mux)
	sse.RegisterHandlers(mux)

	// Load Test
	loadtest.Configure(storage.Put, storage.Get, storage.List, storage.Delete, port)
	loadtest.RegisterHandlers(mux)

	// Mock server control
	mock.SetPersistConfig(func(data []byte) error {
		return storage.Put("mock", "config", data)
	})
	mock.RegisterHandlers(mux)

	// Proxy
	proxy.RegisterHandlers(mux)

	// Storage and workspaces
	storage.RegisterHandlers(mux)

	// Database Studio
	database.RegisterHandlers(mux)

	// Vault
	vault.RegisterHandlers(mux)

	// JSON tools
	jsonutil.RegisterHandlers(mux)

	// Net Tools
	nettools.RegisterHandlers(mux)

	// gRPC
	igrpc.RegisterHandlers(mux)

	// OAuth 2.0 Authorization Code + PKCE
	oauth.RegisterHandlers(mux)

	// DevLogs streaming
	devlog.RegisterHandlers(mux)

	handler := WithSecurity(mux)

	httpSidecar = &http.Server{Handler: handler}
	go func() {
		log.Printf("[server] HTTP sidecar on port %d", port)
		devlog.Info("startHTTPServer.goroutine", "HTTP sidecar in ascolto", map[string]any{"port": port})
		if err := httpSidecar.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[server] HTTP sidecar stopped: %v", err)
			devlog.Err("startHTTPServer.goroutine", "HTTP sidecar terminato", err, nil)
		}
	}()
	return port
}
