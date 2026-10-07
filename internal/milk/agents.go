package milk

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Provider è un servizio OpenAI-compatibile che milk può usare come agente
// leggendo la chiave da una variabile d'ambiente già impostata dall'utente.
type Provider struct {
	ID       string
	Label    string
	EnvVars  []string // la prima impostata vince
	URL      string
	Model    string
	ChatPath string
}

// Providers sono i servizi riconosciuti dall'env. Il modello è solo il default:
// l'utente può cambiarlo nel config di milk e adOmnia non lo sovrascrive più.
var Providers = []Provider{
	{ID: "deepseek", Label: "DeepSeek", EnvVars: []string{"DEEPSEEK_API_KEY"}, URL: "https://api.deepseek.com", Model: "deepseek-chat"},
	{ID: "openai", Label: "OpenAI", EnvVars: []string{"OPENAI_API_KEY"}, URL: "https://api.openai.com", Model: "gpt-4.1-mini"},
	{ID: "gemini", Label: "Google Gemini", EnvVars: []string{"GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"}, URL: "https://generativelanguage.googleapis.com/v1beta/openai", Model: "gemini-2.5-flash", ChatPath: "/chat/completions"},
	{ID: "openrouter", Label: "OpenRouter", EnvVars: []string{"OPENROUTER_API_KEY"}, URL: "https://openrouter.ai/api", Model: "deepseek/deepseek-chat"},
	{ID: "groq", Label: "Groq", EnvVars: []string{"GROQ_API_KEY"}, URL: "https://api.groq.com/openai", Model: "llama-3.3-70b-versatile"},
	{ID: "mistral", Label: "Mistral", EnvVars: []string{"MISTRAL_API_KEY"}, URL: "https://api.mistral.ai", Model: "mistral-small-latest"},
}

// ProviderStatus descrive un provider per la UI: mai il valore della chiave, solo il nome della variabile.
type ProviderStatus struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	EnvVar     string `json:"envVar"`
	Model      string `json:"model"`
	Detected   bool   `json:"detected"`
	Configured bool   `json:"configured"`
}

// AgentsInfo è lo stato degli agenti di milk visto da adOmnia.
type AgentsInfo struct {
	ConfigPath string           `json:"configPath"`
	Primary    string           `json:"primary"`
	Escalation string           `json:"escalation"`
	Providers  []ProviderStatus `json:"providers"`
}

// ConfigPath è il config globale di milk (~/.milk/config.json).
func ConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot find the home folder: %w", err)
	}
	return filepath.Join(home, ".milk", "config.json"), nil
}

func (p Provider) envVar() (string, bool) {
	for _, name := range p.EnvVars {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return name, true
		}
	}
	return p.EnvVars[0], false
}

// tokenCommand legge la chiave dall'env a ogni avvio di milk: la chiave non finisce mai su file.
// ponytail: milk esegue token_cmd con sh -c se c'è sh nel PATH (Git Bash su Windows), altrimenti cmd /C.
func tokenCommand(envVar string) string {
	if _, err := exec.LookPath("sh"); err == nil {
		return `printf %s "$` + envVar + `"`
	}
	return "echo %" + envVar + "%"
}

func readConfig(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot read milk config: %w", err)
	}
	config := map[string]any{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("milk config %s is not valid JSON: %w", path, err)
	}
	return config, nil
}

func agentNames(config map[string]any) map[string]bool {
	names := map[string]bool{}
	agents, _ := config["agents"].([]any)
	for _, agent := range agents {
		if entry, ok := agent.(map[string]any); ok {
			if name, ok := entry["name"].(string); ok {
				names[name] = true
			}
		}
	}
	return names
}

// Agents legge il config di milk e rileva i provider con una chiave nell'env.
func Agents() (AgentsInfo, error) {
	path, err := ConfigPath()
	if err != nil {
		return AgentsInfo{}, err
	}
	config, err := readConfig(path)
	if err != nil {
		return AgentsInfo{}, err
	}
	names := agentNames(config)
	info := AgentsInfo{ConfigPath: path}
	info.Primary, _ = config["agent"].(string)
	info.Escalation, _ = config["escalation_agent"].(string)
	for _, provider := range Providers {
		envVar, detected := provider.envVar()
		info.Providers = append(info.Providers, ProviderStatus{
			ID: provider.ID, Label: provider.Label, EnvVar: envVar, Model: provider.Model,
			Detected: detected, Configured: names[provider.ID],
		})
	}
	return info, nil
}

// UseProvider aggiunge (se manca) l'agente del provider al config di milk e lo
// assegna al ruolo "primary" o "escalation". Gli altri campi del config restano intatti.
func UseProvider(id, role string) error {
	var provider *Provider
	for index := range Providers {
		if Providers[index].ID == id {
			provider = &Providers[index]
		}
	}
	if provider == nil {
		return fmt.Errorf("unknown provider %q", id)
	}
	roleKey := map[string]string{"primary": "agent", "escalation": "escalation_agent"}[role]
	if roleKey == "" {
		return fmt.Errorf("unknown role %q", role)
	}
	envVar, detected := provider.envVar()
	if !detected {
		return fmt.Errorf("%s is not set: set it and restart adOmnia", envVar)
	}
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	config, err := readConfig(path)
	if err != nil {
		return err
	}
	if !agentNames(config)[provider.ID] {
		agent := map[string]any{
			"name": provider.ID, "provider": "bearer", "url": provider.URL, "model": provider.Model,
			"token_cmd": tokenCommand(envVar),
		}
		if provider.ChatPath != "" {
			agent["chat_path"] = provider.ChatPath
		}
		agents, _ := config["agents"].([]any)
		config["agents"] = append(agents, agent)
	}
	config[roleKey] = provider.ID
	return writeConfig(path, config)
}

// writeConfig salva una copia .bak del config precedente e scrive in modo atomico.
func writeConfig(path string, config map[string]any) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("cannot create milk config folder: %w", err)
	}
	if previous, err := os.ReadFile(path); err == nil {
		_ = os.WriteFile(path+".bak", previous, 0o600)
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return fmt.Errorf("cannot write milk config: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("cannot save milk config: %w", err)
	}
	return nil
}
