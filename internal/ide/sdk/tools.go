package sdk

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Sorgenti di un candidato, mostrate all'utente accanto al percorso.
const (
	SourceCustom  = "custom"
	SourceManaged = "managed"
	SourcePath    = "PATH"
)

// ExecutableName aggiunge l'estensione richiesta dalla piattaforma (".exe" su Windows).
func ExecutableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// ToolDir è una cartella in cui cercare uno strumento, con l'etichetta della sua origine (es. "GOPATH").
type ToolDir struct {
	Path   string
	Source string
}

// ToolCandidate è un possibile binario di uno strumento; Name è il nome cercato (utile se ce ne sono più).
type ToolCandidate struct {
	Name   string
	Binary string
	Source string
}

// ToolSearch descrive dove cercare uno strumento (gopls, dlv, un linter, sonar-scanner…).
type ToolSearch struct {
	// Names sono i nomi senza estensione, in ordine di preferenza (es. golangci-lint, poi staticcheck).
	Names []string
	// Custom è il binario scelto dall'utente: ha sempre la precedenza.
	Custom string
	// ManagedDir è la cartella in cui adOmnia installa gli strumenti (vuota se non configurata).
	ManagedDir string
	// Dirs sono le cartelle proprie del linguaggio (es. GOPATH/bin), dopo quella gestita e prima del PATH.
	Dirs []ToolDir
}

// Candidates elenca i binari nell'ordine di ricerca: personalizzato, poi per ogni nome cartella
// gestita, cartelle del linguaggio e PATH.
func (s ToolSearch) Candidates() []ToolCandidate {
	candidates := make([]ToolCandidate, 0, 4)
	if s.Custom != "" {
		candidates = append(candidates, ToolCandidate{Binary: s.Custom, Source: SourceCustom})
	}
	for _, name := range s.Names {
		if s.ManagedDir != "" {
			candidates = append(candidates, ToolCandidate{Name: name, Binary: filepath.Join(s.ManagedDir, ExecutableName(name)), Source: SourceManaged})
		}
		for _, dir := range s.Dirs {
			candidates = append(candidates, ToolCandidate{Name: name, Binary: filepath.Join(dir.Path, ExecutableName(name)), Source: dir.Source})
		}
		if found, err := exec.LookPath(name); err == nil {
			candidates = append(candidates, ToolCandidate{Name: name, Binary: found, Source: SourcePath})
		}
	}
	return candidates
}

// LocatedTool è l'esito della ricerca: il primo candidato esistente, con versione o errore.
type LocatedTool struct {
	ToolCandidate
	Available bool
	Version   string
	Error     string
}

// Locate restituisce il primo candidato esistente e ne legge la versione (con cache per binario).
// Un binario personalizzato inesistente ferma la ricerca con missingCustom: l'utente l'ha scelto
// esplicitamente e non va sostituito in silenzio. found è false se nessun candidato esiste.
func Locate(candidates []ToolCandidate, missingCustom string, version func(ToolCandidate) (string, error)) (result LocatedTool, found bool) {
	for _, candidate := range candidates {
		info, err := os.Stat(candidate.Binary)
		if err != nil || info.IsDir() {
			if candidate.Source == SourceCustom {
				return LocatedTool{ToolCandidate: candidate, Error: missingCustom}, true
			}
			continue
		}
		result = LocatedTool{ToolCandidate: candidate}
		detected, err := CachedVersion(candidate.Binary, func(string) (string, error) { return version(candidate) })
		if err != nil {
			result.Error = err.Error()
			return result, true
		}
		result.Available, result.Version = true, detected
		return result, true
	}
	return LocatedTool{}, false
}
