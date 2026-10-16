// Package perf hosts opt-in profiling and scenario recording for adOmnia
// itself, used by the local performance baseline protocol (docs/PERFORMANCE.md).
// Every path is local-only: no telemetry, no remote endpoints, and nothing is
// exposed unless the developer explicitly enables it.
package perf

import (
	"fmt"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	rtpprof "runtime/pprof"
	"strings"
)

// pprofEnv is the opt-in switch: unset or "0"/"false"/"off" keeps the endpoint
// disabled; "1"/"true"/"on" binds the default loopback address; any other value
// is used as the listen address and must be loopback.
const pprofEnv = "ADOMNIA_PPROF"

const defaultPprofAddr = "127.0.0.1:6069"

// StartPprof exposes net/http/pprof when ADOMNIA_PPROF enables it. Returns the
// bound address ("" when disabled). The listener is loopback-only in every
// case; a non-loopback address is rejected instead of being weakened silently.
func StartPprofFromEnv() (string, error) {
	addr, closeServer, err := startPprofFromEnv(os.Getenv)
	if err != nil || closeServer == nil {
		return addr, err
	}
	// The endpoint lives for the whole process; shutdown of the application
	// does not need to close it explicitly.
	_ = closeServer
	return addr, nil
}

func startPprofFromEnv(getenv func(string) string) (string, func(), error) {
	value := strings.TrimSpace(getenv(pprofEnv))
	switch strings.ToLower(value) {
	case "", "0", "false", "off":
		return "", nil, nil
	case "1", "true", "on":
		value = defaultPprofAddr
	}
	return startPprof(value)
}

// startPprof binds addr with a dedicated mux (DefaultServeMux stays untouched)
// and serves the standard pprof handlers on it. The returned func closes the
// listener (used by tests).
func startPprof(addr string) (string, func(), error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return "", nil, fmt.Errorf("invalid %s address %q: %w", pprofEnv, addr, err)
	}
	if !isLoopbackHost(host) {
		return "", nil, fmt.Errorf("%s refuses non-loopback address %q", pprofEnv, addr)
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return "", nil, fmt.Errorf("listen for pprof on %s: %w", addr, err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	for _, profile := range rtpprof.Profiles() {
		mux.Handle("/debug/pprof/"+profile.Name(), pprof.Handler(profile.Name()))
	}
	server := &http.Server{Handler: mux}
	go func() {
		// Serve returns on listener close; a dev-only endpoint must never
		// take the application down with it.
		_ = server.Serve(listener)
	}()
	closeServer := func() { _ = listener.Close() }
	return listener.Addr().String(), closeServer, nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
