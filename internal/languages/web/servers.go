package web

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/project"
)

//go:embed schemas/package.schema.json
var packageSchema []byte

// lookPath è sostituibile nei test.
var (
	defaultLookPath = exec.LookPath
	lookPath        = defaultLookPath
)

// ManagedPackages sono i pacchetti npm che adOmnia installa (dopo conferma) nella propria cartella
// strumenti per avere i language server anche quando il progetto non li ha.
var ManagedPackages = []string{"typescript-language-server", "typescript", "vscode-langservers-extracted"}

// serverBinaries è l'eseguibile del language server standard di ogni linguaggio.
var serverBinaries = map[string]string{
	ScriptID: "typescript-language-server",
	HTMLID:   "vscode-html-language-server",
	CSSID:    "vscode-css-language-server",
	JSONID:   "vscode-json-language-server",
}

// ServerInfo descrive il language server trovato per un linguaggio.
type ServerInfo struct {
	Language  string `json:"language"`
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	// Source è "project" (node_modules/.bin), "managed" (cartella strumenti di adOmnia), "PATH" o "custom".
	Source string `json:"source,omitempty"`
	// TypeScriptLib è la cartella lib di TypeScript usata da tsserver (solo per il linguaggio script).
	TypeScriptLib string `json:"typescriptLib,omitempty"`
	Error         string `json:"error,omitempty"`
}

// ServerLanguages sono i linguaggi web che hanno un language server.
func ServerLanguages() []string { return []string{ScriptID, HTMLID, CSSID, JSONID} }

// ManagedPrefix è la cartella in cui `npm install --prefix` mette i language server gestiti.
func ManagedPrefix(toolsRoot string) string { return filepath.Join(toolsRoot, "node") }

func managedBinDirectory(toolsRoot string) string {
	return filepath.Join(ManagedPrefix(toolsRoot), "node_modules", ".bin")
}

// LocateServer cerca il language server di languageID: custom, node_modules/.bin del progetto e dei
// suoi genitori fino a root, cartella gestita da adOmnia, PATH. Un server mancante non è un errore
// fatale: l'editor continua con le funzioni di Monaco.
func LocateServer(languageID, root, custom, toolsRoot string) ServerInfo {
	name, ok := serverBinaries[languageID]
	if !ok {
		return ServerInfo{Language: languageID, Error: "no language server for this language"}
	}
	info := ServerInfo{Language: languageID, Name: name}
	if custom != "" {
		if !isFile(custom) {
			info.Error = "the configured language server binary does not exist"
			return info
		}
		info.Available, info.Binary, info.Source = true, custom, "custom"
	} else if binary, source := findBinary(name, root, toolsRoot); binary != "" {
		info.Available, info.Binary, info.Source = true, binary, source
	} else {
		info.Error = fmt.Sprintf("%s not found: install the web language servers from the editor notice, or run `npm install -g %s`", name, installHint(languageID))
		return info
	}
	if languageID == ScriptID {
		if info.TypeScriptLib = findTypeScriptLib(root, toolsRoot); info.TypeScriptLib == "" {
			info.Available = false
			info.Error = "TypeScript is not installed for this project: run `npm install` in it, or install the web language servers from the editor notice"
		}
	}
	return info
}

func installHint(languageID string) string {
	if languageID == ScriptID {
		return "typescript-language-server typescript"
	}
	return "vscode-langservers-extracted"
}

// findBinary cerca name in node_modules/.bin salendo da root, poi nella cartella gestita, poi nel PATH.
func findBinary(name, root, toolsRoot string) (binary, source string) {
	for _, directory := range projectBinDirectories(root) {
		if found := binaryIn(directory, name); found != "" {
			return found, "project"
		}
	}
	if toolsRoot != "" {
		if found := binaryIn(managedBinDirectory(toolsRoot), name); found != "" {
			return found, "managed"
		}
	}
	if found, err := lookPath(name); err == nil {
		return found, "PATH"
	}
	return "", ""
}

