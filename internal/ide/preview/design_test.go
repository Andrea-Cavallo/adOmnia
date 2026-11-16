package preview

import (
	"strings"
	"testing"
)

// Design Mode: lo script di editing è servito dal bridge, ma non entra mai nelle pagine da solo.
func TestDesignScriptIsServedOnDemandOnly(t *testing.T) {
	server, _ := newSite(t)
	status, script := get(t, server.URL()+"__adomnia/design.js")
	if status != 200 || len(script) == 0 {
		t.Fatalf("design script not served: %d (%d bytes)", status, len(script))
	}
	// Lo script parla solo con l'origine dell'IDE annunciata dal bridge, mai con "*".
	if !strings.Contains(script, "__adomniaHostOrigin") {
		t.Fatal("the design script does not read the host origin")
	}
	if _, page := get(t, server.URL()); strings.Contains(page, "design.js") {
		t.Fatal("the design script is injected into pages: it must be loaded on demand")
	}
	if live := string(liveClientScript); !strings.Contains(live, "__adomniaHostOrigin = parentOrigin") {
		t.Fatal("the live bridge does not announce the host origin to the design script")
	}
}
