package eclipsepde

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

const classicBundleStates = `Framework is launched.


id	State       Bundle
0	ACTIVE      org.eclipse.osgi_3.9.1.v20140110
1	ACTIVE      org.eclipse.equinox.common_3.6.200.v20130402-1505
2	RESOLVED    com.acme.core_1.2.0
3	INSTALLED   com.acme.broken_1.0.0
4	RESOLVED    com.acme.core.tests_1.0.0 Fragment
`

func TestParseBundleStatesClassicLayout(t *testing.T) {
	bundles := ParseBundleStates(classicBundleStates)
	if len(bundles) != 5 {
		t.Fatalf("bundles = %+v", bundles)
	}
	if bundles[0].ID != 0 || bundles[0].State != "ACTIVE" || bundles[0].SymbolicName != "org.eclipse.osgi" || bundles[0].Version != "3.9.1.v20140110" {
		t.Fatalf("system bundle = %+v", bundles[0])
	}
	if bundles[3].State != "INSTALLED" || bundles[3].SymbolicName != "com.acme.broken" {
		t.Fatalf("broken = %+v", bundles[3])
	}
	if !bundles[4].Fragment || bundles[4].SymbolicName != "com.acme.core.tests" {
		t.Fatalf("fragment = %+v", bundles[4])
	}
}

func TestParseBundleStatesBracketLayout(t *testing.T) {
	output := `[  1] [Active     ] [    1] com.acme.core_1.2.0
[ 12] [Installed  ] [    1] com.acme.broken_1.0.0
[ 13] [Resolved   ] [    1] com.acme.core.tests_1.0.0 Fragment
`
	bundles := ParseBundleStates(output)
	if len(bundles) != 3 {
		t.Fatalf("bundles = %+v", bundles)
	}
	if bundles[0].ID != 1 || bundles[0].State != "ACTIVE" || bundles[0].SymbolicName != "com.acme.core" {
		t.Fatalf("active = %+v", bundles[0])
	}
	if bundles[1].State != "INSTALLED" || bundles[1].SymbolicName != "com.acme.broken" {
		t.Fatalf("installed = %+v", bundles[1])
	}
	if !bundles[2].Fragment {
		t.Fatalf("fragment = %+v", bundles[2])
	}
}

func TestParseServicesRegistry(t *testing.T) {
	output := `{com.acme.core.api.Service}={service.id=42, service.bundleid=7, service.scope=bundle, objectClass=[Ljava.lang.String;}
  Used by:
    com.acme.ui_1.0.0 [9]
{org.osgi.service.log.LogService}={service.id=8, service.bundleid=1, service.scope=singleton}
`
	services := ParseServices(output)
	if len(services) != 2 {
		t.Fatalf("services = %+v", services)
	}
	byInterface := map[string]RuntimeService{}
	for _, service := range services {
		byInterface[service.Interface] = service
	}
	core := byInterface["com.acme.core.api.Service"]
	if core.ServiceID != "42" || core.BundleID != "7" {
		t.Fatalf("core service = %+v", core)
	}
	if len(core.Consumers) != 1 || !strings.Contains(core.Consumers[0], "com.acme.ui") {
		t.Fatalf("consumers = %+v", core.Consumers)
	}
}

func TestParseStartLevelAndDiagnosis(t *testing.T) {
	if level := ParseStartLevel("FrameworkStartLevel: 6\n"); level != 6 {
		t.Fatalf("level = %d", level)
	}
	diagnosis := ParseDiagnosis(`Missing Constraint: Import-Package: com.acme.missing; version="1.0.0"
  Another reason
`)
	if len(diagnosis) != 2 || !strings.HasPrefix(diagnosis[0], "Missing Constraint") {
		t.Fatalf("diagnosis = %+v", diagnosis)
	}
}

func TestCleanConsoleOutputStripsTelnetAndANSI(t *testing.T) {
	// IAC WILL ECHO, then a red word, then IAC SB ... IAC SE.
	raw := []byte{255, 251, 1}
	raw = append(raw, []byte("\x1b[31mhello\x1b[0m")...)
	raw = append(raw, 255, 250, 24, 1, 2, 255, 240)
	raw = append(raw, []byte(" world")...)
	if got := cleanConsoleOutput(raw); got != "hello world" {
		t.Fatalf("cleaned = %q", got)
	}
}

