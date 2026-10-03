package golang

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/lsp"
	"adomnia/internal/ide/process"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/netpolicy"
)

// GoplsModule è il modulo che `go install` usa per installare gopls nella cartella strumenti.
const GoplsModule = "golang.org/x/tools/gopls@latest"

// GoplsInfo descrive il gopls trovato per una sessione.
type GoplsInfo struct {
	Available  bool   `json:"available"`
	Binary     string `json:"binary,omitempty"`
	Version    string `json:"version,omitempty"`
	Source     string `json:"source,omitempty"`
	ManagedDir string `json:"managedDir,omitempty"`
	Error      string `json:"error,omitempty"`
}

// GoplsSettings sono le preferenze dell'utente tradotte nella configurazione di gopls.
type GoplsSettings struct {
	Gofumpt       bool `json:"gofumpt"`
	Staticcheck   bool `json:"staticcheck"`
	Placeholders  bool `json:"placeholders"`
	SemanticLinks bool `json:"semanticLinks"`
	// Vulncheck attiva la diagnostica delle vulnerabilità note sulle dipendenze (govulncheck
	// dentro gopls). Scarica il database da vuln.go.dev: per questo è opt-in.
	Vulncheck bool `json:"vulncheck"`
}

// BinDirectories restituisce le cartelle bin di ogni voce di GOPATH, dove `go install` mette gli strumenti.
func BinDirectories(gopath string) []sdk.ToolDir {
	if gopath == "" {
		return nil
	}
	dirs := make([]sdk.ToolDir, 0, 1)
	for _, entry := range filepath.SplitList(gopath) {
		dirs = append(dirs, sdk.ToolDir{Path: filepath.Join(entry, "bin"), Source: "GOPATH"})
	}
	return dirs
}

// ToolSearch cerca uno strumento Go nell'ordine: personalizzato, cartella gestita da adOmnia,
// GOPATH/bin, PATH. toolsRoot vuoto esclude la cartella gestita.
func ToolSearch(names []string, custom, toolsRoot, gopath string) sdk.ToolSearch {
	search := sdk.ToolSearch{Names: names, Custom: custom, Dirs: BinDirectories(gopath)}
	if toolsRoot != "" {
		search.ManagedDir = filepath.Join(toolsRoot, "bin")
	}
	return search
}

// LocateGopls individua gopls e ne legge la versione senza avviarlo come server.
func LocateGopls(custom, toolsRoot, gopath string) GoplsInfo {
	managedDir := filepath.Join(toolsRoot, "bin")
	located, found := sdk.Locate(ToolSearch([]string{"gopls"}, custom, toolsRoot, gopath).Candidates(),
		"il binario gopls configurato non esiste", func(candidate sdk.ToolCandidate) (string, error) { return goplsVersion(candidate.Binary) })
	if !found {
		return GoplsInfo{ManagedDir: managedDir, Error: "gopls non trovato: installalo da Go → Install gopls oppure indica un binario personalizzato"}
	}
	return GoplsInfo{Available: located.Available, Binary: located.Binary, Version: located.Version, Source: located.Source, ManagedDir: managedDir, Error: located.Error}
}

func goplsVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), sdk.VersionTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "version")
	process.Configure(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("gopls non risponde a 'gopls version'")
	}
	if err != nil {
		return "", fmt.Errorf("gopls non eseguibile: %s", strings.TrimSpace(string(output)))
	}
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.HasSuffix(fields[0], "gopls") {
			return fields[1], nil
		}
	}
	return strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0]), nil
}

// goplsEnvironmentDefaults valgono solo se l'utente non ha già impostato le variabili.
//
// GO_TELEMETRY_CHILD=2: golang.org/x/telemetry (start.go) tratta il processo come
// discendente del proprio figlio e non avvia né il processo "** telemetry **" né la
// raccolta; la modalità globale scelta con `go telemetry` resta intatta.
// GOTELEMETRY invece è di sola lettura e non spegne nulla: verificato su Windows con
// gopls v0.23.0 (con GOTELEMETRY=off il figlio parte, con GO_TELEMETRY_CHILD=2 no).
// GOMEMLIMIT: il GC di gopls diventa più aggressivo vicino a 1 GiB e taglia i picchi, al costo di un po' di CPU.
var goplsEnvironmentDefaults = map[string]string{"GO_TELEMETRY_CHILD": "2", "GOMEMLIMIT": "1GiB"}

// GoplsServerSpec descrive gopls al manager LSP generico: avvio, configurazione e file osservati.
// environment è quello dell'SDK della sessione (con il suo `go` per primo nel PATH).
func GoplsServerSpec(info GoplsInfo, environment []string, settings GoplsSettings) lsp.ServerSpec {
	return lsp.ServerSpec{
		Language: ID, Name: "gopls", Binary: info.Binary, Version: info.Version,
		Environment:           sdk.WithDefaultEnvironment(environment, goplsEnvironmentDefaults),
		InitializationOptions: goplsConfiguration(settings),
		// Rivalutata a ogni richiesta: il modo offline può cambiare mentre gopls è attivo.
		Configuration: func() any { return goplsConfiguration(settings) },
		WatchesFile:   goplsWatchesFile,
	}
}

// goplsConfiguration traduce le preferenze della sessione nella configurazione gopls; i link esterni restano disattivati (local-first).
func goplsConfiguration(settings GoplsSettings) map[string]any {
	return map[string]any{
		"gofumpt":            settings.Gofumpt,
		"staticcheck":        settings.Staticcheck,
		"vulncheck":          map[bool]string{true: "Imports", false: "Off"}[settings.Vulncheck && !netpolicy.Current().Offline],
		"usePlaceholders":    settings.Placeholders,
		"completeUnimported": true,
		"hoverKind":          "FullDocumentation",
		"linksInHover":       settings.SemanticLinks,
		"semanticTokens":     true,
		// Stringhe e numeri li colora già Monaco: gopls invia solo i token che aggiungono informazione.
		"semanticTokenTypes": map[string]bool{"string": false, "number": false},
		// Tutte le categorie utili: il frontend mostra quelle di tipo solo con la preferenza Type Hints.
		"hints": map[string]bool{
			"parameterNames":         true,
			"functionTypeParameters": true,
			"assignVariableTypes":    true,
			"rangeVariableTypes":     true,
			"compositeLiteralTypes":  true,
			"constantValues":         true,
		},
	}
}

// goplsWatchesFile: i file cambiati su disco che gopls deve rileggere anche se non aperti.
func goplsWatchesFile(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	return strings.HasSuffix(base, ".go") || base == "go.mod" || base == "go.sum" || base == "go.work" || base == "go.work.sum"
}

// Comandi gopls usati dalle funzioni Go dell'IDE (non sono LSP standard).
const (
	GoplsChangeSignatureCommand = "gopls.change_signature"
	GoplsDocCommand             = "gopls.doc"
)
