package otlp

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// receiver is the process-wide trace receiver behind the sidecar endpoints.
var receiver = NewReceiver()

// Shutdown stops the receiver with the sidecar.
func Shutdown() { receiver.Stop() }

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
	mux.HandleFunc("/otlp/traces", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 || limit > 1000 {
			limit = 200
		}
		writeJSON(w, receiver.Store().Summaries(limit))
	})
	mux.HandleFunc("/otlp/lens", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, receiver.Store().Lens()) })
	mux.HandleFunc("/otlp/trace", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, receiver.Store().Trace(r.URL.Query().Get("id")))
	})
}
