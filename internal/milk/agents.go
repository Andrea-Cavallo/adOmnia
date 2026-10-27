package milk

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/jsonutil"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	{ID: "mimo", Label: "Xiaomi MiMo", EnvVars: []string{"MIMO_API_KEY", "XIAOMI_MIMO_API_KEY"}, URL: "https://api.xiaomimimo.com", Model: "mimo-v2.6-flash"},
	{ID: "moonshot", Label: "Moonshot Kimi", EnvVars: []string{"MOONSHOT_API_KEY", "KIMI_API_KEY"}, URL: "https://api.moonshot.ai", Model: "kimi-k2-0905-preview"},
	{ID: "zai", Label: "Z.ai GLM", EnvVars: []string{"ZAI_API_KEY", "ZHIPU_API_KEY"}, URL: "https://api.z.ai/api/paas/v4", Model: "glm-4.6", ChatPath: "/chat/completions"},
	{ID: "xai", Label: "xAI Grok", EnvVars: []string{"XAI_API_KEY"}, URL: "https://api.x.ai", Model: "grok-4"},
	{ID: "qwen", Label: "Alibaba Qwen", EnvVars: []string{"DASHSCOPE_API_KEY", "QWEN_API_KEY"}, URL: "https://dashscope-intl.aliyuncs.com/compatible-mode", Model: "qwen-plus"},
	{ID: "together", Label: "Together AI", EnvVars: []string{"TOGETHER_API_KEY"}, URL: "https://api.together.xyz", Model: "meta-llama/Llama-3.3-70B-Instruct-Turbo"},
	{ID: "cerebras", Label: "Cerebras", EnvVars: []string{"CEREBRAS_API_KEY"}, URL: "https://api.cerebras.ai", Model: "llama-3.3-70b"},
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
	Agents     []AgentStatus    `json:"agents"`
	Warnings   []string         `json:"warnings"`
}

// AgentStatus dice se un agente del config di milk può autenticarsi: un agente il cui token_cmd legge una
// variabile d'ambiente che adOmnia non vede risponde con errori, e va segnalato prima di sceglierlo.
type AgentStatus struct {
	Name          string `json:"name"`
	Model         string `json:"model"`
	Usable        bool   `json:"usable"`
	MissingEnvVar string `json:"missingEnvVar,omitempty"`
}

// tokenVariable trova la variabile letta da un token_cmd: $NAME (sh) o %NAME% (cmd).
var tokenVariable = regexp.MustCompile(`\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%`)

// credentialVariable è la variabile da cui l'agente legge la chiave; vuota se non ne usa una (modelli locali,
// claude-cli, comandi che non leggono l'ambiente).
func credentialVariable(entry map[string]any) string {
	command, _ := entry["token_cmd"].(string)
	match := tokenVariable.FindStringSubmatch(command)
	if match == nil {
		return ""
	}
	return match[1] + match[2]
}

func agentStatuses(config map[string]any) []AgentStatus {
	agents, _ := config["agents"].([]any)
	statuses := make([]AgentStatus, 0, len(agents))
	for _, item := range agents {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := entry["name"].(string)
		if name == "" {
			continue
		}
		model, _ := entry["model"].(string)
		status := AgentStatus{Name: name, Model: model, Usable: true}
		if variable := credentialVariable(entry); variable != "" && strings.TrimSpace(os.Getenv(variable)) == "" {
			status.Usable, status.MissingEnvVar = false, variable
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func missingKeyMessage(status AgentStatus) string {
	return fmt.Sprintf("%s reads %s, which adOmnia does not see", status.Name, status.MissingEnvVar)
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
	if truthyEnvironment(os.Getenv("CLAUDE_CODE_USE_BEDROCK")) {
		info.Warnings = append(info.Warnings, "AWS Bedrock is not supported by milk; use Claude Code for this provider.")
	}
	info.Primary, _ = config["agent"].(string)
	info.Escalation, _ = config["escalation_agent"].(string)
	info.Agents = agentStatuses(config)
	for _, role := range []struct{ label, agent string }{{"primary", info.Primary}, {"escalation", info.Escalation}} {
		for _, status := range info.Agents {
			if status.Name == role.agent && !status.Usable {
				info.Warnings = append(info.Warnings, fmt.Sprintf("The %s agent %s: its answers will fail. Choose another model below, or set the variable and restart adOmnia.", role.label, missingKeyMessage(status)))
			}
		}
	}
	for _, provider := range Providers {
		envVar, detected := provider.envVar()
		info.Providers = append(info.Providers, ProviderStatus{
			ID: provider.ID, Label: provider.Label, EnvVar: envVar, Model: provider.Model,
			Detected: detected, Configured: names[provider.ID],
		})
	}
	return info, nil
}

func truthyEnvironment(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value != "" && value != "0" && value != "false"
}

// UseProvider aggiunge (se manca) l'agente del provider al config di milk e lo
// assegna al ruolo "primary" o "escalation". Gli altri campi del config restano
// intatti. Il primo valore dice se il config è cambiato: solo allora milk va
// riavviato, perché i ruoli valgono dal prossimo avvio del processo.
func UseProvider(id, role string) (bool, error) {
	var provider *Provider
	for index := range Providers {
		if Providers[index].ID == id {
			provider = &Providers[index]
		}
	}
	if provider == nil {
		return false, fmt.Errorf("unknown provider %q", id)
	}
	roleKey := map[string]string{"primary": "agent", "escalation": "escalation_agent"}[role]
	if roleKey == "" {
		return false, fmt.Errorf("unknown role %q", role)
	}
	envVar, detected := provider.envVar()
	if !detected {
		return false, fmt.Errorf("%s is not set: set it and restart adOmnia", envVar)
	}
	path, err := ConfigPath()
	if err != nil {
		return false, err
	}
	config, err := readConfig(path)
	if err != nil {
		return false, err
	}
	changed := false
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
		changed = true
	}
	// Un agente già presente può leggere una variabile che qui non c'è (la chiave è sotto un altro nome): lo si ripara.
	if entry := agentEntry(config, provider.ID); entry != nil {
		if variable := credentialVariable(entry); variable != "" && variable != envVar && strings.TrimSpace(os.Getenv(variable)) == "" {
			entry["token_cmd"] = tokenCommand(envVar)
			changed = true
		}
	}
	if current, _ := config[roleKey].(string); current != provider.ID {
		config[roleKey] = provider.ID
		changed = true
	}
	if !changed {
		return false, nil
	}
	return true, writeConfig(path, config)
}

// agentEntry è la voce dell'agente nel config letto (modificabile in place), nil se manca.
func agentEntry(config map[string]any, name string) map[string]any {
	agents, _ := config["agents"].([]any)
	for _, item := range agents {
		if entry, ok := item.(map[string]any); ok && entry["name"] == name {
			return entry
		}
	}
	return nil
}

// writeConfig salva una copia .bak del config precedente e scrive in modo atomico.
func writeConfig(path string, config map[string]any) error {
	data, err := jsonutil.Marshal(config, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("cannot create milk config folder: %w", err)
	}
	if previous, err := os.ReadFile(path); err == nil {
		_ = os.WriteFile(path+".bak", previous, 0o600) // #nosec G703 -- path is the agent config file the user chose to configure
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
