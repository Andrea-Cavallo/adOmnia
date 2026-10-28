package langserver

import (
	"context"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
)

func configurationReply(t *testing.T, settings any, sections ...string) []any {
	t.Helper()
	items := make([]map[string]string, 0, len(sections))
	for _, section := range sections {
		items = append(items, map[string]string{"section": section})
	}
	raw, err := jsonutil.Marshal(map[string]any{"items": items})
	if err != nil {
		t.Fatal(err)
	}
	handler := &lspHandler{session: &lspSession{options: LanguageServerOptions{Configuration: func() any { return settings }}}}
	reply, err := handler.HandleRequest(context.Background(), "workspace/configuration", raw)
	if err != nil {
		t.Fatal(err)
	}
	entries, ok := reply.([]any)
	if !ok {
		t.Fatalf("reply: %#v", reply)
	}
	return entries
}

// TestWorkspaceConfigurationResolvesTheRequestedSection è la prova di ciò che lasciava JDT LS senza
// i JDK della macchina: LSP chiede il **sottoalbero** della sezione (`java` → il contenuto di `java`),
// non l'intero albero delle impostazioni. Con l'albero intero JDT non trovava `runtimes`, ricadeva
// sul rilevamento proprio (JAVA_HOME + Program Files) e i progetti Java 25 dicevano
// "release 25 is not found in the system".
func TestWorkspaceConfigurationResolvesTheRequestedSection(t *testing.T) {
	settings := map[string]any{
		"java": map[string]any{
			"configuration": map[string]any{
				"runtimes": []any{map[string]any{"name": "JavaSE-25", "path": "C:/jdks/25"}},
			},
		},
	}
	entries := configurationReply(t, settings, "java")
	if len(entries) != 1 {
		t.Fatalf("entries: %#v", entries)
	}
	section, ok := entries[0].(map[string]any)
	if !ok {
		t.Fatalf("entry: %#v", entries[0])
	}
	configuration, ok := section["configuration"].(map[string]any)
	if !ok {
		t.Fatalf("la sezione 'java' deve risolvere sul contenuto di java: %#v", section)
	}
	if _, present := configuration["runtimes"]; !present {
		t.Fatalf("runtimes non raggiungibili dalla sezione richiesta: %#v", section)
	}

	// Un cammino più lungo risolve fino alla foglia.
	entries = configurationReply(t, settings, "java.configuration")
	if _, ok := entries[0].(map[string]any)["runtimes"]; !ok {
		t.Fatalf("sezione 'java.configuration': %#v", entries[0])
	}

	// Un server che chiede una sezione fuori dalle proprie impostazioni (gopls, i server web)
	// riceve l'intero oggetto, come prima: loro già si aspettano il contenuto della sezione.
	entries = configurationReply(t, map[string]any{"gofumpt": true}, "gopls")
	if entry, ok := entries[0].(map[string]any); !ok || entry["gofumpt"] != true {
		t.Fatalf("fallback per sezione sconosciuta: %#v", entries[0])
	}
}
