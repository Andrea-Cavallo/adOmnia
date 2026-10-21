package codestudio

import (
	"testing"

	"adomnia/internal/ide/language"
	"adomnia/internal/languages/java"
	"adomnia/internal/languages/python"
)

// Il servizio passa la factory delle spec per unità solo ai linguaggi che la dichiarano: Python ha un
// server per unità (un venv per servizio), Java e web uno solo per progetto. La decisione arriva
// dall'adapter, quindi aggiungere un linguaggio non tocca questo codice.
func TestOnlyPerUnitLanguagesGetASpecFactory(t *testing.T) {
	service := NewService(&memoryStore{}, nil)
	t.Cleanup(func() { service.lsp.Shutdown() })

	if service.perUnitSpec(python.ID, t.TempDir()) == nil {
		t.Fatal("python must start one language server per unit")
	}
	if service.perUnitSpec(java.ID, t.TempDir()) != nil {
		t.Fatal("java keeps one language server per project")
	}
	if _, ok := interface{}(java.New()).(language.UnitServers); ok {
		t.Fatal("java must not declare per-unit servers without a consumer")
	}
	// L'adapter Python è quello che sa costruire la spec di una unità a partire dalla radice del
	// progetto: la factory dell'host non fa altro che inoltrarla.
	servers, ok := interface{}(python.New()).(language.UnitServers)
	if !ok || !servers.ServersPerUnit() {
		t.Fatal("python must implement language.UnitServers")
	}
}
