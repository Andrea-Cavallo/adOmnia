package ai

type ollamaProvider struct {
	*openAIProvider
}

func newOllamaProvider(model, baseURL string) *ollamaProvider {
	if model == "" {
		model = "llama3"
	}
	return &ollamaProvider{
		openAIProvider: newOpenAIProvider("ollama", model, baseURL+"/v1"),
	}
}

func (p *ollamaProvider) Name() string { return "ollama" }