// projectBinDirectories sono i node_modules/.bin da root verso l'alto (un monorepo li ha nel genitore).
func projectBinDirectories(root string) []string {
	directories := make([]string, 0, 3)
	for current, steps := filepath.Clean(root), 0; steps < 4; steps++ {
		directories = append(directories, filepath.Join(current, "node_modules", ".bin"))
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return directories
}

func binaryIn(directory, name string) string {
	candidates := []string{name}
	if runtime.GOOS == "windows" {
		candidates = []string{name + ".cmd", name + ".exe"}
	}
	for _, candidate := range candidates {
		if path := filepath.Join(directory, candidate); isFile(path) {
			return path
		}
	}
	return ""
}

// findTypeScriptLib cerca typescript/lib prima nel progetto (la sua versione vince), poi nella cartella gestita.
func findTypeScriptLib(root, toolsRoot string) string {
	for current, steps := filepath.Clean(root), 0; steps < 4; steps++ {
		if lib := filepath.Join(current, "node_modules", "typescript", "lib"); isFile(filepath.Join(lib, "tsserver.js")) {
			return lib
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	if toolsRoot != "" {
		if lib := filepath.Join(ManagedPrefix(toolsRoot), "node_modules", "typescript", "lib"); isFile(filepath.Join(lib, "tsserver.js")) {
			return lib
		}
	}
	return ""
}

// ServerSpec descrive il server al manager LSP generico: avvio, opzioni di inizializzazione e
// configurazione servita a workspace/configuration.
func ServerSpec(info ServerInfo) (lsp.ServerSpec, error) {
	if !info.Available {
		return lsp.ServerSpec{}, fmt.Errorf("%s", info.Error)
	}
	spec := lsp.ServerSpec{
		Language: info.Language, Name: info.Name, Binary: info.Binary, Arguments: []string{"--stdio"},
		Configuration: func() any { return serverConfiguration(info.Language) },
		WatchesFile:   func(path string) bool { return watchesFile(info.Language, path) },
	}
	if info.Language == ScriptID {
		spec.InitializationOptions = map[string]any{
			"tsserver": map[string]any{"path": filepath.Join(info.TypeScriptLib, "tsserver.js")},
		}
	}
	return spec, nil
}

// serverConfiguration è la configurazione del server: workspace/configuration risponde con lo
// stesso oggetto a ogni sezione richiesta, quindi vale come impostazioni di quella sezione.
func serverConfiguration(languageID string) any {
	switch languageID {
	case JSONID:
		var schema any
		_ = json.Unmarshal(packageSchema, &schema)
		return map[string]any{
			"validate":       map[string]any{"enable": true},
			"format":         map[string]any{"enable": true},
			"schemaDownload": map[string]any{"enable": false}, // local-first: nessuna richiesta di rete
			"schemas":        []any{map[string]any{"fileMatch": []string{"package.json"}, "schema": schema}},
		}
	case HTMLID:
		return map[string]any{
			"suggest":         map[string]any{"html5": true},
			"validate":        map[string]any{"scripts": true, "styles": true},
			"autoClosingTags": true,
			"format":          map[string]any{"enable": true},
		}
	case CSSID:
		return map[string]any{"validate": true}
	}
	return map[string]any{}
}

// watchesFile dice quali file cambiati su disco interessano il server: configurazioni e sorgenti.
func watchesFile(languageID, path string) bool {
	switch filepath.Base(path) {
	case "tsconfig.json", "jsconfig.json", "package.json":
		return true
	}
	if project.IgnoredDirectory(filepath.Base(filepath.Dir(path))) {
		return false
	}
	_, owned := adapter{kindFor(languageID)}.DocumentLanguageID(path)
	return owned
}

func kindFor(languageID string) kind {
	for _, k := range kinds {
		if k.id == languageID {
			return k
		}
	}
	return kind{}
}
