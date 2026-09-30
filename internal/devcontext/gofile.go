package devcontext

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path"
)

// detectGoFile parses without type checking. Syntax errors are gopls's job:
// the partial AST is used and no warning is raised, so editing never spams.
func detectGoFile(rel string, data []byte) ([]Entity, error) {
	fset := token.NewFileSet()
	file, _ := parser.ParseFile(fset, rel, data, parser.SkipObjectResolution)
	if file == nil || file.Name == nil {
		return nil, nil
	}
	var out []Entity
	out = append(out, detectMain(rel, fset, file)...)
	out = append(out, detectRoutes(rel, fset, file)...)
	out = append(out, detectLiterals(rel, fset, file)...)
	out = append(out, detectProtocols(rel, fset, file)...)
	out = append(out, detectHandlerDecls(rel, fset, file)...)
	return out, nil
}

func detectMain(rel string, fset *token.FileSet, file *ast.File) []Entity {
	if file.Name.Name != "main" {
		return nil
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv != nil || fn.Name.Name != "main" {
			continue
		}
		dir := path.Dir(rel)
		name := path.Base(dir)
		if dir == "." {
			name = "main"
		}
		return []Entity{entity("service", "go:"+dir, name, ConfidenceInferred,
			map[string]string{"origin": "go", "dir": dir}, Source{"gomain", rel, fset.Position(fn.Pos()).Line})}
	}
	return nil
}
