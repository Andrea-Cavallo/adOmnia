package copilot

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// AIPolicyFile è versionabile con il progetto: decide quali provider AI possono vedere il codice.
const AIPolicyFile = ".adomnia/ai-policy.json"

// Politiche AI per progetto.
const (
	// AIPolicyAllowed: qualsiasi provider configurato (i segreti e aiignore restano esclusi).
	AIPolicyAllowed = "allowed"
	// AIPolicyLocalOnly: solo modelli che girano su questa macchina (Ollama o un endpoint su localhost).
	AIPolicyLocalOnly = "local-only"
	// AIPolicyOff: nessun file del progetto va a un provider AI.
	AIPolicyOff = "off"
)

type aiPolicyDocument struct {
	Format string `json:"format"`
	AI     string `json:"ai"`
}

// LoadAIPolicy legge la politica del progetto; file assente o illeggibile vale "allowed",
// tranne un valore sconosciuto, che per prudenza vale "off".
func LoadAIPolicy(root string) string {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(AIPolicyFile)))
	if err != nil {
		return AIPolicyAllowed
	}
	var document aiPolicyDocument
	if json.Unmarshal(data, &document) != nil {
		return AIPolicyOff
	}
	switch document.AI {
	case AIPolicyAllowed, AIPolicyLocalOnly, AIPolicyOff:
		return document.AI
	}
	return AIPolicyOff
}

// SaveAIPolicy scrive la politica; "allowed" rimuove il file, così il progetto torna al default.
func SaveAIPolicy(root, policy string) error {
	path := filepath.Join(root, filepath.FromSlash(AIPolicyFile))
	switch policy {
	case AIPolicyAllowed:
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	case AIPolicyLocalOnly, AIPolicyOff:
	default:
		return fmt.Errorf("politica AI non valida: %q", policy)
	}
	data, err := json.MarshalIndent(aiPolicyDocument{Format: "adomnia-ai-policy", AI: policy}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// PolicyAllows dice se la politica permette di inviare codice a un provider locale o cloud.
func PolicyAllows(policy string, localProvider bool) bool {
	switch policy {
	case AIPolicyAllowed:
		return true
	case AIPolicyLocalOnly:
		return localProvider
	}
	return false
}
