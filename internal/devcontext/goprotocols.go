package devcontext

import (
	"go/ast"
	"go/token"
	"regexp"
	"strconv"
	"strings"
)

var (
	grpcRegister = regexp.MustCompile(`^Register(\w+)Server$`)
	// Librerie WebSocket e il nome locale usato quando l'import non ha alias.
	websocketLibs = map[string]string{
		"github.com/gorilla/websocket": "websocket", "nhooyr.io/websocket": "websocket",
		"github.com/coder/websocket": "websocket", "golang.org/x/net/websocket": "websocket",
	}
)

// detectProtocols finds gRPC service registrations (pb.RegisterXServer(s, impl))
// and WebSocket servers/clients. Like the other detectors it reads call shapes
// only: an upgrade inside func serveWS is linked to the route whose handler is
// serveWS later, in linkWebSockets.
func detectProtocols(rel string, fset *token.FileSet, file *ast.File) []Entity {
	wsNames := map[string]bool{}
	for _, imp := range file.Imports {
		p, _ := strconv.Unquote(imp.Path.Value)
		name, ok := websocketLibs[p]
		if !ok {
			continue
		}
		if imp.Name != nil {
			name = imp.Name.Name
		}
		wsNames[name] = true
	}
	address := listenAddress(file)
	var out []Entity
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			line := fset.Position(call.Pos()).Line
			if m := grpcRegister.FindStringSubmatch(sel.Sel.Name); m != nil && len(call.Args) == 2 {
				if pkg, ok := sel.X.(*ast.Ident); ok {
					attrs := map[string]string{"service": m[1], "package": pkg.Name}
					if address != "" {
						attrs["address"] = address
					}
					out = append(out, entity("grpc", pkg.Name+"."+m[1], m[1], ConfidenceInferred, attrs, Source{"goprotocols", rel, line}))
				}
			}
			if len(wsNames) > 0 {
				if e, ok := websocketCall(rel, fn.Name.Name, sel, call, wsNames, line); ok {
					out = append(out, e)
				}
			}
			return true
		})
	}
	return out
}

func websocketCall(rel, fnName string, sel *ast.SelectorExpr, call *ast.CallExpr, wsNames map[string]bool, line int) (Entity, bool) {
	pkg, _ := sel.X.(*ast.Ident)
	fromLib := pkg != nil && wsNames[pkg.Name]
	switch name := sel.Sel.Name; {
	// gorilla: upgrader.Upgrade(w, r, header); nhooyr/coder: websocket.Accept(w, r, opts).
	case (name == "Upgrade" && len(call.Args) == 3 && !fromLib) || (name == "Accept" && fromLib && len(call.Args) == 3):
		return entity("websocket", "server:"+rel+":"+fnName, fnName, ConfidenceInferred,
			map[string]string{"role": "server", "handler": fnName}, Source{"goprotocols", rel, line}), true
	// client: websocket.Dial(ctx, "ws://…", opts) o dialer.Dial("ws://…", header).
	case name == "Dial" || name == "DialContext":
		for _, arg := range call.Args {
			if url, ok := stringLit(arg); ok && (strings.HasPrefix(url, "ws://") || strings.HasPrefix(url, "wss://")) {
				return entity("websocket", "client:"+url, url, ConfidenceInferred,
					map[string]string{"role": "client", "url": url}, Source{"goprotocols", rel, line}), true
			}
		}
	}
	return Entity{}, false
}

// listenAddress returns the first literal address of net.Listen("tcp", ":50051") in the file.
func listenAddress(file *ast.File) string {
	address := ""
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || address != "" || len(call.Args) != 2 {
			return address == ""
		}
		if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Listen" {
			if s, ok := stringLit(call.Args[1]); ok && strings.Contains(s, ":") {
				address = s
			}
		}
		return true
	})
	return address
}

// linkWebSockets gives a server-side WebSocket the path of the route whose
// handler is the function containing the upgrade (h.serveWS matches serveWS).
func linkWebSockets(entities []Entity) {
	handlers := map[string]Entity{}
	for _, e := range entities {
		if e.Kind == "route" && e.Attrs["handler"] != "" {
			h := e.Attrs["handler"]
			handlers[h[strings.LastIndex(h, ".")+1:]] = e
		}
	}
	for i := range entities {
		e := &entities[i]
		if e.Kind != "websocket" || e.Attrs["role"] != "server" {
			continue
		}
		if route, ok := handlers[e.Attrs["handler"]]; ok {
			e.Attrs["path"] = route.Attrs["path"]
			e.Label = route.Attrs["path"]
		}
	}
}
