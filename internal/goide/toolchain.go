package goide

import "sync"

type ToolchainConfiguration struct {
	GoBinary    string            `json:"goBinary"`
	GOROOT      string            `json:"goroot,omitempty"`
	GOPATH      string            `json:"gopath,omitempty"`
	GOPROXY     string            `json:"goproxy,omitempty"`
	GOPRIVATE   string            `json:"goprivate,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
}

type ToolchainManager struct {
	mu      sync.RWMutex
	configs map[SessionID]ToolchainConfiguration
}

func NewToolchainManager() *ToolchainManager {
	return &ToolchainManager{configs: make(map[SessionID]ToolchainConfiguration)}
}
