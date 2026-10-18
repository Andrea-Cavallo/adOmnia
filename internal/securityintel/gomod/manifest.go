package gomod

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"golang.org/x/mod/modfile"
	"golang.org/x/mod/semver"

	"adomnia/internal/securityintel"
)

// UpgradeManifest implementa securityintel.UpgradeEditor per go.mod.
//
// È una trasformazione pura del testo: nessun processo, nessuna rete, nessuna
// scrittura. Il risultato è il go.mod come lo scriverebbe `go mod edit`: la stessa
// riga di require aggiornata, con i commenti intatti.
func (*Adapter) UpgradeManifest(manifestText string, component securityintel.Component, targetVersion string) (string, error) {
	if component.Origin == securityintel.OriginToolchain {
		return "", fmt.Errorf("the Go standard library and toolchain are not dependencies: upgrade the go/toolchain directive instead")
	}
	if component.Replace != "" {
		return "", fmt.Errorf("the version of %s comes from a replace directive (%s): change the replace, not the require", component.Name, component.Replace)
	}
	version := strings.TrimSpace(targetVersion)
	if version != "" && !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	if !semver.IsValid(version) {
		return "", fmt.Errorf("version %s is not a valid Go module version", targetVersion)
	}
	parsed, err := modfile.Parse("go.mod", []byte(manifestText), nil)
	if err != nil {
		return "", fmt.Errorf("parse go.mod: %w", err)
	}
	// AddRequire aggiorna la prima riga del modulo senza toccarne i commenti, e
	// aggiunge una require esplicita per un modulo finora solo transitive: è quello
	// che fa `go get` per fissare una versione.
	if err := parsed.AddRequire(component.Name, version); err != nil {
		return "", fmt.Errorf("update %s in go.mod: %w", component.Name, err)
	}
	formatted, err := parsed.Format()
	if err != nil {
		return "", fmt.Errorf("format go.mod: %w", err)
	}
	return string(formatted), nil
}

// VerifySteps implementa securityintel.UpgradeEditor per go.mod.
//
// L'ordine è quello che un utente eseguirebbe a mano: registrare il checksum del
// nuovo modulo (aggiorna go.sum, solo con righe in più), compilare, testare. Ogni
// passo avvia un processo e viene eseguito solo con autorizzazione esplicita; in
// modalità offline Go non scarica nulla (GOPROXY=off).
func (*Adapter) VerifySteps(target securityintel.Target, component securityintel.Component, targetVersion string, options securityintel.ResolveOptions) []securityintel.VerifyStep {
	executable := findGo()
	environment := []string{}
	if options.Offline {
		environment = append(environment, "GOPROXY=off")
	}
	return []securityintel.VerifyStep{
		{
			ID:              "checksums",
			Label:           "Record the new module checksums",
			Command:         "go mod download " + component.Name,
			Program:         executable,
			Args:            []string{"mod", "download", component.Name},
			Dir:             target.Root,
			Env:             environment,
			RequiresProcess: true,
		},
		{
			ID:              "build",
			Label:           "Compile",
			Command:         "go build ./...",
			Program:         executable,
			Args:            []string{"build", "./..."},
			Dir:             target.Root,
			Env:             environment,
			RequiresProcess: true,
		},
		{
			ID:              "test",
			Label:           "Run tests",
			Command:         "go test ./...",
			Program:         executable,
			Args:            []string{"test", "./..."},
			Dir:             target.Root,
			Env:             environment,
			RequiresProcess: true,
		},
	}
}

// findGo cerca l'eseguibile Go nel PATH.
func findGo() string {
	name := "go"
	if runtime.GOOS == "windows" {
		name = "go.exe"
	}
	if candidate, err := exec.LookPath(name); err == nil {
		return candidate
	}
	return ""
}
