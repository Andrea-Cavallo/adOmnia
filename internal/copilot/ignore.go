package copilot

import (
	"bufio"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// AIIgnoreFile è il file per progetto con i percorsi da non inviare mai a un provider AI.
const AIIgnoreFile = ".adomnia/aiignore"

// builtinSensitivePatterns: segreti che non devono lasciare la macchina anche senza aiignore.
var builtinSensitivePatterns = []string{
	".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore",
	"id_rsa*", "id_ed25519*", "*.kdbx", ".npmrc", ".netrc", ".pgpass", "credentials", "credentials.json",
	"secrets/**", ".ssh/**", ".aws/**", ".gnupg/**",
}

// ContextFilter decide se un file del progetto può essere mostrato a Copilot.
type ContextFilter struct {
	patterns []string
}

// LoadContextFilter unisce i pattern predefiniti a quelli di <root>/.adomnia/aiignore (sintassi glob, "dir/**").
func LoadContextFilter(root string) ContextFilter {
	patterns := append([]string(nil), builtinSensitivePatterns...)
	file, err := os.Open(filepath.Join(root, filepath.FromSlash(AIIgnoreFile)))
	if err != nil {
		return ContextFilter{patterns: patterns}
	}
	defer func() { _ = file.Close() }()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" && !strings.HasPrefix(line, "#") {
			patterns = append(patterns, strings.TrimPrefix(filepath.ToSlash(line), "/"))
		}
	}
	return ContextFilter{patterns: patterns}
}

// Excluded vale per il percorso relativo al progetto (con /) o per il solo nome del file.
func (f ContextFilter) Excluded(relativePath string) bool {
	relative := strings.TrimPrefix(filepath.ToSlash(relativePath), "./")
	name := path.Base(relative)
	for _, pattern := range f.patterns {
		if prefix, ok := strings.CutSuffix(pattern, "/**"); ok {
			if relative == prefix || strings.HasPrefix(relative, prefix+"/") || strings.Contains("/"+relative, "/"+prefix+"/") {
				return true
			}
			continue
		}
		if matched, _ := path.Match(pattern, name); matched {
			return true
		}
		if matched, _ := path.Match(pattern, relative); matched {
			return true
		}
	}
	return false
}
