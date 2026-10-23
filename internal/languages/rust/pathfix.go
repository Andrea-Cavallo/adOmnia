package rust

import (
	"path/filepath"
	"regexp"
	"strings"
)

// workspacePaths riporta i percorsi stampati da cargo e dai panic alla working directory della Run.
// La Run parte dalla cartella del crate, ma rustc e `panicked at` stampano i percorsi relativi alla
// radice del workspace (`crates/api/src/main.rs`): la console li risolverebbe sotto il crate
// (`crates/api/crates/api/src/main.rs`) e il click aprirebbe un file che non esiste. Come
// `resolveBuildFile` per i diagnostici, si risale dalla cartella di lavoro fino alla radice del
// progetto e si riscrive il percorso relativo alla cartella di lavoro.
type workspacePaths struct {
	directory string // working directory della Run
	root      string // radice del progetto: la risalita non la supera
}

// rustLocation trova `percorso.rs:riga[:colonna]`, con le sequenze SGR (colori) davanti che restano.
var rustLocation = regexp.MustCompile(`((?:\x1b\[[0-9;]*m)*)([^\s:()'"\x1b]+\.rs):(\d+)(?::(\d+))?`)

// resolve restituisce il percorso relativo alla working directory del file, "" se il percorso va
// lasciato com'è (assoluto, già valido o introvabile).
func (w workspacePaths) resolve(path string) string {
	if w.directory == "" || filepath.IsAbs(path) || strings.HasPrefix(path, "/") {
		return ""
	}
	native := filepath.FromSlash(path)
	if hasFile(filepath.Join(w.directory, native)) {
		return ""
	}
	directory := filepath.Clean(w.directory)
	for {
		if samePath(directory, w.root) || filepath.Dir(directory) == directory {
			return ""
		}
		directory = filepath.Dir(directory)
		if !withinRoot(w.root, directory) {
			return ""
		}
		candidate := filepath.Join(directory, native)
		if hasFile(candidate) {
			relative, err := filepath.Rel(w.directory, candidate)
			if err != nil {
				return ""
			}
			return filepath.ToSlash(relative)
		}
	}
}

// rootRelative porta un percorso (relativo alla working directory o assoluto) alla forma relativa
// alla radice del progetto, in slash: è quella che il frontend usa per aprire la posizione di un
// fallimento (`TestLocation.RelativePath`, come il runner JS/Python).
func (w workspacePaths) rootRelative(path string) string {
	candidate := path
	if !filepath.IsAbs(candidate) && !strings.HasPrefix(candidate, "/") {
		candidate = filepath.Join(w.directory, filepath.FromSlash(path))
	}
	absolute, err := filepath.Abs(candidate)
	if err != nil {
		return filepath.ToSlash(path)
	}
	root, err := filepath.Abs(w.root)
	if err != nil {
		return filepath.ToSlash(path)
	}
	relative, err := filepath.Rel(root, absolute)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(relative)
}

// rewrite sostituisce in una riga (o in un blocco `rendered`) i percorsi risolti altrove.
func (w workspacePaths) rewrite(text string) (string, bool) {
	changed := false
	out := rustLocation.ReplaceAllStringFunc(text, func(match string) string {
		parts := rustLocation.FindStringSubmatch(match)
		fixed := w.resolve(parts[2])
		if fixed == "" {
			return match
		}
		changed = true
		location := ":" + parts[3]
		if parts[4] != "" {
			location += ":" + parts[4]
		}
		return parts[1] + fixed + location
	})
	return out, changed
}

func withinRoot(root, path string) bool {
	if root == "" {
		return true
	}
	relative, err := filepath.Rel(root, path)
	return err == nil && !strings.HasPrefix(relative, "..")
}

func samePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right)) && left != "" && right != ""
}

// pathFixingConsole compone cargoConsoleLine con la risoluzione dei percorsi: i messaggi JSON di
// cargo diventano testo con percorsi validi, e le righe del programma (panic) si correggono senza
// toccare le altre.
func pathFixingConsole(paths workspacePaths) func(string) (string, bool) {
	return func(line string) (string, bool) {
		text, handled := cargoConsoleLine(line)
		if handled {
			if text == "" {
				return "", true
			}
			fixed, _ := paths.rewrite(text)
			return fixed, true
		}
		if fixed, changed := paths.rewrite(line); changed {
			return fixed, true
		}
		return "", false
	}
}
