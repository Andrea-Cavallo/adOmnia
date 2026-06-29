package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type geminiProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func newGeminiProvider(apiKey, model string) *geminiProvider {
	if model == "" {
		model = "gemini-3.5-flash"
	}
	return &geminiProvider{apiKey: apiKey, model: model, client: &http.Client{}}
}

func (p *geminiProvider) Name() string { return "gemini" }

func (p *geminiProvider) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}
	body := map[string]any{
		"contents": []content{
			{Role: "user", Parts: []part{{Text: req.UserPrompt}}},
		},
	}
	if req.SystemPrompt != "" {
		body["systemInstruction"] = map[string]any{
			"parts": []part{{Text: req.SystemPrompt}},
		}
	}
	raw, _ := json.Marshal(body)
	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		p.model, p.apiKey,
	)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	httpReq.Header.Set("content-type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("gemini http: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return CompletionResponse{}, fmt.Errorf("gemini decode: %w", err)
	}
	if out.Error != nil {
		return CompletionResponse{}, fmt.Errorf("gemini API: %s", out.Error.Message)
	}
	text := ""
	if len(out.Candidates) > 0 && len(out.Candidates[0].Content.Parts) > 0 {
		text = out.Candidates[0].Content.Parts[0].Text
	}
	return CompletionResponse{
		Text:         text,
		InputTokens:  out.UsageMetadata.PromptTokenCount,
		OutputTokens: out.UsageMetadata.CandidatesTokenCount,
	}, nil
}
