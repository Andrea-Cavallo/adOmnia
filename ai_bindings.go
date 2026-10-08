package main

import (
	"adomnia/internal/ai"
	"adomnia/internal/aigateway"
	"adomnia/internal/devlog"
	"adomnia/internal/mock"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type AIEngine struct {
	mu      sync.RWMutex
	engine  *ai.Engine
	gateway *aigateway.Gateway
}

func NewAIEngine() *AIEngine { return &AIEngine{gateway: aigateway.New()} }

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
		UserPrompt: "Reply only with: OK",
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

// ClaudeCodeSettingsStatus reports which Claude Code settings files apply to
// the Anthropic/Bedrock providers (user level, plus <workspaceDir>/.claude when
// given; empty means the process working directory). Only file paths and
// variable NAMES are returned — values never reach the renderer.
func (a *AIEngine) ClaudeCodeSettingsStatus(workspaceDir string) (string, error) {
	dir := strings.TrimSpace(workspaceDir)
	if dir == "" {
		dir = ai.DefaultClaudeWorkspaceDir()
	}
	raw, err := json.Marshal(ai.LoadClaudeCodeSettings(dir).Status())
	if err != nil {
		return "", fmt.Errorf("encode Claude Code settings status: %w", err)
	}
	return string(raw), nil
}

type aiGatewayStatus struct {
	aigateway.Status
	Token string `json:"token,omitempty"`
}

// StartGateway exposes the selected OpenAI-compatible provider on a stable,
// loopback-only endpoint for local coding agents. The client-facing token is
// never forwarded upstream; the configured provider credential replaces it.
func (a *AIEngine) StartGateway(cfgJSON string, port int) (string, error) {
	var cfg ai.Config
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return "", fmt.Errorf("invalid AI gateway config: %w", err)
	}
	resolved, err := ai.ResolveEnvironmentCredentials(cfg)
	if err != nil {
		return "", err
	}
	baseURL, err := aigateway.UpstreamBaseURL(resolved)
	if err != nil {
		return "", err
	}
	token, err := aigateway.LoadOrCreateToken()
	if err != nil {
		return "", err
	}
	status, err := a.gateway.Start(aigateway.Config{
		Port: port, Token: token, Provider: string(resolved.Provider),
		UpstreamBaseURL: baseURL, UpstreamAPIKey: resolved.APIKey,
	})
	if err != nil {
		return "", err
	}
	devlog.Info("AIEngine.StartGateway", "gateway AI locale avviato", map[string]any{"port": status.Port, "provider": status.Provider})
	return marshalGatewayStatus(aiGatewayStatus{Status: status, Token: token})
}

func (a *AIEngine) StopGateway() error {
	if a.gateway == nil {
		return nil
	}
	if err := a.gateway.Stop(); err != nil {
		return err
	}
	devlog.Info("AIEngine.StopGateway", "gateway AI locale arrestato", nil)
	return nil
}

func (a *AIEngine) GatewayStatus() (string, error) {
	if a.gateway == nil {
		return marshalGatewayStatus(aiGatewayStatus{})
	}
	status := a.gateway.Status()
	view := aiGatewayStatus{Status: status}
	if status.Running {
		token, err := aigateway.LoadOrCreateToken()
		if err != nil {
			return "", err
		}
		view.Token = token
	}
	return marshalGatewayStatus(view)
}

func marshalGatewayStatus(status aiGatewayStatus) (string, error) {
	raw, err := json.Marshal(status)
	if err != nil {
		return "", fmt.Errorf("encode AI gateway status: %w", err)
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
