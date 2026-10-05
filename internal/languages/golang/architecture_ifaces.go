package golang

import (
	"fmt"
	"go/ast"
	"go/types"
	"sort"
	"strings"
)

const (
	maxArchUsers      = 200
	maxArchNearMisses = 20
	broadInterface    = 6
)

type ArchImplementation struct {
	Type    string   `json:"type"`
	Package string   `json:"package"`
	Pointer bool     `json:"pointer"`
	Test    bool     `json:"test,omitempty"`
	Site    ArchSite `json:"site"`
}

type ArchRef struct {
	Kind     string   `json:"kind"`
	Function string   `json:"function,omitempty"`
	Package  string   `json:"package"`
	Site     ArchSite `json:"site"`
}

// ArchNearMiss è un tipo a cui mancano pochi metodi per implementare l'interfaccia.
type ArchNearMiss struct {
	Type    string   `json:"type"`
	Package string   `json:"package"`
	Missing []string `json:"missing"`
	Site    ArchSite `json:"site"`
}

type ArchMethodUse struct {
	Name  string `json:"name"`
	Calls int    `json:"calls"`
}

type ArchHint struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

type ArchInterface struct {
	Name            string               `json:"name"`
	Package         string               `json:"package"`
	Site            ArchSite             `json:"site"`
	Methods         []string             `json:"methods"`
	Embeds          []string             `json:"embeds"`
	Implementations []ArchImplementation `json:"implementations"`
	Users           []ArchRef            `json:"users"`
	UserCount       int                  `json:"userCount"`
	MethodUses      []ArchMethodUse      `json:"methodUses"`
	NearMisses      []ArchNearMiss       `json:"nearMisses"`
	Hints           []ArchHint           `json:"hints"`
}

type archType struct {
	named *types.Named
	site  ArchSite
	test  bool
}

func (a *architecture) collectInterfaces() {
	var interfaces, concretes []archType
	byObject := map[*types.TypeName]int{}
	for _, file := range a.files {
		test := strings.HasSuffix(file.path, "_test.go")
		for _, decl := range file.file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				object, _ := file.pkg.TypesInfo.Defs[typeSpec.Name].(*types.TypeName)
				if object == nil || object.IsAlias() {
					continue
				}
				named, _ := object.Type().(*types.Named)
				if named == nil || named.TypeParams().Len() > 0 {
					continue
				}
				entry := archType{named: named, site: a.site(typeSpec.Name.Pos()), test: test}
				if iface, ok := named.Underlying().(*types.Interface); ok {
					if iface.IsMethodSet() && iface.NumMethods() > 0 {
						byObject[object] = len(interfaces)
						interfaces = append(interfaces, entry)
					}
					continue
				}
				concretes = append(concretes, entry)
			}
		}
	}
	results := make([]ArchInterface, len(interfaces))
	for index, item := range interfaces {
		results[index] = a.describeInterface(item, concretes)
	}
	a.collectInterfaceUsers(byObject, results)
	for index := range results {
		results[index].Hints = interfaceHints(&results[index])
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Package+"."+results[i].Name < results[j].Package+"."+results[j].Name
	})
	a.report.Interfaces = results
}

func (a *architecture) describeInterface(item archType, concretes []archType) ArchInterface {
	iface := item.named.Underlying().(*types.Interface)
	qualifier := types.RelativeTo(item.named.Obj().Pkg())
	result := ArchInterface{
		Name: item.named.Obj().Name(), Package: item.named.Obj().Pkg().Path(), Site: item.site,
		Methods: []string{}, Embeds: []string{}, Implementations: []ArchImplementation{}, Users: []ArchRef{}, MethodUses: []ArchMethodUse{}, NearMisses: []ArchNearMiss{},
	}
	for index := 0; index < iface.NumMethods(); index++ {
		method := iface.Method(index)
		result.Methods = append(result.Methods, method.Name()+strings.TrimPrefix(types.TypeString(method.Type(), qualifier), "func"))
	}
	for index := 0; index < iface.NumEmbeddeds(); index++ {
		result.Embeds = append(result.Embeds, types.TypeString(iface.EmbeddedType(index), qualifier))
	}
	for _, concrete := range concretes {
		switch {
		case types.Implements(concrete.named, iface):
			result.Implementations = append(result.Implementations, ArchImplementation{Type: concrete.named.Obj().Name(), Package: concrete.named.Obj().Pkg().Path(), Site: concrete.site, Test: concrete.test})
		case types.Implements(types.NewPointer(concrete.named), iface):
			result.Implementations = append(result.Implementations, ArchImplementation{Type: concrete.named.Obj().Name(), Package: concrete.named.Obj().Pkg().Path(), Pointer: true, Site: concrete.site, Test: concrete.test})
		case len(result.NearMisses) < maxArchNearMisses:
			if missing := missingMethods(concrete.named, iface); len(missing) > 0 {
				result.NearMisses = append(result.NearMisses, ArchNearMiss{Type: concrete.named.Obj().Name(), Package: concrete.named.Obj().Pkg().Path(), Missing: missing, Site: concrete.site})
			}
		}
	}
	return result
}

