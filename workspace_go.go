// workspace_go.go — named workspace management for adOmnia.
// Save/load/switch between project workspaces stored in bbolt.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type WorkspaceMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Tabs      int    `json:"tabs"`
}

func workspaceListHandler(w http.ResponseWriter, r *http.Request) {
	keys, err := storeList("workspace", "ws/")
	if err != nil || keys == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"workspaces": []WorkspaceMeta{}, "count": 0})
		return
	}

	workspaces := make([]WorkspaceMeta, 0)
	for _, k := range keys {
		data, _ := storeGet("workspace", k)
		if data == nil {
			continue
		}
		var ws WorkspaceMeta
		if json.Unmarshal(data, &ws) == nil {
			ws.ID = k[3:]
			workspaces = append(workspaces, ws)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workspaces": workspaces,
		"count":      len(workspaces),
	})
}

func workspaceSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name  string `json:"name"`
		State string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)

	if err := storePut("workspace", "v2", []byte(req.State)); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}

	var tabs int
	var state map[string]interface{}
	if json.Unmarshal([]byte(req.State), &state) == nil {
		if t, ok := state["openTabs"].([]interface{}); ok {
			tabs = len(t)
		}
	}

	key := fmt.Sprintf("ws/%s", req.Name)
	existing, _ := storeGet("workspace", key)
	createdAt := now
	if existing != nil {
		var prev WorkspaceMeta
		if json.Unmarshal(existing, &prev) == nil && prev.CreatedAt != "" {
			createdAt = prev.CreatedAt
		}
	}

	meta := WorkspaceMeta{Name: req.Name, CreatedAt: createdAt, UpdatedAt: now, Tabs: tabs}
	if err := storeJSONPut("workspace", key, meta); err != nil {
		http.Error(w, "meta save failed", http.StatusInternalServerError)
		return
	}

	log.Printf("[workspace] saved \"%s\" (%d tabs)", req.Name, tabs)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": req.Name, "tabs": tabs})
}

func workspaceLoadHandler(w http.ResponseWriter, r *http.Request) {
	data, _ := storeGet("workspace", "v2")
	w.Header().Set("Content-Type", "application/json")
	if data == nil {
		w.Write([]byte("{}"))
	} else {
		w.Write(data)
	}
}

func workspaceDeleteHandler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	key := fmt.Sprintf("ws/%s", name)
	storeDelete("workspace", key)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}
