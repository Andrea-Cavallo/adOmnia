package codestudio

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
)

// fakeConsole is a TCP Equinox console speaking the same prompt protocol as the real one.
func fakeConsole(t *testing.T, script map[string]string) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, _ = conn.Write([]byte("Eclipse Console\r\nosgi> \r\n"))
		reader := bufio.NewReader(conn)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			command := strings.TrimSpace(line)
			reply, ok := script[command]
			if !ok {
				reply = "no such command"
			}
			_, _ = conn.Write([]byte(command + "\r\n" + reply + "\r\nosgi> "))
		}
	}()
	return listener
}

func TestCaptureJavaOsgiRuntimeReadsRealState(t *testing.T) {
	root := t.TempDir()
	writeControlCenterBundle(t, filepath.Join(root, "com.acme.core"), "com.acme.core", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.core
Bundle-Version: 1.0.0
`, nil)
	writeControlCenterBundle(t, filepath.Join(root, "com.acme.broken"), "com.acme.broken", `Manifest-Version: 1.0
Bundle-SymbolicName: com.acme.broken
Bundle-Version: 1.0.0
`, nil)

	states := `id	State       Bundle
0	ACTIVE      org.eclipse.osgi_3.9.1.v20140110
1	ACTIVE      com.acme.core_1.0.0
2	INSTALLED   com.acme.broken_1.0.0`
	listener := fakeConsole(t, map[string]string{
		"ss":         states,
		"startlevel": "StartLevel: 4",
		"services":   "{com.acme.core.api.Service}={service.id=42, service.bundleid=1, service.scope=bundle}",
		"diag 2":     `Missing Constraint: Require-Bundle: com.acme.core; bundle-version="[2.0.0,3.0.0)"`,
	})

	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetToolAuthorization(string(session.ID), true); err != nil {
		t.Fatal(err)
	}
	runtime := &osgiRuntime{
		sessionID: session.ID, port: 0, address: listener.Addr().String(),
		startedAt: time.Now().Add(-2 * time.Second), activeAt: map[int]int64{},
	}
	snapshot, err := service.captureJavaOsgiRuntime(session, runtime)
	if err != nil {
		t.Fatal(err)
	}
	runtime.closeConsole()
	if !snapshot.Settled || snapshot.FrameworkStartLevel != 4 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if len(snapshot.Bundles) != 3 || len(snapshot.Services) != 1 {
		t.Fatalf("bundles = %+v services = %+v", snapshot.Bundles, snapshot.Services)
	}
	if snapshot.Services[0].Provider != "com.acme.core" {
		t.Fatalf("provider not correlated: %+v", snapshot.Services[0])
	}
	if lines := snapshot.Diagnoses[2]; len(lines) != 1 || !strings.Contains(lines[0], "Missing Constraint") {
		t.Fatalf("diagnosis = %+v", snapshot.Diagnoses)
	}
	if snapshot.StartupMs < 0 {
		t.Fatalf("startup = %d", snapshot.StartupMs)
	}

	report, err := service.JavaOsgiExplorer(string(session.ID))
	if err != nil {
		t.Fatal(err)
	}
	statesByName := map[string]eclipsepde.BundleRow{}
	for _, row := range report.Bundles {
		statesByName[row.SymbolicName] = row
	}
	if statesByName["com.acme.core"].RuntimeState != "ACTIVE" || statesByName["com.acme.core"].State != "ACTIVE" {
		t.Fatalf("core = %+v", statesByName["com.acme.core"])
	}
	if statesByName["com.acme.broken"].State != "INSTALLED" {
		t.Fatalf("broken = %+v", statesByName["com.acme.broken"])
	}
	if report.Summary.Active != 1 || report.Summary.Services != 1 {
		t.Fatalf("summary = %+v", report.Summary)
	}
	found := false
	for _, diagnostic := range report.RuntimeDiagnostics {
		if diagnostic.Kind == "runtime-unresolved" && diagnostic.Bundle == "com.acme.broken" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no runtime diagnosis: %+v", report.RuntimeDiagnostics)
	}
}

func TestJavaOsgiRuntimeSnapshotWithoutRuntimeFails(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.JavaOsgiRuntimeSnapshot(string(session.ID)); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("error = %v", err)
	}
}

func TestSameRuntimeStates(t *testing.T) {
	one := []eclipsepde.RuntimeBundle{{ID: 1, State: "ACTIVE"}, {ID: 2, State: "RESOLVED"}}
	two := []eclipsepde.RuntimeBundle{{ID: 1, State: "ACTIVE"}, {ID: 2, State: "ACTIVE"}}
	if !sameRuntimeStates(one, one) {
		t.Fatal("identical states must compare equal")
	}
	if sameRuntimeStates(one, two) || sameRuntimeStates(one, nil) {
		t.Fatal("different states must not compare equal")
	}
}

func TestRuntimeStopWithNoRuntimeIsANoOp(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(service.Shutdown)
	session, err := service.OpenProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.StopJavaOsgiRuntime(string(session.ID)); err != nil {
		t.Fatal(err)
	}
}
