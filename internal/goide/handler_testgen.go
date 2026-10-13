package goide

import (
	"adomnia/internal/languages/golang"
	"fmt"
	"path/filepath"
	"strings"
)

func (s *Service) GenerateHandlerTest(sessionID, filename, source string, input golang.HandlerTestInput) (golang.HandlerTestPreview, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return golang.HandlerTestPreview{}, err
	}
	resolved, err := s.documents.ResolveProjectPath(session.Project, filename)
	if err != nil {
		return golang.HandlerTestPreview{}, err
	}
	if !strings.EqualFold(filepath.Ext(resolved), ".go") {
		return golang.HandlerTestPreview{}, fmt.Errorf("select a Go handler source file")
	}
	relative, err := filepath.Rel(session.Project.RealPath, resolved)
	if err != nil {
		return golang.HandlerTestPreview{}, err
	}
	return golang.GenerateHandlerTest(filepath.ToSlash(relative), source, input)
}

func (s *Service) FindRetryPolicies(sessionID, filename, source string, line int) ([]golang.RetryPolicyCandidate, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if len(source) > 2<<20 {
		return nil, fmt.Errorf("source exceeds 2 MiB")
	}
	if _, err = s.documents.ResolveProjectPath(session.Project, filename); err != nil {
		return nil, err
	}
	return golang.RetryPolicies(filename, source, line)
}