// TestConsoleAskTalksToAFakeFramework drives the client against a console that negotiates
// telnet options and answers with a prompt, exactly like Equinox does.
func TestConsoleAskTalksToAFakeFramework(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()

	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Telnet negotiation, banner, prompt.
		_, _ = conn.Write([]byte{255, 251, 1, 255, 251, 3})
		_, _ = conn.Write([]byte("Eclipse Console\r\nosgi> \r\n"))
		reader := bufio.NewReader(conn)
		command, _ := reader.ReadString('\n')
		if strings.TrimSpace(command) != "ss" {
			return
		}
		_, _ = conn.Write([]byte("ss\r\n" + classicBundleStates + "\r\nosgi> "))
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	console, err := DialConsole(ctx, listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = console.Close() }()
	output, err := console.Ask(ctx, "ss")
	if err != nil {
		t.Fatal(err)
	}
	bundles := ParseBundleStates(output)
	if len(bundles) != 5 {
		t.Fatalf("bundles = %+v from %q", bundles, output)
	}
	<-done
}

func TestCorrelateRuntimeWritesRealStates(t *testing.T) {
	report := &ExplorerReport{
		Root: "/ws",
		Bundles: []BundleRow{
			{SymbolicName: "com.acme.core", Version: "1.0.0", Source: "workspace", State: "RESOLVED"},
			{SymbolicName: "com.acme.lazy", Version: "1.0.0", Source: "workspace", State: "RESOLVED", Lazy: true},
			{SymbolicName: "com.acme.broken", Version: "1.0.0", Source: "workspace", State: "RESOLVED"},
			{SymbolicName: "com.acme.other", Version: "2.0.0", Source: "target", State: "TARGET"},
		},
	}
	snapshot := &RuntimeSnapshot{
		Port: 40123, FrameworkStartLevel: 4, Settled: true,
		Bundles: []RuntimeBundle{
			{ID: 1, State: "ACTIVE", SymbolicName: "com.acme.core", Version: "1.0.0", ActiveAtMs: 1200},
			{ID: 2, State: "RESOLVED", SymbolicName: "com.acme.lazy", Version: "1.0.0"},
			{ID: 3, State: "INSTALLED", SymbolicName: "com.acme.broken", Version: "1.0.0"},
			{ID: 4, State: "ACTIVE", SymbolicName: "com.acme.other", Version: "2.0.0"},
		},
		Services:  []RuntimeService{{Interface: "com.acme.core.api.Service", ServiceID: "42", BundleID: "1"}},
		Diagnoses: map[int][]string{3: {"Missing Constraint: Require-Bundle: com.acme.core; bundle-version=\"[2.0.0,3.0.0)\""}},
	}
	diagnostics := report.CorrelateRuntime(snapshot)
	if report.Bundles[0].State != "ACTIVE" || report.Bundles[0].RuntimeState != "ACTIVE" || report.Bundles[0].ActiveAtMs != 1200 {
		t.Fatalf("core = %+v", report.Bundles[0])
	}
	if report.Bundles[2].State != "INSTALLED" {
		t.Fatalf("broken = %+v", report.Bundles[2])
	}
	if report.Summary.Active != 1 {
		t.Fatalf("active = %d", report.Summary.Active)
	}
	if report.Summary.Services != 1 || snapshot.Services[0].Provider != "com.acme.core" {
		t.Fatalf("services = %+v", snapshot.Services)
	}
	kinds := map[string]bool{}
	for _, diagnostic := range diagnostics {
		kinds[diagnostic.Kind] = true
	}
	if !kinds["runtime-unresolved"] {
		t.Fatalf("no runtime diagnosis: %+v", diagnostics)
	}
	if kinds["runtime-inactive"] {
		t.Fatalf("a lazy RESOLVED bundle must not be reported: %+v", diagnostics)
	}
	if len(report.RuntimeDiagnostics) != len(diagnostics) || report.Summary.RuntimeIssues == 0 {
		t.Fatalf("runtime diagnostics not stored: %+v", report.RuntimeDiagnostics)
	}
}

func TestRuntimeInactiveDiagnosticIsOnlyForEagerBundles(t *testing.T) {
	report := &ExplorerReport{
		Bundles: []BundleRow{{SymbolicName: "com.acme.idle", Version: "1.0.0", Source: "workspace", State: "RESOLVED"}},
	}
	snapshot := &RuntimeSnapshot{FrameworkStartLevel: 4, Bundles: []RuntimeBundle{{ID: 5, State: "RESOLVED", SymbolicName: "com.acme.idle", Version: "1.0.0"}}}
	diagnostics := report.CorrelateRuntime(snapshot)
	if len(diagnostics) != 1 || diagnostics[0].Kind != "runtime-inactive" {
		t.Fatalf("diagnostics = %+v", diagnostics)
	}
	if !strings.Contains(diagnostics[0].Cause, "start level 4") {
		t.Fatalf("cause = %q", diagnostics[0].Cause)
	}
}
