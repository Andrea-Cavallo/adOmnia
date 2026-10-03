package goide

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Stream reale di govulncheck -json (protocollo v1): un oggetto per messaggio, separati da a capo.
// I finding arrivano dal livello più basso (module) al più alto (function), come fa govulncheck.
func govulnStreamFixture() string {
	return `{"config":{"protocol_version":"v1.0.0","scanner_name":"govulncheck","scanner_version":"v1.1.4","db":"https://vuln.go.dev","db_last_modified":"2026-09-30T18:00:00Z","go_version":"go1.26.5","scan_level":"symbol","scan_mode":"source"}}
{"progress":{"message":"Scanning your code and 312 packages across 41 dependent modules for known vulnerabilities..."}}
{"osv":{"schema_version":"1.3.1","id":"GO-2026-0001","modified":"2026-09-01T00:00:00Z","published":"2026-08-20T00:00:00Z","aliases":["CVE-2026-1111","GHSA-aaaa-bbbb-cccc"],"summary":"Denial of service in HTTP/2 frame parsing","details":"A crafted frame | can exhaust memory.","severity":[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"}],"references":[{"type":"FIX","url":"https://go.dev/cl/1"},{"type":"WEB","url":"https://go.dev/issue/2"}],"database_specific":{"url":"https://pkg.go.dev/vuln/GO-2026-0001"}}}
{"osv":{"schema_version":"1.3.1","id":"GO-2026-0002","modified":"2026-09-02T00:00:00Z","published":"2026-08-21T00:00:00Z","summary":"Path traversal in archive extraction","details":"..."}}
{"osv":{"schema_version":"1.3.1","id":"GO-2026-0003","modified":"2026-09-03T00:00:00Z","published":"2026-08-22T00:00:00Z","summary":"Weak default in token parser","details":"..."}}
{"finding":{"osv":"GO-2026-0001","fixed_version":"v0.30.0","trace":[{"module":"golang.org/x/net","version":"v0.25.0"}]}}
{"finding":{"osv":"GO-2026-0001","fixed_version":"v0.30.0","trace":[{"module":"golang.org/x/net","version":"v0.25.0","package":"golang.org/x/net/http2"}]}}
{"finding":{"osv":"GO-2026-0001","fixed_version":"v0.30.0","trace":[{"module":"golang.org/x/net","version":"v0.25.0","package":"golang.org/x/net/http2","function":"ReadFrame","receiver":"*Framer","position":{"filename":"http2/frame.go","line":502,"column":18}},{"module":"example.com/shop","package":"example.com/shop/api","function":"Serve","position":{"filename":"api/handler.go","line":41,"column":9}}]}}
{"finding":{"osv":"GO-2026-0002","fixed_version":"v1.4.2","trace":[{"module":"github.com/acme/archive","version":"v1.4.0","package":"github.com/acme/archive/zip"}]}}
{"finding":{"osv":"GO-2026-0003","trace":[{"module":"github.com/acme/token","version":"v0.9.0"}]}}
`
}

func TestParseGovulncheckStreamAggregatesByAdvisory(t *testing.T) {
	root := t.TempDir()
	report, err := parseGovulncheckStream([]byte(govulnStreamFixture()))
	if err != nil {
		t.Fatal(err)
	}
	if report.ScannerVersion != "v1.1.4" || report.DatabaseUpdated != "2026-09-30T18:00:00Z" || report.GoVersion != "go1.26.5" {
		t.Fatalf("config not read: %+v", report)
	}
	if len(report.Findings) != 3 {
		t.Fatalf("want 3 advisories, got %d", len(report.Findings))
	}
	levels := []string{report.Findings[0].Level, report.Findings[1].Level, report.Findings[2].Level}
	if !reflect.DeepEqual(levels, []string{VulnLevelCalled, VulnLevelImported, VulnLevelRequired}) {
		t.Fatalf("findings not ranked by reachability: %v", levels)
	}

	called := report.Findings[0]
	if called.ID != "GO-2026-0001" || called.Module != "golang.org/x/net" || called.FoundVersion != "v0.25.0" || called.FixedVersion != "v0.30.0" {
		t.Fatalf("unexpected called finding: %+v", called)
	}
	if !reflect.DeepEqual(called.Aliases, []string{"CVE-2026-1111", "GHSA-aaaa-bbbb-cccc"}) || called.URL != "https://pkg.go.dev/vuln/GO-2026-0001" {
		t.Fatalf("advisory not applied: %+v", called)
	}
	if len(called.CVSS) != 1 || !strings.HasPrefix(called.CVSS[0], "CVSS:3.1/") || len(called.References) != 2 {
		t.Fatalf("severity/references missing: %+v", called)
	}
	if !reflect.DeepEqual(called.Symbols, []string{"Framer.ReadFrame"}) || !reflect.DeepEqual(called.Packages, []string{"golang.org/x/net/http2"}) {
		t.Fatalf("symbols/packages: %+v / %+v", called.Symbols, called.Packages)
	}
	if len(called.CallPaths) != 1 || len(called.CallPaths[0]) != 2 {
		t.Fatalf("want one call path of two frames, got %+v", called.CallPaths)
	}
	modCache := filepath.Join(root, "modcache")
	resolveVulnFrames(report.Findings, vulnSourceRoots{ProjectRoot: root, ModulePath: "example.com/shop", ModuleDirectory: root, GoRoot: filepath.Join(root, "goroot"), ModCache: modCache})
	entry, vulnerable := called.CallPaths[0][0], called.CallPaths[0][1]
	if entry.Function != "Serve" || !entry.InProject || entry.Relative != "api/handler.go" || entry.Line != 41 {
		t.Fatalf("call path must start in project code: %+v", entry)
	}
	if vulnerable.Function != "ReadFrame" || vulnerable.InProject || vulnerable.Relative != "" || vulnerable.Line != 502 {
		t.Fatalf("call path must end at the vulnerable symbol: %+v", vulnerable)
	}
	if want := filepath.Join(modCache, "golang.org", "x", "net@v0.25.0", "http2", "frame.go"); vulnerable.File != want {
		t.Fatalf("dependency frame must resolve into the module cache: got %s want %s", vulnerable.File, want)
	}
	if entry.File != filepath.Join(root, "api", "handler.go") {
		t.Fatalf("project frame must resolve into the module directory: %s", entry.File)
	}

	if report.Findings[1].FixedVersion != "v1.4.2" || len(report.Findings[1].CallPaths) != 0 {
		t.Fatalf("imported finding: %+v", report.Findings[1])
	}
	if report.Findings[2].FixedVersion != "" || report.Findings[2].URL != "https://pkg.go.dev/vuln/GO-2026-0003" {
		t.Fatalf("required finding without fix: %+v", report.Findings[2])
	}
}

