package database

import (
	"testing"

	"adomnia/internal/jsonutil"
	"adomnia/internal/storage"
)

func TestIsCredentialRefOnlyMatchesSavedSecrets(t *testing.T) {
	if err := storage.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	list := []dbConnectionRequest{
		{ID: "a", Password: "vault:age:password-ref", DSN: "vault:age:dsn-ref"},
		{ID: "b", Password: "", User: "reader"},
	}
	raw, _ := jsonutil.Marshal(list)
	if err := storage.Put("database", "connections", raw); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{"vault:age:password-ref", "vault:age:dsn-ref", "  vault:age:password-ref  "} {
		if !IsCredentialRef(ref) {
			t.Fatalf("%q must be refused: it is a saved database credential", ref)
		}
	}
	for _, ref := range []string{"", "   ", "vault:age:env-ref", "vault:local:v1:other"} {
		if IsCredentialRef(ref) {
			t.Fatalf("%q must not match: it is not a database credential", ref)
		}
	}
}
