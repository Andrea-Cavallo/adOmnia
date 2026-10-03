package golang

import (
	"sort"
	"strings"
	"testing"
)

func rulesFound(t *testing.T, source string) []string {
	t.Helper()
	findings := SecurityAnalyzer{}.Analyze("handler.go", []byte(source))
	rules := make([]string, 0, len(findings))
	for _, finding := range findings {
		rules = append(rules, finding.Rule)
		if finding.Line == 0 || finding.Message == "" || finding.Severity == "" {
			t.Errorf("incomplete finding: %+v", finding)
		}
	}
	sort.Strings(rules)
	return rules
}

func TestSecurityAnalyzerFindsEachRule(t *testing.T) {
	cases := []struct {
		name, source, rule string
	}{
		{"insecure skip verify", `package p
import "crypto/tls"
var c = &tls.Config{InsecureSkipVerify: true}`, RuleTLSInsecureSkipVerify},
		{"insecure skip verify assignment", `package p
import "crypto/tls"
func f(c *tls.Config) { c.InsecureSkipVerify = true }`, RuleTLSInsecureSkipVerify},
		{"old TLS", `package p
import "crypto/tls"
var c = tls.Config{MinVersion: tls.VersionTLS10}`, RuleTLSOldVersion},
		{"md5 with alias", `package p
import weak "crypto/md5"
func f(b []byte) [16]byte { return weak.Sum(b) }`, RuleWeakCrypto},
		{"des cipher", `package p
import "crypto/des"
func f(k []byte) { des.NewTripleDESCipher(k) }`, RuleWeakCrypto},
		{"small RSA key", `package p
import ("crypto/rand"; "crypto/rsa")
func f() { rsa.GenerateKey(rand.Reader, 1024) }`, RuleWeakRSAKey},
		{"plain HTTP server", `package p
import "net/http"
func main() { http.ListenAndServe(":8080", nil) }`, RuleInsecureHTTP},
		{"plain HTTP URL", `package p
var api = "http://payments.acme.io/v1/charge"`, RuleInsecureHTTP},
		{"SQL with Sprintf", `package p
import ("database/sql"; "fmt")
func f(db *sql.DB, name string) { db.Query(fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)) }`, RuleSQLInjection},
		{"SQL with concatenation and context", `package p
import ("context"; "database/sql")
func f(ctx context.Context, db *sql.DB, id string) { db.ExecContext(ctx, "DELETE FROM orders WHERE id = " + id) }`, RuleSQLInjection},
		{"shell command", `package p
import "os/exec"
func f(name string) { exec.Command("sh", "-c", "ls " + name).Run() }`, RuleCommandInjection},
		{"path from request", `package p
import ("net/http"; "os")
func h(w http.ResponseWriter, r *http.Request) { os.ReadFile("files/" + r.URL.Query().Get("f")) }`, RulePathTraversal},
		{"zip slip", `package p
import ("archive/zip"; "path/filepath")
func f(z *zip.Reader, dst string) { for _, file := range z.File { _ = filepath.Join(dst, file.Name) } }`, RuleZipSlip},
		{"gob from body", `package p
import ("encoding/gob"; "net/http")
func h(w http.ResponseWriter, r *http.Request) { var v any; gob.NewDecoder(r.Body).Decode(&v) }`, RuleUnsafeDeserialization},
		{"unbounded body", `package p
import ("encoding/json"; "net/http")
func h(w http.ResponseWriter, r *http.Request) { var v any; json.NewDecoder(r.Body).Decode(&v) }`, RuleUnboundedBody},
		{"unbounded gin body", `package p
import ("encoding/json"; "github.com/gin-gonic/gin")
func h(c *gin.Context) { var v any; json.NewDecoder(c.Request.Body).Decode(&v) }`, RuleUnboundedBody},
		{"world-writable file", `package p
import "os"
func f() { os.WriteFile("app.log", nil, 0666) }`, RuleFilePermissions},
		{"ModePerm directory", `package p
import "os"
func f() { os.MkdirAll("data", os.ModePerm) }`, RuleFilePermissions},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			rules := rulesFound(t, testCase.source)
			if len(rules) != 1 || rules[0] != testCase.rule {
				t.Fatalf("want exactly %s, got %v", testCase.rule, rules)
			}
		})
	}
}

func TestSecurityAnalyzerStaysQuietOnSafeCode(t *testing.T) {
	safe := `package p

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

const schema = "http://www.w3.org/2001/XMLSchema"

var cfg = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: false}

func h(w http.ResponseWriter, r *http.Request, db *sql.DB, ctx context.Context) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var v map[string]any
	_ = json.NewDecoder(r.Body).Decode(&v)
	_, _ = db.QueryContext(ctx, "SELECT id FROM users WHERE name = $1", r.FormValue("name"))
	_, _ = db.Exec("UPDATE stats SET hits = hits + 1 " + "WHERE id = 1")
	_ = exec.Command("git", "status", r.FormValue("x")).Run()
	_ = exec.Command("sh", "-c", "echo ready").Run()
	_ = os.WriteFile(filepath.Join("data", "out.json"), nil, 0o644)
	_ = os.MkdirAll("cache", 0o755)
	_ = sha256.Sum256([]byte("x"))
	_ = http.ListenAndServe("127.0.0.1:8080", nil)
	_, _ = http.Get("http://localhost:9090/health")
}

func client(c *http.Client) error {
	resp, err := c.Get("https://api.acme.io/v1/items")
	if err != nil {
		return err
	}
	var out map[string]any
	return json.NewDecoder(resp.Body).Decode(&out)
}
`
	if rules := rulesFound(t, safe); len(rules) != 0 {
		t.Fatalf("safe code must not be flagged, got %v", rules)
	}
}

func TestSecurityAnalyzerSkipsTestsAndGeneratedFiles(t *testing.T) {
	analyzer := SecurityAnalyzer{}
	if analyzer.Accepts("api/handler_test.go") || !analyzer.Accepts("api/handler.go") || analyzer.Accepts("README.md") {
		t.Fatal("only non-test Go files are analyzed")
	}
	generated := "// Code generated by protoc-gen-go. DO NOT EDIT.\n\npackage p\n\nimport \"crypto/md5\"\n\nvar _ = md5.New()\n"
	if findings := analyzer.Analyze("x.pb.go", []byte(generated)); len(findings) != 0 {
		t.Fatalf("generated files are skipped, got %v", findings)
	}
	if findings := analyzer.Analyze("broken.go", []byte("package p\nfunc (")); findings != nil {
		t.Fatal("unparsable files produce no findings")
	}
	for _, rule := range goSecurityRules {
		if rule.Remediation == "" || rule.Description == "" || !strings.HasPrefix(rule.ID, "go/") {
			t.Fatalf("rule %s needs description and remediation", rule.ID)
		}
	}
}
