package rust

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Un file `.rs` fuori da un crate (la cartella degli esercizi, un `fibonacci.rs` da solo) si lancia
// e si debugga come un bin Cargo: l'host genera un crate fantasma nella cache di adOmnia che punta
// al sorgente, così Run, diagnostici, build per il debug e toolchain restano quelli di cargo.
// Il progetto dell'utente non viene toccato (niente Cargo.toml, niente target/ accanto al file).

// validSource è il controllo statico del campo `source`: un `.rs` che non può passare per un flag.
func validSource(source string) error {
	if source == "" || strings.HasPrefix(source, "-") || strings.ContainsAny(source, "\x00\r\n'") || !strings.EqualFold(filepath.Ext(source), ".rs") {
		return fmt.Errorf("select a Rust .rs source file")
	}
	return nil
}

// looseCacheRoot è la cartella dei crate fantasma; sostituibile nei test.
var looseCacheRoot = func() string {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "adomnia", "rust-scripts")
}

// looseCrate prepara il crate fantasma di source e ne restituisce Cargo.toml e il nome del bin.
// Il sorgente si risolve (symlink compresi) e deve stare dentro il progetto.
func looseCrate(root, workingDirectory, source string) (manifest, bin string, err error) {
	if err := validSource(source); err != nil {
		return "", "", err
	}
	path := source
	if !filepath.IsAbs(path) {
		path = filepath.Join(workingDirectory, path)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", "", fmt.Errorf("Rust source file does not exist")
	}
	if !withinRoot(root, resolved) {
		return "", "", fmt.Errorf("Rust source file must be inside the project")
	}
	if !hasFile(resolved) {
		return "", "", fmt.Errorf("select a Rust source file")
	}
	bin = looseBinName(resolved)
	sum := sha256.Sum256([]byte(strings.ToLower(resolved)))
	directory := filepath.Join(looseCacheRoot(), hex.EncodeToString(sum[:6]))
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", "", fmt.Errorf("could not prepare the build folder: %w", err)
	}
	manifest = filepath.Join(directory, "Cargo.toml")
	content := fmt.Sprintf("[package]\nname = %q\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[[bin]]\nname = %q\npath = '%s'\n\n# Un workspace a sé: la cache non deve mai unirsi a un Cargo.toml sopra di lei.\n[workspace]\n",
		bin, bin, filepath.ToSlash(resolved))
	if existing, readErr := os.ReadFile(manifest); readErr != nil || string(existing) != content {
		if err := os.WriteFile(manifest, []byte(content), 0o600); err != nil {
			return "", "", fmt.Errorf("could not prepare the build folder: %w", err)
		}
	}
	return manifest, bin, nil
}

// looseBinName ricava un nome di crate valido dal file (`1st-try.rs` → `s_1st-try`).
func looseBinName(path string) string {
	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	var name strings.Builder
	for _, char := range stem {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9', char == '-', char == '_':
			name.WriteRune(char)
		default:
			name.WriteByte('_')
		}
	}
	result := name.String()
	if result == "" || result[0] < 'A' || (result[0] > 'Z' && result[0] < 'a') || result[0] > 'z' {
		result = "s_" + result
	}
	return result
}
