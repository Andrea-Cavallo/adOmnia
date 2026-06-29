package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type openAIProvider struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

func newOpenAIProvider(apiKey, model, baseURL string) *openAIProvider {
	if model == "" {
		model = "gpt-5.4-mini"
	}
	return &openAIProvider{apiKey: apiKey, model: model, baseURL: baseURL, client: &http.Client{}}
}

func (p *openAIProvider) Name() string { return "openai" }

func (p *openAIProvider) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	maxTok := req.MaxTokens
	if maxTok == 0 {
		maxTok = 2048
	}
	messages := []map[string]string{}
	if req.SystemPrompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": req.SystemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": req.UserPrompt})

	body := map[string]any{"model": p.model, "messages": messages}
	if strings.HasPrefix(p.model, "gpt-5") || strings.HasPrefix(p.model, "o1") || strings.HasPrefix(p.model, "o3") || strings.HasPrefix(p.model, "o4") {
		body["max_completion_tokens"] = maxTok
	} else {
		body["max_tokens"] = maxTok
	}
	raw, _ := json.Marshal(body)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		p.baseURL+"/chat/completions", bytes.NewReader(raw))
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("content-type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("openai http: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return CompletionResponse{}, fmt.Errorf("openai decode: %w", err)
	}
	if out.Error != nil {
		return CompletionResponse{}, fmt.Errorf("openai API: %s", out.Error.Message)
	}
	text := ""
	if len(out.Choices) > 0 {
		text = out.Choices[0].Message.Content
	}
	return CompletionResponse{
		Text:         text,
		InputTokens:  out.Usage.PromptTokens,
		OutputTokens: out.Usage.CompletionTokens,
	}, nil
}
