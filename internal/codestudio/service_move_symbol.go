package codestudio

import (
	"errors"
	"path"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// MoveSymbol calcola lo spostamento e lo restituisce come anteprima di modifiche multi-file.
func (s *Service) MoveSymbol(sessionID string, request MoveSymbolRequest) (WorkspaceChange, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return WorkspaceChange{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return WorkspaceChange{}, errors.New("explicitly authorize the tools for this project")
	}
	root := session.Project.RealPath
	sourcePath := filepath.Join(root, filepath.FromSlash(request.RelativePath))
	if err := ensureWithinRoot(root, sourcePath); err != nil {
		return WorkspaceChange{}, err
	}
	targetDirectory := filepath.Join(root, filepath.FromSlash(strings.TrimSpace(request.TargetDirectory)))
	if strings.TrimSpace(request.TargetDirectory) == "" || ensureWithinRoot(root, targetDirectory) != nil {
		return WorkspaceChange{}, errors.New("invalid destination folder")
	}
	moduleRelative := moduleForDir(root, goLayoutOf(session.Project).Modules, path.Dir(filepath.ToSlash(request.RelativePath)))
	moduleDir := filepath.Join(root, filepath.FromSlash(moduleRelative))
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return WorkspaceChange{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return WorkspaceChange{}, err
	}
	return golang.MoveSymbol(golang.MoveRequest{Root: root, ModuleDir: moduleDir, SourcePath: sourcePath, Line: request.Line, Column: request.Column, TargetDirectory: targetDirectory, GoBinary: binary, Environment: environment})
}
