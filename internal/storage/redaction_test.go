package storage

import (
	"encoding/json"
	"strings"
	"testing"
)

func exportedValue(t *testing.T, input string) string {
	t.Helper()
	output := RedactValueForExport([]byte(input))
	if !json.Valid([]byte(output)) {
		t.Fatalf("redacted output is not JSON: %s", output)
	}
	return output
}

func TestRedactValueForExportRemovesDatabaseAndBrokerPlaintext(t *testing.T) {
	input := `{"connections":[{"dsn":"postgres://user:db-secret@localhost/app","password":"db-secret"}],"broker":{"password":"broker-secret","token":"nats-secret"}}`
	output := exportedValue(t, input)
	for _, secret := range []string{"db-secret", "broker-secret", "nats-secret"} {
		if strings.Contains(output, secret) {
			t.Fatalf("export contains plaintext %q: %s", secret, output)
		}
	}
}

func TestRedactValueForExportPreservesVaultReferences(t *testing.T) {
	input := `{"password":"vault:encrypted-password","token":"vault:encrypted-token"}`
	output := exportedValue(t, input)
	if !strings.Contains(output, "vault:encrypted-password") || !strings.Contains(output, "vault:encrypted-token") {
		t.Fatalf("encrypted references should survive export: %s", output)
	}
}

func TestRedactValueForExportHandlesKeyValueAndSecretVariables(t *testing.T) {
	input := `{"headers":[{"key":"Authorization","value":"Bearer abc123"}],"variables":[{"key":"custom","type":"secret","value":"hidden-value"}]}`
	output := exportedValue(t, input)
	if strings.Contains(output, "abc123") || strings.Contains(output, "hidden-value") {
		t.Fatalf("key/value secrets survived export: %s", output)
	}
}
