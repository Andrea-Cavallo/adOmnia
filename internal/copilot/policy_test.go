package copilot

import (
	"adomnia/internal/aipolicy"

	"os"
	"path/filepath"
	"testing"
)

func TestAIPolicyGatesCloudAndLocalProviders(t *testing.T) {
	root := t.TempDir()
	if aipolicy.Load(root) != aipolicy.Allowed || LoadContextFilter(root).Excluded("main.go") {
		t.Fatal("senza politica il codice è consentito")
	}
	if err := aipolicy.Save(root, aipolicy.LocalOnly); err != nil {
		t.Fatal(err)
	}
	if !LoadContextFilter(root).Excluded("main.go") || LoadContextFilterFor(root, true).Excluded("main.go") {
		t.Fatal("local-only: cloud escluso, locale consentito")
	}
	if !LoadContextFilterFor(root, true).Excluded(".env") {
		t.Fatal("i segreti restano esclusi anche in locale")
	}
	if err := aipolicy.Save(root, aipolicy.Off); err != nil {
		t.Fatal(err)
	}
	if !LoadContextFilterFor(root, true).Excluded("main.go") {
		t.Fatal("off esclude anche i modelli locali")
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(aipolicy.File)), []byte(`{"ai":"maybe"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if aipolicy.Load(root) != aipolicy.Off {
		t.Fatal("un valore sconosciuto deve valere off")
	}
	if err := aipolicy.Save(root, aipolicy.Allowed); err != nil || aipolicy.Load(root) != aipolicy.Allowed {
		t.Fatalf("allowed rimuove il file: %v", err)
	}
	if aipolicy.Save(root, "everything") == nil {
		t.Fatal("politica non valida accettata")
	}
}
