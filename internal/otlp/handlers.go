package otlp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// receiver is the process-wide trace receiver behind the sidecar endpoints.
var receiver = NewReceiver()

// Shutdown stops the receiver with the sidecar.
func Shutdown() { receiver.Stop() }

// Limits of a saved trace loaded back (one request's trace is far smaller).
const (
	maxImportBytes = 32 << 20
	maxImportSpans = 20000
)

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

// RegisterHandlers exposes the receiver to the UI: status, start/stop (explicit user action),
// trace list, one trace, clear.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/otlp/status", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, receiver.Status()) })
	mux.HandleFunc("/otlp/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		ports := struct {
			HTTPPort int `json:"httpPort"`
			GRPCPort int `json:"grpcPort"`
		}{DefaultHTTPPort, DefaultGRPCPort}
		_ = json.NewDecoder(r.Body).Decode(&ports)
		if err := receiver.Start(ports.HTTPPort, ports.GRPCPort); err != nil {
			w.WriteHeader(http.StatusConflict)
		}
		writeJSON(w, receiver.Status())
	})
	mux.HandleFunc("/otlp/stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		receiver.Stop()
		writeJSON(w, receiver.Status())
	})
	mux.HandleFunc("/otlp/clear", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		receiver.Store().Clear()
		writeJSON(w, receiver.Status())
	})
	mux.HandleFunc("/otlp/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var saved struct {
			Spans []Span `json:"spans"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxImportBytes)).Decode(&saved); err != nil {
			http.Error(w, "not a saved trace: "+err.Error(), http.StatusBadRequest)
			return
		}
		if len(saved.Spans) == 0 || len(saved.Spans) > maxImportSpans {
			http.Error(w, fmt.Sprintf("a saved trace has 1 to %d spans", maxImportSpans), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]int{"added": receiver.Store().Import(saved.Spans)})
	})
	mux.HandleFunc("/otlp/traces", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 || limit > 1000 {
			limit = 200
		}
		writeJSON(w, receiver.Store().Summaries(limit))
	})
	mux.HandleFunc("/otlp/map", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, receiver.Store().ServiceMap()) })
	mux.HandleFunc("/otlp/lens", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, receiver.Store().Lens()) })
	mux.HandleFunc("/otlp/trace", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, receiver.Store().Trace(r.URL.Query().Get("id")))
	})
}
