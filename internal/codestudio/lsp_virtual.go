package codestudio

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/lsp"
)

// virtualDocumentPath salva il testo di un documento con URI non-file (classi JDK e librerie Java) in un
// file di sola lettura e restituisce il suo percorso: "" se il server non ha documenti virtuali o la lettura
// fallisce. Il file si apre come ogni file esterno; TrackDocument lo sincronizza col suo URI originale.
func (m *LSPManager) virtualDocumentPath(state *lspSession, uri string) string {
	state.mu.Lock()
	spec, process := state.options.VirtualDocuments, state.process
	for path, original := range state.virtualURIs {
		if original == uri {
			state.mu.Unlock()
			return path
		}
	}
	state.mu.Unlock()
	if spec == nil || spec.Method == "" || spec.RelativePath == nil || process == nil || strings.HasPrefix(uri, "file:") {
		return ""
	}
	ctx, cancel := withRequestTimeout(context.Background())
	defer cancel()
	var text string
	if err := process.conn.Call(ctx, spec.Method, map[string]string{"uri": uri}, &text); err != nil || text == "" {
		return ""
	}
	path, err := writeVirtualDocument(state.language, uri, spec, text)
	if err != nil {
		return ""
	}
	state.mu.Lock()
	if state.virtualURIs == nil {
		state.virtualURIs = map[string]string{}
	}
	state.virtualURIs[path] = uri
	state.mu.Unlock()
	return path
}

// virtualDocumentsRoot è la cartella dove si salvano i documenti virtuali dei language server.
func virtualDocumentsRoot() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "adomnia", "virtual")
}

func writeVirtualDocument(language, uri string, spec *lsp.VirtualDocuments, text string) (string, error) {
	sum := sha1.Sum([]byte(uri)) // nosemgrep: go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1 -- sha1 is a non-security identifier/fingerprint here
	relative := filepath.FromSlash(strings.TrimLeft(spec.RelativePath(uri), "/\\"))
	if relative == "" || strings.Contains(relative, "..") {
		relative = "document"
	}
	path := filepath.Join(virtualDocumentsRoot(), language, hex.EncodeToString(sum[:4]), relative)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	_ = os.Remove(path)
	return path, os.WriteFile(path, []byte(text), 0o444)
}
