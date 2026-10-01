package goide

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// fakeModuleProxy simula `go list -m` per un modulo con le versioni e le direttive go indicate.
type fakeModuleProxy struct {
	modulePath string
	versions   []string          // ordine crescente, come go list -versions
	goVersions map[string]string // versione -> direttiva go
	latest     string
	calls      int
	envSeen    [][]string
}

func (p *fakeModuleProxy) run(_ context.Context, _, _ string, env []string, args ...string) ([]byte, error) {
	p.calls++
	p.envSeen = append(p.envSeen, env)
	query := args[len(args)-1]
	path, ver, _ := strings.Cut(query, "@")
	if path != p.modulePath {
		return nil, fmt.Errorf("go: module %s: no matching versions for query %q", path, ver)
	}
	if ver == "latest" {
		ver = p.latest
	}
	info := moduleInfo{Path: p.modulePath, Version: ver, GoVersion: p.goVersions[ver]}
	for _, arg := range args {
		if arg == "-versions" {
			info.Versions = p.versions
		}
	}
	return json.Marshal(info)
}

func installFakeProxy(t *testing.T, proxy *fakeModuleProxy) {
	t.Helper()
	original := goCommandRunner
	goCommandRunner = proxy.run
	toolResolutionMu.Lock()
	toolResolutionCache = map[string]toolResolution{}
	toolResolutionMu.Unlock()
	t.Cleanup(func() {
		goCommandRunner = original
		toolResolutionMu.Lock()
		toolResolutionCache = map[string]toolResolution{}
		toolResolutionMu.Unlock()
	})
}

func lintProxy() *fakeModuleProxy {
	versions := []string{"v2.0.0", "v2.1.0", "v2.2.0", "v2.3.0-rc.1", "v2.3.0", "v2.4.0", "v2.5.0-beta.1", "v2.5.0"}
	return &fakeModuleProxy{
		modulePath: "github.com/golangci/golangci-lint/v2",
		versions:   versions,
		latest:     "v2.5.0",
		goVersions: map[string]string{
			"v2.0.0": "1.23.0", "v2.1.0": "1.23.0", "v2.2.0": "1.24.0", "v2.3.0-rc.1": "1.24.0",
			"v2.3.0": "1.25.0", "v2.4.0": "1.25.0", "v2.5.0-beta.1": "1.24.0", "v2.5.0": "1.27.0",
		},
	}
}

const lintModule = "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest"

func TestToolVersionGoComparison(t *testing.T) {
	cases := []struct {
		required, local string
		want            bool
	}{
		{"", "go1.20", true},
		{requiredGo("1.26.0"), "go1.26.5", true},
		{requiredGo("1.26"), "go1.26.0", true},
		{requiredGo("1.27.0"), "go1.26.5", false},
		{requiredGo("go1.25"), "go1.26rc1", true},
	}
	for _, tc := range cases {
		if got := goCompatible(tc.required, tc.local); got != tc.want {
			t.Errorf("goCompatible(%q, %q) = %v, want %v", tc.required, tc.local, got, tc.want)
		}
	}
	if toolDisplayName("github.com/golangci/golangci-lint/v2/cmd/golangci-lint") != "golangci-lint" ||
		toolDisplayName("golang.org/x/tools/gopls") != "gopls" || toolDisplayName("example.com/tool/v3") != "tool" {
		t.Error("toolDisplayName returned an unexpected name")
	}
}

func TestToolVersionLatestCompatible(t *testing.T) {
	proxy := lintProxy()
	installFakeProxy(t, proxy)
	resolved, note, err := resolveCompatibleToolModule(context.Background(), "go", "", []string{"GOTOOLCHAIN=auto", "PATH=x"}, lintModule, "go1.27.1")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.5.0" || note != "" {
		t.Fatalf("resolved=%q note=%q", resolved, note)
	}
	for _, env := range proxy.envSeen {
		count := 0
		for _, entry := range env {
			if strings.HasPrefix(entry, "GOTOOLCHAIN=") {
				count++
				if entry != "GOTOOLCHAIN=local" {
					t.Fatalf("unexpected %s", entry)
				}
			}
		}
		if count != 1 {
			t.Fatalf("GOTOOLCHAIN set %d times", count)
		}
	}
}

