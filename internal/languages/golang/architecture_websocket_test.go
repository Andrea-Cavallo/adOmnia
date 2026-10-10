package golang

import (
	"context"
	"go/token"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/tools/go/packages"
)

func TestWebSocketServersAndClients(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"go.mod":                       "module example.com/chat\n\ngo 1.22\n\nrequire github.com/gorilla/websocket v0.0.0\n\nreplace github.com/gorilla/websocket => ./third_party/ws\n",
		"third_party/ws/go.mod":        "module github.com/gorilla/websocket\n\ngo 1.22\n",
		"third_party/ws/ws.go":         "package websocket\n\nimport \"net/http\"\n\ntype Conn struct{}\ntype Upgrader struct{}\nfunc (Upgrader) Upgrade(http.ResponseWriter, *http.Request, http.Header) (*Conn, error) { return nil, nil }\ntype Dialer struct{}\nvar DefaultDialer = &Dialer{}\nfunc (*Dialer) Dial(string, http.Header) (*Conn, *http.Response, error) { return nil, nil, nil }\n",
		"chat/chat.go": `package chat

import (
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{}

func ServeWS(w http.ResponseWriter, r *http.Request) { upgrader.Upgrade(w, r, nil) }

const feed = "ws://localhost:9000/feed"

func Follow() { websocket.DefaultDialer.Dial(feed, nil) }
`,
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fset := token.NewFileSet()
	config := &packages.Config{Context: context.Background(), Dir: root, Fset: fset, Env: append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off"),
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedModule}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		t.Skipf("go/packages unavailable: %v", err)
	}
	byKind := map[string]ArchEntry{}
	for _, entry := range AnalyzeArchitecture(fset, loaded, os.ReadFile).Entries {
		byKind[entry.Kind] = entry
	}
	if server := byKind["websocket-server"]; server.Name != "ServeWS" || server.Detail != "gorilla" {
		t.Fatalf("server: %+v", server)
	}
	if client := byKind["websocket-client"]; client.Name != "ws://localhost:9000/feed" || client.Function != "Follow" {
		t.Fatalf("client: %+v", client)
	}
}
