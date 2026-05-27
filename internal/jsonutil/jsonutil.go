// jsontools_go.go — server-side JSON tools powered by gjson, sjson, jsondiff.
// Exposes fast JSON path queries, mutations, and RFC 6902 diffing.

package jsonutil

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	humanize "github.com/dustin/go-humanize"
	mimetype "github.com/gabriel-vasile/mimetype"
	"github.com/romshark/jscan"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wI2L/jsondiff"
)

func jsonQueryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var req struct {
		JSON string `json:"json"`
		Path string `json:"path"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "path required (e.g. data.items.0.name)", http.StatusBadRequest)
		return
	}

	result := gjson.Get(req.JSON, req.Path)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"path":   req.Path,
		"value":  result.Value(),
		"raw":    result.Raw,
		"type":   gjsonType(result),
		"exists": result.Exists(),
	})
}

func jsonSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var req struct {
		JSON  string      `json:"json"`
		Path  string      `json:"path"`
		Value interface{} `json:"value"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	rawJSON := req.JSON
	if rawJSON == "" {
		rawJSON = "{}"
	}

	result, err := sjson.Set(rawJSON, req.Path, req.Value)
	if err != nil {
		http.Error(w, "set failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     true,
		"path":   req.Path,
		"result": json.RawMessage(result),
	})
}

func jsonDiffHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var req struct {
		Left  json.RawMessage `json:"left"`
		Right json.RawMessage `json:"right"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	patch, err := jsondiff.Compare(req.Left, req.Right)
	if err != nil {
		http.Error(w, "diff failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	identical := len(patch) == 0

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"identical": identical,
		"patch":     patch,
		"count":     len(patch),
	})
}

func jsonHumanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Bytes  int64   `json:"bytes"`
		Ms     float64 `json:"ms"`
		Format string  `json:"format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	resp := map[string]interface{}{}

	if req.Format == "" || req.Format == "bytes" || req.Format == "all" {
		resp["bytesHuman"] = humanize.Bytes(uint64(req.Bytes))
	}
	if req.Format == "" || req.Format == "time" || req.Format == "all" {
		resp["timeHuman"] = humanizeTime(req.Ms)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func gjsonType(r gjson.Result) string {
	switch r.Type {
	case gjson.Null:
		return "null"
	case gjson.False, gjson.True:
		return "boolean"
	case gjson.Number:
		return "number"
	case gjson.String:
		return "string"
	case gjson.JSON:
		if r.IsArray() {
			return "array"
		}
		return "object"
	default:
		return "unknown"
	}
}

func humanizeTime(ms float64) string {
	if ms < 1 {
		return "<1ms"
	}
	if ms < 1000 {
		return fmt.Sprintf("%.1fms", ms)
	}
	if ms < 60000 {
		return fmt.Sprintf("%.1fs", ms/1000)
	}
	return fmt.Sprintf("%.1fm", ms/60000)
}

// Streaming JSON validator — validates and extracts structure without full unmarshal.
// POST /json/stream
func jsonStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024))

	valid := jscan.ValidBytes(body)
	structures := make([]map[string]interface{}, 0)

	if valid {
		err := jscan.ScanBytes(jscan.Options{}, body, func(iter *jscan.IteratorBytes) bool {
			if len(structures) < 100 {
				structures = append(structures, map[string]interface{}{
					"path":  string(iter.Path()),
					"type":  iter.ValueType.String(),
					"value": truncateValue(string(iter.Value()), 100),
				})
			}
			return len(structures) < 200
		})
		if err.Code != 0 {
			valid = false
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":      valid,
		"structures": structures,
		"count":      len(structures),
	})
}

func truncateValue(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// Detect MIME type from raw bytes
// POST /json/mimetype
func mimeDetectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024))
	if len(body) == 0 {
		http.Error(w, "body required", http.StatusBadRequest)
		return
	}

	mtype := mimetype.Detect(body)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mime":      mtype.String(),
		"extension": mtype.Extension(),
		"isJSON":    strings.Contains(mtype.String(), "json"),
		"isXML":     strings.Contains(mtype.String(), "xml"),
		"isHTML":    strings.Contains(mtype.String(), "html"),
		"isText":    strings.HasPrefix(mtype.String(), "text/"),
		"isImage":   strings.HasPrefix(mtype.String(), "image/"),
		"isBinary":  !strings.HasPrefix(mtype.String(), "text/") && !strings.Contains(mtype.String(), "json") && !strings.Contains(mtype.String(), "xml"),
	})
}

// RegisterHandlers registers JSON and MIME inspection endpoints.
func RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/json/query", jsonQueryHandler)
	mux.HandleFunc("/json/set", jsonSetHandler)
	mux.HandleFunc("/json/diff", jsonDiffHandler)
	mux.HandleFunc("/json/human", jsonHumanHandler)
	mux.HandleFunc("/json/stream", jsonStreamHandler)
	mux.HandleFunc("/json/mimetype", mimeDetectHandler)
}
