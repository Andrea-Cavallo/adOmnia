package security

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, root, relative, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSecretsAnalyzerFindsRealCredentialsAndMasksThem(t *testing.T) {
	source := strings.Join([]string{
		`package config`,
		`const awsKey = "AKIAIOSFODNN7EXAMPLE"`,
		`var dsn = "postgres://app:S3cr3tPass!@db.internal:5432/shop"`,
		`var apiToken = "9f8e7d6c5b4a39281706f5e4"`,
		`var password = "changeme"`,
		`var token = os.Getenv("TOKEN")`,
		`var gh = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB"`,
	}, "\n")
	findings := SecretsAnalyzer{}.Analyze("config/config.go", []byte(source))
	lines := []int{}
	for _, finding := range findings {
		lines = append(lines, finding.Line)
		if strings.Contains(finding.Snippet, "IOSFODNN7EXAMPLE") || strings.Contains(finding.Snippet, "S3cr3tPass") || strings.Contains(finding.Snippet, "abcdefghijklmnop") {
			t.Fatalf("snippet must mask the secret: %q", finding.Snippet)
		}
	}
	if len(lines) != 4 || lines[0] != 2 || lines[1] != 3 || lines[2] != 4 || lines[3] != 7 {
		t.Fatalf("want findings on lines 2,3,4,7, got %v: %+v", lines, findings)
	}
	if !strings.Contains(findings[0].Snippet, "AKIA••••••••") {
		t.Fatalf("masked snippet keeps the first 4 characters: %q", findings[0].Snippet)
	}
	private := SecretsAnalyzer{}.Analyze("deploy/server.key", []byte("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun\n"))
	if len(private) != 1 || private[0].Rule != RulePrivateKey {
		t.Fatalf("private key: %+v", private)
	}
}

// Falsi positivi trovati scansionando il repository di adOmnia: nomi-etichetta, default di sviluppo, intestazioni PEM citate.
func TestSecretsAnalyzerIgnoresLabelsDevDefaultsAndPEMMentions(t *testing.T) {
	source := strings.Join([]string{
		`const aiGatewayTokenKey = "ai-gateway-token"`,
		`"tokenUrl": "/oauth/token-endpoint-v2"`,
		`const passwordField = "password_input_2"`,
		`cfg := Conn{user: 'postgres', password: 'postgres'}`,
		`url := "amqp://guest:guest@localhost:5672/"`,
		`placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"`,
		`msg := "use PKCS#8 PEM (-----BEGIN PRIVATE KEY-----)"`,
	}, "\n")
	if findings := (SecretsAnalyzer{}).Analyze("app.ts", []byte(source)); len(findings) != 0 {
		t.Fatalf("expected no findings, got %+v", findings)
	}
}

func TestSecretsAnalyzerSkipsExamplesAndLockFiles(t *testing.T) {
	analyzer := SecretsAnalyzer{}
	for _, skipped := range []string{"config_test.go", "src/lib/aiRedaction.test.ts", "web/__tests__/a.js", "tests/fixtures/creds.json", ".env.example", "go.sum", "package-lock.json", "logo.png"} {
		if analyzer.Accepts(skipped) {
			t.Errorf("%s must be skipped", skipped)
		}
	}
	for _, accepted := range []string{".env", "config/app.yaml", "main.go", "deploy/server.key"} {
		if !analyzer.Accepts(accepted) {
			t.Errorf("%s must be scanned", accepted)
		}
	}
}

type fakeAnalyzer struct{}

func (fakeAnalyzer) Rules() []Rule {
	return []Rule{{ID: "fake/rule", Category: "Test", Severity: SeverityMedium, Title: "Fake", Description: "d", Remediation: "r"}}
}
func (fakeAnalyzer) Accepts(path string) bool { return strings.HasSuffix(path, ".txt") }
func (fakeAnalyzer) Analyze(_ string, content []byte) []Finding {
	var findings []Finding
	for index, line := range strings.Split(string(content), "\n") {
		if strings.Contains(line, "BAD") {
			findings = append(findings, Finding{Rule: "fake/rule", Category: "Test", Severity: SeverityMedium, Title: "Fake", Message: "bad", Line: index + 1})
		}
	}
	return findings
}

func TestScanAppliesInlineSuppressionsAndSkipsVendor(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a.txt", strings.Join([]string{
		"BAD one",
		"// adomnia:security-ignore fake/rule: reviewed, only used in a local tool",
		"BAD two",
		"BAD three // adomnia:security-ignore fake/rule",
		"BAD four // adomnia:security-ignore other/rule: not this rule",
	}, "\n"))
	write(t, root, "vendor/dep/b.txt", "BAD vendored")
	write(t, root, "node_modules/x/c.txt", "BAD dependency")
	report, err := Scan(root, fakeAnalyzer{})
	if err != nil {
		t.Fatal(err)
	}
	if report.FilesScanned != 1 || len(report.Findings) != 4 || len(report.Rules) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	suppressed := map[int]string{}
	for _, finding := range report.Findings {
		if finding.Suppressed {
			suppressed[finding.Line] = finding.SuppressionReason
		}
	}
	if len(suppressed) != 1 || suppressed[3] != "reviewed, only used in a local tool" {
		t.Fatalf("only the motivated inline suppression applies, got %v", suppressed)
	}
}

func TestSuppressionsAndBaselineSurviveMovedCode(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a.txt", "BAD one\nBAD two\n")
	report, err := Scan(root, fakeAnalyzer{})
	if err != nil || len(report.Findings) != 2 {
		t.Fatalf("scan: %v %+v", err, report)
	}
	if err := Suppress(root, report.Findings[0], "  "); err == nil {
		t.Fatal("a suppression without a reason must be refused")
	}
	if err := Suppress(root, report.Findings[0], "False positive: test fixture"); err != nil {
		t.Fatal(err)
	}
	count, err := SaveBaseline(root, mustScan(t, root).Findings)
	if err != nil || count != 1 {
		t.Fatalf("baseline keeps the unsuppressed finding only: %d %v", count, err)
	}

	write(t, root, "a.txt", "// new header\n\nBAD one\nBAD two\nBAD three\n")
	moved := mustScan(t, root)
	state := map[string]string{}
	for _, finding := range moved.Findings {
		switch {
		case finding.Suppressed:
			state[finding.Snippet] = "suppressed:" + finding.SuppressionReason
		case finding.Baselined:
			state[finding.Snippet] = "baselined"
		default:
			state[finding.Snippet] = "new"
		}
	}
	want := map[string]string{"BAD one": "suppressed:False positive: test fixture", "BAD two": "baselined", "BAD three": "new"}
	for snippet, expected := range want {
		if state[snippet] != expected {
			t.Fatalf("%s: want %s, got %s (all: %v)", snippet, expected, state[snippet], state)
		}
	}

	settings, err := LoadSettings(root)
	if err != nil || settings.Format != "adomnia-security" || len(settings.Suppressions) != 1 || len(settings.Baseline) != 1 {
		t.Fatalf("settings file: %+v %v", settings, err)
	}
	if err := Unsuppress(root, settings.Suppressions[0].Fingerprint); err != nil {
		t.Fatal(err)
	}
	if err := ClearBaseline(root); err != nil {
		t.Fatal(err)
	}
	for _, finding := range mustScan(t, root).Findings {
		if finding.Suppressed || finding.Baselined {
			t.Fatalf("cleared settings must show everything: %+v", finding)
		}
	}
}

func mustScan(t *testing.T, root string) Report {
	t.Helper()
	report, err := Scan(root, fakeAnalyzer{})
	if err != nil {
		t.Fatal(err)
	}
	return report
}
