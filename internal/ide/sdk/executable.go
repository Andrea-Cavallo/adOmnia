package sdk

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/process"
)

// ResolveExecutable risolve candidate (nome nel PATH o percorso) in un file eseguibile assoluto.
// label nomina lo strumento nei messaggi d'errore (es. "Go" → "binario Go non trovato").
func ResolveExecutable(candidate, label string) (string, error) {
	resolved, err := exec.LookPath(strings.TrimSpace(candidate))
	if err != nil {
		return "", fmt.Errorf("binario %s non trovato: %w", label, err)
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("percorso del binario %s non valido: %w", label, err)
	}
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("il percorso %s configurato non è un eseguibile valido", label)
	}
	return abs, nil
}

// BinaryStamp identifica un binario senza eseguirlo (dimensione e data): cambia se viene sostituito.
func BinaryStamp(binary string) string {
	info, err := os.Stat(binary)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())
}

const maxQueryOutput = 64 * 1024

// Query esegue un comando informativo dell'SDK (es. "go version") e ne restituisce l'output, al più 64 KiB.
// environment si aggiunge a quello del sistema; label nomina l'SDK nei messaggi d'errore.
func Query(ctx context.Context, label, binary, workingDirectory string, environment map[string]string, arguments ...string) (string, error) {
	command := exec.CommandContext(ctx, binary, arguments...)
	command.Dir = workingDirectory
	command.Env = os.Environ()
	for key, value := range environment {
		command.Env = append(command.Env, key+"="+value)
	}
	process.Configure(command, false)
	output, err := command.CombinedOutput()
	if len(output) > maxQueryOutput {
		output = output[:maxQueryOutput]
	}
	if ctx.Err() != nil {
		return "", fmt.Errorf("rilevamento %s scaduto", label)
	}
	if err != nil {
		return "", fmt.Errorf("rilevamento %s fallito: %s", label, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