func TestToolVersionOlderCompatibleFoundAndPrereleaseSkipped(t *testing.T) {
	proxy := lintProxy()
	installFakeProxy(t, proxy)
	resolved, note, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, lintModule, "go1.24.3")
	if err != nil {
		t.Fatal(err)
	}
	// v2.5.0-beta.1 (go 1.24) e v2.3.0-rc.1 sono pre-release: va scelta v2.2.0.
	if resolved != "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.2.0" {
		t.Fatalf("resolved=%q", resolved)
	}
	want := "golangci-lint v2.5.0 needs go1.27.0; installing v2.2.0, the newest compatible with go1.24.3"
	if note != want {
		t.Fatalf("note=%q want %q", note, want)
	}
	if proxy.calls > toolResolveMaxQueries {
		t.Fatalf("too many queries: %d", proxy.calls)
	}
}

func TestToolVersionNoneCompatible(t *testing.T) {
	proxy := lintProxy()
	installFakeProxy(t, proxy)
	_, _, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, lintModule, "go1.22.0")
	if err == nil {
		t.Fatal("expected an error")
	}
	want := "golangci-lint requires go >= go1.23.0; the selected SDK is go1.22.0."
	if !strings.HasPrefix(err.Error(), want) || !strings.Contains(err.Error(), "does not download Go toolchains") {
		t.Fatalf("error=%q", err)
	}
	calls := proxy.calls
	if _, _, again := resolveCompatibleToolModule(context.Background(), "go", "", nil, lintModule, "go1.22.0"); again == nil || proxy.calls != calls {
		t.Fatalf("incompatibility should be cached (err=%v, calls %d -> %d)", again, calls, proxy.calls)
	}
}

func TestToolVersionCachingAndPinnedModules(t *testing.T) {
	proxy := lintProxy()
	installFakeProxy(t, proxy)
	first, _, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, lintModule, "go1.25.0")
	if err != nil {
		t.Fatal(err)
	}
	calls := proxy.calls
	second, _, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, lintModule, "go1.25.0")
	if err != nil || second != first || proxy.calls != calls {
		t.Fatalf("second call: %q %v, calls %d -> %d", second, err, calls, proxy.calls)
	}
	if first != "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.4.0" {
		t.Fatalf("resolved=%q", first)
	}
	pinned := "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.1.0"
	if got, note, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, pinned, "go1.25.0"); got != pinned || note != "" || err != nil || proxy.calls != calls {
		t.Fatalf("pinned module changed: %q %q %v", got, note, err)
	}
}

func TestToolVersionNetworkErrorNotCached(t *testing.T) {
	installFakeProxy(t, &fakeModuleProxy{})
	failures := 0
	goCommandRunner = func(context.Context, string, string, []string, ...string) ([]byte, error) {
		failures++
		return nil, fmt.Errorf("dial tcp: no route to host")
	}
	if _, _, err := resolveCompatibleToolModule(context.Background(), "go", "", nil, "golang.org/x/tools/gopls@latest", "go1.26.0"); err == nil {
		t.Fatal("expected an error")
	}
	before := failures
	_, _, _ = resolveCompatibleToolModule(context.Background(), "go", "", nil, "golang.org/x/tools/gopls@latest", "go1.26.0")
	if failures == before {
		t.Fatal("network errors must not be cached")
	}
}

// TestCompatibleToolVersionRealProxy usa il proxy reale; viene saltato in -short o senza rete.
func TestCompatibleToolVersionRealProxy(t *testing.T) {
	if testing.Short() {
		t.Skip("network test")
	}
	goBinary, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go not on PATH")
	}
	installFakeProxy(t, &fakeModuleProxy{})
	goCommandRunner = installFakeProxyOriginal
	resolved, note, err := resolveCompatibleToolModule(context.Background(), goBinary, t.TempDir(), os.Environ(), lintModule, "go1.23.0")
	if err != nil {
		t.Skipf("module proxy not reachable: %v", err)
	}
	if !strings.HasPrefix(resolved, "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.") || note == "" {
		t.Fatalf("resolved=%q note=%q", resolved, note)
	}
	t.Logf("resolved=%s note=%s", resolved, note)
}

var installFakeProxyOriginal = goCommandRunner
