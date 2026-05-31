package ai

import (
	"context"
	"fmt"
)

type Provider string

const (
	ProviderAnthropic Provider = "anthropic"
	ProviderOpenAI    Provider = "openai"
	ProviderGemini    Provider = "gemini"
	ProviderOllama    Provider = "ollama"
)

type Config struct {
	Provider Provider `json:"provider"`
	Model    string   `json:"model"`
	APIKey   string   `json:"apiKey"`
	BaseURL  string   `json:"baseURL"`
}

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
	p, err := buildProvider(cfg)
	if err != nil {
		return nil, err
	}
	return &Engine{cfg: cfg, provider: p}, nil
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
	default:
		return nil, fmt.Errorf("unknown provider: %s", cfg.Provider)
	}
}

func (e *Engine) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	return e.provider.Complete(ctx, req)
}
