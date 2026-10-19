// Package strix integra Strix (https://github.com/usestrix/strix), il pentest autonomo basato su agenti AI, nel
// Security Center di adOmnia.
//
// Regole che questo pacchetto fa rispettare:
//   - il progetto non viene mai toccato: Strix monta la cartella target in scrittura e lascia modificare i file,
//     quindi la scansione gira su una copia privata (snapshot.go);
//   - nessun URL o host remoto come target: si analizza solo codice del progetto locale;
//   - il codice parte verso il provider LLM scelto dall'utente: il consenso è un'azione esplicita del chiamante;
//   - le chiavi passano solo nell'ambiente del processo figlio, mai su disco né nei log.
package strix

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Modalità di scansione di Strix.
const (
	ModeQuick    = "quick"
	ModeStandard = "standard"
	ModeDeep     = "deep"
)

const (
	maxInstructionBytes = 4000
	maxBudgetUSD        = 1000
)

// Options è ciò che l'utente sceglie per una scansione.
type Options struct {
	// Root è la cartella del progetto da analizzare (sola lettura: si scansiona una copia).
	Root string `json:"root"`
	// Mode: quick, standard o deep. Vuoto: quick.
	Mode string `json:"mode,omitempty"`
	// MaxBudget è il tetto di spesa LLM in dollari; 0 = nessun limite (sconsigliato).
	MaxBudget float64 `json:"maxBudget,omitempty"`
	// Instruction guida il test (aree da privilegiare). Opzionale.
	Instruction string `json:"instruction,omitempty"`
}

// Validate normalizza le opzioni e rifiuta quelle non sicure.
func (o Options) Validate() (Options, error) {
	root := strings.TrimSpace(o.Root)
	if root == "" {
		return o, fmt.Errorf("select the project folder to scan")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return o, fmt.Errorf("project folder: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return o, fmt.Errorf("project folder %q does not exist", root)
	}
	o.Root = abs
	switch o.Mode {
	case "":
		o.Mode = ModeQuick
	case ModeQuick, ModeStandard, ModeDeep:
	default:
		return o, fmt.Errorf("unknown scan mode %q", o.Mode)
	}
	if o.MaxBudget < 0 || o.MaxBudget > maxBudgetUSD {
		return o, fmt.Errorf("budget must be between 0 and %d USD", maxBudgetUSD)
	}
	o.Instruction = strings.TrimSpace(o.Instruction)
	if len(o.Instruction) > maxInstructionBytes {
		return o, fmt.Errorf("instruction is longer than %d characters", maxInstructionBytes)
	}
	return o, nil
}

// Arguments è la riga di comando headless (`-n`) su target, la copia del progetto.
func (o Options) Arguments(target string) []string {
	args := []string{"-n", "--target", target, "--scan-mode", o.Mode}
	if o.MaxBudget > 0 {
		args = append(args, "--max-budget", strconv.FormatFloat(o.MaxBudget, 'f', -1, 64))
	}
	if o.Instruction != "" {
		args = append(args, "--instruction", o.Instruction)
	}
	return args
}

// LLM è il modello con cui Strix lavora, in formato LiteLLM.
type LLM struct {
	// Model è l'id LiteLLM (`anthropic/claude-…`, `openai/gpt-…`).
	Model string
	// APIKey può essere vuota per modelli locali o autenticazione del cloud (Bedrock).
	APIKey string
	// BaseURL è l'endpoint personalizzato (Ollama, gateway compatibili OpenAI).
	BaseURL string
}

// Environment sono le variabili che Strix legge per l'LLM. Si aggiungono all'ambiente ereditato.
func (l LLM) Environment() []string {
	env := []string{"STRIX_LLM=" + l.Model, "STRIX_TELEMETRY=0"}
	if l.APIKey != "" {
		env = append(env, "LLM_API_KEY="+l.APIKey)
	}
	if l.BaseURL != "" {
		env = append(env, "LLM_API_BASE="+l.BaseURL)
	}
	return env
}

// litellmPrefix mappa i provider di adOmnia sul prefisso LiteLLM.
var litellmPrefix = map[string]string{
	"anthropic":         "anthropic",
	"openai":            "openai",
	"gemini":            "gemini",
	"deepseek":          "deepseek",
	"ollama":            "ollama",
	"huggingface":       "huggingface",
	"openai-compatible": "openai",
	"amazon-bedrock":    "bedrock",
}

// LLMFromProvider traduce provider, modello e credenziali di adOmnia nel formato di Strix.
// Un modello già scritto come `provider/modello` (OpenRouter, LiteLLM) resta com'è.
func LLMFromProvider(provider, model, apiKey, baseURL string) (LLM, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return LLM{}, fmt.Errorf("no AI model configured: choose one in Settings → AI")
	}
	prefix, known := litellmPrefix[provider]
	if !known {
		return LLM{}, fmt.Errorf("provider %q cannot be used by Strix: pick a custom LiteLLM model id", provider)
	}
	if !strings.HasPrefix(model, prefix+"/") {
		model = prefix + "/" + model
	}
	return LLM{Model: model, APIKey: strings.TrimSpace(apiKey), BaseURL: strings.TrimSpace(baseURL)}, nil
}
