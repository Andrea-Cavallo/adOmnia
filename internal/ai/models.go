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

type ModelInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Owner   string `json:"owner,omitempty"`
	Source  string `json:"source"`
	Context int    `json:"context,omitempty"`
	Local   bool   `json:"local"`
}

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
	default:
		return nil, fmt.Errorf("model discovery is not available for %s; use the curated catalog", cfg.Provider)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("model discovery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("model discovery returned HTTP %d", resp.StatusCode)
	}

	needle := strings.ToLower(strings.TrimSpace(query))
	keep := func(id, name string) bool {
		return needle == "" || strings.Contains(strings.ToLower(id+" "+name), needle)
	}
	models := make([]ModelInfo, 0)

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
		for _, item := range payload.Models {
			id := item.Model
			if id == "" {
				id = item.Name
			}
			if keep(id, item.Details.ParameterSize) {
				models = append(models, ModelInfo{ID: id, Name: id, Owner: item.Details.ParameterSize, Source: "Ollama", Local: true})
			}
		}
		return models, nil
	}

	var payload struct {
		Data []struct {
			ID        string `json:"id"`
			OwnedBy   string `json:"owned_by"`
			Providers []struct {
				Status  string `json:"status"`
				Context int    `json:"context_length"`
			} `json:"providers"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode model list: %w", err)
	}
	for _, item := range payload.Data {
		if !keep(item.ID, item.OwnedBy) {
			continue
		}
		contextSize := 0
		for _, provider := range item.Providers {
			if provider.Status == "live" && provider.Context > contextSize {
				contextSize = provider.Context
			}
		}
		name, _ := url.PathUnescape(item.ID)
		models = append(models, ModelInfo{ID: item.ID, Name: name, Owner: item.OwnedBy, Source: string(cfg.Provider), Context: contextSize, Local: cfg.Provider == ProviderOpenAICompatible})
		if len(models) >= 40 {
			break
		}
	}
	return models, nil
}