// missingMethods restituisce i metodi mancanti solo se il tipo ne ha già almeno metà (e ne mancano al più 2).
func missingMethods(named *types.Named, iface *types.Interface) []string {
	total := iface.NumMethods()
	if total < 2 {
		return nil
	}
	pointer := types.NewPointer(named)
	var missing []string
	for index := 0; index < total; index++ {
		method := iface.Method(index)
		object, _, _ := types.LookupFieldOrMethod(pointer, true, method.Pkg(), method.Name())
		found, ok := object.(*types.Func)
		switch {
		case !ok:
			missing = append(missing, method.Name())
		case !types.Identical(found.Type(), method.Type()):
			missing = append(missing, method.Name()+" (different signature)")
		}
		if len(missing) > 2 {
			return nil
		}
	}
	if len(missing) == 0 || total-len(missing) < (total+1)/2 {
		return nil
	}
	return missing
}

// collectInterfaceUsers trova dove ogni interfaccia è usata come tipo e quali metodi vengono chiamati.
func (a *architecture) collectInterfaceUsers(byObject map[*types.TypeName]int, results []ArchInterface) {
	seenInfo := map[*types.Info]bool{}
	for _, file := range a.files {
		info := file.pkg.TypesInfo
		inspectWithStack(file.file, func(node ast.Node, stack []ast.Node) bool {
			ident, ok := node.(*ast.Ident)
			if !ok {
				return true
			}
			object, _ := info.Uses[ident].(*types.TypeName)
			index, known := byObject[object]
			if !known {
				return true
			}
			result := &results[index]
			result.UserCount++
			if len(result.Users) < maxArchUsers {
				result.Users = append(result.Users, ArchRef{Kind: typeUseRole(stack), Function: enclosingFuncName(stack), Package: file.pkg.PkgPath, Site: a.site(ident.Pos())})
			}
			return true
		})
		if seenInfo[info] {
			continue
		}
		seenInfo[info] = true
		calls := map[int]map[string]int{}
		for _, selection := range info.Selections {
			if selection.Kind() != types.MethodVal {
				continue
			}
			named, _ := selection.Recv().(*types.Named)
			if named == nil {
				continue
			}
			index, known := byObject[named.Obj()]
			if !known {
				continue
			}
			if calls[index] == nil {
				calls[index] = map[string]int{}
			}
			calls[index][selection.Obj().Name()]++
		}
		for index, methods := range calls {
			for name, count := range methods {
				results[index].MethodUses = addMethodUse(results[index].MethodUses, name, count)
			}
		}
	}
}

func addMethodUse(uses []ArchMethodUse, name string, count int) []ArchMethodUse {
	for index := range uses {
		if uses[index].Name == name {
			uses[index].Calls += count
			return uses
		}
	}
	return append(uses, ArchMethodUse{Name: name, Calls: count})
}

func typeUseRole(stack []ast.Node) string {
	for index := len(stack) - 1; index >= 0; index-- {
		switch node := stack[index].(type) {
		case *ast.FieldList:
			if index > 0 {
				switch parent := stack[index-1].(type) {
				case *ast.FuncType:
					if parent.Results == node {
						return "result"
					}
					return "param"
				case *ast.StructType:
					return "field"
				case *ast.FuncDecl:
					return "receiver"
				}
			}
			return "use"
		case *ast.ValueSpec:
			return "var"
		case *ast.TypeAssertExpr, *ast.CaseClause:
			return "assert"
		case *ast.TypeSpec:
			return "embed"
		case ast.Stmt:
			return "use"
		}
	}
	return "use"
}

func enclosingFuncName(stack []ast.Node) string {
	for index := len(stack) - 1; index >= 0; index-- {
		if fn, ok := stack[index].(*ast.FuncDecl); ok {
			return funcDeclName(fn)
		}
	}
	return ""
}

// interfaceHints: suggerimenti non invasivi, mai errori.
func interfaceHints(item *ArchInterface) []ArchHint {
	hints := []ArchHint{}
	sort.Slice(item.MethodUses, func(i, j int) bool { return item.MethodUses[i].Calls > item.MethodUses[j].Calls })
	if methods := len(item.Methods); methods >= broadInterface && len(item.MethodUses) > 0 && len(item.MethodUses)*3 <= methods {
		names := make([]string, 0, len(item.MethodUses))
		for _, use := range item.MethodUses {
			names = append(names, use.Name)
		}
		hints = append(hints, ArchHint{Kind: "too-broad", Message: fmt.Sprintf("Interface too broad: %d methods, but callers use only %d (%s). Smaller interfaces are easier to implement and mock.", methods, len(names), strings.Join(names, ", "))})
	}
	if len(item.Implementations) == 1 {
		only := item.Implementations[0]
		where := ""
		if only.Test {
			where = " (in a test file)"
		}
		hints = append(hints, ArchHint{Kind: "single-implementation", Message: fmt.Sprintf("Implemented only by %s%s: unless another implementation is planned or it isolates a dependency for tests, the concrete type is simpler.", only.Type, where)})
	}
	if len(item.Implementations) > 0 {
		samePackage := true
		for _, implementation := range item.Implementations {
			samePackage = samePackage && implementation.Package == item.Package
		}
		consumers := map[string]bool{}
		for _, user := range item.Users {
			if user.Package != item.Package && (user.Kind == "param" || user.Kind == "field") {
				consumers[user.Package] = true
			}
		}
		if samePackage && len(consumers) > 0 {
			names := make([]string, 0, len(consumers))
			for name := range consumers {
				names = append(names, name[strings.LastIndex(name, "/")+1:])
			}
			sort.Strings(names)
			hints = append(hints, ArchHint{Kind: "consumer-side", Message: fmt.Sprintf("Declared next to its implementation, but consumed in %s. In Go, interfaces usually belong to the package that uses them.", strings.Join(names, ", "))})
		}
	}
	return hints
}
