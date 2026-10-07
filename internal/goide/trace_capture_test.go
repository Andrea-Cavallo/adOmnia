package goide

import (
	"context"
	"net/http"
	"net/http/httptest"
	httppprof "net/http/pprof"
	"strings"
	"testing"
)

// Un servizio vero con net/http/pprof: la trace catturata deve aprirsi nel Trace viewer.
func TestCaptureLiveTraceFromRunningService(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/trace", httppprof.Trace)
	mux.HandleFunc("/nottrace/debug/pprof/trace", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("hello")) })
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	root := t.TempDir()
	writeFixtureFile(t, root, "go.mod", "module example.com/live\n")
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	request := LiveProfileRequest{SessionID: string(session.ID), URL: server.URL, Seconds: 1}
	if _, err := service.CaptureLiveTrace(context.Background(), request); err == nil {
		t.Fatal("trace saved in an untrusted project")
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	file, err := service.CaptureLiveTrace(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if file.Kind != "trace" || !strings.HasPrefix(file.Relative, "trace-") {
		t.Fatalf("captured file = %+v", file)
	}
	listed, _ := service.ListTraceFiles(string(session.ID))
	if len(listed) != 1 || listed[0].Relative != file.Relative {
		t.Fatalf("trace not listed: %+v", listed)
	}
	if report, err := service.LoadTrace(string(session.ID), file.Relative); err != nil || len(report.Goroutines) == 0 {
		t.Fatalf("captured trace unreadable: %v", err)
	}
	request.URL = server.URL + "/nottrace"
	if _, err := service.CaptureLiveTrace(context.Background(), request); err == nil || !strings.Contains(err.Error(), "trace") {
		t.Fatalf("non-trace response accepted: %v", err)
	}
}
