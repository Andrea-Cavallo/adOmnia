package devlog

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// FileInfo describes one JSONL file in the logs directory.
type FileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// ReadEntries parses a JSONL log file, skipping malformed lines. limit > 0
// keeps only the most recent entries.
func ReadEntries(path string, limit int) ([]Entry, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	entries := make([]Entry, 0, 256)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry Entry
		if json.Unmarshal([]byte(line), &entry) == nil {
			if entry.Source == "" {
				entry.Source = "backend"
			}
			entries = append(entries, entry)
		}
	}
	if limit > 0 && len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	return entries, scanner.Err()
}

// ReadFile reads one file of the logs directory by bare name.
func ReadFile(name string) ([]Entry, error) {
	cleaned := filepath.Clean(name)
	if cleaned != filepath.Base(cleaned) || cleaned == "." || cleaned == ".." {
		return nil, fmt.Errorf("invalid log file name %q", name)
	}
	return ReadEntries(filepath.Join(Dir(), cleaned), 0)
}

// ListFiles returns the JSONL files of the logs directory.
func ListFiles() ([]FileInfo, error) {
	entries, err := os.ReadDir(Dir())
	if err != nil {
		return nil, err
	}
	var result []FileInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, FileInfo{Name: e.Name(), Size: info.Size(), ModTime: info.ModTime().UTC().Format(time.RFC3339)})
	}
	return result, nil
}

// OpenDir opens the logs directory in the OS file manager.
func OpenDir() error {
	dir := Dir()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", dir)
	case "linux":
		cmd = exec.Command("xdg-open", dir)
	default:
		cmd = exec.Command("explorer", dir)
	}
	return cmd.Start()
}
