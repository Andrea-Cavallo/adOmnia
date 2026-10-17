package main

import "adomnia/internal/languages/golang"

func (g *GoIDE) GenerateHandlerTest(sessionID, filename, source string, input golang.HandlerTestInput) (golang.HandlerTestPreview, error) {
	return g.service.GenerateHandlerTest(sessionID, filename, source, input)
}

func (g *GoIDE) FindRetryPolicies(sessionID, filename, source string, line int) ([]golang.RetryPolicyCandidate, error) {
	return g.service.FindRetryPolicies(sessionID, filename, source, line)
}
