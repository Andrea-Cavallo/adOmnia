package claudecode

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Claude Code legge da sé i suoi settings (l'adapter gli passa user, project e local); adOmnia
// li legge solo per mostrare quale backend verrà usato e perché. Mai i valori dei segreti.

// ConfigFile è un file di settings considerato, in ordine di precedenza crescente.
type ConfigFile struct {
	Scope string `json:"scope"` // user | project | local | managed
	Path  string `json:"path"`
	Found bool   `json:"found"`
	Error string `json:"error,omitempty"`
}

// ConfigVar è una variabile che decide il backend, con la sua origine.
type ConfigVar struct {
	Name   string `json:"name"`
	Value  string `json:"value"` // "set" per i segreti
	Source string `json:"source"`
}

// Config è il quadro che Claude Code vedrà per un progetto.
type Config struct {
	Provider      string       `json:"provider"` // account | api-key | bedrock | vertex | foundry | gateway
	ProviderLabel string       `json:"providerLabel"`
	Model         string       `json:"model,omitempty"`
	Region        string       `json:"region,omitempty"`
	Profile       string       `json:"profile,omitempty"`
	Endpoint      string       `json:"endpoint,omitempty"`
	Helpers       []string     `json:"helpers"`
	Files         []ConfigFile `json:"files"`
	Variables     []ConfigVar  `json:"variables"`
	Warnings      []string     `json:"warnings"`
}

// relevantVars decidono backend, modello e rete. I valori di quelle in safeVars si mostrano.
var relevantVars = []string{
	"CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
	"ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"AWS_REGION", "AWS_PROFILE", "CLOUD_ML_REGION", "ANTHROPIC_VERTEX_PROJECT_ID", "ANTHROPIC_FOUNDRY_RESOURCE",
	"ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL", "ANTHROPIC_FOUNDRY_BASE_URL",
	"CLAUDE_CODE_SKIP_BEDROCK_AUTH", "CLAUDE_CODE_SKIP_VERTEX_AUTH", "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
	"HTTPS_PROXY", "NODE_EXTRA_CA_CERTS",
	"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID", "ANTHROPIC_FOUNDRY_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
}

var secretVars = map[string]bool{"ANTHROPIC_API_KEY": true, "ANTHROPIC_AUTH_TOKEN": true, "AWS_BEARER_TOKEN_BEDROCK": true, "AWS_ACCESS_KEY_ID": true, "ANTHROPIC_FOUNDRY_API_KEY": true, "CLAUDE_CODE_OAUTH_TOKEN": true}

// urlVars possono contenere credenziali (proxy con user:password): se ne mostra solo l'host.
var urlVars = map[string]bool{"ANTHROPIC_BASE_URL": true, "ANTHROPIC_BEDROCK_BASE_URL": true, "ANTHROPIC_VERTEX_BASE_URL": true, "ANTHROPIC_FOUNDRY_BASE_URL": true, "HTTPS_PROXY": true}

// settingsFiles elenca i file nell'ordine in cui si sovrascrivono (l'ultimo vince).
func settingsFiles(root string, getenv func(string) string) []ConfigFile {
	home, _ := os.UserHomeDir()
	userDir := filepath.Join(home, ".claude")
	if dir := strings.TrimSpace(getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		userDir = dir
	}
	files := []ConfigFile{{Scope: "user", Path: filepath.Join(userDir, "settings.json")}}
	if root != "" {
		files = append(files,
			ConfigFile{Scope: "project", Path: filepath.Join(root, ".claude", "settings.json")},
			ConfigFile{Scope: "local", Path: filepath.Join(root, ".claude", "settings.local.json")})
	}
	for _, path := range managedPaths() {
		files = append(files, ConfigFile{Scope: "managed", Path: path})
	}
	return files
}

// managedPaths: i settings imposti dall'azienda, sopra a tutto il resto.
func managedPaths() []string {
	switch runtime.GOOS {
	case "windows":
		return []string{`C:\Program Files\ClaudeCode\managed-settings.json`, `C:\ProgramData\ClaudeCode\managed-settings.json`}
	case "darwin":
		return []string{"/Library/Application Support/ClaudeCode/managed-settings.json"}
	default:
		return []string{"/etc/claude-code/managed-settings.json"}
	}
}

type settingsFile struct {
	Env                 map[string]any `json:"env"`
	Model               string         `json:"model"`
	APIKeyHelper        string         `json:"apiKeyHelper"`
	AWSAuthRefresh      string         `json:"awsAuthRefresh"`
	AWSCredentialExport string         `json:"awsCredentialExport"`
}

// Inspect ricostruisce cosa vedrà Claude Code nel progetto root, dato l'ambiente con cui
// adOmnia lo avvia (ignoreAPIKey toglie ANTHROPIC_API_KEY come fa resolve).
func Inspect(root string, ignoreAPIKey bool) Config {
	return inspect(root, ignoreAPIKey, os.Getenv)
}

func inspect(root string, ignoreAPIKey bool, getenv func(string) string) Config {
	config := Config{Helpers: []string{}, Variables: []ConfigVar{}, Warnings: []string{}}
	values, sources := map[string]string{}, map[string]string{}
	for _, name := range relevantVars {
		if value := strings.TrimSpace(getenv(name)); value != "" && !(ignoreAPIKey && name == apiKeyVar) {
			values[name], sources[name] = value, "environment"
		}
	}
	helpers := map[string]bool{}
	for _, file := range settingsFiles(root, getenv) {
		data, err := os.ReadFile(file.Path)
		if errors.Is(err, os.ErrNotExist) {
			config.Files = append(config.Files, file)
			continue
		}
		file.Found = true
		var parsed settingsFile
		if err == nil {
			err = json.Unmarshal(data, &parsed)
		}
		if err != nil {
			file.Error = err.Error()
			config.Warnings = append(config.Warnings, file.Path+" is not valid JSON: Claude Code ignores it")
			config.Files = append(config.Files, file)
			continue
		}
		config.Files = append(config.Files, file)
		label := file.Scope + " settings"
		for name, raw := range parsed.Env {
			value := strings.TrimSpace(stringValue(raw))
			if value == "" {
				continue
			}
			values[name], sources[name] = value, label
			if name == apiKeyVar && ignoreAPIKey {
				config.Warnings = append(config.Warnings, "ANTHROPIC_API_KEY is set in "+file.Path+": \"ignore ANTHROPIC_API_KEY\" only removes the environment variable, Claude Code still uses this one")
			}
		}
		if parsed.Model != "" {
			config.Model = parsed.Model + " (" + label + ")"
		}
		for name, value := range map[string]string{"apiKeyHelper": parsed.APIKeyHelper, "awsAuthRefresh": parsed.AWSAuthRefresh, "awsCredentialExport": parsed.AWSCredentialExport} {
			if value != "" {
				helpers[name+" ("+label+")"] = true
			}
		}
	}
	for helper := range helpers {
		config.Helpers = append(config.Helpers, helper)
	}
	sort.Strings(config.Helpers)
	for _, name := range relevantVars {
		value, ok := values[name]
		if !ok {
			continue
		}
		shown := value
		switch {
		case secretVars[name]:
			shown = "set"
		case urlVars[name]:
			shown = hostOf(value)
		}
		config.Variables = append(config.Variables, ConfigVar{Name: name, Value: shown, Source: sources[name]})
	}
	if model := values["ANTHROPIC_MODEL"]; model != "" {
		config.Model = model + " (" + sources["ANTHROPIC_MODEL"] + ")"
	}
	classify(&config, values, len(helpers) > 0)
	return config
}

func truthy(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value != "" && value != "0" && value != "false"
}

func classify(config *Config, values map[string]string, hasHelper bool) {
	switch {
	case truthy(values["CLAUDE_CODE_USE_BEDROCK"]):
		config.Provider, config.ProviderLabel = "bedrock", "AWS Bedrock"
		config.Region, config.Profile = values["AWS_REGION"], values["AWS_PROFILE"]
		config.Endpoint = hostOf(values["ANTHROPIC_BEDROCK_BASE_URL"])
		if config.Region == "" {
			config.Warnings = append(config.Warnings, "Bedrock needs AWS_REGION (in the env block of a settings file or in the environment)")
		}
	case truthy(values["CLAUDE_CODE_USE_VERTEX"]):
		config.Provider, config.ProviderLabel = "vertex", "Google Vertex AI"
		config.Region = values["CLOUD_ML_REGION"]
		config.Endpoint = hostOf(values["ANTHROPIC_VERTEX_BASE_URL"])
		if config.Region == "" || values["ANTHROPIC_VERTEX_PROJECT_ID"] == "" {
			config.Warnings = append(config.Warnings, "Vertex AI needs CLOUD_ML_REGION and ANTHROPIC_VERTEX_PROJECT_ID")
		}
	case truthy(values["CLAUDE_CODE_USE_FOUNDRY"]):
		config.Provider, config.ProviderLabel = "foundry", "Azure AI Foundry"
		config.Endpoint = hostOf(values["ANTHROPIC_FOUNDRY_BASE_URL"])
		if config.Endpoint == "" && values["ANTHROPIC_FOUNDRY_RESOURCE"] == "" {
			config.Warnings = append(config.Warnings, "Azure AI Foundry needs ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL")
		}
	case values["ANTHROPIC_BASE_URL"] != "":
		config.Provider, config.ProviderLabel = "gateway", "LLM gateway"
		config.Endpoint = hostOf(values["ANTHROPIC_BASE_URL"])
	case values[apiKeyVar] != "" || values["ANTHROPIC_AUTH_TOKEN"] != "" || hasHelper:
		config.Provider, config.ProviderLabel = "api-key", "Anthropic API key"
	default:
		config.Provider, config.ProviderLabel = "account", "Claude account (claude login)"
	}
}

func stringValue(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	case bool:
		if value {
			return "1"
		}
		return "0"
	case float64:
		data, _ := json.Marshal(value)
		return string(data)
	}
	return ""
}

