package codestudio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime/pprof"
	"strings"
	"testing"
)

// Un vero servizio con net/http/pprof: il goroutine profile non si può ottenere da go test.
func TestCaptureLiveProfileFromRunningService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		kind := strings.TrimPrefix(r.URL.Path, "/app/debug/pprof/")
		if p := pprof.Lookup(kind); p != nil {
			_ = p.WriteTo(w, 0)
			return
		}
		_, _ = w.Write([]byte("<html>not pprof</html>"))
	}))
	t.Cleanup(server.Close)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/live\n")
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	request := LiveProfileRequest{SessionID: string(session.ID), URL: server.URL + "/app/debug/pprof/", Kind: "goroutine"}
	if _, err := service.CaptureLiveProfile(context.Background(), request); err == nil {
		t.Fatal("capture saved a file in an untrusted project")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"goroutine", "threadcreate"} {
		request.Kind = kind
		file, err := service.CaptureLiveProfile(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if file.Kind != kind || !strings.HasPrefix(file.Relative, kind+"-") {
			t.Fatalf("captured file = %+v", file)
		}
		report, err := service.LoadProfile(string(session.ID), file.Relative)
		if err != nil || len(report.SampleTypes) == 0 {
			t.Fatalf("captured %s profile unreadable: %v", kind, err)
		}
	}
	request.Kind = "allocs-but-wrong"
	if _, err := service.CaptureLiveProfile(context.Background(), request); err == nil {
		t.Fatal("unknown kind accepted")
	}
	request.Kind, request.URL = "goroutine", server.URL+"/elsewhere/debug/pprof"
	if _, err := service.CaptureLiveProfile(context.Background(), request); err == nil || !strings.Contains(err.Error(), "pprof") {
		t.Fatalf("non-pprof response accepted: %v", err)
	}
}
