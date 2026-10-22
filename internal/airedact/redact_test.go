package airedact

import (
	"strings"
	"testing"
	"unicode/utf16"
)

// Split so the repository never contains a contiguous credential-shaped string:
// GitHub push protection treats test fixtures as leaked secrets otherwise.
const (
	fakeAWSKey = "AKIA" + "IOSFODNN7EXAMPLE"
)

func TestRedactMasksHighPrecisionSecrets(t *testing.T) {
	cases := map[string]string{
		"aws":        `aws_access_key_id = "` + fakeAWSKey + `"`,
		"jwt":        "Authorization: Bearer ey" + "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		"github":     "token gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789",
		"stripe":     "sk_" + "live_51H8exampleexampleexample",
		"slack":      "xox" + "b-1234567890-abcdefghij",
		"connection": "postgres://app:sup3rSecret@db.internal:5432/app",
		"assignment": `password := "correct horse battery"`,
		"pem":        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
	}
	for name, text := range cases {
		t.Run(name, func(t *testing.T) {
			redacted := Redact(text)
			if redacted == text {
				t.Fatalf("secret was not masked: %q", redacted)
			}
			if len(redacted) != len(text) {
				t.Fatalf("length changed: %d != %d", len(redacted), len(text))
			}
			if strings.Contains(redacted, "sup3rSecret") || strings.Contains(redacted, fakeAWSKey) || strings.Contains(redacted, "correct horse") {
				t.Fatalf("secret leaked: %q", redacted)
			}
		})
	}
}

func TestRedactPreservesLinesAndIsIdempotent(t *testing.T) {
	text := "line one\npassword = \"secret-value\"\nline three\n-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n"
	once := Redact(text)
	if strings.Count(once, "\n") != strings.Count(text, "\n") {
		t.Fatalf("line count changed: %q", once)
	}
	if twice := Redact(once); twice != once {
		t.Fatalf("not idempotent:\n%q\n%q", once, twice)
	}
	if strings.Contains(once, "secret-value") || strings.Contains(once, "MIIE") {
		t.Fatalf("secret leaked: %q", once)
	}
}

func TestRedactLeavesOrdinaryCodeAlone(t *testing.T) {
	text := "func main() {\n\tfmt.Println(\"hello\")\n}\nconst version = \"v1.2.3\"\n"
	if redacted := Redact(text); redacted != text {
		t.Fatalf("ordinary code changed:\n%q", redacted)
	}
}

func TestRedactKeepsUTF16PositionsForNonASCIIValues(t *testing.T) {
	text := "postgres://app:pàsswörd€@db.internal/app\nconst after = 1\n"
	redacted := Redact(text)
	if strings.Contains(redacted, "pàsswörd") {
		t.Fatalf("secret leaked: %q", redacted)
	}
	if len(redacted) != len(text) || len(utf16.Encode([]rune(redacted))) != len(utf16.Encode([]rune(text))) {
		t.Fatalf("positions changed: %q", redacted)
	}
}
