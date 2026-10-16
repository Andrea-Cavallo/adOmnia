package perf

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func envLookup(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestPprofDisabledByDefault(t *testing.T) {
	for _, value := range []string{"", "0", "false", "off", "FALSE"} {
		addr, closeServer, err := startPprofFromEnv(envLookup(map[string]string{pprofEnv: value}))
		if err != nil {
			t.Fatalf("value %q: unexpected error: %v", value, err)
		}
		if addr != "" || closeServer != nil {
			t.Fatalf("value %q: expected disabled endpoint, got addr %q", value, addr)
		}
	}
	addr, closeServer, err := startPprofFromEnv(envLookup(map[string]string{}))
	if err != nil || addr != "" || closeServer != nil {
		t.Fatalf("unset env: expected disabled endpoint, got addr %q err %v", addr, err)
	}
}

func TestPprofServesOnLoopbackWhenEnabled(t *testing.T) {
	addr, closeServer, err := startPprofFromEnv(envLookup(map[string]string{pprofEnv: "127.0.0.1:0"}))
	if err != nil {
		t.Fatalf("start pprof: %v", err)
	}
	defer closeServer()
	if !strings.HasPrefix(addr, "127.0.0.1:") {
		t.Fatalf("expected loopback address, got %q", addr)
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://" + addr + "/debug/pprof/")
	if err != nil {
		t.Fatalf("GET /debug/pprof/: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "profile") {
		t.Fatalf("unexpected pprof index: status %d body %q", response.StatusCode, body)
	}
	response, err = client.Get("http://" + addr + "/debug/pprof/goroutine?debug=1")
	if err != nil {
		t.Fatalf("GET /debug/pprof/goroutine: %v", err)
	}
	defer response.Body.Close()
	body, _ = io.ReadAll(response.Body)
	if !strings.Contains(string(body), "goroutine profile") {
		t.Fatalf("unexpected goroutine profile: %q", body)
	}
}

func TestPprofRejectsNonLoopbackAddress(t *testing.T) {
	for _, value := range []string{"0.0.0.0:6069", "192.168.1.10:6069", "example.com:6069", "not-an-address"} {
		_, closeServer, err := startPprofFromEnv(envLookup(map[string]string{pprofEnv: value}))
		if closeServer != nil {
			closeServer()
		}
		if err == nil {
			t.Fatalf("value %q: expected rejection", value)
		}
	}
}
