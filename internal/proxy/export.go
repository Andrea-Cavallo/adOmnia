package proxy

import (
	"adomnia/internal/httputil"
	"encoding/json"
	"net/http"
	"strings"
)

func proxyExportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Format string   `json:"format"`
		IDs    []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.JSONError(w, "invalid JSON: "+err.Error(), 400)
		return
	}

	if body.Format == "" {
		body.Format = "json"
	}

	trafficMu.RLock()
	var entries []trafficEntry
	if len(body.IDs) == 0 {
		entries = make([]trafficEntry, len(trafficLog))
		copy(entries, trafficLog)
	} else {
		idSet := make(map[string]bool, len(body.IDs))
		for _, id := range body.IDs {
			idSet[id] = true
		}
		for _, e := range trafficLog {
			if idSet[e.ID] {
				entries = append(entries, e)
			}
		}
	}
	trafficMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")

	switch body.Format {
	case "har":
		har := buildHAR(entries)
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "data": har})
	case "curl":
		cmds := buildCurlCommands(entries)
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "data": cmds})
	case "json":
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "data": entries})
	default:
		httputil.JSONError(w, "unsupported format: "+body.Format+". Use har, curl, or json", 400)
	}
}

func buildHAR(entries []trafficEntry) map[string]interface{} {
	harEntries := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		reqHeaders := make([]map[string]string, 0)
		for k, v := range e.ReqHeaders {
			reqHeaders = append(reqHeaders, map[string]string{"name": k, "value": v})
		}
		respHeaders := make([]map[string]string, 0)
		for k, v := range e.RespHeaders {
			respHeaders = append(respHeaders, map[string]string{"name": k, "value": v})
		}

		var timings map[string]interface{}
		if e.Timing != nil {
			t := e.Timing
			// HAR spec: connect includes TLS (ssl)
			connect := t.TCPConnection + t.TLSHandshake
			timings = map[string]interface{}{
				"blocked": -1.0,
				"dns":     t.DNSLookup,
				"connect": connect,
				"ssl":     t.TLSHandshake,
				"send":    t.RequestSent,
				"wait":    t.Waiting,
				"receive": t.ResponseRecv,
			}
		} else {
			timings = map[string]interface{}{
				"blocked": -1.0,
				"dns":     -1.0,
				"connect": -1.0,
				"ssl":     -1.0,
				"send":    0.0,
				"wait":    e.DurationMs,
				"receive": 0.0,
			}
		}

		reqMime := getHeaderValue(e.ReqHeaders, "Content-Type")
		harEntry := map[string]interface{}{
			"startedDateTime": e.Timestamp,
			"time":            e.DurationMs,
			"request": map[string]interface{}{
				"method":      e.Method,
				"url":         e.URL,
				"httpVersion": "HTTP/1.1",
				"headers":     reqHeaders,
				"queryString": []interface{}{},
				"cookies":     []interface{}{},
				"headersSize": -1,
				"bodySize":    len(e.ReqBody),
				"postData": map[string]interface{}{
					"mimeType": reqMime,
					"text":     e.ReqBody,
				},
			},
			"response": map[string]interface{}{
				"status":      e.Status,
				"statusText":  http.StatusText(e.Status),
				"httpVersion": "HTTP/1.1",
				"headers":     respHeaders,
				"cookies":     []interface{}{},
				"content": map[string]interface{}{
					"size":     len(e.RespBody),
					"mimeType": getHeaderValue(e.RespHeaders, "Content-Type"),
					"text":     e.RespBody,
				},
				"redirectURL": "",
				"headersSize": -1,
				"bodySize":    len(e.RespBody),
			},
			"timings": timings,
		}
		harEntries = append(harEntries, harEntry)
	}

	return map[string]interface{}{
		"log": map[string]interface{}{
			"version": "1.2",
			"creator": map[string]string{
				"name":    "adomnia",
				"version": "1.0",
			},
			"entries": harEntries,
		},
	}
}

func getHeaderValue(headers map[string]string, key string) string {
	for k, v := range headers {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

func buildCurlCommands(entries []trafficEntry) []string {
	cmds := make([]string, 0, len(entries))
	for _, e := range entries {
		var b strings.Builder
		b.WriteString("curl")
		if e.Method != "GET" {
			b.WriteString(" -X ")
			b.WriteString(e.Method)
		}
		for k, v := range e.ReqHeaders {
			lk := strings.ToLower(k)
			if lk == "host" || lk == "connection" {
				continue
			}
			b.WriteString(" -H '")
			b.WriteString(k)
			b.WriteString(": ")
			b.WriteString(strings.ReplaceAll(v, "'", "'\\''"))
			b.WriteString("'")
		}
		if e.ReqBody != "" {
			b.WriteString(" -d '")
			b.WriteString(strings.ReplaceAll(e.ReqBody, "'", "'\\''"))
			b.WriteString("'")
		}
		b.WriteString(" '")
		b.WriteString(e.URL)
		b.WriteString("'")
		cmds = append(cmds, b.String())
	}
	return cmds
}
