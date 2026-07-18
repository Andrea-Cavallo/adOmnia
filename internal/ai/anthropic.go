package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type anthropicProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func newAnthropicProvider(apiKey, model string) *anthropicProvider {
	if model == "" {
		model = "claude-sonnet-5"
	}
	return &anthropicProvider{apiKey: apiKey, model: model, client: &http.Client{}}
}

func (p *anthropicProvider) Name() string { return "anthropic" }

func (p *anthropicProvider) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	maxTok := req.MaxTokens
	if maxTok == 0 {
		maxTok = 2048
	}
	body := map[string]any{
		"model":      p.model,
		"max_tokens": maxTok,
		"messages":   []map[string]string{{"role": "user", "content": req.UserPrompt}},
	}
	if req.SystemPrompt != "" {
		body["system"] = req.SystemPrompt
	}
	raw, _ := json.Marshal(body)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.anthropic.com/v1/messages", bytes.NewReader(raw))
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("content-type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("anthropic http: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return CompletionResponse{}, fmt.Errorf("anthropic decode: %w", err)
	}
	if out.Error != nil {
		return CompletionResponse{}, fmt.Errorf("anthropic API: %s", out.Error.Message)
	}
	text := ""
	if len(out.Content) > 0 {
		text = out.Content[0].Text
	}
	return CompletionResponse{
		Text:         text,
		InputTokens:  out.Usage.InputTokens,
		OutputTokens: out.Usage.OutputTokens,
	}, nil
}
