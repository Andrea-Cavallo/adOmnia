package httputil

import (
	"encoding/json"
	"net/http"
)

// JSONError writes the standard sidecar error payload.
func JSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": msg,
	})
}

// JSONOK writes a successful JSON response with status 200.
func JSONOK(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
