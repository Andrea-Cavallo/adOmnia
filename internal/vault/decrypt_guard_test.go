package vault

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecryptRefusesDatabaseCredentialRefs(t *testing.T) {
	SetCredentialRefGuard(func(ref string) bool { return strings.Contains(ref, "db-cred") })
	defer SetCredentialRefGuard(nil)

	body := strings.NewReader(`{"ciphertext":"vault:age:db-cred","passphrase":"p"}`)
	request := httptest.NewRequest(http.MethodPost, "/vault/decrypt", body)
	recorder := httptest.NewRecorder()
	vaultDecryptHandler(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("database credential ref = %d, want %d (body: %s)", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "stay in Go") {
		t.Fatalf("the refusal must say why: %s", recorder.Body.String())
	}

	// Un riferimento delle env-var non è toccato dal controllo: il flusso resta quello
	// del vault (qui si ferma solo perché il vault è chiuso, non perché è vietato).
	body = strings.NewReader(`{"ciphertext":"vault:age:env-ref","passphrase":""}`)
	request = httptest.NewRequest(http.MethodPost, "/vault/decrypt", body)
	recorder = httptest.NewRecorder()
	vaultDecryptHandler(recorder, request)
	if recorder.Code == http.StatusForbidden {
		t.Fatalf("environment refs must not be refused by the database guard: %d", recorder.Code)
	}
}

func TestDecryptWithoutGuardKeepsWorking(t *testing.T) {
	SetCredentialRefGuard(nil)
	body := strings.NewReader(`{"ciphertext":"vault:age:env-ref","passphrase":""}`)
	request := httptest.NewRequest(http.MethodPost, "/vault/decrypt", body)
	recorder := httptest.NewRecorder()
	vaultDecryptHandler(recorder, request)
	if recorder.Code == http.StatusForbidden {
		t.Fatalf("without a guard nothing is refused: %d", recorder.Code)
	}
}
