// Temporary benchmark helper: seeds a Code Studio session for a folder into an
// isolated adOmnia data directory so startup can be measured with a project open.
package main

import (
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/codestudio"
	"github.com/Andrea-Cavallo/adOmnia/internal/storage"
)

type project struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	RootPath      string `json:"rootPath"`
	RealPath      string `json:"realPath"`
	Authorization string `json:"authorization"`
	Units         []any  `json:"units"`
}

type session struct {
	ID          string    `json:"id"`
	Project     project   `json:"project"`
	WorkspaceID string    `json:"workspaceId,omitempty"`
	OpenedAt    time.Time `json:"openedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type recent struct {
	Name      string    `json:"name"`
	RootPath  string    `json:"rootPath"`
	RealPath  string    `json:"realPath"`
	Available bool      `json:"available"`
	OpenedAt  time.Time `json:"openedAt"`
}

type state struct {
	Version      int       `json:"version"`
	Sessions     []session `json:"sessions"`
	Recent       []recent  `json:"recent,omitempty"`
	TrustedPaths []string  `json:"trustedPaths,omitempty"`
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: benchseed <dataDir> <projectPath>")
		os.Exit(2)
	}
	dataDir := os.Args[1]
	root := os.Args[2]
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		real = root
	}
	if err := storage.Open(dataDir); err != nil {
		fmt.Fprintln(os.Stderr, "open storage:", err)
		os.Exit(1)
	}
	defer storage.Close()

	now := time.Now().UTC()
	entry := session{
		ID:        "bench-freqtrade",
		Project:   project{ID: "bench-freqtrade", Name: filepath.Base(real), RootPath: real, RealPath: real, Authorization: "tooling-permitted", Units: []any{}},
		OpenedAt:  now,
		UpdatedAt: now,
	}
	snapshot := state{
		Version:      codestudio.PersistenceSchemaVersion,
		Sessions:     []session{entry},
		Recent:       []recent{{Name: filepath.Base(real), RootPath: real, RealPath: real, Available: true, OpenedAt: now}},
		TrustedPaths: []string{real},
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		fmt.Fprintln(os.Stderr, "marshal:", err)
		os.Exit(1)
	}
	if _, err := storage.Get("goide", "state"); err == nil {
		fmt.Println("note: replacing existing state")
	}
	if err := storage.Put("goide", "state", data); err != nil {
		fmt.Fprintln(os.Stderr, "put:", err)
		os.Exit(1)
	}
	fmt.Printf("seeded %d bytes for %s\n", len(data), real)
}
