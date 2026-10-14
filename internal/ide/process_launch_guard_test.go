package ide_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Files in this list launch an application the user must see. Hiding these via
// procutil would suppress the browser, file manager, editor or desktop window.
var visibleProcessLaunchers = map[string]bool{
	"internal/browser/browser.go":     true,
	"internal/browser/discover.go":    true,
	"internal/devlog/files.go":        true,
	"internal/goide/fileops.go":       true,
	"internal/sourcemap/sourcemap.go": true,
	"internal/update/apply.go":        true,
}

func TestBackgroundProcessesUseProcutil(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "node_modules" || entry.Name() == "testdata" || entry.Name() == "golangtest" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if relative == "internal/procutil/command.go" || visibleProcessLaunchers[relative] {
			return nil
		}
		set := token.NewFileSet()
		file, err := parser.ParseFile(set, path, nil, 0)
		if err != nil {
			return err
		}
		execNames := map[string]bool{}
		for _, spec := range file.Imports {
			if value, _ := strconv.Unquote(spec.Path.Value); value == "os/exec" {
				name := "exec"
				if spec.Name != nil {
					name = spec.Name.Name
				}
				execNames[name] = true
			}
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || selector.Sel.Name != "Command" && selector.Sel.Name != "CommandContext" {
				return true
			}
			identifier, ok := selector.X.(*ast.Ident)
			if ok && execNames[identifier.Name] {
				position := set.Position(call.Pos())
				t.Errorf("%s:%d launches a background process through os/exec; use internal/procutil", relative, position.Line)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
