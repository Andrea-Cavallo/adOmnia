package aigateway

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"adomnia/internal/ai"
	"adomnia/internal/storage"
)

const tokenKey = "ai-gateway-token"

// UpstreamBaseURL returns the OpenAI-compatible base URL of a provider, or an
// error when the provider does not speak that wire format.
func UpstreamBaseURL(cfg ai.Config) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	switch cfg.Provider {
	case ai.ProviderOllama:
		if base == "" {
			base = "http://localhost:11434"
		}
		if strings.HasSuffix(base, "/v1") {
			return base, nil
		}
		return base + "/v1", nil
	case ai.ProviderOpenAI:
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		return base, nil
	case ai.ProviderDeepSeek:
		if base == "" {
			base = "https://api.deepseek.com"
		}
		return base, nil
	case ai.ProviderHuggingFace:
		if base == "" {
			base = "https://router.huggingface.co/v1"
		}
		return base, nil
	case ai.ProviderOpenAICompatible:
		if base == "" {
			base = "http://localhost:1234/v1"
		}
		return base, nil
	default:
		return "", fmt.Errorf("AI gateway requires Ollama, OpenAI, DeepSeek, Hugging Face, or an OpenAI-compatible provider")
	}
}

// LoadOrCreateToken returns the stable client-facing gateway token, creating
// and persisting it on first use.
func LoadOrCreateToken() (string, error) {
	stored, err := storage.Get("workspace", tokenKey)
	if err != nil {
		return "", fmt.Errorf("load AI gateway token: %w", err)
	}
	if token := strings.TrimSpace(string(stored)); token != "" {
		return token, nil
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate AI gateway token: %w", err)
	}
	token := hex.EncodeToString(raw)
	if err := storage.Put("workspace", tokenKey, []byte(token)); err != nil {
		return "", fmt.Errorf("save AI gateway token: %w", err)
	}
	return token, nil
}
