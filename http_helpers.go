package main

import (
	"adomnia/internal/httputil"
	"net/http"
)

// Transitional shim for handlers that have not moved into internal packages yet.
func jsonError(w http.ResponseWriter, msg string, code int) {
	httputil.JSONError(w, msg, code)
}
