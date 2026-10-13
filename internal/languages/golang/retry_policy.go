package golang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"strings"
)

type RetryPolicyCandidate struct {
	Line int    `json:"line"`
	Name string `json:"name"`
}

// Static candidates, never asserted to be the policy that caused the observed retry.
func RetryPolicies(filename, source string, line int) ([]RetryPolicyCandidate, error) {
	fs := token.NewFileSet()
	file, err := parser.ParseFile(fs, filename, source, 0)
	if err != nil {
		return nil, err
	}
	packages := map[string]string{}
	for _, spec := range file.Imports {
		value, _ := strconv.Unquote(spec.Path.Value)
		name := value[strings.LastIndex(value, "/")+1:]
		if spec.Name != nil {
			name = spec.Name.Name
		}
		if strings.Contains(value, "backoff") || strings.Contains(value, "retry") {
			packages[name] = value
		}
	}
	out := []RetryPolicyCandidate{}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil || line < fs.Position(fn.Pos()).Line || line > fs.Position(fn.End()).Line {
			continue
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			pkg, ok := sel.X.(*ast.Ident)
			if !ok || packages[pkg.Name] == "" {
				return true
			}
			out = append(out, RetryPolicyCandidate{Line: fs.Position(call.Pos()).Line, Name: pkg.Name + "." + sel.Sel.Name})
			return true
		})
	}
	return out, nil
}
