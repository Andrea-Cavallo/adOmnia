package oauth

import (
	"adomnia/internal/httputil"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"sync"
	"time"
)

const oauthSessionTTL = 5 * time.Minute

type oauthAuthorizationSession struct {
	Code      string
	Error     string
	ExpiresAt time.Time
	Complete  bool
}

var (
	oauthSessionsMu sync.Mutex
	oauthSessions   = make(map[string]oauthAuthorizationSession)
	serverPort      int
)

// SetServerPort configures the sidecar port used in OAuth loopback redirects.
func SetServerPort(port int) {
	serverPort = port
}

// ResetSessions clears pending OAuth sessions. It is useful when resetting local application state.
func ResetSessions() {
	oauthSessionsMu.Lock()
	oauthSessions = make(map[string]oauthAuthorizationSession)
	oauthSessionsMu.Unlock()
}

func oauthState() (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random), nil
}

func removeExpiredOAuthSessions(now time.Time) {
	for state, session := range oauthSessions {
		if now.After(session.ExpiresAt) {
			delete(oauthSessions, state)
		}
	}
}

func StartHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	state, err := oauthState()
	if err != nil {
		httputil.JSONError(w, "failed to create OAuth state", http.StatusInternalServerError)
		return
	}

	oauthSessionsMu.Lock()
	removeExpiredOAuthSessions(time.Now())
	oauthSessions[state] = oauthAuthorizationSession{ExpiresAt: time.Now().Add(oauthSessionTTL)}
	oauthSessionsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"state":       state,
		"redirectUri": fmt.Sprintf("http://127.0.0.1:%d/oauth/callback", serverPort),
	})
}

func CallbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}

	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	providerError := r.URL.Query().Get("error")
	if description := r.URL.Query().Get("error_description"); description != "" {
		providerError = description
	}

	oauthSessionsMu.Lock()
	removeExpiredOAuthSessions(time.Now())
	session, ok := oauthSessions[state]
	if ok {
		if providerError != "" {
			session.Error = providerError
			session.Complete = true
		} else if code == "" {
			session.Error = "Authorization provider returned no code."
			session.Complete = true
		} else {
			session.Code = code
			session.Complete = true
		}
		oauthSessions[state] = session
	}
	oauthSessionsMu.Unlock()

	if !ok {
		http.Error(w, "This OAuth authorization request is invalid or has expired.", http.StatusBadRequest)
		return
	}

	title := "Authorization complete"
	message := "Authentication completed. You can return to adOmnia."
	if session.Error != "" {
		title = "Authorization failed"
		message = session.Error
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><title>%s</title><style>body{background:#10141c;color:#e7ebf2;font:14px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}.card{background:#171d28;border:1px solid #2a3344;border-radius:12px;padding:28px;max-width:420px}h1{font-size:18px;margin:0 0 10px;color:#eef4ff}p{line-height:1.5;color:#aab6ca;margin:0}</style></head><body><div class="card"><h1>%s</h1><p>%s</p></div><script>window.setTimeout(function(){window.close()},1200)</script></body></html>`,
		html.EscapeString(title), html.EscapeString(title), html.EscapeString(message))
}

func StatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}

	state := r.URL.Query().Get("state")
	oauthSessionsMu.Lock()
	removeExpiredOAuthSessions(time.Now())
	session, ok := oauthSessions[state]
	if ok && session.Complete {
		delete(oauthSessions, state)
	}
	oauthSessionsMu.Unlock()

	if !ok {
		httputil.JSONError(w, "OAuth authorization request expired or not found", http.StatusNotFound)
		return
	}

	response := map[string]string{"status": "pending"}
	if session.Complete {
		if session.Error != "" {
			response["status"] = "error"
			response["error"] = session.Error
		} else {
			response["status"] = "complete"
			response["code"] = session.Code
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

// RegisterHandlers registers the OAuth loopback authorization endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/oauth/start", StartHandler)
	mux.HandleFunc("/oauth/callback", CallbackHandler)
	mux.HandleFunc("/oauth/status", StatusHandler)
}
