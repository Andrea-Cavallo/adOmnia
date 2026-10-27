package gomod

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel"
)

// TestMain fa da finto govulncheck: rilanciato con FAKE_GOVULNCHECK=1 scrive la sezione "config" su stdout e
// l'errore di caricamento su stderr, ed esce con 1, come fa un govulncheck compilato con un Go più vecchio del progetto.
func TestMain(m *testing.M) {
	if os.Getenv("FAKE_GOVULNCHECK") == "1" {
		println("govulncheck: Loading packages failed, possibly due to a mismatch between the Go version")
		_, _ = os.Stdout.WriteString("{\n  \"config\": {\"protocol_version\": \"v1.0.0\"}\n}\n")
		os.Exit(1)
	}
	os.Exit(m.Run())
}

func TestGovulncheckLoadFailureIsAnErrorNotAnEmptyResult(t *testing.T) {
	self, _ := os.Executable()
	t.Setenv("FAKE_GOVULNCHECK", "1")
	_, err := runGovulncheck(context.Background(), t.TempDir(), self, securityintel.ResolveOptions{})
	if err == nil || !strings.Contains(err.Error(), "mismatch between the Go version") {
		t.Fatalf("a failed load must surface as an error, got %v", err)
	}
}
