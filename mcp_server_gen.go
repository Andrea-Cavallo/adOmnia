package main

import "adomnia/internal/mcp/generator"

type MCPServerGenerator struct{}

func NewMCPServerGenerator() *MCPServerGenerator {
	return &MCPServerGenerator{}
}

func (g *MCPServerGenerator) Generate(inputJSON, outputDir string) string {
	if err := generator.Generate(inputJSON, outputDir); err != nil {
		return err.Error()
	}
	return ""
}
