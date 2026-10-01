package ai

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Provider string

const (
	ProviderAnthropic        Provider = "anthropic"
	ProviderAmazonBedrock    Provider = "amazon-bedrock"
	ProviderOpenAI           Provider = "openai"
	ProviderGemini           Provider = "gemini"
	ProviderDeepSeek         Provider = "deepseek"
	ProviderOllama           Provider = "ollama"
	ProviderHuggingFace      Provider = "huggingface"
	ProviderOpenAICompatible Provider = "openai-compatible"
)

type Config struct {
	Provider       Provider       `json:"provider"`
	Model          string         `json:"model"`
	APIKey         string         `json:"apiKey"`
	BaseURL        string         `json:"baseURL"`
	CredentialMode CredentialMode `json:"credentialMode,omitempty"`
	AWSRegion      string         `json:"awsRegion,omitempty"`
	AWSProfile     string         `json:"awsProfile,omitempty"`
	// WorkspaceDir optionally names the project whose .claude/settings*.json
	// files apply. Empty means the process working directory.
	WorkspaceDir string `json:"workspaceDir,omitempty"`

	// Backend-only values resolved from the environment or Claude Code
	// settings. They are never decoded from, or encoded to, the renderer.
	AuthToken string                                `json:"-"`
	headers   http.Header                           // ANTHROPIC_CUSTOM_HEADERS
	proxy     func(*http.Request) (*url.URL, error) // layered HTTP(S)_PROXY/NO_PROXY
}

type CredentialMode string

const (
	// CredentialModeAuto keeps environment credentials in the Go process and
	// falls back to a renderer-provided Vault credential only when none exists.
	CredentialModeAuto        CredentialMode = "auto"
	CredentialModeVault       CredentialMode = "vault"
	CredentialModeEnvironment CredentialMode = "environment"
)

type CompletionRequest struct {
	SystemPrompt string `json:"systemPrompt"`
	UserPrompt   string `json:"userPrompt"`
	MaxTokens    int    `json:"maxTokens"`
}

type CompletionResponse struct {
	Text         string `json:"text"`
	InputTokens  int    `json:"inputTokens"`
	OutputTokens int    `json:"outputTokens"`
}

type AIProvider interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
	Name() string
}

type Engine struct {
	cfg      Config
	provider AIProvider
}

func New(cfg Config) (*Engine, error) {
	var err error
	cfg, err = ResolveEnvironmentCredentials(cfg)
	if err != nil {
		return nil, err
	}
	p, err := buildProvider(cfg)
	if err != nil {
		return nil, err
	}
	return &Engine{cfg: cfg, provider: p}, nil
}

// ResolveEnvironmentCredentials uses a narrow credential chain: inherited
// process variables, a provider-specific adOmnia Environment hint supplied by
// the renderer, then standard dotenv files in the working directory or one of
// its parents. Values never travel back to the renderer.
//
// For Anthropic and Bedrock, Claude Code settings files (see claudecode.go)
// also supply base URL, model default, custom headers, proxy and — after the
// process environment and the adOmnia Environment hint — the API key or
// ANTHROPIC_AUTH_TOKEN.
func ResolveEnvironmentCredentials(cfg Config) (Config, error) {
	var claude ClaudeCodeSettings
	if cfg.Provider == ProviderAnthropic || cfg.Provider == ProviderAmazonBedrock {
		claude = LoadClaudeCodeSettings(claudeWorkspaceDir(cfg.WorkspaceDir))
	}
	// Bedrock authentication is intentionally delegated to the AWS SDK default
	// credential chain (environment, shared profiles/SSO, web identity and
	// workload roles). adOmnia never reads or stores the resolved AWS secrets.
	if cfg.Provider == ProviderAmazonBedrock {
		return applyClaudeBedrock(cfg, claude), nil
	}
	if cfg.Provider == ProviderAnthropic {
		cfg = applyClaudeAnthropic(cfg, claude)
	}
	mode := cfg.CredentialMode
	if mode == "" {
		mode = CredentialModeAuto
	}
	if mode == CredentialModeVault {
		return cfg, nil
	}

	keys := environmentKeys(cfg.Provider)
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			cfg.APIKey = value
			return cfg, nil
		}
	}
	if cfg.Provider == ProviderAnthropic {
		if value := strings.TrimSpace(os.Getenv("ANTHROPIC_AUTH_TOKEN")); value != "" {
			return withAnthropicAuthToken(cfg, value), nil
		}
	}
	// The renderer supplies at most one exact provider key from the active or
	// saved adOmnia Environments. It is ephemeral and is never written to AI
	// settings by the backend.
	if value := strings.TrimSpace(cfg.APIKey); mode == CredentialModeAuto && value != "" {
		cfg.APIKey = value
		return cfg, nil
	}
	if cfg.Provider == ProviderAnthropic {
		if value, _ := claude.fileLookup("ANTHROPIC_API_KEY"); value != "" {
			cfg.APIKey = value
			return cfg, nil
		}
		if value, _ := claude.fileLookup("ANTHROPIC_AUTH_TOKEN"); value != "" {
			return withAnthropicAuthToken(cfg, value), nil
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		if value, _ := resolveDotEnvCredential(cwd, keys); value != "" {
			cfg.APIKey = value
			return cfg, nil
		}
	}

	if mode == CredentialModeAuto && cfg.Provider != ProviderOllama {
		return cfg, missingCredentialError(cfg.Provider, keys)
	}

	if requiresAPIKey(cfg.Provider) {
		return cfg, missingCredentialError(cfg.Provider, keys)
	}
	// Ollama and OpenAI-compatible runtimes can be unauthenticated.
	cfg.APIKey = ""
	return cfg, nil
}

