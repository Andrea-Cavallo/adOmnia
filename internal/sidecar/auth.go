package sidecar

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// isAllowedOrigin reports whether a browser Origin may call the local sidecar.
// The sidecar is loopback-only, so we accept any localhost-family origin
// regardless of port or scheme. This must include the Wails webview origins,
// which differ by platform/runtime version: "wails://wails" (older) and
// "http://wails.localhost" / "https://wails.localhost" (WebView2 / newer).
func isAllowedOrigin(origin string) bool {
	if origin == "" || origin == "wails://wails" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" ||
		host == "127.0.0.1" ||
		host == "::1" ||
		strings.HasSuffix(host, ".localhost")
}

var (
	sidecarToken     string
	sidecarTokenOnce sync.Once
)

func InitToken() {
	sidecarTokenOnce.Do(func() {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			panic("cannot generate sidecar token: " + err.Error())
		}
		sidecarToken = hex.EncodeToString(b)
	})
}

// withSecurity replaces the old open CORS wildcard with origin allowlist +
// per-request token validation + body size cap on POST/PUT.
func WithSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !isAllowedOrigin(origin) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Sidecar-Token")

		// Respond to CORS preflight without token check
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		// The OAuth redirect is opened by an external identity provider and
		// authenticates itself with the one-time state stored by /oauth/start.
		publicOAuthCallback := r.Method == http.MethodGet && r.URL.Path == "/oauth/callback"

		// Require valid session token on all non-OPTIONS requests except the
		// provider redirect callback.
		// EventSource cannot set custom headers, so stream endpoints may pass it
		// as a query parameter on the localhost-only sidecar URL.
		if !publicOAuthCallback {
			token := r.Header.Get("X-Sidecar-Token")
			if token == "" {
				token = r.URL.Query().Get("token")
			}
			if token != sidecarToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}

		// Limit request bodies to 10 MB to prevent memory pressure
		if (r.Method == http.MethodPost || r.Method == http.MethodPut) && r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		}

		next.ServeHTTP(w, r)
	})
}

// Token returns the local authentication token required by sidecar callers.
func Token() string {
	return sidecarToken
}
