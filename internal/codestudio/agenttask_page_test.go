package codestudio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
)

func TestPageVerificationRecordsScreenshotAndFailsOnJavaScriptErrors(t *testing.T) {
	var broken atomic.Bool
	broken.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html")
		script := ""
		if broken.Load() {
			script = `<script>throw new Error("cart total is NaN")</script>`
		}
		_, _ = writer.Write([]byte(`<!doctype html><title>Cart</title><h1>Cart</h1>` + script))
	}))
	defer server.Close()
	verifier := NewTaskVerifier(nil)
	verifier.evidenceDir = t.TempDir()
	request := agenttask.VerifyRequest{TaskID: "task-page", Workdir: t.TempDir(), Verification: agenttask.Verification{
		Kind: agenttask.VerificationPage, Label: "cart", URL: server.URL, SettleSeconds: 1, TimeoutSeconds: 60,
	}}
	evidence := verifier.Run(context.Background(), request)
	if strings.Contains(evidence.Log, "no supported browser") {
		t.Skip("no Chromium-based browser installed")
	}
	if evidence.Outcome != agenttask.EvidenceFailed || !strings.Contains(evidence.Log, "cart total is NaN") {
		t.Fatalf("a JavaScript error must fail the page: %+v", evidence)
	}
	screenshot := ""
	for _, observation := range evidence.Observations {
		if observation.Name == "screenshot" {
			screenshot = observation.Value
		}
	}
	if info, err := os.Stat(screenshot); err != nil || info.Size() == 0 || !strings.HasPrefix(screenshot, verifier.evidenceDir) {
		t.Fatalf("screenshot not saved in the evidence folder: %q, %v", screenshot, err)
	}

	broken.Store(false)
	if evidence := verifier.Run(context.Background(), request); evidence.Outcome != agenttask.EvidencePassed {
		t.Fatalf("a clean page must pass: %+v", evidence)
	}
}
