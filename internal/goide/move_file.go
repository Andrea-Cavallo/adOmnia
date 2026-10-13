package goide

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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
	environment = withGoFirstInPath(environment, binary)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	plan, err := planMoveFile(ctx, environment, moduleDir, sourcePath, destinationPath)
	if err != nil {
		return err
	}
	if err := verifyMove(ctx, binary, environment, moduleDir, plan); err != nil {
		return err
	}
	if err := applyMoveFilePlan(plan, sourcePath); err != nil {
		return err
	}
	return nil
}

func planMoveFile(ctx context.Context, environment []string, moduleDir, sourcePath, destinationPath string) (movePlan, error) {
	module, err := loadModule(ctx, environment, moduleDir)
	if err != nil {
		return movePlan{}, err
	}
	source := module.files[filepath.Clean(sourcePath)]
	if source == nil {
		return movePlan{}, errors.New("the file is not part of a Go package in this module")
	}
	targetDirectory := filepath.Clean(filepath.Dir(destinationPath))
	if filepath.Clean(filepath.Dir(sourcePath)) == targetDirectory {
		return movePlan{}, errors.New("the destination is the source package")
	}
	if ensureWithinRoot(moduleDir, targetDirectory) != nil || hasNestedModule(moduleDir, targetDirectory) {
		return movePlan{}, errors.New("the destination must be inside the same Go module")
	}
	if _, err := os.Lstat(destinationPath); err == nil {
		return movePlan{}, fmt.Errorf("%s already exists", filepath.Base(destinationPath))
	} else if !errors.Is(err, os.ErrNotExist) {
		return movePlan{}, err
	}

	sourcePkg := source.pkg.Types
	target := module.byDir[targetDirectory]
	relativeTarget := filepath.ToSlash(relativeWithin(moduleDir, targetDirectory))
	targetPath := module.modulePath
	if relativeTarget != "" && relativeTarget != "." {
		targetPath += "/" + relativeTarget
	}
	targetName := packageNameForDir(targetDirectory)
	if target != nil {
		targetPath, targetName = target.PkgPath, target.Name
	} else if hasGoFiles(targetDirectory) {
		return movePlan{}, errors.New("the destination contains Go files that do not form a valid package")
	}
	if sourcePkg.Name() == "main" || targetName == "main" {
		return movePlan{}, errors.New("files cannot be moved into or out of package main because it is not importable")
	}

	var moved []movedDecl
	movedObjects := map[types.Object]bool{}
	var primary types.Object
	for _, decl := range source.file.Decls {
		general, isGeneral := decl.(*ast.GenDecl)
		if isGeneral && general.Tok == token.IMPORT {
			continue
		}
		objects := objectsDeclaredBy(source.pkg.TypesInfo, decl)
		if len(objects) == 0 {
			return movePlan{}, fmt.Errorf("unsupported declaration in %s", filepath.Base(sourcePath))
		}
		moved = append(moved, movedDecl{info: source, path: filepath.Clean(sourcePath), decl: decl})
		for _, object := range objects {
			movedObjects[object] = true
			if primary == nil || object.Parent() == sourcePkg.Scope() {
				primary = object
			}
			if target != nil && object.Parent() == sourcePkg.Scope() && target.Types.Scope().Lookup(object.Name()) != nil {
				return movePlan{}, fmt.Errorf("%s already exists in %s", object.Name(), targetPath)
			}
		}
	}
	if primary == nil || len(moved) == 0 {
		return movePlan{}, errors.New("the Go file has no declarations to move")
	}

	builder := newMoveBuilder(module, sourcePkg, primary, movedObjects, targetPath, targetName)
	packageOffset := module.fset.Position(source.file.Package).Offset
	if packageOffset > 0 && packageOffset <= len(source.text) {
		builder.destinationPrefix = string(source.text[:packageOffset])
	}
	for _, spec := range source.file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := ""
		if spec.Name != nil {
			name = spec.Name.Name
		}
		if importPath == "C" {
			return movePlan{}, errors.New("cgo files cannot be moved between packages because the C preamble must remain attached to its import")
		}
		builder.movedImports[importPath] = name
	}
	if err := builder.analyseMovedCode(moved); err != nil {
		return movePlan{}, err
	}
	if err := builder.rewriteReferences(moved); err != nil {
		return movePlan{}, err
	}
	if err := builder.checkCycles(); err != nil {
		return movePlan{}, err
	}
	files, err := builder.renderTo(moved, targetDirectory, filepath.Base(destinationPath))
	if err != nil {
		return movePlan{}, err
	}
	packages := []string{filepath.Dir(sourcePath), targetDirectory}
	for _, file := range files {
		packages = appendUnique(packages, filepath.Dir(file.path))
	}
	return movePlan{symbol: filepath.Base(sourcePath), target: targetPath, files: files, packages: packages}, nil
}

func objectsDeclaredBy(info *types.Info, decl ast.Decl) []types.Object {
	var result []types.Object
	switch value := decl.(type) {
	case *ast.FuncDecl:
		if object := info.Defs[value.Name]; object != nil {
			result = append(result, object)
		}
	case *ast.GenDecl:
		for _, raw := range value.Specs {
			switch spec := raw.(type) {
			case *ast.TypeSpec:
				if object := info.Defs[spec.Name]; object != nil {
					result = append(result, object)
				}
			case *ast.ValueSpec:
				for _, name := range spec.Names {
					if object := info.Defs[name]; object != nil {
						result = append(result, object)
					}
				}
			}
		}
	}
	return result
}

func applyMoveFilePlan(plan movePlan, sourcePath string) error {
	sourcePath = filepath.Clean(sourcePath)
	modes := map[string]fs.FileMode{}
	for _, file := range plan.files {
		if info, err := os.Stat(file.path); err == nil {
			modes[filepath.Clean(file.path)] = info.Mode().Perm()
		}
	}
	sourceMode := fs.FileMode(0o644)
	if mode, ok := modes[sourcePath]; ok {
		sourceMode = mode
	}
	var created []string
	var written []movedFile
	rollback := func() {
		for _, path := range created {
			_ = os.Remove(path)
		}
		for _, file := range written {
			mode := modes[filepath.Clean(file.path)]
			if mode == 0 {
				mode = 0o644
			}
			_ = os.WriteFile(file.path, []byte(file.original), mode)
		}
		for _, file := range plan.files {
			if filepath.Clean(file.path) == sourcePath {
				_ = os.MkdirAll(filepath.Dir(sourcePath), 0o755)
				_ = os.WriteFile(sourcePath, []byte(file.original), sourceMode)
				break
			}
		}
	}

	for _, file := range plan.files {
		if filepath.Clean(file.path) == sourcePath {
			continue
		}
		if file.created {
			if err := os.MkdirAll(filepath.Dir(file.path), 0o755); err != nil {
				rollback()
				return err
			}
			handle, err := os.OpenFile(file.path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, sourceMode)
			if err != nil {
				rollback()
				return err
			}
			_, writeErr := handle.WriteString(file.content)
			closeErr := handle.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(file.path)
				rollback()
				return errors.Join(writeErr, closeErr)
			}
			created = append(created, file.path)
			continue
		}
		mode := modes[filepath.Clean(file.path)]
		if mode == 0 {
			mode = 0o644
		}
		if err := os.WriteFile(file.path, []byte(file.content), mode); err != nil {
			rollback()
			return err
		}
		written = append(written, file)
	}
	if err := os.Remove(sourcePath); err != nil {
		rollback()
		return fmt.Errorf("could not remove the original Go file: %w", err)
	}
	return nil
}