// hostOf mostra solo schema e host: niente utente, password, path o query.
func hostOf(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "set"
	}
	return parsed.Scheme + "://" + parsed.Host
}

// adapterEnvVars sono le variabili che l'adapter ACP legge dal proprio processo e non dai
// settings: ANTHROPIC_MODEL nel blocco env di settings.json raggiunge la CLI ma non la scelta
// del modello dell'adapter, che resterebbe sul default (verificato con Bedrock, adapter 0.89.1).
var adapterEnvVars = []string{"ANTHROPIC_MODEL", "ANTHROPIC_CUSTOM_MODEL_OPTION"}

// liftedEnv restituisce i valori di adapterEnvVars dai blocchi env dei settings del progetto,
// con la precedenza di Claude Code (managed > local > project > user > ambiente).
func liftedEnv(root string, getenv func(string) string) map[string]string {
	lifted := map[string]string{}
	for _, file := range settingsFiles(root, getenv) {
		data, err := os.ReadFile(file.Path)
		if err != nil {
			continue
		}
		var parsed settingsFile
		if json.Unmarshal(data, &parsed) != nil {
			continue
		}
		for _, name := range adapterEnvVars {
			if value := strings.TrimSpace(stringValue(parsed.Env[name])); value != "" {
				lifted[name] = value
			}
		}
	}
	return lifted
}
