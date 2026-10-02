package ai

import (
	"adomnia/internal/netpolicy"

	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultAnthropicBaseURL = "https://api.anthropic.com"

type anthropicProvider struct {
	conn  anthropicConn
	model string
}

// anthropicConn carries everything needed to reach the Messages API: the
// endpoint root (corporate gateway or api.anthropic.com), credential style,
// custom headers and a proxy-aware client.
type anthropicConn struct {
	baseURL   string
	apiKey    string
	authToken string
	headers   http.Header
	client    *http.Client
}

func newAnthropicConn(cfg Config, timeout time.Duration) anthropicConn {
	return anthropicConn{
		baseURL: anthropicRoot(cfg.BaseURL), apiKey: cfg.APIKey, authToken: cfg.AuthToken,
		headers: cfg.headers, client: netpolicy.ClientWithFallbackProxy("ai", timeout, cfg.proxy),
	}
}

// anthropicRoot normalises a base URL to the API root without "/v1", accepting
// both "https://gw.example" (Claude Code style) and ".../v1".
func anthropicRoot(base string) string {
	root := strings.TrimRight(strings.TrimSpace(base), "/")
	if root == "" {
		return defaultAnthropicBaseURL
	}
	return strings.TrimSuffix(root, "/v1")
}

func (c anthropicConn) newRequest(ctx context.Context, method, path string, body []byte) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("anthropic request: invalid base URL")
	}
	for name, values := range c.headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	} else {
		req.Header.Set("x-api-key", c.apiKey)
	}
	req.Header.Set("anthropic-version", "2023-06-01")
	if body != nil {
		req.Header.Set("content-type", "application/json")
	}
	return req, nil
}

func newAnthropicProvider(cfg Config) *anthropicProvider {
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "claude-opus-5-5"
	}
	return &anthropicProvider{conn: newAnthropicConn(cfg, 0), model: model}
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
	httpReq, err := p.conn.newRequest(ctx, http.MethodPost, "/v1/messages", raw)
	if err != nil {
		return CompletionResponse{}, err
	}

	resp, err := p.conn.client.Do(httpReq)
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
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			return CompletionResponse{}, fmt.Errorf("anthropic API: HTTP %d", resp.StatusCode)
		}
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
