package main

import (
	"adomnia/internal/ai"
	"adomnia/internal/devlog"
	"adomnia/internal/mock"
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

type AIEngine struct {
	mu     sync.RWMutex
	engine *ai.Engine
}

func NewAIEngine() *AIEngine { return &AIEngine{} }

var globalAIEngine *AIEngine

func (a *AIEngine) Configure(cfgJSON string) error {
	var cfg ai.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return fmt.Errorf("invalid AI config: %w", err)
	}
	e, err := ai.New(cfg)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.engine = e
	a.mu.Unlock()
	devlog.Info("AIEngine.Configure", "provider configurato: "+string(cfg.Provider), nil)
	return nil
}

func (a *AIEngine) Complete(systemPrompt, userPrompt string, maxTokens int) (string, error) {
	a.mu.RLock()
	e := a.engine
	a.mu.RUnlock()
	if e == nil {
		return "", fmt.Errorf("AI engine non configurato — imposta provider nelle Impostazioni > AI")
	}
	resp, err := e.Complete(context.Background(), ai.CompletionRequest{
		SystemPrompt: systemPrompt,
		UserPrompt:   userPrompt,
		MaxTokens:    maxTokens,
	})
	if err != nil {
		return "", err
	}
	return resp.Text, nil
}

func (a *AIEngine) TestConnection(cfgJSON string) (string, error) {
	var cfg ai.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}
	e, err := ai.New(cfg)
	if err != nil {
		return "", err
	}
	resp, err := e.Complete(context.Background(), ai.CompletionRequest{
		UserPrompt: "Rispondi solo con: OK",
		MaxTokens:  10,
	})
	if err != nil {
		return "", err
	}
	return resp.Text, nil
}

func (a *AIEngine) ListModels(cfgJSON, query string) (string, error) {
	var cfg ai.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid config: %w", err)
	}
	resolved, err := ai.ResolveEnvironmentCredentials(cfg)
	if err != nil {
		return "", err
	}
	models, err := ai.DiscoverModels(context.Background(), resolved, query)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(models)
	if err != nil {
		return "", fmt.Errorf("encode models: %w", err)
	}
	return string(raw), nil
}

func (a *AIEngine) GenerateMockEndpoints(inputType, userInput string) (string, error) {
	a.mu.RLock()
	e := a.engine
	a.mu.RUnlock()
	if e == nil {
		return "", fmt.Errorf("AI engine non configurato — imposta provider nelle Impostazioni > AI")
	}
	prompt := mock.BuildMockGenerationPrompt(inputType, userInput)
	resp, err := e.Complete(context.Background(), ai.CompletionRequest{
		UserPrompt: prompt,
		MaxTokens:  2048,
	})
	if err != nil {
		return "", err
	}
	endpoints, err := mock.ParseAIResponse(resp.Text)
	if err != nil {
		return "", fmt.Errorf("AI ha generato JSON non valido: %w\nRisposta raw: %s", err, resp.Text)
	}
	raw, _ := json.Marshal(endpoints)
	return string(raw), nil
}
