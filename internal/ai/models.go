package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ModelInfo is the provider-neutral description kept by the renderer. It is
// deliberately metadata-only: credentials and prompts never enter the local
// model catalog.
type ModelInfo struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Owner            string   `json:"owner,omitempty"`
	Source           string   `json:"source"`
	Context          int      `json:"context,omitempty"`
	OutputLimit      int      `json:"outputLimit,omitempty"`
	Capabilities     []string `json:"capabilities,omitempty"`
	SupportsThinking bool     `json:"supportsThinking,omitempty"`
	Local            bool     `json:"local"`
}

// DiscoverModels asks the configured provider (or local runtime) what this
// user can actually use. It never falls back to a third-party adOmnia service.
func DiscoverModels(ctx context.Context, cfg Config, query string) ([]ModelInfo, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	base := strings.TrimRight(cfg.BaseURL, "/")
	var endpoint string

	switch cfg.Provider {
	case ProviderOllama:
		if base == "" {
			base = "http://localhost:11434"
		}
		endpoint = base + "/api/tags"
	case ProviderHuggingFace:
		if base == "" {
			base = "https://router.huggingface.co/v1"
		}
		endpoint = base + "/models"
	case ProviderOpenAICompatible:
		if base == "" {
			base = "http://localhost:1234/v1"
		}
		endpoint = base + "/models"
	case ProviderOpenAI:
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		endpoint = base + "/models"
	case ProviderAnthropic:
		if base == "" {
			base = "https://api.anthropic.com/v1"
		}
		endpoint = base + "/models?limit=1000"
	case ProviderGemini:
		if base == "" {
			base = "https://generativelanguage.googleapis.com/v1beta"
		}
		endpoint = base + "/models?pageSize=1000"
	default:
		return nil, fmt.Errorf("model discovery is not supported for %s", cfg.Provider)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	switch cfg.Provider {
	case ProviderAnthropic:
		req.Header.Set("x-api-key", cfg.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	case ProviderGemini:
		// Keep the key out of URLs and error strings. Gemini accepts API keys
		// through this standard REST header.
		req.Header.Set("x-goog-api-key", cfg.APIKey)
	default:
		if cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("model discovery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("model discovery returned HTTP %d", resp.StatusCode)
	}

	if cfg.Provider == ProviderOllama {
		var payload struct {
			Models []struct {
				Name    string `json:"name"`
				Model   string `json:"model"`
				Details struct {
					ParameterSize string `json:"parameter_size"`
				} `json:"details"`
			} `json:"models"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("decode Ollama models: %w", err)
		}
		models := make([]ModelInfo, 0, len(payload.Models))
		for _, item := range payload.Models {
			id := item.Model
			if id == "" {
				id = item.Name
			}
			if id != "" {
				models = append(models, ModelInfo{ID: id, Name: id, Owner: item.Details.ParameterSize, Source: "Ollama", Local: true})
			}
		}
		return filterModels(models, query), nil
	}

	if cfg.Provider == ProviderGemini {
		var payload struct {
			Models []struct {
				Name                       string   `json:"name"`
				BaseModelID                string   `json:"baseModelId"`
				DisplayName                string   `json:"displayName"`
				InputTokenLimit            int      `json:"inputTokenLimit"`
				OutputTokenLimit           int      `json:"outputTokenLimit"`
				SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
				Thinking                   bool     `json:"thinking"`
			} `json:"models"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("decode Gemini models: %w", err)
		}
		models := make([]ModelInfo, 0, len(payload.Models))
		for _, item := range payload.Models {
			id := strings.TrimPrefix(item.BaseModelID, "models/")
			if id == "" {
				id = strings.TrimPrefix(item.Name, "models/")
			}
			if id == "" {
				continue
			}
			name := item.DisplayName
			if name == "" {
				name = id
			}
			models = append(models, ModelInfo{
				ID:               id,
				Name:             name,
				Source:           "Gemini",
				Context:          item.InputTokenLimit,
				OutputLimit:      item.OutputTokenLimit,
				Capabilities:     item.SupportedGenerationMethods,
				SupportsThinking: item.Thinking,
			})
		}
		return filterModels(models, query), nil
	}

	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
			OwnedBy     string `json:"owned_by"`
			Providers   []struct {
				Status  string `json:"status"`
				Context int    `json:"context_length"`
			} `json:"providers"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode model list: %w", err)
	}
	models := make([]ModelInfo, 0, len(payload.Data))
	for _, item := range payload.Data {
		if item.ID == "" {
			continue
		}
		contextSize := 0
		for _, provider := range item.Providers {
			if provider.Status == "live" && provider.Context > contextSize {
				contextSize = provider.Context
			}
		}
		name := item.DisplayName
		if name == "" {
			name, _ = url.PathUnescape(item.ID)
		}
		models = append(models, ModelInfo{
			ID: item.ID, Name: name, Owner: item.OwnedBy, Source: string(cfg.Provider),
			Context: contextSize, Local: cfg.Provider == ProviderOpenAICompatible,
		})
	}
	return filterModels(models, query), nil
}

func filterModels(models []ModelInfo, query string) []ModelInfo {
	needle := strings.ToLower(strings.TrimSpace(query))
	filtered := make([]ModelInfo, 0, len(models))
	for _, model := range models {
		if needle != "" && !strings.Contains(strings.ToLower(model.ID+" "+model.Name+" "+model.Owner), needle) {
			continue
		}
		filtered = append(filtered, model)
		if len(filtered) >= 100 {
			break
		}
	}
	return filtered
}
