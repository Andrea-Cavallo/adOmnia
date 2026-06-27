package adomniacli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
)

func TestFetchOAuth2ClientCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("client_id") != "client" || r.Form.Get("client_secret") != "secret" {
			t.Fatalf("form = %#v", r.Form)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "issued-token", "expires_in": 300})
	}))
	defer server.Close()
	token, err := fetchOAuth2Token(requestcontract.Auth{Type: "oauth2", OAuth2GrantType: "client_credentials", OAuth2TokenURL: server.URL, OAuth2ClientID: "client", OAuth2ClientSecret: "secret"}, nil)
	if err != nil || token != "issued-token" {
		t.Fatalf("token = %q, err = %v", token, err)
	}
}

func TestApplyAWS4ProducesSignedHeaders(t *testing.T) {
	payload := httpexec.HTTPExecRequest{Method: "GET", URL: "https://example.amazonaws.com/items?limit=2", Headers: map[string]string{}, FollowRedirects: true}
	err := applyAWS4(&payload, requestcontract.Auth{AWSAccessKeyID: "AKID", AWSSecretKey: "SECRET", AWSRegion: "eu-west-1", AWSService: "execute-api"}, nil, time.Date(2026, 6, 27, 10, 11, 12, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Headers["x-amz-date"] != "20260627T101112Z" || !strings.Contains(payload.Headers["Authorization"], "Credential=AKID/20260627/eu-west-1/execute-api/aws4_request") {
		t.Fatalf("headers = %#v", payload.Headers)
	}
	if _, err := url.Parse(payload.URL); err != nil {
		t.Fatal(err)
	}
}

func TestResolveVaultVarsRequiresExplicitCIValue(t *testing.T) {
	t.Setenv("ADOMNIA_VAULT_TOKEN", "plain-token")
	vars, err := resolveVaultVars(map[string]string{"token": "vault:ciphertext"})
	if err != nil || vars["token"] != "plain-token" {
		t.Fatalf("vars = %#v, err = %v", vars, err)
	}
	if _, err := resolveVaultVars(map[string]string{"missing": "vault:ciphertext"}); err == nil {
		t.Fatal("expected missing Vault override error")
	}
}
