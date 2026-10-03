package golang

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"adomnia/internal/ide/process"
	"adomnia/internal/ide/sdk"
)

// DelveModule è il modulo che `go install` usa per installare Delve nella cartella strumenti.
const DelveModule = "github.com/go-delve/delve/cmd/dlv@latest"

// DelveInfo descrive il binario dlv trovato per la sessione.
type DelveInfo struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Version   string `json:"version,omitempty"`
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

// LocateDelve individua dlv (personalizzato, cartella strumenti, GOPATH/bin, PATH) e ne legge la versione.
func LocateDelve(custom, toolsRoot, gopath string) DelveInfo {
	located, found := sdk.Locate(ToolSearch([]string{"dlv"}, custom, toolsRoot, gopath).Candidates(),
		"il binario dlv configurato non esiste", func(candidate sdk.ToolCandidate) (string, error) { return delveVersion(candidate.Binary) })
	if !found {
		return DelveInfo{Error: "Delve (dlv) non trovato: installalo da Go → Install Delve oppure indica un binario personalizzato"}
	}
	return DelveInfo{Available: located.Available, Binary: located.Binary, Version: located.Version, Source: located.Source, Error: located.Error}
}

func delveVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), sdk.VersionTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "version")
	process.Configure(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("dlv non risponde a 'dlv version'")
	}
	if err != nil {
		return "", fmt.Errorf("dlv non eseguibile: %s", strings.TrimSpace(string(output)))
	}
	for _, line := range strings.Split(string(output), "\n") {
		if version, ok := strings.CutPrefix(strings.TrimSpace(line), "Version:"); ok {
			return strings.TrimSpace(version), nil
		}
	}
	return "", fmt.Errorf("versione di dlv non riconosciuta")
}
