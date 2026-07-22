package ai

import (
	"context"
	"fmt"
	"os"
	"strings"
)

type Provider string

const (
	ProviderAnthropic        Provider = "anthropic"
	ProviderOpenAI           Provider = "openai"
	ProviderGemini           Provider = "gemini"
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
}

type CredentialMode string

const (
	// CredentialModeVault preserves the existing renderer/Vault flow. An empty
	// mode is deliberately treated the same way for saved configurations from
	// before this setting existed.
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

// ResolveEnvironmentCredentials reads only the process environment inherited
// by adOmnia. It never returns an environment value to the renderer and is
// used only when the user explicitly selects environment credentials.
func ResolveEnvironmentCredentials(cfg Config) (Config, error) {
	if cfg.CredentialMode != CredentialModeEnvironment {
		return cfg, nil
	}

	keys := environmentKeys(cfg.Provider)
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			cfg.APIKey = value
			return cfg, nil
		}
	}

	if requiresAPIKey(cfg.Provider) {
		return cfg, fmt.Errorf("AI environment credential is missing: set %s and restart adOmnia", strings.Join(keys, " or "))
	}
	// Ollama and OpenAI-compatible runtimes can be unauthenticated.
	cfg.APIKey = ""
	return cfg, nil
}

func environmentKeys(provider Provider) []string {
	switch provider {
	case ProviderAnthropic:
		return []string{"ANTHROPIC_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderOpenAI:
		return []string{"OPENAI_API_KEY", "ADOMNIA_AI_API_KEY"}
	case ProviderGemini:
		return []string{"GEMINI_API_KEY", "GOOGLE_API_KEY", "ADOMNIA_AI_API_KEY"}
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
	case ProviderAnthropic, ProviderOpenAI, ProviderGemini, ProviderHuggingFace:
		return true
	default:
		return false
	}
}

func buildProvider(cfg Config) (AIProvider, error) {
	switch cfg.Provider {
	case ProviderAnthropic:
		return newAnthropicProvider(cfg.APIKey, cfg.Model), nil
	case ProviderOpenAI:
		base := cfg.BaseURL
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		return newOpenAIProvider(cfg.APIKey, cfg.Model, base), nil
	case ProviderGemini:
		return newGeminiProvider(cfg.APIKey, cfg.Model), nil
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

func (e *Engine) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	return e.provider.Complete(ctx, req)
}
