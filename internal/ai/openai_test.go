package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIProviderUsesCompatibleTokenLimitField(t *testing.T) {
	for _, tc := range []struct{ model, want, unwanted string }{
		{model: "gpt-5.4-mini", want: "max_completion_tokens", unwanted: "max_tokens"},
		{model: "local/qwen", want: "max_tokens", unwanted: "max_completion_tokens"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if _, ok := body[tc.want]; !ok {
					t.Errorf("missing %s in %#v", tc.want, body)
				}
				if _, ok := body[tc.unwanted]; ok {
					t.Errorf("unexpected %s in %#v", tc.unwanted, body)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}]}`))
			}))
			defer server.Close()

			provider := newOpenAIProvider("key", tc.model, server.URL)
			if _, err := provider.Complete(context.Background(), CompletionRequest{UserPrompt: "ping", MaxTokens: 12}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
