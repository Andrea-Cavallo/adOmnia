package lsp

import (
	"net/url"
	"path/filepath"
)

// FileURI converte un percorso assoluto in URI file:// (su Windows "C:\x" diventa "file:///C:/x").
func FileURI(path string) string {
	normalized := filepath.ToSlash(path)
	if len(normalized) >= 2 && normalized[1] == ':' {
		normalized = "/" + normalized
	}
	return (&url.URL{Scheme: "file", Path: normalized}).String()
}
