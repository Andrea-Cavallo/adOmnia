package httputil

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"net/http"
)

// JSONError writes the standard sidecar error payload.
func JSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = jsonutil.MarshalWrite(w, map[string]any{
		"ok":    false,
		"error": msg,
	})
}
