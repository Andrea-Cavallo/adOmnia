package golang

import (
	"testing"
)

func TestLiveProfileEndpointIsLocalOnly(t *testing.T) {
	for raw, want := range map[string]string{
		"localhost:6060":                         "http://localhost:6060/debug/pprof/goroutine",
		"http://127.0.0.1:6060/debug/pprof/heap": "http://127.0.0.1:6060/debug/pprof/goroutine",
		"http://[::1]:8080/admin/":               "http://[::1]:8080/admin/debug/pprof/goroutine",
	} {
		got, _, err := liveProfileEndpoint(LiveProfileRequest{URL: raw, Kind: "goroutine"})
		if err != nil || got != want {
			t.Fatalf("%s → %q, %v; want %q", raw, got, err, want)
		}
	}
	if _, _, err := liveProfileEndpoint(LiveProfileRequest{URL: "http://example.com:6060", Kind: "goroutine"}); err == nil {
		t.Fatal("remote host accepted")
	}
	got, timeout, err := liveProfileEndpoint(LiveProfileRequest{URL: "localhost:6060", Kind: "profile", Seconds: 600})
	if err != nil || got != "http://localhost:6060/debug/pprof/profile?seconds=60" || timeout <= liveProfileTimeout {
		t.Fatalf("cpu endpoint = %q %v %v", got, timeout, err)
	}
}
