package devlog

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
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
		if entry, ok := parseEntry(scanner.Bytes()); ok {
			entries = append(entries, entry)
		}
	}
	return lastEntries(entries, limit), scanner.Err()
}

// Chunk sono le voci aggiunte dopo un offset e l'offset da cui riprendere.
type Chunk struct {
	Entries []Entry `json:"entries"`
	Next    int64   `json:"next"`
}

// ReadSince legge solo le righe complete aggiunte dopo offset. Il polling del frontend rileggeva l'intero
// file a ogni giro anche ad app ferma; così un giro senza log nuovi costa una Stat. Se il file è stato
// svuotato (ClearDevLogs) riparte dall'inizio.
func ReadSince(path string, offset int64, limit int) (Chunk, error) {
	chunk := Chunk{Entries: []Entry{}, Next: offset}
	info, err := os.Stat(path)
	if err != nil {
		return chunk, err
	}
	if offset < 0 || info.Size() < offset {
		offset = 0
	}
	chunk.Next = offset
	if info.Size() == offset {
		return chunk, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return chunk, err
	}
	defer file.Close()
	if _, err = file.Seek(offset, io.SeekStart); err != nil {
		return chunk, err
	}
	reader := bufio.NewReaderSize(file, 64*1024)
	for {
		line, readErr := reader.ReadBytes('\n')
		if readErr != nil {
			// Una riga senza \n è ancora in scrittura: si rilegge al prossimo giro.
			if readErr == io.EOF {
				break
			}
			return chunk, readErr
		}
		chunk.Next += int64(len(line))
		if entry, ok := parseEntry(line); ok {
			chunk.Entries = append(chunk.Entries, entry)
		}
	}
	chunk.Entries = lastEntries(chunk.Entries, limit)
	return chunk, nil
}

func parseEntry(raw []byte) (Entry, bool) {
	line := strings.TrimSpace(string(raw))
	if line == "" {
		return Entry{}, false
	}
	var entry Entry
	if json.Unmarshal([]byte(line), &entry) != nil {
		return Entry{}, false
	}
	if entry.Source == "" {
		entry.Source = "backend"
	}
	return entry, true
}

func lastEntries(entries []Entry, limit int) []Entry {
	if limit > 0 && len(entries) > limit {
		return entries[len(entries)-limit:]
	}
	return entries
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