func missingCredentialError(provider Provider, keys []string) error {
	if provider == ProviderAnthropic {
		return fmt.Errorf("AI environment credential is missing: set %s (or ANTHROPIC_AUTH_TOKEN, also via Claude Code settings \"env\") and restart adOmnia", strings.Join(keys, " or "))
	}
	return fmt.Errorf("AI environment credential is missing: set %s and restart adOmnia", strings.Join(keys, " or "))
}

func withAnthropicAuthToken(cfg Config, token string) Config {
	cfg.APIKey = ""
	cfg.AuthToken = token
	return cfg
}

// applyClaudeAnthropic fills non-credential Anthropic settings from Claude
// Code. Explicit adOmnia values (BaseURL, Model) always win.
func applyClaudeAnthropic(cfg Config, claude ClaudeCodeSettings) Config {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		cfg.BaseURL, _ = claude.Lookup("ANTHROPIC_BASE_URL")
	}
	// With CLAUDE_CODE_USE_BEDROCK, ANTHROPIC_MODEL is a Bedrock model ID.
	if strings.TrimSpace(cfg.Model) == "" && !claude.UsesBedrock() {
		cfg.Model = claude.Model()
	}
	cfg.headers = claude.CustomHeaders()
	cfg.proxy = claude.ProxyFunc()
	return cfg
}

// applyClaudeBedrock fills Bedrock region/profile/model/endpoint from Claude
// Code files. Region and profile are taken only from files: process values
// are already honoured by the AWS SDK chain itself.
func applyClaudeBedrock(cfg Config, claude ClaudeCodeSettings) Config {
	if strings.TrimSpace(cfg.AWSRegion) == "" {
		if value, scope := claude.Lookup("AWS_REGION"); scope != ClaudeScopeProcess {
			cfg.AWSRegion = value
		}
	}
	if strings.TrimSpace(cfg.AWSProfile) == "" {
		if value, scope := claude.Lookup("AWS_PROFILE"); scope != ClaudeScopeProcess {
			cfg.AWSProfile = value
		}
	}
	if strings.TrimSpace(cfg.Model) == "" && claude.UsesBedrock() {
		cfg.Model = claude.Model()
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		cfg.BaseURL, _ = claude.Lookup("ANTHROPIC_BEDROCK_BASE_URL")
	}
	cfg.proxy = claude.ProxyFunc()
	return cfg
}

func environmentKeys(provider Provider) []string {
	switch provider {
	case ProviderAnthropic:
		return []string{"ANTHROPIC_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderOpenAI:
		return []string{"OPENAI_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderGemini:
		return []string{"GEMINI_API_KEY", "GOOGLE_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderDeepSeek:
		return []string{"DEEPSEEK_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderHuggingFace:
		return []string{"HUGGINGFACE_API_KEY", "HF_TOKEN", "ADOMNIA_AI_API_KEY"}
	case ProviderOpenAICompatible:
		return []string{"OPENAI_COMPATIBLE_API_KEY", "OPENAI_API_KEY", "ADOMNIA_AI_API_KEY"}
	default:
		return nil
	}
}

func requiresAPIKey(provider Provider) bool {
	switch provider {
	case ProviderAnthropic, ProviderOpenAI, ProviderGemini, ProviderDeepSeek, ProviderHuggingFace:
		return true
	default:
		return false
	}
}

func buildProvider(cfg Config) (AIProvider, error) {
	switch cfg.Provider {
	case ProviderAnthropic:
		return newAnthropicProvider(cfg), nil
	case ProviderAmazonBedrock:
		return newBedrockProvider(cfg.Model, cfg.AWSRegion, cfg.AWSProfile, cfg.BaseURL, cfg.proxy), nil
	case ProviderOpenAI:
		base := cfg.BaseURL
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		return newOpenAIProvider(cfg.APIKey, cfg.Model, base), nil
	case ProviderGemini:
		return newGeminiProvider(cfg.APIKey, cfg.Model), nil
	case ProviderDeepSeek:
		base := strings.TrimRight(cfg.BaseURL, "/")
		if base == "" {
			base = "https://api.deepseek.com"
		}
		return newOpenAIProvider(cfg.APIKey, cfg.Model, base), nil
	case ProviderOllama:
		base := cfg.BaseURL
		if base == "" {
			base = "http://localhost:11434"
		}
		return newOllamaProvider(cfg.Model, base), nil
	case ProviderHuggingFace:
		base := cfg.BaseURL
		if base == "" {
			base = "https://router.huggingface.co/v1"
		}
		return newOpenAIProvider(cfg.APIKey, cfg.Model, base), nil
	case ProviderOpenAICompatible:
		base := cfg.BaseURL
		if base == "" {
			base = "http://localhost:1234/v1"
		}
		return newOpenAIProvider(cfg.APIKey, cfg.Model, base), nil
	default:
		return nil, fmt.Errorf("unknown provider: %s", cfg.Provider)
	}
}

var dotEnvNames = []string{".env.local", ".env", ".env.development.local", ".env.development", ".env.production.local", ".env.production"}

func resolveDotEnvCredential(startDir string, keys []string) (string, string) {
	wanted := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		wanted[key] = struct{}{}
	}
	dir, err := filepath.Abs(startDir)
	if err != nil {
		return "", ""
	}
	for depth := 0; depth < 6; depth++ {
		for _, name := range dotEnvNames {
			path := filepath.Join(dir, name)
			if value := readDotEnvCredential(path, wanted); value != "" {
				return value, path
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", ""
}

func readDotEnvCredential(path string, wanted map[string]struct{}) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, raw, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok {
			continue
		}
		if _, ok := wanted[key]; !ok {
			continue
		}
		value := strings.TrimSpace(raw)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		if value != "" {
			return value
		}
	}
	return ""
}

func (e *Engine) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	return e.provider.Complete(ctx, req)
}
