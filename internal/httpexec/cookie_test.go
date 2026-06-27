package httpexec

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCookieJarReplaysCookiesWithinRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/set" {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "abc", Path: "/"})
			return
		}
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value != "abc" {
			t.Fatalf("cookie = %#v, err = %v", cookie, err)
		}
	}))
	defer server.Close()
	jarID := "test-cookie-jar"
	defer ClearCookieJar(jarID)
	for _, path := range []string{"/set", "/check"} {
		raw := Execute(marshalRequest(t, HTTPExecRequest{Method: "GET", URL: server.URL + path, Headers: map[string]string{}, TimeoutMs: 1000, FollowRedirects: true, CookieJarID: jarID}))
		var response HTTPExecResponse
		if err := json.Unmarshal([]byte(raw), &response); err != nil || response.Error != nil {
			t.Fatalf("response = %s, err = %v", raw, err)
		}
	}
}

func marshalRequest(t *testing.T, request HTTPExecRequest) string {
	t.Helper()
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
