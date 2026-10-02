package copilot

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAIPolicyGatesCloudAndLocalProviders(t *testing.T) {
	root := t.TempDir()
	if LoadAIPolicy(root) != AIPolicyAllowed || LoadContextFilter(root).Excluded("main.go") {
		t.Fatal("senza politica il codice è consentito")
	}
	if err := SaveAIPolicy(root, AIPolicyLocalOnly); err != nil {
		t.Fatal(err)
	}
	if !LoadContextFilter(root).Excluded("main.go") || LoadContextFilterFor(root, true).Excluded("main.go") {
		t.Fatal("local-only: cloud escluso, locale consentito")
	}
	if !LoadContextFilterFor(root, true).Excluded(".env") {
		t.Fatal("i segreti restano esclusi anche in locale")
	}
	if err := SaveAIPolicy(root, AIPolicyOff); err != nil {
		t.Fatal(err)
	}
	if !LoadContextFilterFor(root, true).Excluded("main.go") {
		t.Fatal("off esclude anche i modelli locali")
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(AIPolicyFile)), []byte(`{"ai":"maybe"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if LoadAIPolicy(root) != AIPolicyOff {
		t.Fatal("un valore sconosciuto deve valere off")
	}
	if err := SaveAIPolicy(root, AIPolicyAllowed); err != nil || LoadAIPolicy(root) != AIPolicyAllowed {
		t.Fatalf("allowed rimuove il file: %v", err)
	}
	if SaveAIPolicy(root, "everything") == nil {
		t.Fatal("politica non valida accettata")
	}
}
