package codestudio

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
)

// moveGoFile is the semantic counterpart of a Project-tree drag between packages.
// It moves every declaration in the file, rewrites references and imports, verifies the
// affected packages with an overlay, then applies the checked plan transactionally.
func (s *Service) moveGoFile(sessionID, from, to string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return errors.New("trust this project before moving Go files between packages")
	}
	sourcePath, info, err := resolveExistingEntry(session.Project, from)
	if err != nil {
		return err
	}
	if info.IsDir() || info.Mode()&fs.ModeSymlink != 0 || !strings.EqualFold(filepath.Ext(sourcePath), ".go") {
		return errors.New("the semantic move requires a regular Go file")
	}
	destinationPath, err := resolveNewFilePath(session.Project, to)
	if err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Ext(destinationPath), ".go") {
		return errors.New("the destination must be a Go file")
	}
	if _, err := os.Lstat(destinationPath); err == nil {
		return fmt.Errorf("%s already exists", filepath.ToSlash(to))
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	moduleRelative := moduleForDir(session.Project.RealPath, goLayoutOf(session.Project).Modules, filepath.ToSlash(filepath.Dir(from)))
	moduleDir := filepath.Join(session.Project.RealPath, filepath.FromSlash(moduleRelative))
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return err
	}
	return golang.MoveGoFile(golang.MoveFileRequest{ModuleDir: moduleDir, SourcePath: sourcePath, DestinationPath: destinationPath, GoBinary: binary, Environment: environment})
}
