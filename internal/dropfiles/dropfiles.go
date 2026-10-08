// Package dropfiles reads files dropped on the main window.
package dropfiles

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// File is one dropped file: text formats in Text, binary ones in BytesBase64.
type File struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Text        string `json:"text,omitempty"`
	BytesBase64 string `json:"bytesBase64,omitempty"`
}

const maxBytes = 50 * 1024 * 1024

var supported = []string{".class", ".pdf", ".har", ".wsdl", ".mmd", ".mermaid", ".tex", ".json", ".yaml", ".yml", ".adomnia", ".bru"}

// Supported reports whether a file name has a drag-and-drop importable extension.
func Supported(name string) bool {
	lower := strings.ToLower(name)
	for _, ext := range supported {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func isBinary(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".class")
}

// Read loads the dropped files, refusing folders, oversized and unsupported files.
func Read(paths []string) ([]File, error) {
	result := make([]File, 0, len(paths))
	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		cleaned := filepath.Clean(path)
		name := filepath.Base(cleaned)
		info, err := os.Stat(cleaned)
		if err != nil {
			return nil, fmt.Errorf("could not read dropped file %q: %w", name, err)
		}
		if info.IsDir() {
			return nil, fmt.Errorf("%s is a folder; drop a supported file instead", name)
		}
		if info.Size() > maxBytes {
			return nil, fmt.Errorf("%s is too large to import from drag and drop", name)
		}
		if !Supported(info.Name()) {
			return nil, fmt.Errorf("%s is not a supported drag-and-drop file type", name)
		}
		data, err := os.ReadFile(cleaned)
		if err != nil {
			return nil, fmt.Errorf("could not read dropped file %q: %w", name, err)
		}
		entry := File{Name: name, Path: cleaned}
		if isBinary(name) {
			entry.BytesBase64 = base64.StdEncoding.EncodeToString(data)
		} else {
			entry.Text = string(data)
		}
		result = append(result, entry)
	}
	return result, nil
}
