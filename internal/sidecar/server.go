// Package sidecar runs adOmnia's loopback-only HTTP server used by the frontend for long-running features, protected by a random per-launch token and origin checks.
package sidecar

import (
	"context"
	"github.com/Andrea-Cavallo/adOmnia/internal/broker"
	"github.com/Andrea-Cavallo/adOmnia/internal/database"
	"github.com/Andrea-Cavallo/adOmnia/internal/devlog"
	igrpc "github.com/Andrea-Cavallo/adOmnia/internal/grpc"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/kafka"
	"github.com/Andrea-Cavallo/adOmnia/internal/kube"
	"github.com/Andrea-Cavallo/adOmnia/internal/loadtest"
	"github.com/Andrea-Cavallo/adOmnia/internal/logindex"
	"github.com/Andrea-Cavallo/adOmnia/internal/logstream"
	"github.com/Andrea-Cavallo/adOmnia/internal/mock"
	"github.com/Andrea-Cavallo/adOmnia/internal/nettools"
	"github.com/Andrea-Cavallo/adOmnia/internal/oauth"
	"github.com/Andrea-Cavallo/adOmnia/internal/otlp"
	"github.com/Andrea-Cavallo/adOmnia/internal/proxy"
	"github.com/Andrea-Cavallo/adOmnia/internal/sourcemap"
	"github.com/Andrea-Cavallo/adOmnia/internal/sse"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
	"github.com/Andrea-Cavallo/adOmnia/internal/vault"
	"github.com/Andrea-Cavallo/adOmnia/internal/ws"
	"log"
	"net"
	"net/http"
	"time"
)

var httpSidecar *http.Server

func Stop() {
	database.CloseAll()
	// Live sources own processes and goroutines: closing the sidecar must not
	// leave a kubectl or docker follow running.
	logstream.CloseAll()
	kube.CloseAll()
	logindex.CloseAll()
	otlp.Shutdown()
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
	loadtest.Configure(storage.Put, storage.Get, storage.List, storage.Delete, port, Token())
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
	vault.SetCredentialRefGuard(database.IsCredentialRef)

	// Vault
	vault.RegisterHandlers(mux)

	// JSON tools
	jsonutil.RegisterHandlers(mux)

	// Net Tools
	nettools.RegisterHandlers(mux)

	// Stack frame → repository source mapping
	sourcemap.RegisterHandlers(mux)

	// Live log acquisition: file tail, kubectl/oc/docker logs
	logstream.RegisterHandlers(mux)

	// Kubernetes Studio — read-only cluster exploration
	kube.RegisterHandlers(mux)

	// On-disk index for log files larger than the available RAM
	logindex.RegisterHandlers(mux)

	// gRPC
	igrpc.RegisterHandlers(mux)

	// OAuth 2.0 Authorization Code + PKCE
	oauth.RegisterHandlers(mux)

	// DevLogs streaming
	devlog.RegisterHandlers(mux)

	// Local OpenTelemetry trace receiver (listens only after the user starts it)
	otlp.RegisterHandlers(mux)

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
