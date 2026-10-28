// Package aipolicy reads the per-project AI policy that decides whether code
// may leave the machine. It is deliberately dependency-free so every agent
// launcher (Copilot, milk/Claude Code, OpenCode) applies the same rule.
package aipolicy

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"path/filepath"
)

// File is versionable with the project: it decides which AI providers may see the code.
const File = ".adomnia/ai-policy.json"

// Per-project AI policies.
const (
	// Allowed: any configured provider (secrets and aiignore entries stay excluded).
	Allowed = "allowed"
	// LocalOnly: only models running on this machine (Ollama or a localhost endpoint).
	LocalOnly = "local-only"
	// Off: no project file goes to an AI provider.
	Off = "off"
)

type document struct {
	Format string `json:"format"`
	AI     string `json:"ai"`
}

// Load reads the project policy; a missing or unreadable file means "allowed",
// except an unknown value, which means "off" for safety.
func Load(root string) string {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(File)))
	if err != nil {
		return Allowed
	}
	var doc document
	if json.Unmarshal(data, &doc) != nil {
		return Off
	}
	switch doc.AI {
	case Allowed, LocalOnly, Off:
		return doc.AI
	}
	return Off
}

// Save writes the policy; "allowed" removes the file so the project returns to the default.
func Save(root, policy string) error {
	path := filepath.Join(root, filepath.FromSlash(File))
	switch policy {
	case Allowed:
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	case LocalOnly, Off:
	default:
		return fmt.Errorf("invalid AI policy: %q", policy)
	}
	data, err := jsonutil.Marshal(document{Format: "adomnia-ai-policy", AI: policy}, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// Allows reports whether the policy permits sending code to a local or cloud provider.
func Allows(policy string, localProvider bool) bool {
	switch policy {
	case Allowed:
		return true
	case LocalOnly:
		return localProvider
	}
	return false
}
