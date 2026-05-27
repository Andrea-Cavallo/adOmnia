package main

import (
	"adomnia/internal/oauth"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func resetOAuthSessionsForTest() {
	oauth.ResetSessions()
}

func TestOAuthAuthorizationCallbackReturnsCodeOnce(t *testing.T) {
	resetOAuthSessionsForTest()
	oauth.SetServerPort(45123)
	t.Cleanup(func() {
		oauth.SetServerPort(0)
		resetOAuthSessionsForTest()
	})

	startRecorder := httptest.NewRecorder()
	oauth.StartHandler(startRecorder, httptest.NewRequest(http.MethodPost, "/oauth/start", nil))
	if startRecorder.Code != http.StatusOK {
		t.Fatalf("start status = %d, body = %s", startRecorder.Code, startRecorder.Body.String())
	}
	var started map[string]string
	if err := json.Unmarshal(startRecorder.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if started["state"] == "" {
		t.Fatal("OAuth state was empty")
	}
	if started["redirectUri"] != "http://127.0.0.1:45123/oauth/callback" {
		t.Fatalf("redirect URI = %q", started["redirectUri"])
	}

	callbackURL := "/oauth/callback?state=" + url.QueryEscape(started["state"]) + "&code=returned-code"
	callbackRecorder := httptest.NewRecorder()
	oauth.CallbackHandler(callbackRecorder, httptest.NewRequest(http.MethodGet, callbackURL, nil))
	if callbackRecorder.Code != http.StatusOK {
		t.Fatalf("callback status = %d, body = %s", callbackRecorder.Code, callbackRecorder.Body.String())
	}

	statusURL := "/oauth/status?state=" + url.QueryEscape(started["state"])
	statusRecorder := httptest.NewRecorder()
	oauth.StatusHandler(statusRecorder, httptest.NewRequest(http.MethodGet, statusURL, nil))
	var completed map[string]string
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &completed); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if completed["status"] != "complete" || completed["code"] != "returned-code" {
		t.Fatalf("OAuth completion = %#v", completed)
	}

	consumedRecorder := httptest.NewRecorder()
	oauth.StatusHandler(consumedRecorder, httptest.NewRequest(http.MethodGet, statusURL, nil))
	if consumedRecorder.Code != http.StatusNotFound {
		t.Fatalf("consumed status = %d, want %d", consumedRecorder.Code, http.StatusNotFound)
	}
}

func TestSecurityAllowsOnlyValidOAuthCallbackWithoutSidecarToken(t *testing.T) {
	resetOAuthSessionsForTest()
	initSidecarToken()

	startRecorder := httptest.NewRecorder()
	oauth.StartHandler(startRecorder, httptest.NewRequest(http.MethodPost, "/oauth/start", nil))
	var started map[string]string
	if err := json.Unmarshal(startRecorder.Body.Bytes(), &started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	handler := withSecurity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		oauth.CallbackHandler(w, r)
	}))
	valid := httptest.NewRecorder()
	handler.ServeHTTP(valid, httptest.NewRequest(http.MethodGet, "/oauth/callback?state="+url.QueryEscape(started["state"])+"&code=ok", nil))
	if valid.Code != http.StatusOK {
		t.Fatalf("public callback status = %d, body = %s", valid.Code, valid.Body.String())
	}

	protected := httptest.NewRecorder()
	withSecurity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(protected, httptest.NewRequest(http.MethodGet, "/oauth/status?state="+url.QueryEscape(started["state"]), nil))
	if protected.Code != http.StatusUnauthorized {
		t.Fatalf("protected OAuth status = %d, want %d", protected.Code, http.StatusUnauthorized)
	}
}