func TestParseGovulncheckStreamHandlesEmptyAndTruncatedOutput(t *testing.T) {
	report, err := parseGovulncheckStream([]byte(`{"config":{"scanner_version":"v1.1.4"}}` + "\n"))
	if err != nil || len(report.Findings) != 0 {
		t.Fatalf("clean scan must yield no findings: %v %+v", err, report)
	}
	full := govulnStreamFixture()
	truncated := full[:strings.Index(full, `{"finding":{"osv":"GO-2026-0002"`)+20]
	report, err = parseGovulncheckStream([]byte(truncated))
	if err != nil || len(report.Findings) != 1 || report.Findings[0].ID != "GO-2026-0001" {
		t.Fatalf("truncated output must keep what was read: %v %+v", err, report.Findings)
	}
	if _, err := parseGovulncheckStream([]byte("govulncheck: loading packages: no go.mod")); err == nil {
		t.Fatal("plain-text errors must not look like a clean scan")
	}
}

func TestDependencyPathToFindsShortestModuleChain(t *testing.T) {
	graph := strings.Join([]string{
		"example.com/shop github.com/acme/web@v1.2.0",
		"example.com/shop golang.org/x/text@v0.20.0",
		"github.com/acme/web@v1.2.0 github.com/acme/router@v0.3.0",
		"github.com/acme/router@v0.3.0 golang.org/x/net@v0.25.0",
		"github.com/acme/web@v1.2.0 golang.org/x/net@v0.24.0",
	}, "\n")
	got := dependencyPathTo(graph, "example.com/shop", "golang.org/x/net")
	want := []string{"example.com/shop", "github.com/acme/web", "golang.org/x/net"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if dependencyPathTo(graph, "example.com/shop", "stdlib") != nil || dependencyPathTo(graph, "example.com/shop", "example.com/missing") != nil {
		t.Fatal("stdlib and unknown modules have no dependency path")
	}
}

// Output reale di govulncheck v1.8.0 (JSON indentato, file relativi al modulo) su un'app che chiama
// golang.org/x/text/language.Parse alla v0.3.6, con un database locale di prova (-db file://).
func TestParseGovulncheckRealOutput(t *testing.T) {
	output, err := os.ReadFile(filepath.Join("testdata", "govulncheck_x_text.json"))
	if err != nil {
		t.Fatal(err)
	}
	report, err := parseGovulncheckStream(output)
	if err != nil {
		t.Fatal(err)
	}
	if report.ScannerVersion != "v1.8.0" || len(report.Findings) != 2 {
		t.Fatalf("unexpected report: %+v", report)
	}
	called, required := report.Findings[0], report.Findings[1]
	if called.ID != "GO-2099-0001" || called.Level != VulnLevelCalled || called.FixedVersion != "v0.3.7" || called.FoundVersion != "v0.3.6" {
		t.Fatalf("called finding: %+v", called)
	}
	if required.ID != "GO-2099-0002" || required.Level != VulnLevelRequired || len(required.CallPaths) != 0 {
		t.Fatalf("module-only finding: %+v", required)
	}
	root := t.TempDir()
	resolveVulnFrames(report.Findings, vulnSourceRoots{ProjectRoot: root, ModulePath: "example.com/vulnapp", ModuleDirectory: root, ModCache: filepath.Join(root, "mod")})
	path := report.Findings[0].CallPaths[0]
	if len(path) != 2 || path[0].Function != "Locale" || path[0].Relative != "api/lang.go" || path[0].Line != 7 || !path[0].InProject {
		t.Fatalf("project frame: %+v", path)
	}
	if path[1].Function != "Parse" || path[1].File != filepath.Join(root, "mod", "golang.org", "x", "text@v0.3.6", "language", "parse.go") {
		t.Fatalf("vulnerable frame: %+v", path[1])
	}
}
